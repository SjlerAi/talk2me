'use strict';

const db = require('../config/db');
const { normaliseSouthAfricanMobile, MOBILE_PHONE_FIELDS } = require('./sa-phone-normalisation');
const { matchSingleRow, normaliseAccount } = require('./monthly-import-matcher');
const {
  loadScopeRows,
  loadSafetyEvidence,
  classifyBulkSafety
} = require('./monthly-import-bulk-finaliser');
const { writeAudit } = require('./monthly-import-finaliser');

const EXCEPTION_FILTERS = Object.freeze([
  ['all', 'All outstanding'],
  ['missing_name', 'Missing customer/business name'],
  ['missing_phone', 'Missing phone'],
  ['missing_account', 'Missing account number'],
  ['conflict', 'Conflict'],
  ['fixed_approval', 'Fixed approval'],
  ['failed', 'Failed'],
  ['deferred', 'Deferred'],
  ['rejected', 'Rejected']
]);
const FILTER_KEYS = new Set(EXCEPTION_FILTERS.map(([key]) => key));
const PAGE_SIZES = new Set([10, 25, 50]);
const MANAGEMENT_SCOPE_KEYS = Object.freeze([
  'batch', 'date_from', 'date_to', 'filename', 'customer_name', 'phone', 'canonical_phone',
  'account_number', 'domain', 'import_type', 'source_system', 'classification',
  'business_status', 'review_status', 'approval_status', 'applied_status', 'completion'
]);

function clean(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function exceptionFilters(input = {}) {
  const pageSize = Number(input.page_size);
  return {
    batch: /^\d+$/.test(clean(input.batch)) ? Number(input.batch) : '',
    exception: FILTER_KEYS.has(clean(input.exception)) ? clean(input.exception) : 'all',
    search: clean(input.search),
    live_search: clean(input.live_search),
    focus_row: /^\d+$/.test(clean(input.focus_row)) ? Number(input.focus_row) : '',
    page: Math.max(1, Number(input.page) || 1),
    page_size: PAGE_SIZES.has(pageSize) ? pageSize : 25
  };
}

function exceptionKind(row) {
  if (row.applied_status === 'failed' || row.category === 'failed') return 'failed';
  if (row.approval_status === 'rejected' || row.review_status === 'rejected') return 'rejected';
  if (row.approval_status === 'deferred' || row.review_status === 'deferred') return 'deferred';
  if (row.category === 'conflict' || row.classification === 'conflict') return 'conflict';
  if (row.category === 'fixed_approval') return 'fixed_approval';
  if (row.match_domain === 'mobile'
    && !normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised)) return 'missing_phone';
  if (row.match_domain === 'fixed' && !normaliseAccount(row.account_number)) return 'missing_account';
  if (!clean(row.customer_name) && ['create_mobile_record', 'create_fixed_account_and_service'].includes(row.action_type)) {
    return 'missing_name';
  }
  if (row.category === 'account_number') return 'missing_account';
  return row.category === 'missing_information' ? 'missing_name' : 'conflict';
}

function managerAction(row) {
  const kind = exceptionKind(row);
  if (kind === 'missing_name') return 'Add customer or business name';
  if (kind === 'missing_phone') return 'Add or correct phone number';
  if (kind === 'missing_account') return 'Add or correct account number';
  if (kind === 'fixed_approval') return 'Approve fixed creation';
  if (kind === 'failed') return 'Retry supported failed action';
  if (kind === 'deferred') return 'Deferred — update the record before rechecking';
  if (kind === 'rejected') return 'Rejected — update the record before rechecking';
  return row.match_domain === 'fixed' ? 'Select the correct customer account' : 'Select the correct customer';
}

function decorateException(row) {
  return {
    ...row,
    exception_kind: exceptionKind(row),
    manager_action: managerAction(row),
    technical_status: `${row.classification || 'not matched'} / ${row.approval_status || 'no action'}`
  };
}

function matchesQueueFilter(row, filters) {
  if (filters.exception !== 'all' && row.exception_kind !== filters.exception) return false;
  if (!filters.search) return true;
  const haystack = [
    row.phone_original, row.customer_name, row.account_number, row.original_filename,
    row.source_row_number, row.batch_id, row.reason, row.requiredAction
  ].join(' ').toLowerCase();
  return haystack.includes(filters.search.toLowerCase());
}

async function searchLiveTargets(connection, term, domain) {
  const query = clean(term);
  if (query.length < 2) return [];
  const like = `%${query}%`;
  if (domain === 'fixed') {
    const [rows] = await connection.execute(`
      SELECT id,'customer_account' kind,display_name title,account_number reference
      FROM customer_accounts
      WHERE display_name LIKE :like OR account_number LIKE :like OR account_number_normalised LIKE :like
      ORDER BY display_name,id LIMIT 8
    `, { like });
    return rows;
  }
  const canonical = normaliseSouthAfricanMobile(query);
  const [rows] = await connection.execute(`
    SELECT id,'client' kind,client_name title,
      COALESCE(NULLIF(account_number,''),NULLIF(cell_number,''),NULLIF(main_contact_number,''),'No account number') reference
    FROM clients
    WHERE client_name LIKE :like OR account_number LIKE :like
      OR cell_number LIKE :like OR main_contact_number LIKE :like OR alt_number LIKE :like
      OR (:canonical IS NOT NULL AND
        (cell_number_normalised=:canonical OR main_contact_number_normalised=:canonical))
    ORDER BY client_name,id LIMIT 8
  `, { like, canonical: canonical || null });
  return rows;
}

async function loadExceptionQueue(input, { connection = db, panelMode = false } = {}) {
  const filters = exceptionFilters(input);
  const scope = Object.fromEntries(MANAGEMENT_SCOPE_KEYS
    .filter(key => input[key] !== '' && input[key] != null)
    .map(key => [key, input[key]]));
  if (filters.batch) scope.batch = filters.batch;
  const { rows: sourceRows } = await loadScopeRows(scope, connection);
  const evidence = await loadSafetyEvidence(connection, sourceRows);
  const outstanding = sourceRows
    .map(row => decorateException({ ...row, ...classifyBulkSafety(row, evidence) }))
    .filter(row => !row.safe && row.category !== 'completed')
    .filter(row => matchesQueueFilter(row, filters));
  const pages = Math.max(1, Math.ceil(outstanding.length / filters.page_size));
  filters.page = Math.min(filters.page, pages);
  const start = (filters.page - 1) * filters.page_size;
  const rows = outstanding.slice(start, start + filters.page_size);
  const focused = rows.find(row => Number(row.row_id) === Number(filters.focus_row));
  const liveMatches = focused && filters.live_search
    ? await searchLiveTargets(connection, filters.live_search, focused.match_domain)
    : [];
  return {
    filters,
    scope,
    rows,
    liveMatches,
    exceptionFilters: EXCEPTION_FILTERS,
    total: outstanding.length,
    panelMode,
    pagination: { page: filters.page, pages, pageSize: filters.page_size }
  };
}

async function loadLockedRow(connection, rowId) {
  const [[row]] = await connection.execute(`
    SELECT r.*,b.import_type,b.original_filename,
      m.id match_id,m.classification,m.match_domain,m.review_status,m.candidate_json,
      m.proposed_client_id,m.proposed_account_id,m.proposed_fixed_account_id,m.proposed_fixed_service_id,
      a.id action_id,a.action_type,a.target_entity_type,a.target_entity_id,
      a.approval_status,a.applied_status,a.error_text,a.proposed_json
    FROM monthly_import_rows r
    JOIN monthly_import_batches b ON b.id=r.batch_id
    LEFT JOIN monthly_import_matches m ON m.import_row_id=r.id
    LEFT JOIN monthly_import_actions a ON a.import_row_id=r.id
    WHERE r.id=:rowId FOR UPDATE
  `, { rowId });
  if (!row) throw new Error('This imported record no longer exists.');
  if (row.applied_status === 'applied') throw new Error('This record is already completed and cannot be changed here.');
  return row;
}

async function classifyRowInCurrentScope(connection, rowId) {
  const scope = await loadScopeRows({}, connection);
  const evidence = await loadSafetyEvidence(connection, scope.rows, { lock: true });
  const row = scope.rows.find(item => Number(item.row_id) === Number(rowId));
  if (!row) throw new Error('The corrected record could not be reloaded.');
  return { row, safety: classifyBulkSafety(row, evidence) };
}

async function rematchLockedRow(connection, row) {
  await matchSingleRow(connection, row, { resetDecision: true });
  return classifyRowInCurrentScope(connection, row.id);
}

async function withTransaction(work, { connectionFactory = () => db.getConnection() } = {}) {
  const connection = await connectionFactory();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function correctExceptionRow(rowIdInput, fields, context, options = {}) {
  const rowId = Number(rowIdInput);
  if (!Number.isSafeInteger(rowId) || rowId < 1) throw new Error('A valid imported record is required.');
  const supplied = ['customer_name', 'phone_original', 'account_number']
    .filter(key => Object.prototype.hasOwnProperty.call(fields || {}, key));
  if (!supplied.length) throw new Error('Enter a correction before saving.');
  return withTransaction(async connection => {
    const row = await loadLockedRow(connection, rowId);
    const before = {
      ...Object.fromEntries(supplied.map(key => [key, row[key] || null])),
      import_status: row.import_status
    };
    const after = {};
    for (const key of supplied) after[key] = clean(fields[key], key === 'customer_name' ? 255 : 120) || null;
    const phone = Object.prototype.hasOwnProperty.call(after, 'phone_original')
      ? normaliseSouthAfricanMobile(after.phone_original) : row.phone_normalised;
    await connection.execute(`
      UPDATE monthly_import_rows
      SET import_status='confirmed',
        customer_name=COALESCE(:customerName,customer_name),
        phone_original=COALESCE(:phoneOriginal,phone_original),
        phone_normalised=CASE WHEN :phoneSupplied=1 THEN :phoneNormalised ELSE phone_normalised END,
        account_number=COALESCE(:accountNumber,account_number)
      WHERE id=:rowId
    `, {
      customerName: Object.prototype.hasOwnProperty.call(after, 'customer_name') ? after.customer_name : null,
      phoneOriginal: Object.prototype.hasOwnProperty.call(after, 'phone_original') ? after.phone_original : null,
      phoneSupplied: Object.prototype.hasOwnProperty.call(after, 'phone_original') ? 1 : 0,
      phoneNormalised: phone || null,
      accountNumber: Object.prototype.hasOwnProperty.call(after, 'account_number') ? after.account_number : null,
      rowId
    });
    const updated = { ...row, ...after, import_status: 'confirmed', phone_normalised: phone || null };
    const result = await rematchLockedRow(connection, updated);
    await writeAudit(connection, context, 'monthly_import_exception_corrected', 'monthly_import_rows', rowId,
      `Monthly import row #${rowId} was corrected and rechecked; no live CRM record was changed.`,
      before, { ...after, import_status: 'confirmed', safetyStatus: result.safety.safe ? 'safe' : result.safety.category });
    return result.safety;
  }, options);
}

function candidateIds(candidateJson, key) {
  let candidates = {};
  try { candidates = typeof candidateJson === 'string' ? JSON.parse(candidateJson) : candidateJson || {}; } catch {}
  return (candidates[key] || []).map(item => Number(item.id)).filter(Number.isSafeInteger);
}

async function linkExistingTarget(rowIdInput, targetType, targetIdInput, context, options = {}) {
  const rowId = Number(rowIdInput);
  const targetId = Number(targetIdInput);
  if (!Number.isSafeInteger(rowId) || rowId < 1 || !Number.isSafeInteger(targetId) || targetId < 1) {
    throw new Error('Choose a valid imported record and live record.');
  }
  if (!['client', 'customer_account'].includes(targetType)) throw new Error('This live record type cannot be linked.');
  return withTransaction(async connection => {
    const row = await loadLockedRow(connection, rowId);
    const isClient = targetType === 'client';
    if ((isClient && row.match_domain !== 'mobile') || (!isClient && row.match_domain !== 'fixed')) {
      throw new Error('The selected live record does not match this import type.');
    }
    const table = isClient ? 'clients' : 'customer_accounts';
    const [[target]] = await connection.execute(`SELECT * FROM ${table} WHERE id=:targetId FOR UPDATE`, { targetId });
    if (!target) throw new Error('The selected live record no longer exists.');
    const allowed = candidateIds(row.candidate_json, isClient ? 'clients' : 'accounts');
    if (!allowed.includes(targetId)) {
      throw new Error('The selected live record is not a current match candidate. Correct the imported details and recheck first.');
    }
    if (isClient) {
      const canonical = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);
      const stillMatches = MOBILE_PHONE_FIELDS.some(field => normaliseSouthAfricanMobile(target[field]) === canonical);
      if (!canonical || !stillMatches) throw new Error('The selected customer no longer matches the imported phone.');
    } else if (normaliseAccount(target.account_number_normalised || target.account_number) !== normaliseAccount(row.account_number)) {
      throw new Error('The selected customer account no longer matches the imported account number.');
    }
    const before = {
      reviewStatus: row.review_status, approvalStatus: row.approval_status,
      targetEntityType: row.target_entity_type, targetEntityId: row.target_entity_id
    };
    await connection.execute(`
      UPDATE monthly_import_matches
      SET review_status='approved',reviewed_by=:userId,reviewed_at=NOW(),
        review_notes='Explicitly linked from Monthly Import exception review.',
        proposed_client_id=CASE WHEN :isClient=1 THEN :targetId ELSE proposed_client_id END,
        proposed_account_id=CASE WHEN :isClient=0 THEN :targetId ELSE proposed_account_id END
      WHERE id=:matchId
    `, { userId: context.userId, isClient: isClient ? 1 : 0, targetId, matchId: row.match_id });
    await connection.execute(`
      UPDATE monthly_import_actions
      SET action_type=:actionType,target_entity_type=:entityType,target_entity_id=:targetId,
        approval_status='approved',approved_by=:userId,approved_at=NOW(),
        applied_status='not_applied',applied_by=NULL,applied_at=NULL,error_text=NULL
      WHERE id=:actionId
    `, {
      actionType: isClient ? 'resolve_mobile_conflict' : 'resolve_fixed_conflict',
      entityType: isClient ? 'clients' : 'customer_accounts',
      targetId, userId: context.userId, actionId: row.action_id
    });
    const result = await classifyRowInCurrentScope(connection, rowId);
    await writeAudit(connection, context, 'monthly_import_exception_linked', 'monthly_import_rows', rowId,
      `Monthly import row #${rowId} was explicitly linked to ${table} #${targetId}; no live CRM record was changed.`,
      before, {
        targetEntityType: isClient ? 'clients' : 'customer_accounts',
        targetEntityId: targetId, safetyStatus: result.safety.safe ? 'safe' : result.safety.category
      });
    return result.safety;
  }, options);
}

async function decideException(rowIdInput, decisionInput, reasonInput, context, options = {}) {
  const rowId = Number(rowIdInput);
  const decision = clean(decisionInput).toLowerCase();
  const reason = clean(reasonInput, 2000);
  if (!['approve_fixed', 'defer', 'reject'].includes(decision)) throw new Error('Choose a supported exception decision.');
  if (['defer', 'reject'].includes(decision) && !reason) throw new Error('Enter a reason before deferring or rejecting.');
  return withTransaction(async connection => {
    const row = await loadLockedRow(connection, rowId);
    if (decision === 'approve_fixed' && row.action_type !== 'create_fixed_account_and_service') {
      throw new Error('Only a proposed fixed creation can be approved here.');
    }
    const status = decision === 'approve_fixed' ? 'approved' : decision === 'defer' ? 'deferred' : 'rejected';
    await connection.execute(`
      UPDATE monthly_import_matches
      SET review_status=:status,reviewed_by=:userId,reviewed_at=NOW(),review_notes=:reason
      WHERE id=:matchId
    `, { status, userId: context.userId, reason: reason || 'Approved fixed creation.', matchId: row.match_id });
    await connection.execute(`
      UPDATE monthly_import_actions
      SET approval_status=:status,approved_by=:userId,approved_at=NOW(),
        applied_status='not_applied',applied_by=NULL,applied_at=NULL,error_text=NULL
      WHERE id=:actionId
    `, { status, userId: context.userId, actionId: row.action_id });
    const result = await classifyRowInCurrentScope(connection, rowId);
    await writeAudit(connection, context, `monthly_import_exception_${status}`, 'monthly_import_rows', rowId,
      `Monthly import row #${rowId} was ${status}; no live CRM record was changed.`,
      { reviewStatus: row.review_status, approvalStatus: row.approval_status },
      { reviewStatus: status, approvalStatus: status, reason, safetyStatus: result.safety.safe ? 'safe' : result.safety.category });
    return result.safety;
  }, options);
}

module.exports = {
  EXCEPTION_FILTERS,
  MANAGEMENT_SCOPE_KEYS,
  exceptionFilters,
  exceptionKind,
  managerAction,
  searchLiveTargets,
  loadExceptionQueue,
  loadLockedRow,
  classifyRowInCurrentScope,
  rematchLockedRow,
  correctExceptionRow,
  linkExistingTarget,
  decideException
};
