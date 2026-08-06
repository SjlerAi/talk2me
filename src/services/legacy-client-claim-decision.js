'use strict';

const db = require('../config/db');
const { normaliseAccount } = require('./client-claim');

const PENDING = new Set(['pending_manager', 'pending_owner']);
const TERMINAL = new Set(['applied', 'rejected', 'cancelled']);
const LEGACY_TITLE = 'Client claim awaiting approval';

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function parseProposal(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch (_) {
    return null;
  }
}

function extractLegacyClaimRequestId(task) {
  if (!task || clean(task.title, 255).toLowerCase() !== LEGACY_TITLE.toLowerCase()) return null;
  const match = clean(task.message, 5000).match(/\brequest\s*#(\d+)\b/i);
  return match ? positiveId(match[1]) : null;
}

function decisionError(message, statusCode = 409, classification = 'exception') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.classification = classification;
  return error;
}

function canDecide(user, request) {
  const role = clean(user?.role, 40).toLowerCase();
  if (role === 'owner') return true;
  const proposal = parseProposal(request?.proposed_data_json) || {};
  if (request?.status === 'pending_owner' || request?.required_approval_role === 'owner' || proposal.ownership_conflict) return false;
  return ['manager', 'admin'].includes(role) && request?.request_type === 'claim_client';
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function uniqueIds(values) {
  return [...new Set(values.map(positiveId).filter(Boolean))];
}

async function loadLockedScope(conn, request, proposal) {
  const requestedClientId = positiveId(request.client_id)
    || positiveId(proposal.client_id)
    || (request.request_type === 'claim_client' ? positiveId(request.record_id) : null);
  const requestedAccountId = positiveId(proposal.account_id)
    || (request.request_type === 'claim_account' ? positiveId(request.record_id) : null);
  let accountNumber = normaliseAccount(request.account_number || proposal.account_number);
  let requestedClient = null;
  if (requestedClientId) {
    [[requestedClient]] = await conn.execute(`SELECT id,account_id,account_number,client_name,is_active
      FROM clients WHERE id=:id FOR UPDATE`, { id: requestedClientId });
    if (requestedClient) accountNumber ||= normaliseAccount(requestedClient.account_number);
  }
  const accountId = requestedAccountId || positiveId(requestedClient?.account_id);
  const accountParams = [];
  const accountWhere = [];
  if (accountId) { accountWhere.push('id=?'); accountParams.push(accountId); }
  if (accountNumber) { accountWhere.push('account_number_normalised=?'); accountParams.push(accountNumber); }
  const [accounts] = accountWhere.length ? await conn.query(`SELECT id,account_number,account_number_normalised,
      display_name,account_status,assigned_staff_id,assigned_by,assignment_confirmed_at
    FROM customer_accounts WHERE ${accountWhere.join(' OR ')} ORDER BY id FOR UPDATE`, accountParams) : [[]];
  if (!accountNumber && accounts[0]) accountNumber = normaliseAccount(accounts[0].account_number_normalised || accounts[0].account_number);

  const clientParams = [];
  const clientWhere = [];
  if (requestedClientId) { clientWhere.push('id=?'); clientParams.push(requestedClientId); }
  if (accountId) { clientWhere.push('account_id=?'); clientParams.push(accountId); }
  if (accountNumber) {
    clientWhere.push("UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=?");
    clientParams.push(accountNumber);
  }
  const [clients] = clientWhere.length ? await conn.query(`SELECT id,account_id,account_number,client_name,is_active,
      lifecycle_status,line_status FROM clients WHERE ${clientWhere.join(' OR ')} ORDER BY id FOR UPDATE`, clientParams) : [[]];
  const activeClients = clients.filter(row => Number(row.is_active) === 1);
  const clientIds = uniqueIds(activeClients.map(row => row.id));
  const assignmentParams = [...clientIds];
  const assignmentWhere = [];
  if (clientIds.length) assignmentWhere.push(`client_id IN (${placeholders(clientIds)})`);
  if (accountNumber) {
    assignmentWhere.push("UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=?");
    assignmentParams.push(accountNumber);
  }
  const [assignments] = assignmentWhere.length ? await conn.query(`SELECT id,client_id,account_number,assigned_staff_id,
      assigned_at,updated_at FROM client_assignments WHERE is_active=1 AND (${assignmentWhere.join(' OR ')})
      ORDER BY client_id,id FOR UPDATE`, assignmentParams) : [[]];

  const fixedParams = [];
  const fixedWhere = [];
  if (accountId) { fixedWhere.push('account_id=?'); fixedParams.push(accountId); }
  if (clientIds.length) { fixedWhere.push(`linked_client_id IN (${placeholders(clientIds)})`); fixedParams.push(...clientIds); }
  if (accountNumber) {
    fixedWhere.push("account_number_normalised=? OR UPPER(REPLACE(TRIM(COALESCE(linked_mobile_account_number,'')),' ',''))=?");
    fixedParams.push(accountNumber, accountNumber);
  }
  const [fixedAccounts] = fixedWhere.length ? await conn.query(`SELECT id,account_id,account_number,account_number_normalised,
      linked_mobile_account_number,linked_client_id,assigned_staff_id,account_status
    FROM fixed_accounts WHERE ${fixedWhere.join(' OR ')} ORDER BY id FOR UPDATE`, fixedParams) : [[]];

  const claimParams = [...clientIds];
  const claimWhere = [];
  if (clientIds.length) claimWhere.push(`client_id IN (${placeholders(clientIds)})`);
  if (accountId) { claimWhere.push("(request_type='claim_account' AND record_id=?)"); claimParams.push(accountId); }
  if (accountNumber) {
    claimWhere.push("UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=?");
    claimParams.push(accountNumber);
  }
  const [pendingClaims] = claimWhere.length ? await conn.query(`SELECT * FROM data_change_requests
    WHERE request_type IN ('claim_client','claim_account') AND status IN ('pending_manager','pending_owner')
      AND (${claimWhere.join(' OR ')}) ORDER BY created_at,id FOR UPDATE`, claimParams) : [[request]];
  return { requestedClient, accountId, accountNumber, accounts, clients, activeClients, clientIds, assignments, fixedAccounts, pendingClaims };
}

function classify(scope, request, proposal) {
  const problems = [];
  if (!proposal) problems.push('The legacy claim has malformed proposal data.');
  if (!scope.requestedClient && request.request_type === 'claim_client') problems.push('The requested client no longer exists.');
  if (scope.requestedClient && Number(scope.requestedClient.is_active) !== 1) problems.push('The requested client is inactive.');
  if (!scope.activeClients.length) problems.push('No active client or line remains in this scope.');
  if (!scope.accountId && !scope.accountNumber) problems.push('No reliable account grouping identifier exists.');
  if (scope.accounts.length > 1) problems.push('More than one canonical account matches this claim.');
  if (scope.accounts.some(row => ['inactive', 'cancelled'].includes(clean(row.account_status, 40).toLowerCase()))) problems.push('The canonical account is inactive.');
  const proposedClaimant = positiveId(proposal?.claimant_id || proposal?.assigned_staff_id);
  if (proposedClaimant && proposedClaimant !== Number(request.requested_by)) problems.push('The proposal names a different claimant.');
  if (problems.length) return { classification: 'exception', reason: problems.join(' ') };

  const claimantIds = new Set(scope.pendingClaims.map(row => Number(row.requested_by)).filter(Boolean));
  if (claimantIds.size > 1) return { classification: 'ownership_conflict', reason: 'Ownership conflict - review required' };
  const evidence = [
    ...scope.assignments.map(row => Number(row.assigned_staff_id)),
    ...scope.accounts.map(row => Number(row.assigned_staff_id)).filter(Boolean),
    ...scope.fixedAccounts.filter(row => !['inactive', 'cancelled'].includes(clean(row.account_status, 40).toLowerCase()))
      .map(row => Number(row.assigned_staff_id)).filter(Boolean)
  ];
  const assignees = new Set(evidence.filter(Boolean));
  if (assignees.size > 1 || (assignees.size === 1 && !assignees.has(Number(request.requested_by)))) {
    return { classification: 'ownership_conflict', reason: 'Ownership conflict - review required' };
  }
  if (!assignees.size) return { classification: 'safe_to_apply', reason: 'One active claimant and no trusted current assignee.' };
  const accountWide = scope.accounts.some(row => Number(row.assigned_staff_id) === Number(request.requested_by));
  const assignedClients = new Set(scope.assignments
    .filter(row => Number(row.assigned_staff_id) === Number(request.requested_by)).map(row => Number(row.client_id)));
  if (accountWide || scope.activeClients.every(row => assignedClients.has(Number(row.id)))) {
    return { classification: 'already_correct', reason: 'The trusted scope is already assigned to this claimant.' };
  }
  return { classification: 'exception', reason: 'Assignment coverage is incomplete.' };
}

async function findLinkedMessages(conn, requestIds, clientIds) {
  const params = [];
  const where = ["title='Client claim awaiting approval'"];
  const link = [];
  if (clientIds.length) { link.push(`related_client_id IN (${placeholders(clientIds)})`); params.push(...clientIds); }
  for (const id of requestIds) { link.push('message LIKE ?'); params.push(`%request #${id}.%`); }
  if (!link.length) return [];
  where.push(`(${link.join(' OR ')})`);
  const [rows] = await conn.query(`SELECT id,title,message,status,assigned_to,related_client_id,created_at
    FROM staff_tasks WHERE ${where.join(' AND ')} ORDER BY id FOR UPDATE`, params);
  const ids = new Set(requestIds.map(Number));
  return rows.filter(row => ids.has(extractLegacyClaimRequestId(row)));
}

async function resolveMessages(conn, messages, note, actorId) {
  if (!messages.length) return;
  const ids = messages.map(row => Number(row.id));
  await conn.query(`UPDATE staff_tasks SET status='completed',seen_at=COALESCE(seen_at,NOW()),
    started_at=COALESCE(started_at,NOW()),completed_at=NOW(),completion_note=? WHERE id IN (${placeholders(ids)})`, [note, ...ids]);
  try {
    await conn.query(`UPDATE staff_task_notifications SET resolved_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW())
      WHERE task_id IN (${placeholders(ids)}) AND resolved_at IS NULL`, ids);
  } catch (error) {
    // This table was introduced by the task workflow's runtime compatibility layer.
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  for (const id of ids) {
    await conn.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment)
      VALUES (:taskId,:staffId,:comment)`, { taskId: id, staffId: actorId, comment: note });
  }
}

async function applyScope(conn, scope, claimantId, decisionUserId) {
  const accountNumber = scope.accounts[0]?.account_number || scope.activeClients.map(row => clean(row.account_number, 120)).find(Boolean) || null;
  for (const client of scope.activeClients) {
    await conn.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active)
      VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)
      ON DUPLICATE KEY UPDATE account_number=VALUES(account_number),assigned_staff_id=VALUES(assigned_staff_id),
        assigned_by=VALUES(assigned_by),is_active=1,updated_at=NOW()`, {
      clientId: client.id, accountNumber, staffId: claimantId, assignedBy: decisionUserId
    });
  }
  if (scope.accounts.length === 1) {
    await conn.execute(`UPDATE customer_accounts SET assigned_staff_id=:staffId,assigned_by=:assignedBy,
      assignment_confirmed_at=NOW() WHERE id=:id`, { staffId: claimantId, assignedBy: decisionUserId, id: scope.accounts[0].id });
  }
  if (scope.accountNumber) {
    await conn.execute(`UPDATE fixed_accounts SET assigned_staff_id=:staffId,updated_at=NOW()
      WHERE account_number_normalised=:number
         OR UPPER(REPLACE(TRIM(COALESCE(linked_mobile_account_number,'')),' ',''))=:number`, {
      staffId: claimantId, number: scope.accountNumber
    });
  }
}

async function auditDecision(conn, context, request, scope, before, after, actionType) {
  await conn.execute(`INSERT INTO audit_log
    (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent)
    VALUES (:staffId,:actionType,'data_change_requests',:requestId,:description,:beforeJson,:afterJson,:ip,:userAgent)`, {
    staffId: context.user.id,
    actionType,
    requestId: request.id,
    description: clean(`Legacy claim #${request.id}: ${after.result_classification}`, 500),
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(after),
    ip: clean(context.ipAddress, 64) || null,
    userAgent: clean(context.userAgent, 255) || null
  });
}

async function decideLegacyClaim(requestIdValue, decisionValue, options = {}, database = db) {
  const requestId = positiveId(requestIdValue);
  const decision = clean(decisionValue, 20).toLowerCase();
  if (!requestId || !['approve', 'reject'].includes(decision)) throw decisionError('Choose approve or reject.', 400);
  const context = { user: options.user || {}, ipAddress: options.ipAddress, userAgent: options.userAgent };
  const decisionUserId = positiveId(context.user.id);
  if (!decisionUserId) throw decisionError('A signed-in decision maker is required.', 403);
  const conn = await database.getConnection();
  try {
    await conn.beginTransaction();
    const [[request]] = await conn.execute(`SELECT * FROM data_change_requests
      WHERE id=:requestId AND request_type IN ('claim_client','claim_account') FOR UPDATE`, { requestId });
    if (!request) throw decisionError('Legacy claim request not found.', 404);
    if (!canDecide(context.user, request)) throw decisionError('You do not have permission to decide this legacy claim.', 403);
    if (TERMINAL.has(request.status)) {
      if (request.status !== 'applied') throw decisionError(`This claim was already ${request.status}.`);
      const [[appliedClaimant]] = await conn.execute(`SELECT id,full_name,is_active FROM staff_users WHERE id=:id FOR UPDATE`, { id: request.requested_by });
      const messages = await findLinkedMessages(conn, [request.id], uniqueIds([request.client_id]));
      await resolveMessages(conn, messages, `Claim already applied. Confirmed by ${clean(context.user.full_name, 255)}.`, decisionUserId);
      const before = { request_id: Number(request.id), message_id: positiveId(options.messageId), request_status: 'applied',
        claimant: { id: Number(request.requested_by), name: appliedClaimant?.full_name || null } };
      await auditDecision(conn, context, request, {}, before, { ...before,
        decision_user: { id: decisionUserId, name: context.user.full_name }, decision_timestamp: new Date().toISOString(),
        result_classification: 'already_correct', result: 'idempotent_retry', message_ids: messages.map(row => Number(row.id))
      }, 'legacy_client_claim_idempotent');
      await conn.commit();
      return { status: 'completed', classification: 'already_correct', idempotent: true, requestId, messageIds: messages.map(row => Number(row.id)) };
    }
    if (!PENDING.has(request.status)) throw decisionError('This claim is not awaiting a decision.');
    const proposal = parseProposal(request.proposed_data_json);
    const [[claimant]] = await conn.execute(`SELECT id,full_name,is_active FROM staff_users WHERE id=:id FOR UPDATE`, { id: request.requested_by });
    if (!claimant || Number(claimant.is_active) !== 1) throw decisionError('The claimant is missing or inactive.');
    const scope = await loadLockedScope(conn, request, proposal || {});
    const before = {
      request_id: Number(request.id), message_id: positiveId(options.messageId), request_status: request.status,
      claimant: { id: Number(claimant.id), name: claimant.full_name }, claim_timestamp: request.created_at,
      client_ids: scope.clientIds,
      account_id: scope.accountId, account_number: scope.accountNumber,
      assignments: scope.assignments.map(row => ({ client_id: Number(row.client_id), staff_id: Number(row.assigned_staff_id) }))
    };

    if (decision === 'reject') {
      const reason = clean(options.reason, 2000);
      if (!reason) throw decisionError('A reason is required to reject a legacy claim.', 400);
      await conn.execute(`UPDATE data_change_requests SET status='rejected',reviewed_by=:reviewedBy,
        reviewed_at=NOW(),review_comment=:reason WHERE id=:requestId`, { reviewedBy: decisionUserId, reason, requestId });
      const messages = await findLinkedMessages(conn, [request.id], scope.clientIds);
      const note = `Claim rejected by ${clean(context.user.full_name, 255)}: ${reason}`;
      await resolveMessages(conn, messages, note, decisionUserId);
      const after = { ...before, request_status: 'rejected', decision_user: { id: decisionUserId, name: context.user.full_name },
        reason, decision_timestamp: new Date().toISOString(), result_classification: 'rejected', message_ids: messages.map(row => Number(row.id)) };
      await auditDecision(conn, context, request, scope, before, after, 'legacy_client_claim_rejected');
      await conn.commit();
      return { status: 'completed', classification: 'rejected', requestId, messageIds: after.message_ids };
    }

    const classification = classify(scope, request, proposal);
    if (classification.classification === 'ownership_conflict') {
      const after = { ...before, request_status: request.status, decision_user: { id: decisionUserId, name: context.user.full_name },
        decision_timestamp: new Date().toISOString(), result_classification: 'ownership_conflict', result: classification.reason };
      await auditDecision(conn, context, request, scope, before, after, 'legacy_client_claim_conflict_review_required');
      await conn.commit();
      return { status: 'conflict', classification: 'ownership_conflict', message: 'Ownership conflict - review required', requestId };
    }
    if (classification.classification === 'exception') throw decisionError(classification.reason);

    if (classification.classification === 'safe_to_apply') await applyScope(conn, scope, Number(claimant.id), decisionUserId);
    const duplicateIds = scope.pendingClaims.filter(row => Number(row.requested_by) === Number(claimant.id)).map(row => Number(row.id));
    const satisfiedIds = uniqueIds([request.id, ...duplicateIds]);
    const reviewComment = clean(options.reason, 2000) || `Safely approved through legacy claim #${request.id}.`;
    await conn.query(`UPDATE data_change_requests SET status='applied',reviewed_by=?,reviewed_at=NOW(),
      review_comment=?,applied_at=COALESCE(applied_at,NOW()) WHERE id IN (${placeholders(satisfiedIds)})`,
    [decisionUserId, reviewComment, ...satisfiedIds]);
    const messages = await findLinkedMessages(conn, satisfiedIds, scope.clientIds);
    const note = `${classification.classification === 'already_correct' ? 'Claim already satisfied' : 'Claim approved safely'} by ${clean(context.user.full_name, 255)}.`;
    await resolveMessages(conn, messages, note, decisionUserId);
    const after = { ...before, request_status: 'applied', duplicate_request_ids: satisfiedIds.filter(id => id !== requestId),
      resulting_assignment: { staff_id: Number(claimant.id), staff_name: claimant.full_name, client_ids: scope.clientIds,
        account_id: scope.accountId, account_number: scope.accountNumber }, decision_user: { id: decisionUserId, name: context.user.full_name },
      reason: reviewComment, decision_timestamp: new Date().toISOString(), result_classification: classification.classification,
      message_ids: messages.map(row => Number(row.id)) };
    await auditDecision(conn, context, request, scope, before, after,
      classification.classification === 'already_correct' ? 'legacy_client_claim_satisfied' : 'legacy_client_claim_approved');
    await conn.commit();
    return { status: 'completed', classification: classification.classification, requestId,
      duplicateRequestIds: after.duplicate_request_ids, messageIds: after.message_ids };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function decorateLegacyClaimTasks(tasks, user, database = db) {
  const requestIds = uniqueIds(tasks.map(extractLegacyClaimRequestId));
  if (!requestIds.length) return tasks.map(task => ({ ...task, legacyClaim: null }));
  const [requests] = await database.query(`SELECT id,request_type,status,required_approval_role,proposed_data_json
    FROM data_change_requests WHERE id IN (${placeholders(requestIds)})`, requestIds);
  const byId = new Map(requests.map(row => [Number(row.id), row]));
  return tasks.map(task => {
    const id = extractLegacyClaimRequestId(task);
    const request = byId.get(id);
    const pending = request && PENDING.has(request.status);
    return { ...task, legacyClaim: request ? {
      requestId: id, status: request.status, pending, canDecide: pending && canDecide(user, request),
      ownerOnly: request.status === 'pending_owner' || request.required_approval_role === 'owner',
      openUrl: `/clients/assignment-centre?view=pending&focus_request=${id}`
    } : null };
  });
}

module.exports = { LEGACY_TITLE, extractLegacyClaimRequestId, canDecide, classify, decideLegacyClaim, decorateLegacyClaimTasks };
