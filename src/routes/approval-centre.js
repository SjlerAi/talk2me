const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const MANAGEMENT_ROLES = new Set(['owner', 'admin', 'manager']);
const PENDING_STATUSES = "('pending_manager','pending_owner')";

function isManagement(user) {
  return Boolean(user && MANAGEMENT_ROLES.has(String(user.role || '').toLowerCase()));
}

function clean(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function parseJson(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
    return parsed && typeof parsed === 'object' ? parsed : { details: parsed };
  } catch (_) {
    return { details: String(value) };
  }
}

function titleCase(value) {
  return String(value || 'request')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function flattenDetails(value, prefix = '', depth = 0) {
  if (depth > 3) return [];
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    if (!value.length) return [];
    if (value.every(item => item == null || typeof item !== 'object')) {
      return [{ label: titleCase(prefix || 'details'), value: value.map(item => String(item ?? '')).join(', ') }];
    }
    return value.flatMap((item, index) => flattenDetails(item, `${prefix} ${index + 1}`.trim(), depth + 1));
  }
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => flattenDetails(item, prefix ? `${prefix} - ${key}` : key, depth + 1));
  }
  return [{ label: titleCase(prefix || 'details'), value: String(value) }];
}

function categoryFor(requestType, entityType, proposed = {}) {
  const type = String(requestType || '').toLowerCase();
  const entity = String(entityType || '').toLowerCase();
  const looksLikeClaim = type === 'claim_client'
    || type === 'claim_account'
    || type.startsWith('claim_')
    || (proposed.assigned_staff_id && (proposed.scope === 'account' || Array.isArray(proposed.linked_client_ids)));
  if (looksLikeClaim) return 'client_claims';
  if (type.includes('account') || entity === 'customer_accounts') return 'account_changes';
  if (/(staff|attendance|leave|permission|role|access)/.test(type) || entity.includes('staff')) return 'staff_requests';
  if (/(client|customer|mobile|fixed|line|prospect|contact|upgrade|birthday)/.test(type)
      || entity === 'clients' || entity.startsWith('fixed_')) return 'customer_changes';
  return 'other_requests';
}

function displayTypeLabel(row, category) {
  if (category === 'client_claims') return 'Client Claim';
  return titleCase(row.request_type);
}

async function loadPendingCount() {
  const [[changes]] = await db.query(`SELECT COUNT(*) total
    FROM data_change_requests WHERE status IN ${PENDING_STATUSES}`);
  let tasks = 0;
  try {
    const [[taskRow]] = await db.query(`SELECT COUNT(*) total
      FROM staff_tasks t
      JOIN staff_task_workflow w ON w.task_id=t.id
      WHERE t.status='completed' AND w.workflow_state='awaiting_sender_ack'`);
    tasks = Number(taskRow?.total || 0);
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  return Number(changes?.total || 0) + tasks;
}

async function loadPendingChanges(basePath) {
  const [rows] = await db.query(`SELECT r.id,r.request_type,r.entity_type,r.record_id,r.client_id,r.account_number,
      r.summary,r.reason,r.proposed_data_json,r.required_approval_role,r.status,r.created_at,
      requester.full_name requested_by_name,c.client_name,c.cell_number,c.email,c.city_town,
      COALESCE(r.account_number,c.account_number) display_account_number
    FROM data_change_requests r
    LEFT JOIN staff_users requester ON requester.id=r.requested_by
    LEFT JOIN clients c ON c.id=r.client_id
    WHERE r.status IN ${PENDING_STATUSES}
    ORDER BY CASE WHEN r.required_approval_role='owner' THEN 0 ELSE 1 END,r.created_at,r.id
    LIMIT 1000`);

  return rows.map(row => {
    const proposed = parseJson(row.proposed_data_json);
    const linkedIds = Array.isArray(proposed.linked_client_ids) ? proposed.linked_client_ids : [];
    const affectedCount = Number(proposed.linked_line_count || linkedIds.length || 1);
    const category = categoryFor(row.request_type, row.entity_type, proposed);
    return {
      kind: 'change',
      category,
      id: Number(row.id),
      requestType: row.request_type,
      typeLabel: displayTypeLabel(row, category),
      title: row.summary || row.client_name || displayTypeLabel(row, category),
      customerName: row.client_name || null,
      cellphone: row.cell_number || null,
      accountNumber: row.display_account_number || proposed.account_number || null,
      town: row.city_town || null,
      requestedBy: row.requested_by_name || 'Unknown staff member',
      createdAt: row.created_at,
      reason: row.reason || null,
      requiredRole: row.required_approval_role || 'manager',
      details: flattenDetails(proposed).slice(0, 16),
      affectedCount,
      clientId: row.client_id ? Number(row.client_id) : null,
      openUrl: row.client_id ? `${basePath}/customers/${row.client_id}/360` : null,
      actionUrl: row.request_type === 'claim_client'
        ? `${basePath}/client-claims/${row.id}/decision`
        : `${basePath}/approvals/${row.id}/decision`,
      needsAccountNumber: row.request_type === 'assign_account_number'
    };
  });
}

async function loadTaskApprovals(basePath) {
  try {
    const [rows] = await db.query(`SELECT t.id,t.type,t.title,t.message,t.completion_note,t.priority,t.created_at,t.completed_at,
        t.related_client_id,ass.full_name assigned_name,creator.full_name created_by_name,
        c.client_name,c.account_number,w.completed_at workflow_completed_at
      FROM staff_tasks t
      JOIN staff_task_workflow w ON w.task_id=t.id
      JOIN staff_users ass ON ass.id=t.assigned_to
      JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN clients c ON c.id=t.related_client_id
      WHERE t.status='completed' AND w.workflow_state='awaiting_sender_ack'
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
        COALESCE(w.completed_at,t.completed_at,t.created_at),t.id
      LIMIT 1000`);

    return rows.map(row => ({
      kind: 'task',
      category: 'tasks',
      id: Number(row.id),
      requestType: row.type === 'notification' ? 'message_acknowledgement' : 'task_completion',
      typeLabel: row.type === 'notification' ? 'Message Acknowledgement' : 'Task Completion',
      title: row.title || `Task #${row.id}`,
      customerName: row.client_name || null,
      accountNumber: row.account_number || null,
      requestedBy: row.assigned_name || 'Assigned staff member',
      sentBy: row.created_by_name || 'Unknown sender',
      createdAt: row.workflow_completed_at || row.completed_at || row.created_at,
      reason: row.completion_note || row.message || null,
      requiredRole: 'sender / management',
      details: [
        { label: 'Completed By', value: row.assigned_name || 'Unknown' },
        { label: 'Sent By', value: row.created_by_name || 'Unknown' },
        ...(row.completion_note ? [{ label: 'Completion Note', value: row.completion_note }] : [])
      ],
      affectedCount: 1,
      clientId: row.related_client_id ? Number(row.related_client_id) : null,
      openUrl: `${basePath}/tasks/${row.id}`,
      acceptUrl: `${basePath}/tasks/${row.id}/accept`,
      returnUrl: `${basePath}/tasks/${row.id}/return`
    }));
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return [];
    throw error;
  }
}

async function loadHistory(basePath) {
  const [changeRows] = await db.query(`SELECT r.id,r.request_type,r.entity_type,r.client_id,r.account_number,r.summary,r.reason,
      r.proposed_data_json,r.status,r.created_at,r.reviewed_at,r.applied_at,r.review_comment,
      requester.full_name requested_by_name,reviewer.full_name reviewed_by_name,
      c.client_name,c.cell_number,COALESCE(r.account_number,c.account_number) display_account_number
    FROM data_change_requests r
    LEFT JOIN staff_users requester ON requester.id=r.requested_by
    LEFT JOIN staff_users reviewer ON reviewer.id=r.reviewed_by
    LEFT JOIN clients c ON c.id=r.client_id
    WHERE r.status NOT IN ${PENDING_STATUSES}
    ORDER BY COALESCE(r.applied_at,r.reviewed_at,r.created_at) DESC,r.id DESC
    LIMIT 300`);

  const changes = changeRows.map(row => {
    const proposed = parseJson(row.proposed_data_json);
    const category = categoryFor(row.request_type, row.entity_type, proposed);
    return {
      kind: 'history',
      category,
      id: `change-${row.id}`,
      typeLabel: displayTypeLabel(row, category),
      title: row.summary || row.client_name || displayTypeLabel(row, category),
      customerName: row.client_name || null,
      accountNumber: row.display_account_number || proposed.account_number || null,
      requestedBy: row.requested_by_name || 'Unknown staff member',
      decidedBy: row.reviewed_by_name || 'System',
      decisionAt: row.applied_at || row.reviewed_at || row.created_at,
      decision: ['applied', 'approved'].includes(String(row.status || '').toLowerCase()) ? 'Approved' : titleCase(row.status),
      comment: row.review_comment || null,
      reason: row.reason || null,
      details: flattenDetails(proposed).slice(0, 10),
      openUrl: row.client_id ? `${basePath}/customers/${row.client_id}/360` : null
    };
  });

  let tasks = [];
  try {
    const [taskRows] = await db.query(`SELECT t.id,t.type,t.title,t.completion_note,t.related_client_id,
        ass.full_name assigned_name,creator.full_name created_by_name,reviewer.full_name reviewed_by_name,
        c.client_name,c.account_number,w.acknowledged_at,w.updated_at
      FROM staff_tasks t
      JOIN staff_task_workflow w ON w.task_id=t.id
      JOIN staff_users ass ON ass.id=t.assigned_to
      JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN staff_users reviewer ON reviewer.id=w.acknowledged_by
      LEFT JOIN clients c ON c.id=t.related_client_id
      WHERE t.status='completed' AND w.workflow_state='accepted'
      ORDER BY COALESCE(w.acknowledged_at,w.updated_at) DESC,t.id DESC
      LIMIT 300`);
    tasks = taskRows.map(row => ({
      kind: 'history',
      category: 'tasks',
      id: `task-${row.id}`,
      typeLabel: row.type === 'notification' ? 'Message Acknowledgement' : 'Task Completion',
      title: row.title || `Task #${row.id}`,
      customerName: row.client_name || null,
      accountNumber: row.account_number || null,
      requestedBy: row.assigned_name || 'Assigned staff member',
      decidedBy: row.reviewed_by_name || row.created_by_name || 'Sender',
      decisionAt: row.acknowledged_at || row.updated_at,
      decision: 'Accepted & Archived',
      comment: row.completion_note || null,
      reason: null,
      details: [
        { label: 'Completed By', value: row.assigned_name || 'Unknown' },
        { label: 'Sent By', value: row.created_by_name || 'Unknown' }
      ],
      openUrl: `${basePath}/tasks/${row.id}`
    }));
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }

  return [...changes, ...tasks]
    .sort((a, b) => new Date(b.decisionAt || 0) - new Date(a.decisionAt || 0))
    .slice(0, 500);
}

function searchable(item) {
  return [item.typeLabel,item.title,item.customerName,item.cellphone,item.accountNumber,item.town,
    item.requestedBy,item.sentBy,item.decidedBy,item.reason,item.comment,
    ...(item.details || []).flatMap(detail => [detail.label,detail.value])]
    .filter(Boolean).join(' ').toLowerCase();
}

router.use(async (req, res, next) => {
  if (res.locals.approvalCentreLoaded) return next();
  res.locals.approvalCentreLoaded = true;
  res.locals.approvalCentreCount = 0;
  if (!isManagement(req.session?.user)) return next();
  try {
    res.locals.approvalCentreCount = await loadPendingCount();
  } catch (error) {
    console.error('Could not load approval count', error);
  }
  next();
});

router.get('/api/approvals/status', requireAuth, async (req, res, next) => {
  if (!isManagement(req.session.user)) return res.json({ ok: true, count: 0 });
  try {
    res.json({ ok: true, count: await loadPendingCount() });
  } catch (error) {
    next(error);
  }
});

router.get('/approvals', requireAuth, async (req, res, next) => {
  if (!isManagement(req.session.user)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Only owners, managers and administrators can review approvals.' });
  }

  try {
    const allowedTabs = new Set(['all','client_claims','account_changes','customer_changes','staff_requests','tasks','other_requests','history']);
    const tab = allowedTabs.has(String(req.query.tab || '')) ? String(req.query.tab) : 'all';
    const q = clean(req.query.q, 200).toLowerCase();
    const basePath = res.locals.basePath || '';
    const [changes, tasks] = await Promise.all([loadPendingChanges(basePath), loadTaskApprovals(basePath)]);
    const pending = [...changes, ...tasks].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    const counts = {
      all: pending.length,
      client_claims: pending.filter(item => item.category === 'client_claims').length,
      account_changes: pending.filter(item => item.category === 'account_changes').length,
      customer_changes: pending.filter(item => item.category === 'customer_changes').length,
      staff_requests: pending.filter(item => item.category === 'staff_requests').length,
      tasks: pending.filter(item => item.category === 'tasks').length,
      other_requests: pending.filter(item => item.category === 'other_requests').length
    };

    let items;
    if (tab === 'history') {
      items = await loadHistory(basePath);
    } else {
      items = tab === 'all' ? pending : pending.filter(item => item.category === tab);
    }
    if (q) items = items.filter(item => searchable(item).includes(q));

    res.render('approval-centre', {
      title: 'Approval Centre',
      tab,
      q: clean(req.query.q, 200),
      items,
      counts,
      totalPending: counts.all,
      updated: clean(req.query.updated, 40),
      tabs: [
        ['all','All Pending'],
        ['client_claims','Client Claims'],
        ['account_changes','Account Changes'],
        ['customer_changes','Customer Changes'],
        ['staff_requests','Staff Requests'],
        ['tasks','Task Approvals'],
        ['other_requests','Other Requests'],
        ['history','History']
      ]
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
