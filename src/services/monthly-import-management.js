'use strict';

const db = require('../config/db');

const STATUS_RULES = Object.freeze([
  {
    key: 'failed', label: 'Failed / needs attention',
    sql: `a.applied_status='failed'`,
    test: row => row.applied_status === 'failed'
  },
  {
    key: 'rejected', label: 'Rejected',
    sql: `(a.approval_status='rejected' OR m.review_status='rejected')`,
    test: row => row.approval_status === 'rejected' || row.review_status === 'rejected'
  },
  {
    key: 'deferred', label: 'Deferred',
    sql: `(a.approval_status='deferred' OR m.review_status='deferred')`,
    test: row => row.approval_status === 'deferred' || row.review_status === 'deferred'
  },
  {
    key: 'conflict', label: 'Needs conflict review',
    sql: `(a.applied_status='not_applied' AND m.review_status='pending' AND
      (m.classification='conflict' OR a.action_type IN ('resolve_mobile_conflict','resolve_fixed_conflict')))`,
    test: row => row.applied_status === 'not_applied' && row.review_status === 'pending'
      && (row.classification === 'conflict' || ['resolve_mobile_conflict', 'resolve_fixed_conflict'].includes(row.action_type))
  },
  {
    key: 'new_mobile_account', label: 'New customer needs account number',
    sql: `(a.applied_status='applied' AND a.action_type='create_mobile_record'
      AND (c.id IS NULL OR NULLIF(TRIM(COALESCE(ca.account_number,c.account_number)), '') IS NULL))`,
    test: row => row.applied_status === 'applied' && row.action_type === 'create_mobile_record'
      && !String(row.live_account_number || '').trim()
  },
  {
    key: 'new_mobile', label: 'New customer created',
    sql: `(a.applied_status='applied' AND a.action_type='create_mobile_record')`,
    test: row => row.applied_status === 'applied' && row.action_type === 'create_mobile_record'
  },
  {
    key: 'mobile_updated', label: 'Existing customer updated',
    sql: `(a.applied_status='applied' AND a.action_type IN ('link_mobile_client','resolve_mobile_conflict'))`,
    test: row => row.applied_status === 'applied' && ['link_mobile_client', 'resolve_mobile_conflict'].includes(row.action_type)
  },
  {
    key: 'fixed_created', label: 'Fixed account/service created',
    sql: `(a.applied_status='applied' AND
      (a.action_type IN ('create_fixed_service','create_fixed_account_and_service')
        OR (a.action_type='resolve_fixed_conflict' AND a.before_json IS NULL)))`,
    test: row => row.applied_status === 'applied'
      && (['create_fixed_service', 'create_fixed_account_and_service'].includes(row.action_type)
        || (row.action_type === 'resolve_fixed_conflict' && !row.before_json))
  },
  {
    key: 'fixed_updated', label: 'Existing fixed account/service updated',
    sql: `(a.applied_status='applied' AND
      (a.action_type='link_fixed_service'
        OR (a.action_type='resolve_fixed_conflict' AND a.before_json IS NOT NULL)))`,
    test: row => row.applied_status === 'applied'
      && (row.action_type === 'link_fixed_service'
        || (row.action_type === 'resolve_fixed_conflict' && Boolean(row.before_json)))
  },
  {
    key: 'completed', label: 'Completed',
    sql: `(a.applied_status='applied' OR m.classification='already_applied')`,
    test: row => row.applied_status === 'applied' || row.classification === 'already_applied'
  },
  {
    key: 'ready', label: 'Ready to finalise',
    sql: `(a.applied_status='not_applied' AND
      (a.approval_status='approved' OR
        (a.approval_status='pending' AND a.action_type IN ('create_mobile_record','create_fixed_service'))))`,
    test: row => row.applied_status === 'not_applied'
      && (row.approval_status === 'approved'
        || (row.approval_status === 'pending' && ['create_mobile_record', 'create_fixed_service'].includes(row.action_type)))
  },
  {
    key: 'approval_required', label: 'Approval required',
    sql: `(a.applied_status='not_applied' AND a.approval_status='pending' AND a.id IS NOT NULL)`,
    test: row => row.applied_status === 'not_applied' && row.approval_status === 'pending' && Boolean(row.action_id || row.action_type)
  },
  {
    key: 'not_processed', label: 'Not yet processed',
    sql: '1=1',
    test: () => true
  }
]);

const STATUS_BY_KEY = new Map(STATUS_RULES.map(rule => [rule.key, rule]));
const PAGE_SIZES = new Set([25, 50, 100]);

function businessStatusSql() {
  return `CASE ${STATUS_RULES.map(rule => `WHEN ${rule.sql} THEN '${rule.key}'`).join(' ')} END`;
}

function classifyBusinessStatus(row) {
  const rule = STATUS_RULES.find(item => item.test(row)) || STATUS_BY_KEY.get('not_processed');
  return { key: rule.key, label: rule.label };
}

function clean(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function filtersFrom(input = {}) {
  const pageSize = Number(input.page_size);
  return {
    batch: /^\d+$/.test(clean(input.batch)) ? Number(input.batch) : '',
    date_from: /^\d{4}-\d{2}-\d{2}$/.test(clean(input.date_from)) ? clean(input.date_from) : '',
    date_to: /^\d{4}-\d{2}-\d{2}$/.test(clean(input.date_to)) ? clean(input.date_to) : '',
    filename: clean(input.filename),
    customer_name: clean(input.customer_name),
    phone: clean(input.phone, 80),
    canonical_phone: clean(input.canonical_phone, 20),
    account_number: clean(input.account_number, 120),
    domain: ['mobile', 'fixed'].includes(clean(input.domain)) ? clean(input.domain) : '',
    import_type: ['activation', 'upgrade', 'fixed_base'].includes(clean(input.import_type)) ? clean(input.import_type) : '',
    source_system: ['B12', 'SIEBEL', 'FIXED_BASE'].includes(clean(input.source_system).toUpperCase())
      ? clean(input.source_system).toUpperCase() : '',
    classification: ['exact_match', 'possible_match', 'new_record', 'conflict', 'already_applied', 'ignored']
      .includes(clean(input.classification)) ? clean(input.classification) : '',
    business_status: STATUS_BY_KEY.has(clean(input.business_status)) ? clean(input.business_status) : '',
    review_status: ['pending', 'approved', 'rejected', 'deferred'].includes(clean(input.review_status))
      ? clean(input.review_status) : '',
    approval_status: ['pending', 'approved', 'rejected', 'deferred'].includes(clean(input.approval_status))
      ? clean(input.approval_status) : '',
    applied_status: ['not_applied', 'applied', 'failed'].includes(clean(input.applied_status))
      ? clean(input.applied_status) : '',
    completion: ['completed', 'outstanding'].includes(clean(input.completion)) ? clean(input.completion) : '',
    page: Math.max(1, Number(input.page) || 1),
    page_size: PAGE_SIZES.has(pageSize) ? pageSize : 50
  };
}

function whereFor(filters) {
  const clauses = ['1=1'];
  const params = {};
  const add = (condition, key, value) => {
    clauses.push(condition);
    params[key] = value;
  };
  if (filters.batch) add('b.id=:batch', 'batch', filters.batch);
  if (filters.date_from) add('b.created_at>=:dateFrom', 'dateFrom', `${filters.date_from} 00:00:00`);
  if (filters.date_to) add('b.created_at<DATE_ADD(:dateTo,INTERVAL 1 DAY)', 'dateTo', `${filters.date_to} 00:00:00`);
  if (filters.filename) add('b.original_filename LIKE :filename', 'filename', `%${filters.filename}%`);
  if (filters.customer_name) add('r.customer_name LIKE :customerName', 'customerName', `%${filters.customer_name}%`);
  if (filters.phone) add('r.phone_original LIKE :phone', 'phone', `%${filters.phone}%`);
  if (filters.canonical_phone) add('r.phone_normalised LIKE :canonicalPhone', 'canonicalPhone', `%${filters.canonical_phone}%`);
  if (filters.account_number) {
    add(`(r.account_number LIKE :accountNumber OR c.account_number LIKE :accountNumber
      OR ca.account_number LIKE :accountNumber OR fa.account_number LIKE :accountNumber)`,
    'accountNumber', `%${filters.account_number}%`);
  }
  if (filters.domain) add('m.match_domain=:domain', 'domain', filters.domain);
  if (filters.import_type) add('b.import_type=:importType', 'importType', filters.import_type);
  if (filters.source_system) add('b.source_system=:sourceSystem', 'sourceSystem', filters.source_system);
  if (filters.classification) add('m.classification=:classification', 'classification', filters.classification);
  if (filters.review_status) add('m.review_status=:reviewStatus', 'reviewStatus', filters.review_status);
  if (filters.approval_status) add('a.approval_status=:approvalStatus', 'approvalStatus', filters.approval_status);
  if (filters.applied_status) add('a.applied_status=:appliedStatus', 'appliedStatus', filters.applied_status);
  if (filters.business_status) {
    const rule = STATUS_BY_KEY.get(filters.business_status);
    add(`(${businessStatusSql()})=:businessStatus`, 'businessStatus', rule.key);
  }
  if (filters.completion === 'completed') clauses.push(`a.applied_status='applied'`);
  if (filters.completion === 'outstanding') clauses.push(`COALESCE(a.applied_status,'not_applied')<>'applied'`);
  return { sql: clauses.join(' AND '), params };
}

const FROM_SQL = `
  FROM monthly_import_rows r
  JOIN monthly_import_batches b ON b.id=r.batch_id
  LEFT JOIN monthly_import_matches m ON m.import_row_id=r.id
  LEFT JOIN monthly_import_actions a ON a.import_row_id=r.id
  LEFT JOIN clients c ON c.id=CASE
    WHEN a.target_entity_type='clients' AND a.target_entity_id IS NOT NULL THEN a.target_entity_id
    ELSE m.proposed_client_id END
  LEFT JOIN fixed_services fs ON fs.id=CASE
    WHEN a.target_entity_type='fixed_services' AND a.target_entity_id IS NOT NULL THEN a.target_entity_id
    ELSE m.proposed_fixed_service_id END
  LEFT JOIN fixed_accounts fa ON fa.id=COALESCE(
    fs.fixed_account_id,
    CASE WHEN a.target_entity_type='fixed_accounts' THEN a.target_entity_id END,
    m.proposed_fixed_account_id)
  LEFT JOIN customer_accounts ca ON ca.id=COALESCE(c.account_id,fa.account_id,m.proposed_account_id)
  LEFT JOIN (
    SELECT client_id,MAX(id) pending_account_request_id
    FROM data_change_requests
    WHERE request_type='assign_account_number' AND status IN ('pending_manager','pending_owner')
    GROUP BY client_id
  ) ar ON ar.client_id=c.id
`;

const SELECT_SQL = `
  SELECT r.id row_id,r.batch_id,r.source_row_number,r.import_status,r.phone_original,r.phone_normalised,
    r.account_number imported_account_number,r.customer_name,r.warning_text,
    b.original_filename,b.created_at upload_date,b.source_system,b.import_type,b.status batch_status,
    m.id match_id,m.classification,m.match_domain,m.confidence_score,m.review_status,m.match_reason,
    m.proposed_client_id,m.proposed_account_id,m.proposed_fixed_account_id,m.proposed_fixed_service_id,
    a.id action_id,a.action_type,a.target_entity_type,a.target_entity_id,a.before_json,a.approval_status,
    a.applied_status,a.error_text,a.applied_at,
    c.id live_client_id,c.client_name live_client_name,c.cell_number live_client_phone,
    COALESCE(ca.account_number,c.account_number) live_account_number,
    ca.id live_account_id,ar.pending_account_request_id,
    fa.id live_fixed_account_id,fa.account_number live_fixed_account_number,fa.customer_name live_fixed_account_name,
    fs.id live_fixed_service_id,fs.service_title live_fixed_service_title,
    ${businessStatusSql()} business_status
  ${FROM_SQL}
`;

function decorate(row) {
  const status = STATUS_BY_KEY.get(row.business_status) || classifyBusinessStatus(row);
  const panelSuffix = row.panel_mode ? '?panel=1' : '';
  let livePath = null;
  if (row.live_client_id) livePath = `/customers/${Number(row.live_client_id)}/360${panelSuffix}`;
  else if (row.live_fixed_account_id) {
    livePath = `/fixed/accounts/${Number(row.live_fixed_account_id)}${panelSuffix}`;
    if (row.live_fixed_service_id) livePath += `#service-${Number(row.live_fixed_service_id)}`;
  }
  let requiredAction = '';
  if (status.key === 'conflict') requiredAction = 'Resolve exception';
  else if (status.key === 'new_mobile_account') requiredAction = 'Open account-number approval';
  else if (status.key === 'failed') requiredAction = 'Retry through Monthly Import finalisation';
  else if (status.key === 'ready') requiredAction = 'Finalise Monthly Import';
  else if (row.action_type === 'create_fixed_account_and_service'
    && row.approval_status === 'pending' && row.applied_status === 'not_applied') {
    requiredAction = 'Approve or reject fixed creation';
  }
  return { ...row, status_key: status.key, business_status_label: status.label, live_path: livePath, required_action: requiredAction };
}

async function loadBatches(connection = db) {
  const [rows] = await connection.query(`
    SELECT id,original_filename,created_at,status,total_rows,valid_rows,duplicate_rows,exception_rows
    FROM monthly_import_batches ORDER BY created_at DESC,id DESC LIMIT 250
  `);
  return rows;
}

async function loadManagement(filtersInput, { connection = db, exportAll = false, panelMode = false } = {}) {
  const filters = filtersFrom(filtersInput);
  const where = whereFor(filters);
  const offset = (filters.page - 1) * filters.page_size;
  const limitSql = exportAll ? '' : 'LIMIT :limit OFFSET :offset';
  const params = { ...where.params };
  if (!exportAll) {
    params.limit = filters.page_size;
    params.offset = offset;
  }
  const [[[count]], [summaryRows], [rows], batches] = await Promise.all([
    connection.query(`SELECT COUNT(*) total ${FROM_SQL} WHERE ${where.sql}`, where.params),
    connection.query(`
      SELECT business_status,COUNT(*) total FROM (
        SELECT ${businessStatusSql()} business_status ${FROM_SQL} WHERE ${where.sql}
      ) classified GROUP BY business_status
    `, where.params),
    connection.query(`${SELECT_SQL} WHERE ${where.sql}
      ORDER BY b.created_at DESC,b.id DESC,r.source_row_number,r.id ${limitSql}`, params),
    loadBatches(connection)
  ]);
  const summary = Object.fromEntries(STATUS_RULES.map(rule => [rule.key, 0]));
  for (const row of summaryRows) summary[row.business_status] = Number(row.total || 0);
  summary.total = Number(count.total || 0);
  summary.new_customers_created_total = summary.new_mobile + summary.new_mobile_account;
  summary.completed_total = summary.mobile_updated + summary.new_mobile + summary.new_mobile_account
    + summary.fixed_updated + summary.fixed_created + summary.completed;
  return {
    filters, rows: rows.map(row => decorate({ ...row, panel_mode: panelMode })),
    batches, summary,
    pagination: {
      total: summary.total,
      page: filters.page,
      pageSize: filters.page_size,
      pages: Math.max(1, Math.ceil(summary.total / filters.page_size))
    }
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  const columns = [
    ['Batch ID', 'batch_id'], ['Source filename', 'original_filename'], ['Upload date', 'upload_date'],
    ['Source row', 'source_row_number'], ['Imported name', 'customer_name'], ['Original phone', 'phone_original'],
    ['Canonical phone', 'phone_normalised'], ['Imported account', 'imported_account_number'],
    ['Source system', 'source_system'], ['Import type', 'import_type'], ['Domain', 'match_domain'],
    ['Match classification', 'classification'], ['Match confidence', 'confidence_score'], ['Review status', 'review_status'],
    ['Proposed client ID', 'proposed_client_id'], ['Proposed account ID', 'proposed_account_id'],
    ['Proposed fixed account ID', 'proposed_fixed_account_id'], ['Proposed fixed service ID', 'proposed_fixed_service_id'],
    ['Action type', 'action_type'], ['Approval status', 'approval_status'], ['Applied status', 'applied_status'],
    ['Business status', 'business_status_label'], ['Required action', 'required_action'], ['Error', 'error_text'],
    ['Live client ID', 'live_client_id'], ['Live client name', 'live_client_name'], ['Live client phone', 'live_client_phone'],
    ['Live account ID', 'live_account_id'], ['Live account number', 'live_account_number'],
    ['Live fixed account ID', 'live_fixed_account_id'], ['Live fixed account number', 'live_fixed_account_number'],
    ['Live fixed service ID', 'live_fixed_service_id'], ['Live fixed service', 'live_fixed_service_title']
  ];
  return [
    columns.map(([label]) => csvCell(label)).join(','),
    ...rows.map(row => columns.map(([, key]) => csvCell(row[key])).join(','))
  ].join('\r\n');
}

module.exports = {
  STATUS_RULES,
  STATUS_BY_KEY,
  businessStatusSql,
  classifyBusinessStatus,
  filtersFrom,
  whereFor,
  FROM_SQL,
  loadManagement,
  toCsv
};
