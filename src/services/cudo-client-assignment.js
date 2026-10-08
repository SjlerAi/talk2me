'use strict';

const db = require('../config/db');
const {
  ensureAgentResponsibilitySchema,
  createAgentInstructionInTransaction
} = require('./office-intelligence-agent');

const MAX_CUDO_ASSIGNMENTS = 50;
const ACTIVE_TASK = "('unread','seen','in_progress')";

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normaliseAccount(value) {
  return clean(value, 120).replace(/\s+/g, '').toUpperCase();
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

async function loadScope(conn, clientId) {
  const [[requested]] = await conn.execute(`SELECT id,account_id,account_number,client_name,cell_number,email
    FROM clients WHERE id=:clientId AND is_active=1 FOR UPDATE`, { clientId });
  if (!requested) throw new Error(`Customer #${clientId} no longer exists or is inactive.`);

  const accountId = positiveId(requested.account_id);
  const normalised = normaliseAccount(requested.account_number);
  const [clients] = await conn.execute(`SELECT id,account_id,account_number,client_name,cell_number,email
    FROM clients
    WHERE is_active=1 AND (
      id=:clientId
      OR (:accountId IS NOT NULL AND account_id=:accountId)
      OR (:normalised<>'' AND UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised)
    )
    ORDER BY id FOR UPDATE`, {
    clientId: requested.id,
    accountId,
    normalised
  });

  let account = null;
  if (accountId || normalised) {
    [[account]] = await conn.execute(`SELECT id,account_number,account_number_normalised,assigned_staff_id,
        assigned_by,assignment_confirmed_at
      FROM customer_accounts
      WHERE (:accountId IS NOT NULL AND id=:accountId)
         OR (:normalised<>'' AND account_number_normalised=:normalised)
      ORDER BY (id=:accountId) DESC,id
      LIMIT 1 FOR UPDATE`, { accountId, normalised });
  }

  const resolvedNormalised = normaliseAccount(account?.account_number || requested.account_number);
  const key = account?.id
    ? `account:${Number(account.id)}`
    : resolvedNormalised
      ? `account-number:${resolvedNormalised}`
      : `client:${Number(requested.id)}`;

  return {
    requested,
    clients,
    account: account || null,
    accountId: positiveId(account?.id || requested.account_id),
    accountNumber: clean(account?.account_number || requested.account_number, 120) || null,
    normalised: resolvedNormalised,
    key
  };
}

async function pendingOwnershipRequest(conn, scope) {
  const ids = scope.clients.map(row => Number(row.id));
  const params = [...ids];
  let where = `client_id IN (${placeholders(ids)})`;
  if (scope.accountId) {
    where += ' OR record_id=?';
    params.push(scope.accountId);
  }
  if (scope.normalised) {
    where += ` OR UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=?`;
    params.push(scope.normalised);
  }
  const [rows] = await conn.query(`SELECT id,request_type,status
    FROM data_change_requests
    WHERE request_type IN ('claim_client','claim_account')
      AND status IN ('pending_manager','pending_owner')
      AND (${where})
    ORDER BY id
    LIMIT 1 FOR UPDATE`, params);
  return rows[0] || null;
}

async function assignmentSnapshot(conn, scope) {
  const ids = scope.clients.map(row => Number(row.id));
  const params = [...ids];
  let where = `a.client_id IN (${placeholders(ids)})`;
  if (scope.normalised) {
    where += ` OR UPPER(REPLACE(TRIM(COALESCE(a.account_number,'')),' ',''))=?`;
    params.push(scope.normalised);
  }
  const [rows] = await conn.query(`SELECT a.id,a.client_id,a.account_number,a.assigned_staff_id,
      a.assigned_at,a.updated_at,COALESCE(s.full_name,s.email) assigned_staff_name
    FROM client_assignments a
    LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
    WHERE a.is_active=1 AND (${where})
    ORDER BY a.client_id,a.updated_at DESC,a.id DESC FOR UPDATE`, params);
  return rows;
}

async function applyAssignment(conn, scope, actorId, targetStaffId) {
  const accountNumber = scope.accountNumber;
  for (const client of scope.clients) {
    await conn.execute(`INSERT INTO client_assignments
      (client_id,account_number,assigned_staff_id,assigned_by,is_active)
      VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)
      ON DUPLICATE KEY UPDATE
        account_number=VALUES(account_number),
        assigned_staff_id=VALUES(assigned_staff_id),
        assigned_by=VALUES(assigned_by),
        is_active=1,
        updated_at=NOW()`, {
      clientId: Number(client.id),
      accountNumber,
      staffId: targetStaffId,
      assignedBy: actorId
    });
  }

  if (scope.accountId) {
    await conn.execute(`UPDATE customer_accounts
      SET assigned_staff_id=:staffId,assigned_by=:assignedBy,assignment_confirmed_at=NOW()
      WHERE id=:accountId`, {
      staffId: targetStaffId,
      assignedBy: actorId,
      accountId: scope.accountId
    });
  }

  if (scope.normalised) {
    await conn.execute(`UPDATE fixed_accounts
      SET assigned_staff_id=:staffId,updated_at=NOW()
      WHERE UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ',''))=:normalised
         OR UPPER(REPLACE(TRIM(COALESCE(linked_mobile_account_number,'')),' ',''))=:normalised`, {
      staffId: targetStaffId,
      normalised: scope.normalised
    });
  }
}

function taskPrefix(sourceKind) {
  const kind = clean(sourceKind, 50);
  if (kind === 'upgrade') return 'Upgrade follow-up';
  if (kind === 'birthday') return 'Birthday follow-up';
  if (kind === 'deal') return 'Deal follow-up';
  if (kind === 'client_followup_activity' || kind === 'followup') return 'Customer follow-up';
  if (kind === 'unallocated_clients') return 'Customer follow-up';
  return 'Cudo follow-up';
}

async function createMonitoredTask(conn, {
  actorId,
  targetStaffId,
  dueAt,
  priority,
  item
}) {
  const title = `${taskPrefix(item.sourceKind)} · ${clean(item.title || 'Customer', 120)}`.slice(0, 180);
  const clientId = positiveId(item.clientId);
  const [[duplicate]] = await conn.execute(`SELECT id FROM staff_tasks
    WHERE assigned_to=:assignedTo
      AND related_client_id <=> :clientId
      AND title=:title
      AND due_at=:dueAt
      AND status IN ${ACTIVE_TASK}
    ORDER BY id DESC LIMIT 1 FOR UPDATE`, {
    assignedTo: targetStaffId,
    clientId,
    title,
    dueAt
  });
  if (duplicate) {
    return { taskId:Number(duplicate.id), duplicate:true, title };
  }

  const message = [
    'Assigned by Cudo from a management result set.',
    item.detail ? `Context: ${clean(item.detail, 700)}` : '',
    clientId ? `Customer record: #${clientId}` : '',
    item.dueAt ? `Original/source date: ${String(item.dueAt).slice(0, 19)}` : '',
    item.resultNumber ? `Cudo result number: ${Number(item.resultNumber)}` : ''
  ].filter(Boolean).join('\n');

  const result = await createAgentInstructionInTransaction(conn, {
    issuedBy: actorId,
    assignedTo: targetStaffId,
    title,
    message,
    dueAt,
    priority,
    relatedClientId: clientId
  });
  return { ...result, duplicate:false, title };
}

async function insertAudit(conn, {
  actorId,
  clientId,
  description,
  before,
  after,
  ipAddress,
  userAgent
}) {
  await conn.execute(`INSERT INTO audit_log
    (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent)
    VALUES (:staffId,'cudo_client_reassigned','clients',:clientId,:description,:beforeJson,:afterJson,:ip,:userAgent)`, {
    staffId: actorId,
    clientId,
    description: clean(description, 500),
    beforeJson: before == null ? null : JSON.stringify(before),
    afterJson: after == null ? null : JSON.stringify(after),
    ip: clean(ipAddress, 64) || null,
    userAgent: clean(userAgent, 255) || null
  });
}

async function reassignClientWork({
  actorId,
  dueAt,
  priority='normal',
  groups,
  ipAddress=null,
  userAgent=null
} = {}) {
  await ensureAgentResponsibilitySchema();

  const managementId = positiveId(actorId);
  const cleanDueAt = clean(dueAt, 30);
  const cleanPriority = ['normal','high','urgent'].includes(priority) ? priority : 'normal';
  const inputGroups = Array.isArray(groups) ? groups : [];
  const items = inputGroups.flatMap(group => {
    const staffId = positiveId(group?.staffId);
    const staffName = clean(group?.staffName, 255);
    return (Array.isArray(group?.items) ? group.items : []).map(item => ({
      ...item,
      targetStaffId: staffId,
      targetStaffName: staffName
    }));
  }).slice(0, MAX_CUDO_ASSIGNMENTS);

  if (!managementId || !cleanDueAt || !items.length) {
    throw new Error('A management user, assignment list and deadline are required.');
  }
  if (items.some(item => !positiveId(item.targetStaffId) || !positiveId(item.clientId))) {
    throw new Error('Every selected Cudo result must have a valid customer and staff member.');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[actor]] = await conn.execute(`SELECT id,full_name,email,role,is_active
      FROM staff_users WHERE id=:id LIMIT 1 FOR UPDATE`, { id:managementId });
    if (!actor || !Number(actor.is_active) || String(actor.role || '').toLowerCase() !== 'owner') {
      throw new Error('Only the Talk2Me owner can confirm Cudo customer reassignment.');
    }

    const targetIds = [...new Set(items.map(item => Number(item.targetStaffId)))];
    const targetParams = {};
    const targetPlaceholders = targetIds.map((id,index) => {
      targetParams[`staff${index}`] = id;
      return `:staff${index}`;
    });
    const [staffRows] = await conn.execute(`SELECT id,full_name,email,is_active
      FROM staff_users WHERE id IN (${targetPlaceholders.join(',')}) FOR UPDATE`, targetParams);
    const staffById = new Map(staffRows.map(row => [Number(row.id), row]));
    for (const id of targetIds) {
      const staff = staffById.get(id);
      if (!staff || !Number(staff.is_active)) throw new Error(`Staff member #${id} is no longer active.`);
    }

    const plannedScopes = new Map();
    for (const item of items) {
      const scope = await loadScope(conn, Number(item.clientId));
      const existing = plannedScopes.get(scope.key);
      if (existing && Number(existing.targetStaffId) !== Number(item.targetStaffId)) {
        throw new Error(`${scope.requested.client_name || 'One customer account'} appears more than once with different staff assignments. Put all linked lines under the same staff member.`);
      }
      if (!existing) {
        plannedScopes.set(scope.key, {
          scope,
          targetStaffId:Number(item.targetStaffId),
          targetStaffName:staffById.get(Number(item.targetStaffId))?.full_name || item.targetStaffName,
          items:[item]
        });
      } else {
        existing.items.push(item);
      }
    }

    const results = [];
    for (const planned of plannedScopes.values()) {
      const { scope, targetStaffId, targetStaffName } = planned;
      const pending = await pendingOwnershipRequest(conn, scope);
      if (pending) {
        throw new Error(`${scope.requested.client_name || 'This customer'} has an ownership request awaiting approval (#${pending.id}). Resolve that approval before reassigning it with Cudo.`);
      }

      const beforeAssignments = await assignmentSnapshot(conn, scope);
      const previousStaffIds = [...new Set(beforeAssignments.map(row => Number(row.assigned_staff_id)).filter(Boolean))];
      const accountWasAlreadyTarget = previousStaffIds.length === 1 && previousStaffIds[0] === targetStaffId;

      await applyAssignment(conn, scope, managementId, targetStaffId);

      const tasks = [];
      for (const item of planned.items) {
        tasks.push(await createMonitoredTask(conn, {
          actorId:managementId,
          targetStaffId,
          dueAt:cleanDueAt,
          priority:cleanPriority,
          item
        }));
      }

      await insertAudit(conn, {
        actorId:managementId,
        clientId:Number(scope.requested.id),
        description:`Cudo reassigned ${scope.requested.client_name || `customer #${scope.requested.id}`} and ${scope.clients.length} linked line${scope.clients.length===1?'':'s'} to ${targetStaffName}.`,
        before:{
          accountId:scope.accountId,
          accountNumber:scope.accountNumber,
          assignments:beforeAssignments.map(row => ({
            clientId:Number(row.client_id),
            staffId:Number(row.assigned_staff_id),
            staffName:row.assigned_staff_name || null
          }))
        },
        after:{
          accountId:scope.accountId,
          accountNumber:scope.accountNumber,
          assignedStaffId:targetStaffId,
          assignedStaffName:targetStaffName,
          linkedClientIds:scope.clients.map(row => Number(row.id)),
          selectedResultNumbers:planned.items.map(item => Number(item.resultNumber)).filter(Boolean),
          taskIds:tasks.map(task => Number(task.taskId)),
          dueAt:cleanDueAt,
          alreadyAssigned:accountWasAlreadyTarget
        },
        ipAddress,
        userAgent
      });

      results.push({
        clientId:Number(scope.requested.id),
        clientName:scope.requested.client_name || `Customer #${scope.requested.id}`,
        accountId:scope.accountId,
        linkedLineCount:scope.clients.length,
        assignedStaffId:targetStaffId,
        assignedStaffName:targetStaffName,
        alreadyAssigned:accountWasAlreadyTarget,
        taskIds:tasks.map(task => Number(task.taskId)),
        duplicateTasks:tasks.filter(task => task.duplicate).length
      });
    }

    await conn.commit();

    return {
      groups:results,
      accountGroups:results.length,
      selectedItems:items.length,
      monitoredTasks:results.reduce((sum,row)=>sum+row.taskIds.length,0),
      alreadyAssigned:results.filter(row=>row.alreadyAssigned).length,
      linkedLines:results.reduce((sum,row)=>sum+Number(row.linkedLineCount||0),0),
      dueAt:cleanDueAt
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  MAX_CUDO_ASSIGNMENTS,
  positiveId,
  normaliseAccount,
  reassignClientWork
};
