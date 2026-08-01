'use strict';

const { appendAudit } = require('./audit');

const FINAL_STATES = new Set(['approved','rejected']);
const DECISION_STATES = new Set(['approved','rejected','deferred']);

function safePayload(value) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { return JSON.parse(value || '{}'); } catch (_) { return {}; }
  }
  return value && typeof value === 'object' ? value : {};
}

async function createApproval(connection, options) {
  const [result] = await connection.execute(`
    INSERT INTO os2_approval_requests
      (request_type, master_customer_id, target_entity_type, target_entity_id,
       request_payload, status, requested_by, requested_at, created_at, updated_at)
    VALUES
      (:requestType,:masterCustomerId,:targetEntityType,:targetEntityId,
       :payload,'pending',:requestedBy,NOW(),NOW(),NOW())`, {
    requestType: options.requestType,
    masterCustomerId: options.masterCustomerId || null,
    targetEntityType: options.targetEntityType || null,
    targetEntityId: options.targetEntityId || null,
    payload: JSON.stringify(options.payload || {}),
    requestedBy: Number(options.requestedBy)
  });
  const id = Number(result.insertId);
  await appendAudit(connection, {
    actorStaffId: options.requestedBy,
    actionType: 'approval_requested',
    entityType: 'os2_approval_requests',
    entityId: id,
    masterCustomerId: options.masterCustomerId,
    description: `Requested approval for ${options.requestType}`,
    after: options,
    requestContext: options.requestContext
  });
  return id;
}

async function decideApproval(connection, options) {
  if (!DECISION_STATES.has(options.decision)) throw new Error('INVALID_APPROVAL_DECISION');
  const [[request]] = await connection.execute(
    'SELECT * FROM os2_approval_requests WHERE id=:id FOR UPDATE',
    { id: Number(options.approvalId) }
  );
  if (!request) throw new Error('APPROVAL_NOT_FOUND');
  if (FINAL_STATES.has(request.status)) throw new Error('APPROVAL_ALREADY_FINAL');
  if (Number(request.requested_by) === Number(options.reviewerStaffId)) {
    throw new Error('SELF_APPROVAL_NOT_ALLOWED');
  }

  const payload = safePayload(request.request_payload);
  let applicationResult = null;
  if (options.decision === 'approved' && typeof options.applyApprovedAction === 'function') {
    applicationResult = await options.applyApprovedAction({ request, payload, connection });
  }

  await connection.execute(`
    UPDATE os2_approval_requests
       SET status=:decision, reviewed_by=:reviewer, reviewed_at=NOW(),
           decision_reason=:reason, application_result=:applicationResult,
           updated_at=NOW()
     WHERE id=:id`, {
    id: Number(options.approvalId),
    decision: options.decision,
    reviewer: Number(options.reviewerStaffId),
    reason: options.reason || null,
    applicationResult: applicationResult == null ? null : JSON.stringify(applicationResult)
  });

  await connection.execute(`
    INSERT INTO os2_approval_history
      (approval_request_id, from_status, to_status, reason, changed_by, created_at)
    VALUES (:id,:fromStatus,:toStatus,:reason,:reviewer,NOW())`, {
    id: Number(options.approvalId),
    fromStatus: request.status,
    toStatus: options.decision,
    reason: options.reason || null,
    reviewer: Number(options.reviewerStaffId)
  });

  await appendAudit(connection, {
    actorStaffId: options.reviewerStaffId,
    actionType: 'approval_decided',
    entityType: 'os2_approval_requests',
    entityId: request.id,
    masterCustomerId: request.master_customer_id,
    description: `Approval ${request.id} ${options.decision}`,
    before: { status: request.status },
    after: { status: options.decision, reason: options.reason || null, applicationResult },
    requestContext: options.requestContext
  });

  return { approvalId: Number(request.id), decision: options.decision, applicationResult };
}

module.exports = { FINAL_STATES, DECISION_STATES, safePayload, createApproval, decideApproval };
