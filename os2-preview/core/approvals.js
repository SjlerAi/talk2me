'use strict';

const crypto = require('crypto');
const { appendAudit } = require('./audit');

const FINAL_STATES = new Set(['approved','rejected']);
const DECISION_STATES = new Set(['approved','rejected','deferred']);
const APPROVAL_ACTIONS = new Set([
  'add_mobile_line','add_fixed_service','service_change','service_cancel',
  'ownership_transfer','restriction_override','claim_transfer','attendance_correction',
  'privacy_request','retention_action','document_archive','customer_archive'
]);

function safePayload(value) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { return JSON.parse(value || '{}'); } catch (_) { return {}; }
  }
  return value && typeof value === 'object' ? value : {};
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out,key) => { out[key]=stable(value[key]); return out; },{});
  return value;
}
function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(safePayload(payload)))).digest('hex');
}
function validateAction(action) {
  const value = String(action || '').trim();
  if (!APPROVAL_ACTIONS.has(value)) throw new Error('INVALID_APPROVAL_ACTION');
  return value;
}

async function createApproval(connection, options) {
  const actionKey = validateAction(options.actionKey || options.requestType);
  const payload = safePayload(options.payload);
  const hash = payloadHash(payload);
  const [result] = await connection.execute(`
    INSERT INTO os2_approval_requests
      (request_type, action_key, master_customer_id, target_entity_type, target_entity_id,
       request_payload, payload_hash, status, requested_by, requested_at, created_at, updated_at)
    VALUES
      (:requestType,:actionKey,:masterCustomerId,:targetEntityType,:targetEntityId,
       :payload,:payloadHash,'pending',:requestedBy,NOW(),NOW(),NOW())`, {
    requestType: actionKey,
    actionKey,
    masterCustomerId: options.masterCustomerId || null,
    targetEntityType: options.targetEntityType || null,
    targetEntityId: options.targetEntityId || null,
    payload: JSON.stringify(payload),
    payloadHash: hash,
    requestedBy: Number(options.requestedBy)
  });
  const id = Number(result.insertId);
  await appendAudit(connection, {
    actorStaffId: options.requestedBy, actionType: 'approval_requested', entityType: 'os2_approval_requests',
    entityId: id, masterCustomerId: options.masterCustomerId,
    description: `Requested approval for ${actionKey}`,
    after: { actionKey, targetEntityType:options.targetEntityType || null, targetEntityId:options.targetEntityId || null, payloadHash:hash },
    requestContext: options.requestContext
  });
  return id;
}

async function decideApproval(connection, options) {
  if (!DECISION_STATES.has(options.decision)) throw new Error('INVALID_APPROVAL_DECISION');
  const [[request]] = await connection.execute('SELECT * FROM os2_approval_requests WHERE id=:id FOR UPDATE', { id:Number(options.approvalId) });
  if (!request) throw new Error('APPROVAL_NOT_FOUND');
  if (FINAL_STATES.has(request.status)) throw new Error('APPROVAL_ALREADY_FINAL');
  if (Number(request.requested_by) === Number(options.reviewerStaffId)) throw new Error('SELF_APPROVAL_NOT_ALLOWED');
  validateAction(request.action_key || request.request_type);

  const payload = safePayload(request.request_payload);
  const expectedHash = payloadHash(payload);
  if (request.payload_hash && request.payload_hash !== expectedHash) throw new Error('APPROVAL_PAYLOAD_INTEGRITY_FAILED');

  let applicationResult = null;
  if (options.decision === 'approved' && typeof options.applyApprovedAction === 'function') {
    applicationResult = await options.applyApprovedAction({ request,payload,connection });
  }
  await connection.execute(`UPDATE os2_approval_requests
    SET status=:decision,reviewed_by=:reviewer,reviewed_at=NOW(),decision_reason=:reason,
        payload_hash=:payloadHash,application_result=:applicationResult,updated_at=NOW()
    WHERE id=:id`, {
    id:Number(options.approvalId), decision:options.decision, reviewer:Number(options.reviewerStaffId),
    reason:options.reason || null, payloadHash:expectedHash,
    applicationResult:applicationResult == null ? null : JSON.stringify(applicationResult)
  });
  await connection.execute(`INSERT INTO os2_approval_history
    (approval_request_id,from_status,to_status,reason,changed_by,created_at)
    VALUES(:id,:fromStatus,:toStatus,:reason,:reviewer,NOW())`, {
    id:Number(options.approvalId),fromStatus:request.status,toStatus:options.decision,
    reason:options.reason || null,reviewer:Number(options.reviewerStaffId)
  });
  await appendAudit(connection, {
    actorStaffId:options.reviewerStaffId,actionType:'approval_decided',entityType:'os2_approval_requests',
    entityId:request.id,masterCustomerId:request.master_customer_id,
    description:`Approval ${request.id} ${options.decision}`,
    before:{ status:request.status },after:{ status:options.decision,reason:options.reason || null,applicationResult },
    requestContext:options.requestContext
  });
  return { approvalId:Number(request.id),decision:options.decision,applicationResult };
}

async function consumeApproval(connection, options) {
  const actionKey = validateAction(options.actionKey);
  const approvalId = Number(options.approvalId);
  if (!Number.isInteger(approvalId) || approvalId < 1) throw new Error('APPROVAL_REQUIRED');
  const [[request]] = await connection.execute('SELECT * FROM os2_approval_requests WHERE id=:id FOR UPDATE', { id:approvalId });
  if (!request) throw new Error('APPROVAL_NOT_FOUND');
  if (request.status !== 'approved') throw new Error('APPROVAL_NOT_APPROVED');
  if (request.consumed_at) throw new Error('APPROVAL_ALREADY_CONSUMED');
  if ((request.action_key || request.request_type) !== actionKey) throw new Error('APPROVAL_ACTION_MISMATCH');
  if (options.masterCustomerId && Number(request.master_customer_id) !== Number(options.masterCustomerId)) throw new Error('APPROVAL_CUSTOMER_MISMATCH');
  if (options.targetEntityType && request.target_entity_type && request.target_entity_type !== options.targetEntityType) throw new Error('APPROVAL_TARGET_MISMATCH');
  if (options.targetEntityId && request.target_entity_id && Number(request.target_entity_id) !== Number(options.targetEntityId)) throw new Error('APPROVAL_TARGET_MISMATCH');

  const storedPayload = safePayload(request.request_payload);
  const storedHash = payloadHash(storedPayload);
  if (request.payload_hash && request.payload_hash !== storedHash) throw new Error('APPROVAL_PAYLOAD_INTEGRITY_FAILED');
  const proposedHash = payloadHash(options.payload || {});
  if (storedHash !== proposedHash) throw new Error('APPROVAL_PAYLOAD_MISMATCH');

  const result = options.result || {};
  await connection.execute(`UPDATE os2_approval_requests SET consumed_at=NOW(),consumed_by=:actor,
    consumed_for_entity_type=:entityType,consumed_for_entity_id=:entityId,consumption_result=:result,updated_at=NOW()
    WHERE id=:id AND consumed_at IS NULL`, {
    id:approvalId,actor:Number(options.actorStaffId),entityType:options.consumedForEntityType || null,
    entityId:options.consumedForEntityId || null,result:JSON.stringify(result)
  });
  await connection.execute(`INSERT INTO os2_approval_consumption_history
    (approval_request_id,action_key,master_customer_id,target_entity_type,target_entity_id,payload_hash,
     consumed_by,consumed_for_entity_type,consumed_for_entity_id,result_json,consumed_at)
    VALUES(:id,:actionKey,:customerId,:targetType,:targetId,:payloadHash,:actor,:entityType,:entityId,:result,NOW())`, {
    id:approvalId,actionKey,customerId:request.master_customer_id,targetType:request.target_entity_type,
    targetId:request.target_entity_id,payloadHash:storedHash,actor:Number(options.actorStaffId),
    entityType:options.consumedForEntityType || null,entityId:options.consumedForEntityId || null,
    result:JSON.stringify(result)
  });
  await appendAudit(connection, {
    actorStaffId:options.actorStaffId,actionType:'approval_consumed',entityType:'os2_approval_requests',
    entityId:approvalId,masterCustomerId:request.master_customer_id,
    description:`Approval ${approvalId} consumed for ${actionKey}`,
    after:{ actionKey,consumedForEntityType:options.consumedForEntityType || null,consumedForEntityId:options.consumedForEntityId || null },
    requestContext:options.requestContext
  });
  return { approvalId,actionKey,payloadHash:storedHash };
}

module.exports = { FINAL_STATES,DECISION_STATES,APPROVAL_ACTIONS,safePayload,payloadHash,createApproval,decideApproval,consumeApproval };
