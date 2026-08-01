'use strict';

const { appendAudit } = require('./audit');

const RESTRICTION_TYPES = Object.freeze({
  no_new_lines: { value: 'none' },
  no_fixed_services: { value: 'none' },
  no_financed_devices: { value: 'none' },
  approval_for_upgrades: { value: 'none' },
  approval_for_package_increases: { value: 'none' },
  approval_for_cancellations: { value: 'none' },
  maximum_line_count: { value: 'integer', min: 0, max: 1000 },
  monthly_account_limit: { value: 'money', min: 0, max: 100000000 },
  maximum_monthly_increase: { value: 'money', min: 0, max: 100000000 }
});

const ACTION_RESTRICTIONS = Object.freeze({
  add_mobile_line: ['no_new_lines'], add_fixed_service: ['no_fixed_services'],
  finance_device: ['no_financed_devices'], upgrade: ['approval_for_upgrades'],
  package_increase: ['approval_for_package_increases'], cancellation: ['approval_for_cancellations']
});

function validateRestriction(type, value) {
  const rule = RESTRICTION_TYPES[type];
  if (!rule) throw new Error('INVALID_RESTRICTION_TYPE');
  if (rule.value === 'none') return { textValue: null, numericValue: null };
  const number = Number(value);
  if (!Number.isFinite(number) || number < rule.min || number > rule.max || (rule.value === 'integer' && !Number.isInteger(number))) {
    throw new Error('INVALID_RESTRICTION_VALUE');
  }
  return { textValue: String(number), numericValue: number };
}

async function loadActiveRestrictions(connection, masterCustomerId) {
  const [rows] = await connection.execute(`SELECT id,restriction_type,restriction_value,value_numeric,verification_method,evidence_document_id,effective_from,expires_at,notes
    FROM os2_customer_restrictions WHERE master_customer_id=:masterCustomerId AND is_active=1
    AND revoked_at IS NULL AND (effective_from IS NULL OR effective_from<=NOW()) AND (expires_at IS NULL OR expires_at>NOW())
    ORDER BY restriction_type`, { masterCustomerId:Number(masterCustomerId) });
  return rows;
}

function evaluateRestrictions(restrictions, action, context = {}) {
  const types = new Set(restrictions.map(row => row.restriction_type));
  const blockers = []; const approvals = [];
  for (const type of ACTION_RESTRICTIONS[action] || []) {
    if (!types.has(type)) continue;
    if (type.startsWith('approval_for_')) approvals.push(type); else blockers.push(type);
  }
  const numeric = type => {
    const row = restrictions.find(item => item.restriction_type === type);
    return row ? Number(row.value_numeric == null ? row.restriction_value : row.value_numeric) : null;
  };
  const maxLine = numeric('maximum_line_count');
  if (action === 'add_mobile_line' && Number.isFinite(maxLine) && Number(context.currentLineCount || 0) >= maxLine) blockers.push('maximum_line_count');
  const monthlyLimit = numeric('monthly_account_limit');
  if (Number.isFinite(monthlyLimit) && context.proposedMonthlyTotal != null && Number(context.proposedMonthlyTotal) > monthlyLimit) blockers.push('monthly_account_limit');
  const increaseLimit = numeric('maximum_monthly_increase');
  if (Number.isFinite(increaseLimit) && context.monthlyIncrease != null && Number(context.monthlyIncrease) > increaseLimit) blockers.push('maximum_monthly_increase');
  return { allowed:blockers.length===0, requiresApproval:approvals.length>0, blockers:[...new Set(blockers)], approvals:[...new Set(approvals)] };
}

async function enforceCustomerAction(connection, options) {
  const restrictions = await loadActiveRestrictions(connection, options.masterCustomerId);
  const decision = evaluateRestrictions(restrictions, options.action, options.context);
  if (!decision.allowed) { const error = new Error('CUSTOMER_RESTRICTION_BLOCKED'); error.statusCode=409; error.details=decision; throw error; }
  return { restrictions, ...decision };
}

async function recordRestriction(connection, options) {
  const validated = validateRestriction(options.restrictionType, options.restrictionValue);
  if (options.effectiveFrom && options.expiresAt && new Date(options.expiresAt) <= new Date(options.effectiveFrom)) throw new Error('INVALID_RESTRICTION_DATES');
  const [result] = await connection.execute(`INSERT INTO os2_customer_restrictions
    (master_customer_id,restriction_type,restriction_value,value_numeric,verification_method,source_reference,evidence_document_id,effective_from,expires_at,notes,is_active,created_by,updated_by,created_at,updated_at)
    VALUES(:masterCustomerId,:restrictionType,:restrictionValue,:valueNumeric,:verificationMethod,:sourceReference,:evidenceDocumentId,:effectiveFrom,:expiresAt,:notes,1,:actor,:actor,NOW(),NOW())`, {
    masterCustomerId:Number(options.masterCustomerId), restrictionType:options.restrictionType,
    restrictionValue:validated.textValue, valueNumeric:validated.numericValue,
    verificationMethod:options.verificationMethod||null, sourceReference:options.sourceReference||null,
    evidenceDocumentId:options.evidenceDocumentId||null, effectiveFrom:options.effectiveFrom||null,
    expiresAt:options.expiresAt||null, notes:options.notes||null, actor:Number(options.actorStaffId)
  });
  const id = Number(result.insertId);
  await connection.execute(`INSERT INTO os2_restriction_history(restriction_id,master_customer_id,event_type,after_json,changed_by,created_at)
    VALUES(:id,:customerId,'created',:afterJson,:actor,NOW())`, { id,customerId:Number(options.masterCustomerId),afterJson:JSON.stringify({ type:options.restrictionType,value:validated.textValue }),actor:Number(options.actorStaffId) });
  await appendAudit(connection,{actorStaffId:options.actorStaffId,actionType:'customer_restriction_created',entityType:'os2_customer_restrictions',entityId:id,masterCustomerId:options.masterCustomerId,description:`Added customer restriction ${options.restrictionType}`,after:{...options,restrictionValue:validated.textValue},requestContext:options.requestContext});
  return id;
}

async function revokeRestriction(connection, options) {
  const [[row]] = await connection.execute('SELECT * FROM os2_customer_restrictions WHERE id=:id FOR UPDATE',{id:Number(options.restrictionId)});
  if (!row) throw new Error('RESTRICTION_NOT_FOUND');
  if (!row.is_active || row.revoked_at) throw new Error('RESTRICTION_ALREADY_INACTIVE');
  if (!options.reason) throw new Error('RESTRICTION_REVOKE_REASON_REQUIRED');
  await connection.execute(`UPDATE os2_customer_restrictions SET is_active=0,revoked_at=NOW(),revoked_by=:actor,revoke_reason=:reason,updated_by=:actor,updated_at=NOW() WHERE id=:id`,{id:row.id,actor:Number(options.actorStaffId),reason:options.reason});
  await connection.execute(`INSERT INTO os2_restriction_history(restriction_id,master_customer_id,event_type,before_json,after_json,reason,changed_by,created_at)
    VALUES(:id,:customerId,'revoked',:beforeJson,:afterJson,:reason,:actor,NOW())`,{id:row.id,customerId:row.master_customer_id,beforeJson:JSON.stringify({is_active:row.is_active}),afterJson:JSON.stringify({is_active:0}),reason:options.reason,actor:Number(options.actorStaffId)});
  await appendAudit(connection,{actorStaffId:options.actorStaffId,actionType:'customer_restriction_revoked',entityType:'os2_customer_restrictions',entityId:row.id,masterCustomerId:row.master_customer_id,description:`Revoked customer restriction ${row.restriction_type}`,before:{isActive:true},after:{isActive:false,reason:options.reason},requestContext:options.requestContext});
  return { restrictionId:Number(row.id), masterCustomerId:Number(row.master_customer_id) };
}

module.exports = { RESTRICTION_TYPES,ACTION_RESTRICTIONS,validateRestriction,loadActiveRestrictions,evaluateRestrictions,enforceCustomerAction,recordRestriction,revokeRestriction };
