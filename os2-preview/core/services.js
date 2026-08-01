'use strict';

const { appendAudit } = require('./audit');
const { enforceCustomerAction } = require('./restrictions');

function clean(value, max = 255) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : null;
}

async function currentOwner(connection, masterCustomerId) {
  const [[row]] = await connection.execute(`
    SELECT assigned_staff_id FROM os2_customer_ownership
     WHERE master_customer_id=:masterCustomerId AND is_current=1
     ORDER BY effective_from DESC, id DESC LIMIT 1`, { masterCustomerId: Number(masterCustomerId) });
  return row ? Number(row.assigned_staff_id) : null;
}

async function createMobileLine(connection, options) {
  const [[counts]] = await connection.execute(`
    SELECT COUNT(*) total FROM os2_mobile_lines
     WHERE master_customer_id=:masterCustomerId AND archived_at IS NULL`, { masterCustomerId: Number(options.masterCustomerId) });
  const decision = await enforceCustomerAction(connection, {
    masterCustomerId: options.masterCustomerId,
    action: 'add_mobile_line',
    context: { currentLineCount: Number(counts.total || 0), proposedMonthlyTotal: options.proposedMonthlyTotal }
  });
  if (decision.requiresApproval && !options.approvalId) {
    const error = new Error('APPROVAL_REQUIRED');
    error.statusCode = 409;
    error.details = decision;
    throw error;
  }

  const mobileNumber = clean(options.mobileNumber, 40);
  if (!mobileNumber) throw new Error('MOBILE_NUMBER_REQUIRED');
  const [[duplicate]] = await connection.execute(`
    SELECT id, master_customer_id FROM os2_mobile_lines
     WHERE mobile_number=:mobileNumber AND archived_at IS NULL LIMIT 1 FOR UPDATE`, { mobileNumber });
  if (duplicate) {
    const error = new Error('MOBILE_NUMBER_ALREADY_EXISTS');
    error.statusCode = 409;
    error.details = duplicate;
    throw error;
  }

  const ownerStaffId = await currentOwner(connection, options.masterCustomerId);
  const [result] = await connection.execute(`
    INSERT INTO os2_mobile_lines
      (master_customer_id, account_id, mobile_number, sim_number, imei, handset,
       package_name, contract_months, previous_upgrade_date, next_upgrade_date,
       monthly_amount, line_status, assigned_staff_id, created_by, updated_by,
       created_at, updated_at)
    VALUES
      (:masterCustomerId,:accountId,:mobileNumber,:simNumber,:imei,:handset,
       :packageName,:contractMonths,:previousUpgradeDate,:nextUpgradeDate,
       :monthlyAmount,'active',:assignedStaffId,:actor,:actor,NOW(),NOW())`, {
    masterCustomerId: Number(options.masterCustomerId),
    accountId: Number(options.accountId),
    mobileNumber,
    simNumber: clean(options.simNumber, 100),
    imei: clean(options.imei, 100),
    handset: clean(options.handset, 200),
    packageName: clean(options.packageName, 200),
    contractMonths: Number(options.contractMonths || 36),
    previousUpgradeDate: options.previousUpgradeDate || null,
    nextUpgradeDate: options.nextUpgradeDate || null,
    monthlyAmount: options.monthlyAmount == null ? null : Number(options.monthlyAmount),
    assignedStaffId: ownerStaffId,
    actor: Number(options.actorStaffId)
  });
  const id = Number(result.insertId);
  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'mobile_line_created',
    entityType: 'os2_mobile_lines',
    entityId: id,
    masterCustomerId: options.masterCustomerId,
    description: `Added mobile line ${mobileNumber}`,
    after: { ...options, inherited_owner_staff_id: ownerStaffId },
    requestContext: options.requestContext
  });
  return id;
}

async function createFixedService(connection, options) {
  const decision = await enforceCustomerAction(connection, {
    masterCustomerId: options.masterCustomerId,
    action: 'add_fixed_service',
    context: { proposedMonthlyTotal: options.proposedMonthlyTotal }
  });
  if (decision.requiresApproval && !options.approvalId) {
    const error = new Error('APPROVAL_REQUIRED');
    error.statusCode = 409;
    error.details = decision;
    throw error;
  }

  const fixedAccountNumber = clean(options.fixedAccountNumber, 100);
  if (!fixedAccountNumber) throw new Error('FIXED_ACCOUNT_NUMBER_REQUIRED');
  const normalised = fixedAccountNumber.toUpperCase().replace(/[\s-]/g, '');
  let [[fixedAccount]] = await connection.execute(`
    SELECT * FROM os2_fixed_accounts
     WHERE normalised_account_number=:normalised AND archived_at IS NULL
     LIMIT 1 FOR UPDATE`, { normalised });
  if (fixedAccount && Number(fixedAccount.master_customer_id) !== Number(options.masterCustomerId)) {
    const error = new Error('FIXED_ACCOUNT_BELONGS_TO_ANOTHER_CUSTOMER');
    error.statusCode = 409;
    throw error;
  }
  const ownerStaffId = await currentOwner(connection, options.masterCustomerId);
  if (!fixedAccount) {
    const [insert] = await connection.execute(`
      INSERT INTO os2_fixed_accounts
        (master_customer_id, account_id, fixed_account_number, normalised_account_number,
         assigned_staff_id, status, created_by, updated_by, created_at, updated_at)
      VALUES
        (:masterCustomerId,:accountId,:fixedAccountNumber,:normalised,
         :assignedStaffId,'active',:actor,:actor,NOW(),NOW())`, {
      masterCustomerId: Number(options.masterCustomerId), accountId: Number(options.accountId),
      fixedAccountNumber, normalised, assignedStaffId: ownerStaffId,
      actor: Number(options.actorStaffId)
    });
    fixedAccount = { id: Number(insert.insertId), master_customer_id: Number(options.masterCustomerId) };
  }

  const collisionParams = {
    fixedAccountId: Number(fixedAccount.id),
    macAddress: clean(options.macAddress, 100),
    solutionId: clean(options.solutionId, 100),
    orderNumber: clean(options.orderNumber, 100)
  };
  const [[collision]] = await connection.execute(`
    SELECT id FROM os2_fixed_services
     WHERE fixed_account_id=:fixedAccountId AND archived_at IS NULL AND (
       (:macAddress IS NOT NULL AND mac_address=:macAddress) OR
       (:solutionId IS NOT NULL AND solution_id=:solutionId) OR
       (:orderNumber IS NOT NULL AND order_number=:orderNumber)
     ) LIMIT 1 FOR UPDATE`, collisionParams);
  if (collision) {
    const error = new Error('FIXED_SERVICE_IDENTIFIER_COLLISION');
    error.statusCode = 409;
    throw error;
  }

  const [result] = await connection.execute(`
    INSERT INTO os2_fixed_services
      (fixed_account_id, service_name, service_type, mac_address, solution_id,
       order_number, package_name, monthly_amount, service_status, assigned_staff_id,
       created_by, updated_by, created_at, updated_at)
    VALUES
      (:fixedAccountId,:serviceName,:serviceType,:macAddress,:solutionId,
       :orderNumber,:packageName,:monthlyAmount,'active',:assignedStaffId,
       :actor,:actor,NOW(),NOW())`, {
    fixedAccountId: Number(fixedAccount.id),
    serviceName: clean(options.serviceName, 200) || 'Fixed service',
    serviceType: clean(options.serviceType, 100),
    macAddress: collisionParams.macAddress,
    solutionId: collisionParams.solutionId,
    orderNumber: collisionParams.orderNumber,
    packageName: clean(options.packageName, 200),
    monthlyAmount: options.monthlyAmount == null ? null : Number(options.monthlyAmount),
    assignedStaffId: ownerStaffId,
    actor: Number(options.actorStaffId)
  });
  const id = Number(result.insertId);
  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'fixed_service_created',
    entityType: 'os2_fixed_services',
    entityId: id,
    masterCustomerId: options.masterCustomerId,
    description: `Added fixed service ${options.serviceName || fixedAccountNumber}`,
    after: { ...options, fixed_account_id: Number(fixedAccount.id), inherited_owner_staff_id: ownerStaffId },
    requestContext: options.requestContext
  });
  return { fixedAccountId: Number(fixedAccount.id), fixedServiceId: id };
}

module.exports = { currentOwner, createMobileLine, createFixedService };
