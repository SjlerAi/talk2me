'use strict';

const { appendAudit } = require('./audit');

async function lockMasterCustomer(connection, masterCustomerId) {
  const [[customer]] = await connection.execute(
    'SELECT id, owner_staff_id FROM os2_master_customers WHERE id=:id FOR UPDATE',
    { id: Number(masterCustomerId) }
  );
  if (!customer) throw new Error('MASTER_CUSTOMER_NOT_FOUND');
  return customer;
}

async function assignMasterCustomer(connection, options) {
  const customer = await lockMasterCustomer(connection, options.masterCustomerId);
  const previousOwner = customer.owner_staff_id == null ? null : Number(customer.owner_staff_id);
  const newOwner = options.newOwnerStaffId == null ? null : Number(options.newOwnerStaffId);
  if (previousOwner === newOwner) return { changed: false, previousOwner, newOwner };

  await connection.execute(
    'UPDATE os2_master_customers SET owner_staff_id=:newOwner, updated_by=:actorId, updated_at=NOW() WHERE id=:id',
    { newOwner, actorId: Number(options.actorStaffId), id: Number(options.masterCustomerId) }
  );
  const [history] = await connection.execute(`
    INSERT INTO os2_ownership_history
      (master_customer_id, previous_owner_staff_id, new_owner_staff_id, change_type, approval_id, reason, changed_by, created_at)
    VALUES
      (:masterCustomerId, :previousOwner, :newOwner, :changeType, :approvalId, :reason, :actorId, NOW())`, {
    masterCustomerId: Number(options.masterCustomerId),
    previousOwner,
    newOwner,
    changeType: options.changeType || 'transfer',
    approvalId: options.approvalId || null,
    reason: options.reason ? String(options.reason).slice(0, 500) : null,
    actorId: Number(options.actorStaffId)
  });

  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'master_customer_owner_changed',
    entityType: 'os2_master_customers',
    entityId: options.masterCustomerId,
    masterCustomerId: options.masterCustomerId,
    description: `Master Customer ownership changed from ${previousOwner || 'unassigned'} to ${newOwner || 'unassigned'}`,
    before: { owner_staff_id: previousOwner },
    after: { owner_staff_id: newOwner, ownership_history_id: Number(history.insertId) },
    requestContext: options.requestContext
  });

  return { changed: true, previousOwner, newOwner, historyId: Number(history.insertId) };
}

module.exports = { lockMasterCustomer, assignMasterCustomer };
