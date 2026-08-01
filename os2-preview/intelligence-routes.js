'use strict';

const express = require('express');
const crypto = require('crypto');
const { withTransaction } = require('./core/transactions');
const { appendAudit } = require('./core/audit');
const { requirePermission } = require('./core/permissions');

const OPPORTUNITY_STAGES = new Set(['identified','qualified','proposal','negotiation','won','lost','archived']);

function text(value, max = 255) {
  const result = String(value == null ? '' : value).trim();
  return result ? result.slice(0, max) : null;
}
function id(value) {
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : null;
}
function context(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
  };
}
function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function csvCell(value) {
  const string = value == null ? '' : String(value);
  return /[",\n\r]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}
function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.map(csvCell).join(','), ...rows.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\n');
}

module.exports = function createIntelligenceRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use('/api/os2', requireAuth);

  router.get('/api/os2/opportunities', async (req, res) => {
    const where = ['o.archived_at IS NULL'];
    const params = {};
    if (!['owner','manager','admin'].includes(String(req.user.role))) {
      where.push('o.assigned_staff_id=:staffId');
      params.staffId = Number(req.user.id);
    }
    if (text(req.query.stage, 40)) {
      where.push('o.stage=:stage');
      params.stage = text(req.query.stage, 40);
    }
    const [rows] = await pool.execute(`
      SELECT o.*, mc.display_name customer_name, su.full_name assigned_staff_name
        FROM os2_opportunities o
        LEFT JOIN os2_master_customers mc ON mc.id=o.master_customer_id
        LEFT JOIN staff_users su ON su.id=o.assigned_staff_id
       WHERE ${where.join(' AND ')}
       ORDER BY FIELD(o.stage,'negotiation','proposal','qualified','identified','won','lost','archived'),
                COALESCE(o.expected_close_date,'9999-12-31'), o.updated_at DESC`, params);
    res.json({ ok:true, opportunities:rows });
  });

  router.post('/api/os2/opportunities', requirePermission('work.create'), async (req, res) => {
    const title = text(req.body.title, 240);
    const opportunityType = text(req.body.opportunityType, 80);
    if (!title || !opportunityType) return res.status(400).json({ ok:false, error:'TITLE_AND_TYPE_REQUIRED' });
    try {
      const opportunityId = await withTransaction(pool, async connection => {
        const [insert] = await connection.execute(`
          INSERT INTO os2_opportunities
            (master_customer_id,opportunity_type,title,description,value_estimate,probability_percent,
             stage,assigned_staff_id,source,expected_close_date,created_by,updated_by,created_at,updated_at)
          VALUES
            (:customerId,:type,:title,:description,:valueEstimate,:probability,'identified',:assignee,
             :source,:expectedCloseDate,:actor,:actor,NOW(),NOW())`, {
          customerId:id(req.body.masterCustomerId), type:opportunityType, title,
          description:text(req.body.description, 5000),
          valueEstimate:req.body.valueEstimate == null ? null : Number(req.body.valueEstimate),
          probability:Math.max(0, Math.min(100, Number(req.body.probabilityPercent || 0))),
          assignee:id(req.body.assignedStaffId) || Number(req.user.id),
          source:text(req.body.source, 120), expectedCloseDate:req.body.expectedCloseDate || null,
          actor:Number(req.user.id)
        });
        const newId = Number(insert.insertId);
        await connection.execute(`INSERT INTO os2_opportunity_history
          (opportunity_id,from_stage,to_stage,note,changed_by,created_at)
          VALUES (:id,NULL,'identified','Opportunity created',:actor,NOW())`, { id:newId, actor:Number(req.user.id) });
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'opportunity_created', entityType:'os2_opportunities',
          entityId:newId, masterCustomerId:id(req.body.masterCustomerId), description:`Created opportunity ${title}`,
          after:req.body, requestContext:context(req)
        });
        return newId;
      });
      res.status(201).json({ ok:true, opportunityId });
    } catch (error) {
      console.error('Opportunity create failed', error.code || error.message);
      res.status(500).json({ ok:false, error:'OPPORTUNITY_CREATE_FAILED' });
    }
  });

  router.post('/api/os2/opportunities/:id/stage', async (req, res) => {
    const opportunityId = id(req.params.id);
    const toStage = text(req.body.stage, 40);
    if (!opportunityId || !OPPORTUNITY_STAGES.has(toStage)) return res.status(400).json({ ok:false, error:'INVALID_OPPORTUNITY_STAGE' });
    try {
      const result = await withTransaction(pool, async connection => {
        const [[row]] = await connection.execute('SELECT * FROM os2_opportunities WHERE id=:id FOR UPDATE', { id:opportunityId });
        if (!row) throw Object.assign(new Error('OPPORTUNITY_NOT_FOUND'), { statusCode:404 });
        const manager = ['owner','manager','admin'].includes(String(req.user.role));
        if (!manager && Number(row.assigned_staff_id) !== Number(req.user.id)) {
          throw Object.assign(new Error('INSUFFICIENT_PERMISSION'), { statusCode:403 });
        }
        const wonAt = toStage === 'won' ? new Date() : row.won_at;
        const lostAt = toStage === 'lost' ? new Date() : row.lost_at;
        await connection.execute(`UPDATE os2_opportunities
          SET stage=:stage,won_at=:wonAt,lost_at=:lostAt,loss_reason=:lossReason,
              probability_percent=:probability,updated_by=:actor,updated_at=NOW(),
              archived_at=IF(:stage='archived',NOW(),archived_at)
          WHERE id=:id`, {
          id:opportunityId, stage:toStage, wonAt, lostAt,
          lossReason:toStage === 'lost' ? text(req.body.reason, 500) : row.loss_reason,
          probability:toStage === 'won' ? 100 : (toStage === 'lost' ? 0 : Number(req.body.probabilityPercent ?? row.probability_percent ?? 0)),
          actor:Number(req.user.id)
        });
        await connection.execute(`INSERT INTO os2_opportunity_history
          (opportunity_id,from_stage,to_stage,note,changed_by,created_at)
          VALUES (:id,:fromStage,:toStage,:note,:actor,NOW())`, {
          id:opportunityId, fromStage:row.stage, toStage, note:text(req.body.note, 5000), actor:Number(req.user.id)
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'opportunity_stage_changed', entityType:'os2_opportunities',
          entityId:opportunityId, masterCustomerId:row.master_customer_id,
          description:`Opportunity moved from ${row.stage} to ${toStage}`,
          before:{stage:row.stage}, after:{stage:toStage}, requestContext:context(req)
        });
        return { opportunityId, fromStage:row.stage, toStage };
      });
      res.json({ ok:true, ...result });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok:false, error:error.statusCode ? error.message : 'OPPORTUNITY_STAGE_FAILED' });
    }
  });

  router.post('/api/os2/attendance-corrections', async (req, res) => {
    const sessionId = id(req.body.attendanceSessionId);
    if (!sessionId || !text(req.body.reason, 1000)) return res.status(400).json({ ok:false, error:'SESSION_AND_REASON_REQUIRED' });
    try {
      const correctionId = await withTransaction(pool, async connection => {
        const [[session]] = await connection.execute('SELECT * FROM attendance_sessions WHERE id=:id FOR UPDATE', { id:sessionId });
        if (!session) throw Object.assign(new Error('ATTENDANCE_SESSION_NOT_FOUND'), { statusCode:404 });
        const manager = ['owner','manager'].includes(String(req.user.role));
        if (!manager && Number(session.staff_id) !== Number(req.user.id)) throw Object.assign(new Error('INSUFFICIENT_PERMISSION'), { statusCode:403 });
        const [insert] = await connection.execute(`INSERT INTO os2_attendance_corrections
          (attendance_session_id,staff_id,requested_clock_in,requested_clock_out,reason,status,
           requested_by,requested_at,original_clock_in,original_clock_out,created_at,updated_at)
          VALUES (:sessionId,:staffId,:clockIn,:clockOut,:reason,'pending',:actor,NOW(),
                  :originalIn,:originalOut,NOW(),NOW())`, {
          sessionId, staffId:Number(session.staff_id), clockIn:dateValue(req.body.clockIn), clockOut:dateValue(req.body.clockOut),
          reason:text(req.body.reason, 1000), actor:Number(req.user.id),
          originalIn:session.clock_in_at, originalOut:session.clock_out_at
        });
        const correctionId = Number(insert.insertId);
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'attendance_correction_requested', entityType:'os2_attendance_corrections',
          entityId:correctionId, description:`Requested attendance correction for session ${sessionId}`,
          after:req.body, requestContext:context(req)
        });
        return correctionId;
      });
      res.status(201).json({ ok:true, correctionId });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok:false, error:error.statusCode ? error.message : 'ATTENDANCE_CORRECTION_CREATE_FAILED' });
    }
  });

  router.post('/api/os2/attendance-corrections/:id/decision', requirePermission('attendance.correct'), async (req, res) => {
    const correctionId = id(req.params.id);
    const decision = text(req.body.decision, 20);
    if (!correctionId || !['approved','rejected'].includes(decision)) return res.status(400).json({ ok:false, error:'INVALID_CORRECTION_DECISION' });
    try {
      await withTransaction(pool, async connection => {
        const [[correction]] = await connection.execute('SELECT * FROM os2_attendance_corrections WHERE id=:id FOR UPDATE', { id:correctionId });
        if (!correction) throw Object.assign(new Error('ATTENDANCE_CORRECTION_NOT_FOUND'), { statusCode:404 });
        if (correction.status !== 'pending') throw Object.assign(new Error('ATTENDANCE_CORRECTION_ALREADY_DECIDED'), { statusCode:409 });
        if (Number(correction.requested_by) === Number(req.user.id)) throw Object.assign(new Error('SELF_APPROVAL_NOT_ALLOWED'), { statusCode:409 });
        if (decision === 'approved') {
          await connection.execute(`UPDATE attendance_sessions
            SET clock_in_at=COALESCE(:clockIn,clock_in_at),clock_out_at=:clockOut,updated_at=NOW()
            WHERE id=:sessionId`, {
            sessionId:correction.attendance_session_id,
            clockIn:correction.requested_clock_in,
            clockOut:correction.requested_clock_out
          });
        }
        await connection.execute(`UPDATE os2_attendance_corrections
          SET status=:decision,reviewed_by=:actor,reviewed_at=NOW(),review_reason=:reason,
              applied_at=IF(:decision='approved',NOW(),NULL),updated_at=NOW()
          WHERE id=:id`, {
          id:correctionId, decision, actor:Number(req.user.id), reason:text(req.body.reason, 1000)
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'attendance_correction_decided', entityType:'os2_attendance_corrections',
          entityId:correctionId, description:`Attendance correction ${correctionId} ${decision}`,
          before:{status:'pending'}, after:{status:decision}, requestContext:context(req)
        });
      });
      res.json({ ok:true, correctionId, decision });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok:false, error:error.statusCode ? error.message : 'ATTENDANCE_CORRECTION_DECISION_FAILED' });
    }
  });

  router.get('/api/os2/reports/:type', requirePermission('report.read'), async (req, res) => {
    const type = text(req.params.type, 100);
    const reportSql = {
      customer_summary: `SELECT mc.id,mc.display_name,mc.customer_type,mc.town,mc.status,
        COUNT(DISTINCT ca.id) account_count,COUNT(DISTINCT ml.id) mobile_line_count,
        COUNT(DISTINCT fs.id) fixed_service_count,COALESCE(su.full_name,'Unassigned') owner_name
        FROM os2_master_customers mc
        LEFT JOIN os2_customer_accounts ca ON ca.master_customer_id=mc.id AND ca.archived_at IS NULL
        LEFT JOIN os2_mobile_lines ml ON ml.master_customer_id=mc.id AND ml.archived_at IS NULL
        LEFT JOIN os2_fixed_accounts fa ON fa.master_customer_id=mc.id AND fa.archived_at IS NULL
        LEFT JOIN os2_fixed_services fs ON fs.fixed_account_id=fa.id AND fs.archived_at IS NULL
        LEFT JOIN os2_customer_ownership ow ON ow.master_customer_id=mc.id AND ow.is_current=1
        LEFT JOIN staff_users su ON su.id=ow.assigned_staff_id
        WHERE mc.archived_at IS NULL GROUP BY mc.id,su.full_name ORDER BY mc.display_name`,
      work_pipeline: `SELECT w.id,w.work_type,w.title,w.priority,w.lifecycle_state,w.start_at,w.due_at,
        mc.display_name customer_name,COALESCE(su.full_name,'Unassigned') assignee
        FROM os2_work_items w LEFT JOIN os2_master_customers mc ON mc.id=w.master_customer_id
        LEFT JOIN staff_users su ON su.id=w.assigned_staff_id WHERE w.archived_at IS NULL
        ORDER BY FIELD(w.priority,'urgent','high','normal','low'),COALESCE(w.due_at,w.start_at,w.created_at)`,
      opportunity_pipeline: `SELECT o.id,o.opportunity_type,o.title,o.stage,o.value_estimate,o.probability_percent,
        o.expected_close_date,mc.display_name customer_name,su.full_name assignee
        FROM os2_opportunities o LEFT JOIN os2_master_customers mc ON mc.id=o.master_customer_id
        LEFT JOIN staff_users su ON su.id=o.assigned_staff_id WHERE o.archived_at IS NULL
        ORDER BY FIELD(o.stage,'negotiation','proposal','qualified','identified','won','lost'),o.expected_close_date`,
      attendance_exceptions: `SELECT c.id,c.status,c.reason,c.requested_clock_in,c.requested_clock_out,
        c.original_clock_in,c.original_clock_out,c.requested_at,s.full_name staff_member,r.full_name requested_by_name
        FROM os2_attendance_corrections c LEFT JOIN staff_users s ON s.id=c.staff_id
        LEFT JOIN staff_users r ON r.id=c.requested_by ORDER BY c.requested_at DESC`
    };
    if (!reportSql[type]) return res.status(404).json({ ok:false, error:'REPORT_NOT_FOUND' });
    try {
      const [rows] = await pool.query(reportSql[type]);
      if (String(req.query.format || '').toLowerCase() === 'csv') {
        const csv = rowsToCsv(rows);
        const fileName = `${type}-${new Date().toISOString().slice(0,10)}.csv`;
        const hash = crypto.createHash('sha256').update(csv).digest('hex');
        await pool.execute(`INSERT INTO os2_report_exports
          (report_type,requested_by,filter_json,row_count,export_format,file_name,file_hash,generated_at,created_at)
          VALUES (:type,:actor,:filters,:rowCount,'csv',:fileName,:hash,NOW(),NOW())`, {
          type, actor:Number(req.user.id), filters:JSON.stringify(req.query || {}), rowCount:rows.length, fileName, hash
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(csv);
      }
      res.json({ ok:true, report:type, rowCount:rows.length, rows });
    } catch (error) {
      console.error('Report failed', type, error.code || error.message);
      res.status(500).json({ ok:false, error:'REPORT_GENERATION_FAILED' });
    }
  });

  return router;
};
