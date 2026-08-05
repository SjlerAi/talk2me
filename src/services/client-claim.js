const db = require('../config/db');

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normaliseAccount(value) {
  return clean(value, 120).replace(/\s+/g, '').toUpperCase();
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function claimLinks(basePath, clientId, conflictId = null) {
  const root = String(basePath || '').replace(/\/$/, '');
  return {
    client: `${root}/customers/${clientId}/360`,
    assignment_centre: `${root}/clients/assignment-centre?view=all`,
    owner_resolution: conflictId ? `${root}/approvals?tab=client_claims&q=${conflictId}` : `${root}/approvals?tab=client_claims`
  };
}

async function insertAudit(conn, context, details) {
  await conn.execute(`INSERT INTO audit_log
    (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent)
    VALUES (:staffId,:actionType,'clients',:clientId,:description,:beforeJson,:afterJson,:ip,:userAgent)`, {
    staffId: context.claimant.id,
    actionType: details.actionType,
    clientId: details.clientId,
    description: clean(details.description, 500),
    beforeJson: JSON.stringify(details.before),
    afterJson: JSON.stringify(details.after),
    ip: clean(context.ipAddress, 64) || null,
    userAgent: clean(context.userAgent, 255) || null
  });
}

async function loadLockedScope(conn, clientId) {
  const [[requested]] = await conn.execute(`SELECT id,account_id,account_number,client_name,cell_number,email
    FROM clients WHERE id=:clientId AND is_active=1 FOR UPDATE`, { clientId });
  if (!requested) throw new Error('Client not found.');

  const normalised = normaliseAccount(requested.account_number);
  const accountId = positiveId(requested.account_id);
  const [clients] = await conn.execute(`SELECT id,account_id,account_number,client_name,cell_number,email,
      account_authority_status,lifecycle_status,line_status,main_contact_name
    FROM clients
    WHERE is_active=1 AND (
      id=:clientId
      OR (:normalised<>'' AND UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised)
      OR (:accountId IS NOT NULL AND account_id=:accountId)
    ) ORDER BY id FOR UPDATE`, { clientId: requested.id, normalised, accountId });

  let account = null;
  if (accountId || normalised) {
    [[account]] = await conn.execute(`SELECT id,account_number,account_number_normalised,assigned_staff_id,
        assigned_by,assignment_confirmed_at
      FROM customer_accounts
      WHERE (:accountId IS NOT NULL AND id=:accountId)
         OR (:normalised<>'' AND account_number_normalised=:normalised)
      ORDER BY (id=:accountId) DESC,id LIMIT 1 FOR UPDATE`, { accountId, normalised });
  }
  return { requested, clients, account: account || null, normalised };
}

async function loadLockedAssignments(conn, scope) {
  const ids = scope.clients.map(row => Number(row.id));
  const params = [...ids];
  let where = `a.client_id IN (${placeholders(ids)})`;
  if (scope.normalised) {
    where += ` OR UPPER(REPLACE(TRIM(COALESCE(a.account_number,'')),' ',''))=?`;
    params.push(scope.normalised);
  }
  const [rows] = await conn.query(`SELECT a.id,a.client_id,a.account_number,a.assigned_staff_id,a.assigned_at,
      a.updated_at,s.full_name assigned_staff_name
    FROM client_assignments a
    JOIN staff_users s ON s.id=a.assigned_staff_id
    WHERE a.is_active=1 AND (${where})
    ORDER BY a.updated_at DESC,a.id DESC FOR UPDATE`, params);
  return rows;
}

async function loadLockedLegacyClaims(conn, scope) {
  const ids = scope.clients.map(row => Number(row.id));
  const params = [...ids];
  let where = `r.client_id IN (${placeholders(ids)})`;
  if (scope.account?.id) {
    where += ' OR r.record_id=?';
    params.push(Number(scope.account.id));
  }
  if (scope.normalised) {
    where += ` OR UPPER(REPLACE(TRIM(COALESCE(r.account_number,'')),' ',''))=?`;
    params.push(scope.normalised);
  }
  const [rows] = await conn.query(`SELECT r.* FROM data_change_requests r
    WHERE r.request_type IN ('claim_client','claim_account')
      AND r.status IN ('pending_manager','pending_owner') AND (${where})
    ORDER BY r.created_at,r.id FOR UPDATE`, params);
  return rows;
}

function activeAssignment(scope, assignments) {
  const row = assignments[0] || null;
  if (row) return {
    staffId: Number(row.assigned_staff_id),
    staffName: row.assigned_staff_name,
    assignedAt: row.assigned_at || row.updated_at,
    source: 'client_assignments'
  };
  if (scope.account?.assigned_staff_id) return {
    staffId: Number(scope.account.assigned_staff_id),
    staffName: null,
    assignedAt: scope.account.assignment_confirmed_at,
    source: 'customer_accounts'
  };
  return null;
}

async function staffName(conn, staffId, lock = false) {
  const [[staff]] = await conn.execute(`SELECT id,full_name FROM staff_users
    WHERE id=:id AND is_active=1 LIMIT 1${lock ? ' FOR UPDATE' : ''}`, { id: staffId });
  return staff || null;
}

function conflictProposal(scope, context, current, currentName, requestedAt, original = {}) {
  const main = scope.clients[0];
  return {
    ...original,
    ownership_conflict: true,
    scope: scope.normalised || scope.account ? 'account' : 'client',
    client_id: Number(main.id),
    linked_client_ids: scope.clients.map(row => Number(row.id)),
    linked_line_count: scope.clients.length,
    account_id: scope.account?.id || positiveId(main.account_id),
    account_number: scope.account?.account_number || clean(main.account_number) || null,
    claimant_id: Number(context.claimant.id),
    claimant_name: context.claimant.name,
    claim_timestamp: requestedAt,
    current_assignee_id: Number(current.staffId),
    current_assignee_name: currentName,
    current_assignment_timestamp: current.assignedAt || null,
    links: claimLinks(context.basePath, main.id)
  };
}

async function createOrReuseConflict(conn, scope, context, current, legacyClaims) {
  const claimantId = Number(context.claimant.id);
  const requestedAt = context.claimTimestamp || new Date().toISOString();
  const currentStaff = await staffName(conn, current.staffId);
  const currentName = currentStaff?.full_name || current.staffName || `staff member #${current.staffId}`;
  let conflict = legacyClaims.find(row => Number(row.requested_by) === claimantId) || null;
  const existingProposal = conflict ? parseJson(conflict.proposed_data_json) : {};
  let created = false;
  let proposal = conflictProposal(scope, context, current, currentName, requestedAt,
    conflict ? { legacy_proposal: existingProposal } : {});
  const main = scope.clients[0];
  const accountNumber = scope.account?.account_number || clean(main.account_number) || null;
  const displayName = main.client_name || main.cell_number || `client #${main.id}`;

  if (conflict) {
    proposal.links = claimLinks(context.basePath, main.id, conflict.id);
    proposal.conflict_notification_created = existingProposal.conflict_notification_created || requestedAt;
    await conn.execute(`UPDATE data_change_requests SET required_approval_role='owner',status='pending_owner',
      summary=:summary,reason=:reason,proposed_data_json=:proposal WHERE id=:id`, {
      id: conflict.id,
      summary: `Ownership conflict: ${displayName}`,
      reason: `Claim attempted by ${context.claimant.name} while ${currentName} is the active assignee.`,
      proposal: JSON.stringify(proposal)
    });
    for (const duplicate of legacyClaims.filter(row => Number(row.requested_by) === claimantId && Number(row.id) !== Number(conflict.id))) {
      await conn.execute(`UPDATE data_change_requests SET status='cancelled',reviewed_by=:staffId,reviewed_at=NOW(),
        review_comment='Duplicate claim closed; the earliest ownership conflict remains available for owner resolution.'
        WHERE id=:id`, { staffId: claimantId, id: duplicate.id });
    }
  } else {
    const [result] = await conn.execute(`INSERT INTO data_change_requests
      (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,
       required_approval_role,status,requested_by)
      VALUES ('claim_client','clients',:recordId,:clientId,:accountNumber,:summary,:reason,:proposal,
       'owner','pending_owner',:requestedBy)`, {
      recordId: main.id,
      clientId: main.id,
      accountNumber,
      summary: `Ownership conflict: ${displayName}`,
      reason: `Claim attempted by ${context.claimant.name} while ${currentName} is the active assignee.`,
      proposal: JSON.stringify(proposal),
      requestedBy: claimantId
    });
    conflict = { id: result.insertId };
    created = true;
    proposal.links = claimLinks(context.basePath, main.id, conflict.id);
    proposal.conflict_notification_created = requestedAt;
    await conn.execute('UPDATE data_change_requests SET proposed_data_json=:proposal WHERE id=:id', {
      id: conflict.id,
      proposal: JSON.stringify(proposal)
    });
  }

  if (created || !existingProposal.conflict_notification_created) {
    await conn.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,email_status)
      SELECT 'notification','Client ownership conflict',:message,'high','unread',s.id,:createdBy,NOW(),:clientId,'not_configured'
      FROM staff_users s WHERE s.is_active=1 AND s.role='owner'`, {
      message: `${context.claimant.name} attempted to claim ${displayName}${accountNumber ? ` (${accountNumber})` : ''}, currently assigned to ${currentName}. Claim: ${requestedAt}. Current assignment: ${current.assignedAt || 'timestamp unavailable'}. Resolve conflict #${conflict.id}: ${proposal.links.owner_resolution}`,
      createdBy: claimantId,
      clientId: main.id
    });
  }

  await insertAudit(conn, context, {
    actionType: created ? 'client_claim_conflict_created' : 'client_claim_conflict_reused',
    clientId: main.id,
    description: `Ownership conflict #${conflict.id}: ${context.claimant.name} could not claim ${displayName}, assigned to ${currentName}`,
    before: { assigned_staff_id: current.staffId, assigned_staff_name: currentName, assigned_at: current.assignedAt || null },
    after: { ...proposal, conflict_id: Number(conflict.id), result: created ? 'conflict_created' : 'conflict_reused' }
  });
  return { status: 'conflict', conflictId: Number(conflict.id), currentAssigneeName: currentName };
}

async function markLegacyAfterClaim(conn, legacyClaims, context, scope, resultingAssignment) {
  const claimantId = Number(context.claimant.id);
  const main = scope.clients[0];
  const competingClaimants = new Set();
  for (const request of legacyClaims) {
    if (Number(request.requested_by) === claimantId) {
      const proposal = { ...parseJson(request.proposed_data_json), ...resultingAssignment, claim_already_applied: true };
      await conn.execute(`UPDATE data_change_requests SET status='applied',reviewed_by=:staffId,reviewed_at=NOW(),
        review_comment='Claim applied automatically by the immediate-claim workflow.',applied_at=NOW(),
        proposed_data_json=:proposal WHERE id=:id`, {
        staffId: claimantId,
        proposal: JSON.stringify(proposal),
        id: request.id
      });
    } else {
      if (competingClaimants.has(Number(request.requested_by))) {
        await conn.execute(`UPDATE data_change_requests SET status='cancelled',reviewed_by=:staffId,reviewed_at=NOW(),
          review_comment='Duplicate legacy claim closed; the earliest ownership conflict remains available for owner resolution.'
          WHERE id=:id`, { staffId: claimantId, id: request.id });
        continue;
      }
      competingClaimants.add(Number(request.requested_by));
      const original = parseJson(request.proposed_data_json);
      const legacyClaimant = await staffName(conn, request.requested_by);
      const proposal = { ...original, ownership_conflict: true,
        claimant_id: Number(request.requested_by),
        claimant_name: legacyClaimant?.full_name || `Staff member #${request.requested_by}`,
        claim_timestamp: request.created_at,
        current_assignee_id: Number(claimantId), current_assignee_name: resultingAssignment.assigned_staff_name,
        current_assignment_timestamp: resultingAssignment.claim_timestamp,
        client_id: Number(main.id),
        linked_client_ids: scope.clients.map(row => Number(row.id)),
        linked_line_count: scope.clients.length,
        account_id: scope.account?.id || positiveId(main.account_id),
        account_number: resultingAssignment.account_number,
        links: claimLinks(context.basePath, main.id, request.id),
        conflict_notification_created: original.conflict_notification_created || context.claimTimestamp };
      await conn.execute(`UPDATE data_change_requests SET status='pending_owner',required_approval_role='owner',
        review_comment='Legacy claim preserved as an ownership conflict after an immediate first claim.',
        proposed_data_json=:proposal WHERE id=:id`, { proposal: JSON.stringify(proposal), id: request.id });
      if (!original.conflict_notification_created) {
        await conn.execute(`INSERT INTO staff_tasks
          (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,email_status)
          SELECT 'notification','Client ownership conflict',:message,'high','unread',s.id,:createdBy,NOW(),:clientId,'not_configured'
          FROM staff_users s WHERE s.is_active=1 AND s.role='owner'`, {
          message: `${proposal.claimant_name}'s legacy claim for ${main.client_name || `client #${main.id}`} conflicts with the active assignment to ${context.claimant.name}. Resolve conflict #${request.id}: ${proposal.links.owner_resolution}`,
          createdBy: claimantId,
          clientId: main.id
        });
        await insertAudit(conn, {
          ...context,
          claimant: { id: Number(request.requested_by), name: proposal.claimant_name },
          ipAddress: null,
          userAgent: null
        }, {
          actionType: 'client_claim_conflict_created',
          clientId: main.id,
          description: `Legacy claim conflict #${request.id}: ${proposal.claimant_name} and ${context.claimant.name}`,
          before: { assigned_staff_id: claimantId, assigned_staff_name: context.claimant.name },
          after: { ...proposal, conflict_id: Number(request.id), result: 'legacy_conflict_preserved' }
        });
      }
    }
  }
}

async function applyAssignment(conn, scope, context) {
  const claimantId = Number(context.claimant.id);
  const accountNumber = scope.account?.account_number || scope.clients.map(row => clean(row.account_number)).find(Boolean) || null;
  for (const client of scope.clients) {
    await conn.execute(`INSERT INTO client_assignments
      (client_id,account_number,assigned_staff_id,assigned_by,is_active)
      VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)
      ON DUPLICATE KEY UPDATE account_number=VALUES(account_number),assigned_staff_id=VALUES(assigned_staff_id),
        assigned_by=VALUES(assigned_by),is_active=1,updated_at=NOW()`, {
      clientId: client.id,
      accountNumber,
      staffId: claimantId,
      assignedBy: claimantId
    });
  }
  if (scope.account) {
    await conn.execute(`UPDATE customer_accounts SET assigned_staff_id=:staffId,assigned_by=:staffId,
      assignment_confirmed_at=NOW() WHERE id=:accountId`, { staffId: claimantId, accountId: scope.account.id });
  }
  if (scope.normalised) {
    await conn.execute(`UPDATE fixed_accounts SET assigned_staff_id=:staffId,updated_at=NOW()
      WHERE UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised
         OR UPPER(REPLACE(TRIM(COALESCE(linked_mobile_account_number,'')),' ',''))=:normalised`, {
      staffId: claimantId,
      normalised: scope.normalised
    });
  }
}

async function claimClient(clientId, options, database = db) {
  const claimantId = positiveId(options?.claimant?.id);
  if (!claimantId) throw new Error('A valid claimant is required.');
  const context = {
    claimant: { id: claimantId, name: clean(options.claimant.name, 255) || `Staff member #${claimantId}` },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    basePath: options.basePath,
    claimTimestamp: options.claimTimestamp || new Date().toISOString()
  };
  const conn = await database.getConnection();
  try {
    await conn.beginTransaction();
    const scope = await loadLockedScope(conn, positiveId(clientId));
    const claimant = await staffName(conn, claimantId, true);
    if (!claimant) throw new Error('The claiming staff member is no longer active.');
    context.claimant.name = claimant.full_name;
    const assignments = await loadLockedAssignments(conn, scope);
    const legacyClaims = await loadLockedLegacyClaims(conn, scope);
    const current = activeAssignment(scope, assignments);
    const main = scope.clients[0];

    if (current && Number(current.staffId) !== claimantId) {
      const result = await createOrReuseConflict(conn, scope, context, current, legacyClaims);
      await conn.commit();
      return result;
    }

    const resultDetails = {
      assigned_staff_id: claimantId,
      assigned_staff_name: context.claimant.name,
      client_id: Number(main.id),
      client_ids: scope.clients.map(row => Number(row.id)),
      account_id: scope.account?.id || positiveId(main.account_id),
      account_number: scope.account?.account_number || clean(main.account_number) || null,
      linked_line_count: scope.clients.length,
      claim_timestamp: context.claimTimestamp,
      result: current ? 'already_assigned_to_claimant' : 'claimed'
    };

    if (!current || current.source === 'customer_accounts') await applyAssignment(conn, scope, context);
    await markLegacyAfterClaim(conn, legacyClaims, context, scope, resultDetails);
    await insertAudit(conn, context, {
      actionType: current ? 'client_claim_idempotent' : 'client_claim_applied',
      clientId: main.id,
      description: current
        ? `${context.claimant.name} retried an already-applied claim for ${main.client_name || `client #${main.id}`}`
        : `${context.claimant.name} claimed ${main.client_name || `client #${main.id}`} and ${scope.clients.length} linked line${scope.clients.length === 1 ? '' : 's'}`,
      before: current ? { assigned_staff_id: current.staffId, assigned_at: current.assignedAt || null } : { assigned_staff_id: null },
      after: resultDetails
    });
    await conn.commit();
    return { status: 'claimed', idempotent: Boolean(current), ...resultDetails };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { claimClient, normaliseAccount };
