const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { claimClient } = require('../services/client-claim');

const router = express.Router();
const MANAGEMENT_ROLES = ['owner', 'admin', 'manager'];

function isManagement(user) {
  return Boolean(user && MANAGEMENT_ROLES.includes(String(user.role || '').toLowerCase()));
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function panelSuffix(req, separator = '?') {
  return String(req.body?.panel || req.query?.panel || '') === '1' ? `${separator}panel=1` : '';
}

function normaliseAccount(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function accountKey(record) {
  const account = normaliseAccount(record.account_number || record.client_account_number);
  if (account) return `account:${account}`;
  const accountId = positiveId(record.account_id);
  if (accountId) return `account-id:${accountId}`;
  return `client:${positiveId(record.client_id) || positiveId(record.id) || 'unknown'}`;
}

function mainRecordScore(row) {
  let score = 0;
  if (String(row.account_authority_status || '') === 'confirmed') score += 100;
  if (String(row.lifecycle_status || '') === 'client') score += 20;
  if (String(row.line_status || '') === 'active') score += 10;
  if (clean(row.main_contact_name)) score += 5;
  if (clean(row.client_name)) score += 2;
  return score;
}

function selectMainRecord(rows) {
  return [...rows].sort((a, b) => {
    const scoreDifference = mainRecordScore(b) - mainRecordScore(a);
    if (scoreDifference) return scoreDifference;
    return Number(a.id) - Number(b.id);
  })[0];
}

function requestDetails(row) {
  try {
    const proposed = JSON.parse(row.proposed_data_json || '{}');
    return {
      ...row,
      linked_line_count: Number(proposed.linked_line_count || 1),
      linked_client_ids: Array.isArray(proposed.linked_client_ids) ? proposed.linked_client_ids : []
    };
  } catch (_) {
    return { ...row, linked_line_count: 1, linked_client_ids: [] };
  }
}

function parseProposal(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function loadAccountGroups() {
  const [clientRows] = await db.query(`SELECT c.id,c.account_id,c.account_number,c.client_name,c.cell_number,c.email,c.city_town,
      c.lifecycle_status,c.line_status,c.next_upgrade_date,c.created_at,c.account_authority_status,c.main_contact_name
    FROM clients c
    WHERE c.is_active=1
    ORDER BY c.id`);

  const [assignmentRows] = await db.query(`SELECT a.id,a.client_id,a.account_number,a.assigned_staff_id,a.updated_at,
      c.account_id,c.account_number client_account_number,s.full_name assigned_staff_name
    FROM client_assignments a
    LEFT JOIN clients c ON c.id=a.client_id
    LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
    WHERE a.is_active=1
    ORDER BY a.updated_at DESC,a.id DESC`);

  const [pendingRows] = await db.query(`SELECT r.id,r.client_id,r.account_number,r.requested_by,r.created_at,
      c.account_id,c.account_number client_account_number,u.full_name pending_requested_by_name
    FROM data_change_requests r
    LEFT JOIN clients c ON c.id=r.client_id
    LEFT JOIN staff_users u ON u.id=r.requested_by
    WHERE r.request_type='claim_client' AND r.status IN ('pending_manager','pending_owner')
    ORDER BY r.created_at,r.id`);

  const assignmentsByKey = new Map();
  for (const row of assignmentRows) {
    const key = accountKey(row);
    if (!assignmentsByKey.has(key)) assignmentsByKey.set(key, row);
  }

  const pendingByKey = new Map();
  for (const row of pendingRows) {
    const key = accountKey(row);
    if (!pendingByKey.has(key)) pendingByKey.set(key, row);
  }

  const groupedRows = new Map();
  for (const row of clientRows) {
    const key = accountKey(row);
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key).push(row);
  }

  const groups = [];
  for (const [key, rows] of groupedRows.entries()) {
    const main = selectMainRecord(rows);
    const assignment = assignmentsByKey.get(key) || null;
    const pending = pendingByKey.get(key) || null;
    const accountNumber = rows.map(row => clean(row.account_number)).find(Boolean) || null;
    groups.push({
      ...main,
      account_number: accountNumber,
      account_group_key: key,
      linked_line_count: rows.length,
      linked_client_ids: rows.map(row => Number(row.id)),
      linked_mobile_numbers: [...new Set(rows.map(row => clean(row.cell_number)).filter(Boolean))],
      assigned_staff_id: assignment?.assigned_staff_id || null,
      assigned_staff_name: assignment?.assigned_staff_name || null,
      pending_claim_id: pending?.id || null,
      pending_requested_by: pending?.requested_by || null,
      pending_requested_by_name: pending?.pending_requested_by_name || null,
      pending_requested_at: pending?.created_at || null,
      search_text: rows.flatMap(row => [row.client_name,row.cell_number,row.email,row.account_number,row.city_town,row.main_contact_name])
        .filter(Boolean).join(' ').toLowerCase()
    });
  }

  return groups;
}

async function unassignedCount() {
  const groups = await loadAccountGroups();
  return groups.filter(group => !group.assigned_staff_id).length;
}

async function loadScopeClients(conn, client, lock = false) {
  const normalised = normaliseAccount(client.account_number);
  const accountId = positiveId(client.account_id);
  const [rows] = await conn.execute(`SELECT id,account_id,account_number,client_name,cell_number,email,
      account_authority_status,lifecycle_status,line_status,main_contact_name
    FROM clients
    WHERE is_active=1 AND (
      id=:clientId
      OR (:normalised<>'' AND UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised)
      OR (:accountId IS NOT NULL AND account_id=:accountId)
    )
    ORDER BY id${lock ? ' FOR UPDATE' : ''}`, {
    clientId: client.id,
    normalised,
    accountId
  });
  return rows;
}

function idPlaceholders(rows) {
  return rows.map(() => '?').join(',');
}

async function findGroupAssignment(conn, scopeClients, normalised, lock = false) {
  const ids = scopeClients.map(row => Number(row.id));
  const params = [...ids];
  let where = `a.client_id IN (${idPlaceholders(scopeClients)})`;
  if (normalised) {
    where += ` OR UPPER(REPLACE(TRIM(COALESCE(a.account_number,'')),' ',''))=?`;
    params.push(normalised);
  }
  const [rows] = await conn.query(`SELECT a.assigned_staff_id,s.full_name
    FROM client_assignments a JOIN staff_users s ON s.id=a.assigned_staff_id
    WHERE a.is_active=1 AND (${where})
    ORDER BY a.updated_at DESC,a.id DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, params);
  return rows[0] || null;
}

async function findPendingGroupClaim(conn, scopeClients, normalised, excludeId = null, lock = false) {
  const ids = scopeClients.map(row => Number(row.id));
  const params = [...ids];
  let where = `r.client_id IN (${idPlaceholders(scopeClients)})`;
  if (normalised) {
    where += ` OR UPPER(REPLACE(TRIM(COALESCE(r.account_number,'')),' ',''))=?`;
    params.push(normalised);
  }
  let exclude = '';
  if (excludeId) {
    exclude = ' AND r.id<>?';
    params.push(excludeId);
  }
  const [rows] = await conn.query(`SELECT r.id,r.requested_by
    FROM data_change_requests r
    WHERE r.request_type='claim_client' AND r.status IN ('pending_manager','pending_owner')
      AND (${where})${exclude}
    ORDER BY r.created_at,r.id LIMIT 1${lock ? ' FOR UPDATE' : ''}`, params);
  return rows[0] || null;
}

router.use(async (req, res, next) => {
  res.locals.unassignedClientCount = 0;
  if (!req.session?.user || req.path !== '/workspace') return next();
  try {
    res.locals.unassignedClientCount = await unassignedCount();
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/api/client-assignments/status', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.session.user.id);
    const groups = await loadAccountGroups();
    const [[requests]] = await db.execute(`SELECT COUNT(*) total FROM data_change_requests
      WHERE request_type='claim_client' AND requested_by=:userId AND status IN ('pending_manager','pending_owner')`, { userId });
    res.json({
      ok: true,
      unassignedCount: groups.filter(group => !group.assigned_staff_id).length,
      myClientCount: groups.filter(group => Number(group.assigned_staff_id) === userId).length,
      myPendingClaimCount: Number(requests?.total || 0)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/clients/assignment-centre', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.session.user.id);
    const management = isManagement(req.session.user);
    const allowed = ['unassigned', 'mine', 'requests', 'pending', 'all'];
    let view = allowed.includes(String(req.query.view || '')) ? String(req.query.view) : 'unassigned';
    if (!management && ['pending', 'all'].includes(view)) view = 'unassigned';
    const q = clean(req.query.q, 200);
    let clients = [];
    let requests = [];
    const groups = await loadAccountGroups();

    if (view === 'requests') {
      [requests] = await db.execute(`SELECT r.*,c.client_name,c.cell_number,c.email,c.city_town,
          reviewer.full_name reviewed_by_name
        FROM data_change_requests r
        LEFT JOIN clients c ON c.id=r.client_id
        LEFT JOIN staff_users reviewer ON reviewer.id=r.reviewed_by
        WHERE r.request_type='claim_client' AND r.requested_by=:userId
        ORDER BY r.created_at DESC LIMIT 500`, { userId });
      requests = requests.map(requestDetails);
    } else if (view === 'pending') {
      [requests] = await db.execute(`SELECT r.*,c.client_name,c.cell_number,c.email,c.city_town,
          requester.full_name requested_by_name
        FROM data_change_requests r
        LEFT JOIN clients c ON c.id=r.client_id
        JOIN staff_users requester ON requester.id=r.requested_by
        WHERE r.request_type='claim_client' AND r.status IN ('pending_manager','pending_owner')
        ORDER BY r.created_at LIMIT 500`);
      requests = requests.map(requestDetails);
    } else {
      clients = groups.filter(group => {
        if (view === 'unassigned' && group.assigned_staff_id) return false;
        if (view === 'mine' && Number(group.assigned_staff_id) !== userId) return false;
        if (view === 'all' && !group.assigned_staff_id) return false;
        if (q && !group.search_text.includes(q.toLowerCase())) return false;
        return true;
      }).sort((a, b) => {
        if (Boolean(a.pending_claim_id) !== Boolean(b.pending_claim_id)) return a.pending_claim_id ? 1 : -1;
        return String(a.client_name || '').localeCompare(String(b.client_name || '')) || Number(a.id) - Number(b.id);
      }).slice(0, 1000);
    }

    const [[requestCounts]] = await db.execute(`SELECT
      SUM(requested_by=:userId AND status IN ('pending_manager','pending_owner')) requests_count,
      SUM(status IN ('pending_manager','pending_owner')) pending_count
      FROM data_change_requests WHERE request_type='claim_client'`, { userId });

    const counts = {
      unassigned_count: groups.filter(group => !group.assigned_staff_id).length,
      mine_count: groups.filter(group => Number(group.assigned_staff_id) === userId).length,
      requests_count: Number(requestCounts?.requests_count || 0),
      pending_count: Number(requestCounts?.pending_count || 0),
      assigned_count: groups.filter(group => group.assigned_staff_id).length
    };

    res.render('client-assignment-centre', {
      title: 'Client Assignment Centre',
      view,
      q,
      clients,
      requests,
      counts,
      isManagement: management,
      requested: req.query.requested,
      claimed: req.query.claimed,
      conflict: req.query.conflict,
      conflictOwner: clean(req.query.owner, 255),
      reviewed: req.query.reviewed
    });
  } catch (error) {
    next(error);
  }
});

router.post('/clients/:id/request-claim', requireAuth, async (req, res, next) => {
  const requestedClientId = positiveId(req.params.id);
  if (!requestedClientId) return next();
  try {
    const result = await claimClient(requestedClientId, {
      claimant: { id: req.session.user.id, name: req.session.user.full_name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      basePath: res.locals.basePath
    });
    if (result.status === 'conflict') {
      const query = new URLSearchParams({
        view: 'unassigned',
        conflict: '1',
        owner: result.currentAssigneeName
      });
      if (String(req.body.panel || '') === '1') query.set('panel', '1');
      return res.redirect(`${res.locals.basePath}/clients/assignment-centre?${query.toString()}`);
    }
    res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=mine&claimed=1${panelSuffix(req, '&')}`);
  } catch (error) {
    if (!error.code) return res.status(409).render('error', { title: 'Client could not be claimed', message: error.message });
    next(error);
  }
});

router.post('/client-claims/:id/decision', requireAuth, async (req, res, next) => {
  if (!isManagement(req.session.user)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Only management can approve or reject client claims.' });
  }
  const requestId = positiveId(req.params.id);
  if (!requestId) return next();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[request]] = await conn.execute(`SELECT * FROM data_change_requests
      WHERE id=:requestId AND request_type='claim_client' FOR UPDATE`, { requestId });
    if (!request || !['pending_manager', 'pending_owner'].includes(request.status)) throw new Error('This claim request has already been reviewed.');
    const proposedRequest = parseProposal(request.proposed_data_json);
    if (proposedRequest.ownership_conflict && String(req.session.user.role || '').toLowerCase() !== 'owner') {
      await conn.rollback();
      return res.status(403).render('error', { title: 'Owner decision required', message: 'Only an owner can resolve a client ownership conflict.' });
    }
    const decision = String(req.body.decision || '');
    const comment = clean(req.body.comment, 2000) || null;

    if (decision === 'reject') {
      await conn.execute(`UPDATE data_change_requests SET status='rejected',reviewed_by=:reviewedBy,
        reviewed_at=NOW(),review_comment=:comment WHERE id=:requestId`, {
        reviewedBy: req.session.user.id, comment, requestId
      });
      await conn.execute(`INSERT INTO staff_tasks
        (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,email_status)
        VALUES ('notification',:title,:message,'normal','unread',:assignedTo,:createdBy,NOW(),:clientId,'not_configured')`, {
        title: proposedRequest.ownership_conflict ? 'Client ownership decision' : 'Client claim not approved',
        message: `${proposedRequest.ownership_conflict ? 'The owner kept the current client assignment' : 'Your request to claim this account was not approved'}${comment ? `: ${comment}` : '.'}`,
        assignedTo: request.requested_by,
        createdBy: req.session.user.id,
        clientId: request.client_id
      });
      await conn.commit();
      await audit(req, { actionType: proposedRequest.ownership_conflict ? 'client_claim_conflict_resolved' : 'client_claim_rejected', entityType: 'data_change_requests', entityId: requestId, description: proposedRequest.ownership_conflict ? 'Ownership conflict resolved by keeping the current assignment' : 'Client account claim rejected', after: { comment, decision: 'keep_current_assignment', ...proposedRequest } });
      return res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=pending&reviewed=rejected${panelSuffix(req, '&')}`);
    }

    if (decision !== 'approve') throw new Error('Choose approve or reject.');
    const [[requestedClient]] = await conn.execute(`SELECT id,account_id,client_name,account_number FROM clients
      WHERE id=:clientId AND is_active=1 FOR UPDATE`, { clientId: request.client_id });
    if (!requestedClient) throw new Error('The client is no longer available.');

    const scopeClients = await loadScopeClients(conn, requestedClient, true);
    const mainClient = selectMainRecord(scopeClients);
    const accountNumber = scopeClients.map(row => clean(row.account_number)).find(Boolean) || null;
    const normalised = normaliseAccount(accountNumber);
    const existingAssignment = await findGroupAssignment(conn, scopeClients, normalised, true);
    if (existingAssignment && Number(existingAssignment.assigned_staff_id) !== Number(request.requested_by)) {
      if (String(req.session.user.role || '').toLowerCase() !== 'owner') {
        await conn.rollback();
        return res.status(403).render('error', { title: 'Owner decision required', message: 'Only an owner can reassign a client while resolving an ownership conflict.' });
      }
    }

    const [[staff]] = await conn.execute(`SELECT id,full_name FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1`, { id: request.requested_by });
    if (!staff) throw new Error('The requesting staff member is no longer active.');

    const scopeIds = scopeClients.map(row => Number(row.id));
    const assignmentParams = [...scopeIds];
    let assignmentWhere = `client_id IN (${idPlaceholders(scopeClients)})`;
    if (normalised) {
      assignmentWhere += ` OR UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=?`;
      assignmentParams.push(normalised);
    }
    await conn.query(`UPDATE client_assignments SET is_active=0,updated_at=NOW()
      WHERE is_active=1 AND (${assignmentWhere})`, assignmentParams);

    for (const row of scopeClients) {
      await conn.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active)
        VALUES (:clientId,:account,:staffId,:assignedBy,1)
        ON DUPLICATE KEY UPDATE account_number=VALUES(account_number),assigned_staff_id=VALUES(assigned_staff_id),
          assigned_by=VALUES(assigned_by),is_active=1,updated_at=NOW()`, {
        clientId: row.id,
        account: accountNumber,
        staffId: staff.id,
        assignedBy: req.session.user.id
      });
    }

    if (normalised) {
      await conn.execute(`UPDATE customer_accounts SET assigned_staff_id=:staffId,assigned_by=:assignedBy,
        assignment_confirmed_at=NOW() WHERE account_number_normalised=:normalised`, {
        staffId: staff.id, assignedBy: req.session.user.id, normalised
      });
      await conn.execute(`UPDATE fixed_accounts SET assigned_staff_id=:staffId,updated_at=NOW()
        WHERE UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised
           OR UPPER(REPLACE(TRIM(COALESCE(linked_mobile_account_number,'')),' ',''))=:normalised`, {
        staffId: staff.id, normalised
      });
    }

    const duplicateClaim = await findPendingGroupClaim(conn, scopeClients, normalised, requestId, true);
    if (duplicateClaim) {
      const pendingParams = [req.session.user.id, `Automatically closed because account claim #${requestId} was approved.`, request.requested_by, ...scopeIds];
      let pendingWhere = `client_id IN (${idPlaceholders(scopeClients)})`;
      if (normalised) {
        pendingWhere += ` OR UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=?`;
        pendingParams.push(normalised);
      }
      pendingParams.push(requestId);
      await conn.query(`UPDATE data_change_requests SET status='rejected',reviewed_by=?,reviewed_at=NOW(),review_comment=?
        WHERE request_type='claim_client' AND status IN ('pending_manager','pending_owner')
          AND requested_by=? AND (${pendingWhere}) AND id<>?`, pendingParams);
    }

    await conn.execute(`UPDATE data_change_requests SET status='applied',reviewed_by=:reviewedBy,
      reviewed_at=NOW(),review_comment=:comment,applied_at=NOW(),
      proposed_data_json=:proposed WHERE id=:requestId`, {
      reviewedBy: req.session.user.id,
      comment,
      requestId,
      proposed: JSON.stringify({
        ...proposedRequest,
        client_id: mainClient.id,
        linked_client_ids: scopeIds,
        linked_line_count: scopeClients.length,
        account_number: accountNumber,
        assigned_staff_id: staff.id,
        assigned_staff_name: staff.full_name,
        scope: accountNumber || mainClient.account_id ? 'account' : 'client',
        ownership_conflict: Boolean(proposedRequest.ownership_conflict || (existingAssignment && Number(existingAssignment.assigned_staff_id) !== Number(request.requested_by))),
        previous_assignee_id: existingAssignment?.assigned_staff_id || null,
        previous_assignee_name: existingAssignment?.full_name || null
      })
    });

    await conn.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,email_status)
      VALUES ('notification',:title,:message,'normal','unread',:assignedTo,:createdBy,NOW(),:clientId,'not_configured')`, {
      title: proposedRequest.ownership_conflict ? 'Client ownership decision' : 'Client claim approved',
      message: `${mainClient.client_name || 'The client account'} is now assigned to you. ${scopeClients.length} linked line${scopeClients.length === 1 ? ' was' : 's were'} assigned together.`,
      assignedTo: staff.id,
      createdBy: req.session.user.id,
      clientId: mainClient.id
    });

    await conn.commit();
    await audit(req, {
      actionType: proposedRequest.ownership_conflict ? 'client_claim_conflict_resolved' : 'client_claim_approved',
      entityType: 'clients',
      entityId: mainClient.id,
      description: `${proposedRequest.ownership_conflict ? 'Ownership conflict resolved: ' : ''}${mainClient.client_name || mainClient.id} and ${scopeClients.length} linked line${scopeClients.length === 1 ? '' : 's'} assigned to ${staff.full_name}`,
      after: {
        ...proposedRequest,
        assigned_staff_id: staff.id,
        assigned_staff_name: staff.full_name,
        account_number: accountNumber,
        linked_client_ids: scopeIds,
        linked_line_count: scopeClients.length,
        scope: accountNumber || mainClient.account_id ? 'account' : 'client',
        previous_assignee_id: existingAssignment?.assigned_staff_id || null,
        previous_assignee_name: existingAssignment?.full_name || null,
        decision: proposedRequest.ownership_conflict ? 'reassign_to_claimant' : 'apply_legacy_claim'
      }
    });
    res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=pending&reviewed=approved${panelSuffix(req, '&')}`);
  } catch (error) {
    await conn.rollback();
    if (!error.code) return res.status(409).render('error', { title: 'Claim could not be reviewed', message: error.message });
    next(error);
  } finally {
    conn.release();
  }
});

module.exports = router;
