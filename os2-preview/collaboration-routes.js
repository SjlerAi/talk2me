'use strict';

const express = require('express');
const { withTransaction } = require('./core/transaction');
const { appendAudit } = require('./core/audit');
const { transferOwnership, getCurrentOwner } = require('./core/ownership');
const { requirePermission } = require('./core/permissions');

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function text(value, max = 255) {
  const result = String(value == null ? '' : value).trim();
  return result ? result.slice(0, max) : null;
}
function context(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
  };
}
function knownError(res, error, fallback) {
  const known = new Set([
    'CUSTOMER_NOT_FOUND','CLAIM_ALREADY_PENDING','CLAIM_NOT_FOUND','CLAIM_ALREADY_FINAL',
    'SELF_APPROVAL_NOT_ALLOWED','INVALID_CLAIM_DECISION','NOT_CLAIM_REQUESTER',
    'CALENDAR_EVENT_NOT_FOUND','STICKY_NOTE_NOT_FOUND','STICKY_NOTE_ACCESS_DENIED'
  ]);
  const status = error.statusCode || (known.has(error.message) ? 409 : 500);
  return res.status(status).json({ ok:false, error:known.has(error.message) ? error.message : fallback });
}

module.exports = function createCollaborationRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use('/api/os2', requireAuth);

  router.get('/api/os2/claims', async (req, res) => {
    const scope = text(req.query.scope, 20) || 'mine';
    const status = text(req.query.status, 30) || 'pending';
    const management = ['owner','manager','admin'].includes(String(req.user.role).toLowerCase());
    const where = ["(:status='all' OR cr.status=:status)"];
    const params = { status };
    if (!(scope === 'team' && management)) {
      where.push('(cr.requested_by=:staffId OR cr.requested_owner_staff_id=:staffId)');
      params.staffId = Number(req.user.id);
    }
    try {
      const [rows] = await pool.execute(`
        SELECT cr.*,mc.display_name customer_name,
               requester.full_name requester_name,current_owner.full_name current_owner_name,
               requested_owner.full_name requested_owner_name,reviewer.full_name reviewer_name
          FROM os2_claim_requests cr
          JOIN os2_master_customers mc ON mc.id=cr.master_customer_id
          JOIN staff_users requester ON requester.id=cr.requested_by
          LEFT JOIN staff_users current_owner ON current_owner.id=cr.current_owner_staff_id
          JOIN staff_users requested_owner ON requested_owner.id=cr.requested_owner_staff_id
          LEFT JOIN staff_users reviewer ON reviewer.id=cr.reviewed_by
         WHERE ${where.join(' AND ')}
         ORDER BY FIELD(cr.status,'pending','approved','rejected','cancelled'),cr.created_at DESC
         LIMIT 250`, params);
      res.json({ ok:true, claims:rows });
    } catch (error) { knownError(res, error, 'CLAIMS_LOAD_FAILED'); }
  });

  router.post('/api/os2/customers/:id/claims', async (req, res) => {
    const masterCustomerId = positiveId(req.params.id);
    const requestedOwnerStaffId = positiveId(req.body.requestedOwnerStaffId) || Number(req.user.id);
    const reason = text(req.body.reason, 1000);
    if (!masterCustomerId || !reason) return res.status(400).json({ ok:false, error:'CUSTOMER_AND_REASON_REQUIRED' });
    try {
      const claimId = await withTransaction(pool, async connection => {
        const [[customer]] = await connection.execute('SELECT id,display_name FROM os2_master_customers WHERE id=:id AND archived_at IS NULL FOR UPDATE', { id:masterCustomerId });
        if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
        const owner = await getCurrentOwner(connection, masterCustomerId);
        const [[pending]] = await connection.execute(`SELECT id FROM os2_claim_requests
          WHERE master_customer_id=:masterCustomerId AND status='pending' LIMIT 1 FOR UPDATE`, { masterCustomerId });
        if (pending) throw new Error('CLAIM_ALREADY_PENDING');
        const [result] = await connection.execute(`INSERT INTO os2_claim_requests
          (master_customer_id,requested_by,current_owner_staff_id,requested_owner_staff_id,reason,status,created_at,updated_at)
          VALUES (:masterCustomerId,:requestedBy,:currentOwner,:requestedOwner,:reason,'pending',NOW(),NOW())`, {
          masterCustomerId, requestedBy:Number(req.user.id), currentOwner:owner?.assigned_staff_id || null,
          requestedOwner:requestedOwnerStaffId, reason
        });
        const id = Number(result.insertId);
        await connection.execute(`INSERT INTO os2_claim_history
          (claim_request_id,from_status,to_status,note,changed_by,created_at)
          VALUES (:id,NULL,'pending',:reason,:staffId,NOW())`, { id, reason, staffId:Number(req.user.id) });
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'customer_claim_requested', entityType:'os2_claim_requests', entityId:id,
          masterCustomerId, description:`Requested ownership of ${customer.display_name}`,
          after:{ requested_owner_staff_id:requestedOwnerStaffId, reason }, requestContext:context(req)
        });
        return id;
      });
      res.status(201).json({ ok:true, claimId });
    } catch (error) { knownError(res, error, 'CLAIM_CREATE_FAILED'); }
  });

  router.post('/api/os2/claims/:id/decision', requirePermission('assignment.approve'), async (req, res) => {
    const decision = text(req.body.decision, 30);
    if (!['approved','rejected'].includes(decision)) return res.status(400).json({ ok:false, error:'INVALID_CLAIM_DECISION' });
    try {
      const result = await withTransaction(pool, async connection => {
        const [[claim]] = await connection.execute('SELECT * FROM os2_claim_requests WHERE id=:id FOR UPDATE', { id:Number(req.params.id) });
        if (!claim) throw new Error('CLAIM_NOT_FOUND');
        if (claim.status !== 'pending') throw new Error('CLAIM_ALREADY_FINAL');
        if (Number(claim.requested_by) === Number(req.user.id)) throw new Error('SELF_APPROVAL_NOT_ALLOWED');
        let ownershipResult = null;
        if (decision === 'approved') {
          ownershipResult = await transferOwnership(connection, {
            masterCustomerId:claim.master_customer_id,
            assignedStaffId:claim.requested_owner_staff_id,
            reason:'approved_claim',
            actorStaffId:req.user.id,
            requestContext:context(req)
          });
        }
        await connection.execute(`UPDATE os2_claim_requests SET status=:decision,reviewed_by=:reviewer,
          reviewed_at=NOW(),decision_reason=:reason,updated_at=NOW() WHERE id=:id`, {
          id:Number(claim.id), decision, reviewer:Number(req.user.id), reason:text(req.body.reason, 1000)
        });
        await connection.execute(`INSERT INTO os2_claim_history
          (claim_request_id,from_status,to_status,note,changed_by,created_at)
          VALUES (:id,'pending',:decision,:reason,:reviewer,NOW())`, {
          id:Number(claim.id), decision, reason:text(req.body.reason, 1000), reviewer:Number(req.user.id)
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'customer_claim_decided', entityType:'os2_claim_requests', entityId:claim.id,
          masterCustomerId:claim.master_customer_id, description:`Claim ${claim.id} ${decision}`,
          before:{ status:'pending' }, after:{ status:decision, ownershipResult }, requestContext:context(req)
        });
        return { claimId:Number(claim.id), decision, ownershipResult };
      });
      res.json({ ok:true, ...result });
    } catch (error) { knownError(res, error, 'CLAIM_DECISION_FAILED'); }
  });

  router.post('/api/os2/claims/:id/cancel', async (req, res) => {
    try {
      const result = await withTransaction(pool, async connection => {
        const [[claim]] = await connection.execute('SELECT * FROM os2_claim_requests WHERE id=:id FOR UPDATE', { id:Number(req.params.id) });
        if (!claim) throw new Error('CLAIM_NOT_FOUND');
        if (claim.status !== 'pending') throw new Error('CLAIM_ALREADY_FINAL');
        if (Number(claim.requested_by) !== Number(req.user.id)) throw new Error('NOT_CLAIM_REQUESTER');
        await connection.execute(`UPDATE os2_claim_requests SET status='cancelled',updated_at=NOW() WHERE id=:id`, { id:Number(claim.id) });
        await connection.execute(`INSERT INTO os2_claim_history
          (claim_request_id,from_status,to_status,note,changed_by,created_at)
          VALUES (:id,'pending','cancelled',:note,:staffId,NOW())`, {
          id:Number(claim.id), note:text(req.body.reason, 1000), staffId:Number(req.user.id)
        });
        return Number(claim.id);
      });
      res.json({ ok:true, claimId:result, status:'cancelled' });
    } catch (error) { knownError(res, error, 'CLAIM_CANCEL_FAILED'); }
  });

  router.get('/api/os2/calendar', async (req, res) => {
    const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10);
    const to = req.query.to || new Date(Date.now() + 30 * 86400000).toISOString().slice(0,10);
    const team = req.query.scope === 'team' && ['owner','manager','admin'].includes(String(req.user.role).toLowerCase());
    try {
      const [rows] = await pool.execute(`SELECT ce.*,mc.display_name customer_name,su.full_name assignee_name
        FROM os2_calendar_events ce
        LEFT JOIN os2_master_customers mc ON mc.id=ce.master_customer_id
        JOIN staff_users su ON su.id=ce.assigned_staff_id
        WHERE ce.archived_at IS NULL AND ce.start_at>=:from AND ce.start_at<DATE_ADD(:to,INTERVAL 1 DAY)
          AND (:team=1 OR ce.assigned_staff_id=:staffId)
        ORDER BY ce.start_at,ce.id`, { from, to, team:team ? 1 : 0, staffId:Number(req.user.id) });
      res.json({ ok:true, events:rows });
    } catch (error) { knownError(res, error, 'CALENDAR_LOAD_FAILED'); }
  });

  router.post('/api/os2/calendar', async (req, res) => {
    const title = text(req.body.title, 240);
    const startAt = req.body.startAt;
    if (!title || !startAt) return res.status(400).json({ ok:false, error:'TITLE_AND_START_REQUIRED' });
    try {
      const id = await withTransaction(pool, async connection => {
        const [result] = await connection.execute(`INSERT INTO os2_calendar_events
          (title,description,event_type,start_at,end_at,all_day,assigned_staff_id,created_by,
           master_customer_id,work_item_id,location,recurrence_rule,status,created_at,updated_at)
          VALUES (:title,:description,:eventType,:startAt,:endAt,:allDay,:assignee,:creator,
           :customerId,:workItemId,:location,:recurrenceRule,'scheduled',NOW(),NOW())`, {
          title, description:text(req.body.description, 5000), eventType:text(req.body.eventType, 50) || 'task',
          startAt, endAt:req.body.endAt || null, allDay:req.body.allDay ? 1 : 0,
          assignee:positiveId(req.body.assignedStaffId) || Number(req.user.id), creator:Number(req.user.id),
          customerId:positiveId(req.body.masterCustomerId), workItemId:positiveId(req.body.workItemId),
          location:text(req.body.location, 255), recurrenceRule:text(req.body.recurrenceRule, 500)
        });
        const eventId = Number(result.insertId);
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'calendar_event_created', entityType:'os2_calendar_events', entityId:eventId,
          masterCustomerId:positiveId(req.body.masterCustomerId), description:`Created calendar event ${title}`,
          after:req.body, requestContext:context(req)
        });
        return eventId;
      });
      res.status(201).json({ ok:true, eventId:id });
    } catch (error) { knownError(res, error, 'CALENDAR_CREATE_FAILED'); }
  });

  router.post('/api/os2/calendar/:id/status', async (req, res) => {
    const status = text(req.body.status, 30);
    if (!['scheduled','completed','cancelled'].includes(status)) return res.status(400).json({ ok:false, error:'INVALID_CALENDAR_STATUS' });
    try {
      await withTransaction(pool, async connection => {
        const [[event]] = await connection.execute('SELECT * FROM os2_calendar_events WHERE id=:id AND archived_at IS NULL FOR UPDATE', { id:Number(req.params.id) });
        if (!event) throw new Error('CALENDAR_EVENT_NOT_FOUND');
        const management = ['owner','manager','admin'].includes(String(req.user.role).toLowerCase());
        if (!management && Number(event.assigned_staff_id) !== Number(req.user.id)) {
          const error = new Error('CALENDAR_EVENT_NOT_FOUND'); error.statusCode = 404; throw error;
        }
        await connection.execute('UPDATE os2_calendar_events SET status=:status,updated_at=NOW() WHERE id=:id', { status, id:Number(event.id) });
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'calendar_event_status_changed', entityType:'os2_calendar_events', entityId:event.id,
          masterCustomerId:event.master_customer_id, description:`Calendar event ${event.id} ${status}`,
          before:{ status:event.status }, after:{ status }, requestContext:context(req)
        });
      });
      res.json({ ok:true, eventId:Number(req.params.id), status });
    } catch (error) { knownError(res, error, 'CALENDAR_UPDATE_FAILED'); }
  });

  router.get('/api/os2/sticky-notes/shared', async (req, res) => {
    try {
      const [rows] = await pool.execute(`SELECT sn.*,owner.full_name owner_name,s.can_edit
        FROM os2_sticky_note_shares s
        JOIN os2_sticky_notes sn ON sn.id=s.sticky_note_id AND sn.archived_at IS NULL
        JOIN staff_users owner ON owner.id=sn.staff_id
        WHERE s.shared_with_staff_id=:staffId ORDER BY sn.is_pinned DESC,s.created_at DESC`, { staffId:Number(req.user.id) });
      res.json({ ok:true, notes:rows });
    } catch (error) { knownError(res, error, 'SHARED_NOTES_LOAD_FAILED'); }
  });

  router.post('/api/os2/sticky-notes/:id/share', async (req, res) => {
    const sharedWithStaffId = positiveId(req.body.sharedWithStaffId);
    if (!sharedWithStaffId) return res.status(400).json({ ok:false, error:'STAFF_REQUIRED' });
    try {
      await withTransaction(pool, async connection => {
        const [[note]] = await connection.execute('SELECT * FROM os2_sticky_notes WHERE id=:id AND archived_at IS NULL FOR UPDATE', { id:Number(req.params.id) });
        if (!note) throw new Error('STICKY_NOTE_NOT_FOUND');
        if (Number(note.staff_id) !== Number(req.user.id)) throw new Error('STICKY_NOTE_ACCESS_DENIED');
        await connection.execute(`INSERT INTO os2_sticky_note_shares
          (sticky_note_id,shared_with_staff_id,shared_by,can_edit,created_at)
          VALUES (:noteId,:sharedWith,:sharedBy,:canEdit,NOW())
          ON DUPLICATE KEY UPDATE can_edit=VALUES(can_edit),shared_by=VALUES(shared_by)`, {
          noteId:Number(note.id), sharedWith:sharedWithStaffId, sharedBy:Number(req.user.id), canEdit:req.body.canEdit ? 1 : 0
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'sticky_note_shared', entityType:'os2_sticky_notes', entityId:note.id,
          masterCustomerId:note.master_customer_id, description:`Shared sticky note ${note.id}`,
          after:{ shared_with_staff_id:sharedWithStaffId, can_edit:Boolean(req.body.canEdit) }, requestContext:context(req)
        });
      });
      res.json({ ok:true, stickyNoteId:Number(req.params.id), sharedWithStaffId });
    } catch (error) { knownError(res, error, 'STICKY_NOTE_SHARE_FAILED'); }
  });

  router.delete('/api/os2/sticky-notes/:id/share/:staffId', async (req, res) => {
    try {
      await withTransaction(pool, async connection => {
        const [[note]] = await connection.execute('SELECT * FROM os2_sticky_notes WHERE id=:id AND archived_at IS NULL FOR UPDATE', { id:Number(req.params.id) });
        if (!note) throw new Error('STICKY_NOTE_NOT_FOUND');
        if (Number(note.staff_id) !== Number(req.user.id)) throw new Error('STICKY_NOTE_ACCESS_DENIED');
        await connection.execute('DELETE FROM os2_sticky_note_shares WHERE sticky_note_id=:noteId AND shared_with_staff_id=:staffId', {
          noteId:Number(note.id), staffId:Number(req.params.staffId)
        });
      });
      res.json({ ok:true });
    } catch (error) { knownError(res, error, 'STICKY_NOTE_UNSHARE_FAILED'); }
  });

  return router;
};
