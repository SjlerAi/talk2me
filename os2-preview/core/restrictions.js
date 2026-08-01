'use strict';

const { appendAudit } = require('./audit');

const ACTION_RESTRICTIONS = Object.freeze({
  add_mobile_line: ['no_new_lines'],
  add_fixed_service: ['no_fixed_services'],
  finance_device: ['no_financed_devices'],
  upgrade: ['approval_for_upgrades'],
  package_increase: ['approval_for_package_increases'],
  cancellation: ['approval_for_cancellations']
});

async function loadActiveRestrictions(connection, masterCustomerId) {
  const [rows] = await connection.execute(`
    SELECT id, restriction_type, restriction_value, verification_method, evidence_document_id,
           effective_from, expires_at, notes
      FROM os2_customer_restrictions
     WHERE master_customer_id=:masterCustomerId
       AND is_active=1
       AND (effective_from IS NULL OR effective_from<=NOW())
       AND (expires_at IS NULL OR expires_at>NOW())
     ORDER BY restriction_type`, { masterCustomerId: Number(masterCustomerId) });
  return rows;
}

function evaluateRestrictions(restrictions, action, context = {}) {
  const types = new Set(restrictions.map(row => row.restriction_type));
  const blockers = [];
  const approvals = [];

  for (const type of ACTION_RESTRICTIONS[action] || []) {
    if (!types.has(type)) continue;
    if (type.startsWith('approval_for_')) approvals.push(type);
    else blockers.push(type);
  }

  const maxLine = restrictions.find(row => row.restriction_type === 'maximum_line_count');
  if (action === 'add_mobile_line' && maxLine) {
    const limit = Number(maxLine.restriction_value);
    if (Number.isFinite(limit) && Number(context.currentLineCount || 0) >= limit) blockers.push('maximum_line_count');
  }

  const monthlyLimit = restrictions.find(row => row.restriction_type === 'monthly_account_limit');
  if (monthlyLimit && context.proposedMonthlyTotal != null) {
    const limit = Number(monthlyLimit.restriction_value);
    if (Number.isFinite(limit) && Number(context.proposedMonthlyTotal) > limit) blockers.push('monthly_account_limit');
  }

  const increaseLimit = restrictions.find(row => row.restriction_type === 'maximum_monthly_increase');
  if (increaseLimit && context.monthlyIncrease != null) {
    const limit = Number(increaseLimit.restriction_value);
    if (Number.isFinite(limit) && Number(context.monthlyIncrease) > limit) blockers.push('maximum_monthly_increase');
  }

  return { allowed: blockers.length === 0, requiresApproval: approvals.length > 0, blockers, approvals };
}

async function enforceCustomerAction(connection, options) {
  const restrictions = await loadActiveRestrictions(connection, options.masterCustomerId);
  const decision = evaluateRestrictions(restrictions, options.action, options.context);
  if (!decision.allowed) {
    const error = new Error('CUSTOMER_RESTRICTION_BLOCKED');
    error.statusCode = 409;
    error.details = decision;
    throw error;
  }
  return { restrictions, ...decision };
}

async function recordRestriction(connection, options) {
  const [result] = await connection.execute(`
    INSERT INTO os2_customer_restrictions
      (master_customer_id, restriction_type, restriction_value, verification_method,
       evidence_document_id, effective_from, expires_at, notes, is_active,
       created_by, updated_by, created_at, updated_at)
    VALUES
      (:masterCustomerId,:restrictionType,:restrictionValue,:verificationMethod,
       :evidenceDocumentId,:effectiveFrom,:expiresAt,:notes,1,:actor,:actor,NOW(),NOW())`, {
    masterCustomerId: Number(options.masterCustomerId),
    restrictionType: options.restrictionType,
    restrictionValue: options.restrictionValue || null,
    verificationMethod: options.verificationMethod || null,
    evidenceDocumentId: options.evidenceDocumentId || null,
    effectiveFrom: options.effectiveFrom || null,
    expiresAt: options.expiresAt || null,
    notes: options.notes || null,
    actor: Number(options.actorStaffId)
  });
  const id = Number(result.insertId);
  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'customer_restriction_created',
    entityType: 'os2_customer_restrictions',
    entityId: id,
    masterCustomerId: options.masterCustomerId,
    description: `Added customer restriction ${options.restrictionType}`,
    after: options,
    requestContext: options.requestContext
  });
  return id;
}

module.exports = { ACTION_RESTRICTIONS, loadActiveRestrictions, evaluateRestrictions, enforceCustomerAction, recordRestriction };
