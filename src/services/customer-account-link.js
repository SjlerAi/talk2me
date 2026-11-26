'use strict';
const { normaliseOfficialAccountNumber } = require('./provisional-account-approval');

function reviewError(message) {
  const error = new Error(message);
  error.code = 'ACCOUNT_LINK_REVIEW_REQUIRED';
  return error;
}
function normalise(value) {
  try { return normaliseOfficialAccountNumber(value); }
  catch (error) { throw reviewError(error.message); }
}
function entered(value) { return String(value ?? '').trim(); }
function assertAvailable(account) {
  if (!account || ['inactive','cancelled'].includes(String(account.account_status || '').toLowerCase())) {
    throw reviewError('This official account is not active. Management must review the account before adding a service.');
  }
}
async function readLinkedAccount(conn, client) {
  if (!client.account_id) return null;
  const [[account]] = await conn.execute(
    'SELECT * FROM customer_accounts WHERE id=:id', { id: client.account_id });
  if (!account || !entered(client.account_number)
      || normalise(client.account_number) !== normalise(account.account_number)
      || normalise(account.account_number) !== normalise(account.account_number_normalised)) {
    throw reviewError('The displayed account number and linked account disagree. Management must review the existing account relationship.');
  }
  assertAvailable(account);
  return account;
}

// Only call inside the transaction that locks the individual client row.
// Never grant or overwrite an existing account assignment, merge customers,
// or silently move an already-linked customer to a different account.
async function resolveCustomerAccountForWrite(conn, client, requested, displayName, actorId) {
  const number = entered(requested);
  if (!number) {
    if (client.account_id) throw reviewError('A linked official account cannot be cleared here. Use the reviewed account correction workflow.');
    return { accountId: null, accountNumber: '' };
  }
  const normalised = normalise(number);
  if (client.account_id) {
    const [[account]] = await conn.execute(
      'SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE', { id: client.account_id });
    if (!account || normalise(account.account_number) !== normalised
        || normalise(account.account_number_normalised) !== normalised) {
      throw reviewError('A linked official account cannot be reassigned here. Use the reviewed account correction workflow.');
    }
    assertAvailable(account);
    return { accountId: account.id, accountNumber: account.account_number };
  }

  const [assignments] = await conn.execute(
    'SELECT account_number,assigned_staff_id,assigned_by FROM client_assignments WHERE client_id=:id AND is_active=1 FOR UPDATE',
    { id: client.id });
  for (const assignment of assignments) {
    if (entered(assignment.account_number) && normalise(assignment.account_number) !== normalised) {
      throw reviewError('This customer already has an assignment to a different account. Management review is required.');
    }
  }
  const staffIds = [...new Set(assignments.map(row => Number(row.assigned_staff_id)).filter(id => id > 0))];
  if (staffIds.length > 1) throw reviewError('This customer has conflicting staff assignments. Management review is required.');
  const staffId = staffIds[0] || null;
  const assignedBy = staffId ? (assignments.find(row => Number(row.assigned_staff_id) === staffId)?.assigned_by || actorId || null) : null;
  let [[account]] = await conn.execute(
    'SELECT * FROM customer_accounts WHERE account_number_normalised=:normalised FOR UPDATE', { normalised });
  if (!account) {
    try {
      await conn.execute(
        "INSERT INTO customer_accounts (account_number,account_number_normalised,display_name,assigned_staff_id,assigned_by,assignment_confirmed_at) VALUES (:number,:normalised,:displayName,:staffId,:assignedBy,CASE WHEN :staffId IS NULL THEN NULL ELSE NOW() END)",
        { number: normalised, normalised, displayName: entered(displayName).slice(0,180) || normalised, staffId, assignedBy });
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
    }
    [[account]] = await conn.execute(
      'SELECT * FROM customer_accounts WHERE account_number_normalised=:normalised FOR UPDATE', { normalised });
  }
  assertAvailable(account);
  if (normalise(account.account_number) !== normalised
      || normalise(account.account_number_normalised) !== normalised) {
    throw reviewError('The canonical official account changed during the save. Please review and try again.');
  }
  if (staffId && account.assigned_staff_id && Number(account.assigned_staff_id) !== staffId) {
    throw reviewError('This official account is assigned to a different staff member. Management must resolve the ownership conflict.');
  }
  // Preserve the staff member and history; only fill the number on this client's active assignment.
  if (assignments.length) await conn.execute(
    'UPDATE client_assignments SET account_number=:accountNumber,updated_at=NOW() WHERE client_id=:id AND is_active=1',
    { id: client.id, accountNumber: account.account_number });
  return { accountId: account.id, accountNumber: account.account_number };
}
module.exports = { readLinkedAccount, resolveCustomerAccountForWrite };
