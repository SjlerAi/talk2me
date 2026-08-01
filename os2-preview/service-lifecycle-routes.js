'use strict';

const express = require('express');
const { withTransaction } = require('./core/transaction');
const { requirePermission } = require('./core/permissions');
const { enforceCustomerAction } = require('./core/restrictions');
const { createApproval } = require('./core/approvals');
const { appendAudit } = require('./core/audit');

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function text(value, max = 255) {
  const result = String(value == null ? '' : value).trim();
  return result ? result.slice(0, max) : null;
}
function requestContext(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
  };
}
async function writeHistory(connection, options) {
  await connection.execute(`INSERT INTO os2_service_change_history
    (master_customer_id,service_type,service_id,change_type,before_json,after_json,approval_id,changed_by,created_at)
    VALUES (:masterCustomerId,:serviceType,:serviceId,:changeType,:beforeJson,:afterJson,:approvalId,:actor,NOW())`, {
    masterCustomerId: options.masterCustomerId,
    serviceType: options.serviceType,
    serviceId: options.serviceId,
    changeType: options.changeType,
    beforeJson: JSON.stringify(options.before || {}),
    afterJson: JSON.stringify(options.after || {}),
    approvalId: options.approvalId || null,
    actor: options.actorStaffId
  });
}

module.exports = function createServiceLifecycleRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use('/api/os2', requireAuth);

  router.patch('/api/os2/mobile-lines/:id', requirePermission('service.update'), async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error:'INVALID_MOBILE_LINE_ID' });
    try {
      const result = await withTransaction(pool, async connection => {
        const [[line]] = await connection.execute('SELECT * FROM os2_mobile_lines WHERE id=:id AND archived_at IS NULL FOR UPDATE', { id });
        if (!line) throw Object.assign(new Error('MOBILE_LINE_NOT_FOUND'), { statusCode:404 });
        const newPackage = text(req.body.packageName, 200) || line.package_name;
        const newAmount = req.body.monthlyAmount == null ? Number(line.monthly_amount || 0) : Number(req.body.monthlyAmount);
        const increase = newAmount - Number(line.monthly_amount || 0);
        const action = increase > 0 ? 'package_increase' : 'upgrade';
        const decision = await enforceCustomerAction(connection, {
          masterCustomerId: line.master_customer_id,
          action,
          context: { monthlyIncrease: increase, proposedMonthlyTotal: req.body.proposedMonthlyTotal }
        });
        if (decision.requiresApproval && !positiveId(req.body.approvalId)) {
          const approvalId = await createApproval(connection, {
            requestType: action,
            masterCustomerId: line.master_customer_id,
            targetEntityType: 'os2_mobile_lines',
            targetEntityId: id,
            payload: { packageName:newPackage, monthlyAmount:newAmount, handset:text(req.body.handset,200), nextUpgradeDate:req.body.nextUpgradeDate || null },
            requestedBy: req.user.id,
            requestContext: requestContext(req)
          });
          return { approvalRequired:true, approvalId };
        }
        const after = {
          package_name:newPackage,
          monthly_amount:newAmount,
          handset:text(req.body.handset,200) || line.handset,
          next_upgrade_date:req.body.nextUpgradeDate || line.next_upgrade_date,
          line_status:text(req.body.lineStatus,30) || line.line_status
        };
        await connection.execute(`UPDATE os2_mobile_lines SET package_name=:package_name,monthly_amount=:monthly_amount,
          handset=:handset,next_upgrade_date=:next_upgrade_date,line_status=:line_status,updated_by=:actor,updated_at=NOW() WHERE id=:id`, {
          ...after, actor:req.user.id, id
        });
        await writeHistory(connection, { masterCustomerId:line.master_customer_id, serviceType:'mobile', serviceId:id, changeType:action, before:line, after, approvalId:positiveId(req.body.approvalId), actorStaffId:req.user.id });
        await appendAudit(connection, { actorStaffId:req.user.id, actionType:`mobile_line_${action}`, entityType:'os2_mobile_lines', entityId:id, masterCustomerId:line.master_customer_id, description:`Updated mobile line ${line.mobile_number}`, before:line, after, requestContext:requestContext(req) });
        return { approvalRequired:false, mobileLineId:id };
      });
      res.json({ ok:true, ...result });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok:false, error:error.statusCode ? error.message : 'MOBILE_LINE_UPDATE_FAILED', details:error.details || null });
    }
  });

  router.post('/api/os2/mobile-lines/:id/cancel', requirePermission('service.update'), async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error:'INVALID_MOBILE_LINE_ID' });
    try {
      const result = await withTransaction(pool, async connection => {
        const [[line]] = await connection.execute('SELECT * FROM os2_mobile_lines WHERE id=:id AND archived_at IS NULL FOR UPDATE', { id });
        if (!line) throw Object.assign(new Error('MOBILE_LINE_NOT_FOUND'), { statusCode:404 });
        const decision = await enforceCustomerAction(connection, { masterCustomerId:line.master_customer_id, action:'cancellation', context:{} });
        if (decision.requiresApproval && !positiveId(req.body.approvalId)) {
          const approvalId = await createApproval(connection, {
            requestType:'cancellation', masterCustomerId:line.master_customer_id,
            targetEntityType:'os2_mobile_lines', targetEntityId:id,
            payload:{ cancellationDate:req.body.cancellationDate || null, reason:text(req.body.reason,1000) },
            requestedBy:req.user.id, requestContext:requestContext(req)
          });
          return { approvalRequired:true, approvalId };
        }
        const after = { line_status:'cancelled', cancellation_date:req.body.cancellationDate || new Date().toISOString().slice(0,10) };
        await connection.execute(`UPDATE os2_mobile_lines SET line_status='cancelled',cancellation_date=:date,updated_by=:actor,updated_at=NOW() WHERE id=:id`, { date:after.cancellation_date, actor:req.user.id, id });
        await writeHistory(connection, { masterCustomerId:line.master_customer_id, serviceType:'mobile', serviceId:id, changeType:'cancellation', before:line, after, approvalId:positiveId(req.body.approvalId), actorStaffId:req.user.id });
        await appendAudit(connection, { actorStaffId:req.user.id, actionType:'mobile_line_cancelled', entityType:'os2_mobile_lines', entityId:id, masterCustomerId:line.master_customer_id, description:`Cancelled mobile line ${line.mobile_number}`, before:line, after, requestContext:requestContext(req) });
        return { approvalRequired:false, mobileLineId:id };
      });
      res.json({ ok:true, ...result });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok:false, error:error.statusCode ? error.message : 'MOBILE_LINE_CANCEL_FAILED', details:error.details || null });
    }
  });

  router.get('/api/os2/customers/:id/service-history', async (req, res) => {
    const masterCustomerId = positiveId(req.params.id);
    if (!masterCustomerId) return res.status(400).json({ ok:false, error:'INVALID_CUSTOMER_ID' });
    try {
      const [rows] = await pool.execute(`SELECT h.*,s.full_name changed_by_name FROM os2_service_change_history h
        LEFT JOIN staff_users s ON s.id=h.changed_by WHERE h.master_customer_id=:id ORDER BY h.created_at DESC LIMIT 250`, { id:masterCustomerId });
      res.json({ ok:true, history:rows });
    } catch (error) {
      res.status(500).json({ ok:false, error:'SERVICE_HISTORY_LOAD_FAILED' });
    }
  });

  return router;
};
