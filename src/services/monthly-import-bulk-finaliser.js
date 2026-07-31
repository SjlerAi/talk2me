'use strict';

const db = require('../config/db');
const { filtersFrom, whereFor, FROM_SQL } = require('./monthly-import-management');
const { normaliseSouthAfricanMobile, MOBILE_PHONE_FIELDS } = require('./sa-phone-normalisation');
const {
  loadMonthlyImportActions,
  completeMonthlyImportAction,
  resolvedMobileCandidateIds,
  writeAudit
} = require('./monthly-import-finaliser');

const BULK_CHUNK_SIZE = 25;
const SUPPORTED_ACTIONS = new Set([
  'link_mobile_client',
  'resolve_mobile_conflict',
  'create_mobile_record',
  'link_fixed_service',
  'resolve_fixed_conflict',
  'create_fixed_service',
  'create_fixed_account_and_service'
]);

function normaliseAccount(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function uniqueIds(rows) {
  return [...new Set(rows.map(row => Number(row.id)).filter(id => Number.isSafeInteger(id) && id > 0))];
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function addMap(map, key, row) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(row);
  map.set(key, values);
}

function namedList(values, prefix, params) {
  return values.map((value, index) => {
    const key = `${prefix}${index}`;
    params[key] = value;
    return `:${key}`;
  }).join(',');
}

async function loadScopeRows(filtersInput, connection = db) {
  const filters = filtersFrom(filtersInput);
  const where = whereFor(filters);
  const [rows] = await connection.query(`
    SELECT
      r.id row_id,r.batch_id,r.source_row_number,r.row_fingerprint,r.import_status,
      r.phone_original,r.phone_normalised,r.account_number,r.customer_name,r.order_number,
      r.solution_id,r.mac_address,r.sim_number,r.package_name,r.raw_data_json,
      b.original_filename,b.import_type,b.source_system,
      m.id match_id,m.classification,m.match_domain,m.review_status,m.candidate_json,
      m.proposed_client_id,m.proposed_account_id,m.proposed_fixed_account_id,m.proposed_fixed_service_id,
      a.id action_id,a.action_type,a.target_entity_type,a.target_entity_id,
      a.approval_status,a.applied_status,a.error_text,a.proposed_json,
      COALESCE(ca.account_number,c.account_number) live_account_number
    ${FROM_SQL}
    WHERE ${where.sql}
    ORDER BY b.created_at,b.id,r.source_row_number,r.id
    LIMIT 5000
  `, where.params);
  return { filters, rows };
}

async function loadSafetyEvidence(connection, rows, { lock = false } = {}) {
  const phones = [...new Set(rows.map(row =>
    normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised)).filter(Boolean))];
  const accountNumbers = [...new Set(rows.map(row => normaliseAccount(row.account_number)).filter(Boolean))];
  const accountIds = uniqueIds(rows.flatMap(row => [
    { id: row.proposed_account_id },
    { id: row.target_entity_type === 'customer_accounts' ? row.target_entity_id : null }
  ]));
  const fixedAccountIds = uniqueIds(rows.flatMap(row => [
    { id: row.proposed_fixed_account_id },
    { id: row.target_entity_type === 'fixed_accounts' ? row.target_entity_id : null }
  ]));
  const serviceIds = uniqueIds(rows.flatMap(row => [
    { id: row.proposed_fixed_service_id },
    { id: row.target_entity_type === 'fixed_services' ? row.target_entity_id : null }
  ]));
  const hashes = [...new Set(rows.map(row => row.row_fingerprint).filter(Boolean))];
  const orders = [...new Set(rows.map(row => String(row.order_number || '').trim()).filter(Boolean))];
  const solutions = [...new Set(rows.map(row => String(row.solution_id || '').trim()).filter(Boolean))];
  const [clients, accounts, fixedAccounts, services] = await Promise.all([
    (async () => {
      if (!phones.length) return [];
      const params = {};
      const canonical = namedList(phones, 'phone', params);
      const rawPhones = [...new Set(phones.flatMap(phone => [phone, `+${phone}`, `0${phone.slice(-9)}`]))];
      const raw = namedList(rawPhones, 'rawPhone', params);
      const [result] = await connection.execute(`
        SELECT id,client_name,account_id,account_number,cell_number_normalised,cell_number,
          main_contact_number_normalised,main_contact_number,alt_number
        FROM clients
        WHERE cell_number_normalised IN (${canonical})
          OR main_contact_number_normalised IN (${canonical})
          OR cell_number IN (${raw}) OR main_contact_number IN (${raw}) OR alt_number IN (${raw})
        ${lock ? 'FOR UPDATE' : ''}
      `, params);
      return result;
    })(),
    (async () => {
      if (!accountNumbers.length && !accountIds.length) return [];
      const params = {};
      const conditions = [];
      if (accountNumbers.length) conditions.push(`account_number_normalised IN (${namedList(accountNumbers, 'account', params)})`);
      if (accountIds.length) conditions.push(`id IN (${namedList(accountIds, 'accountId', params)})`);
      const [result] = await connection.execute(`
        SELECT id,account_number,account_number_normalised,display_name
        FROM customer_accounts WHERE ${conditions.join(' OR ')} ${lock ? 'FOR UPDATE' : ''}
      `, params);
      return result;
    })(),
    (async () => {
      if (!accountNumbers.length && !accountIds.length && !fixedAccountIds.length) return [];
      const params = {};
      const conditions = [];
      if (accountNumbers.length) conditions.push(`account_number_normalised IN (${namedList(accountNumbers, 'fixedNumber', params)})`);
      if (accountIds.length) conditions.push(`account_id IN (${namedList(accountIds, 'fixedAccountOwner', params)})`);
      if (fixedAccountIds.length) conditions.push(`id IN (${namedList(fixedAccountIds, 'fixedAccountId', params)})`);
      const [result] = await connection.execute(`
        SELECT id,account_id,account_number,account_number_normalised,customer_name
        FROM fixed_accounts WHERE ${conditions.join(' OR ')} ${lock ? 'FOR UPDATE' : ''}
      `, params);
      return result;
    })(),
    (async () => {
      if (!serviceIds.length && !hashes.length && !orders.length && !solutions.length) return [];
      const params = {};
      const conditions = [];
      if (serviceIds.length) conditions.push(`id IN (${namedList(serviceIds, 'serviceId', params)})`);
      if (hashes.length) conditions.push(`source_row_hash IN (${namedList(hashes, 'hash', params)})`);
      if (orders.length) conditions.push(`order_number IN (${namedList(orders, 'order', params)})`);
      if (solutions.length) conditions.push(`solution_id IN (${namedList(solutions, 'solution', params)})`);
      const [result] = await connection.execute(`
        SELECT id,fixed_account_id,source_row_hash,order_number,solution_id,service_title
        FROM fixed_services WHERE ${conditions.join(' OR ')} ${lock ? 'FOR UPDATE' : ''}
      `, params);
      return result;
    })()
  ]);

  const clientsByPhone = new Map();
  for (const client of clients) {
    for (const field of MOBILE_PHONE_FIELDS) {
      const phone = normaliseSouthAfricanMobile(client[field]);
      if (phones.includes(phone)) addMap(clientsByPhone, phone, client);
    }
  }
  const accountsByNumber = new Map();
  const accountsById = new Map(accounts.map(row => [Number(row.id), row]));
  for (const row of accounts) addMap(accountsByNumber, normaliseAccount(row.account_number_normalised || row.account_number), row);
  const fixedByNumber = new Map();
  const fixedByAccountId = new Map();
  const fixedById = new Map(fixedAccounts.map(row => [Number(row.id), row]));
  for (const row of fixedAccounts) {
    addMap(fixedByNumber, normaliseAccount(row.account_number_normalised || row.account_number), row);
    if (row.account_id) addMap(fixedByAccountId, Number(row.account_id), row);
  }
  const servicesById = new Map(services.map(row => [Number(row.id), row]));
  const importPhoneCounts = new Map();
  const importAccountCounts = new Map();
  for (const row of rows) {
    const phone = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);
    const account = normaliseAccount(row.account_number);
    if (phone && row.action_type === 'create_mobile_record') importPhoneCounts.set(phone, (importPhoneCounts.get(phone) || 0) + 1);
    if (account && row.action_type === 'create_fixed_account_and_service') importAccountCounts.set(account, (importAccountCounts.get(account) || 0) + 1);
  }
  return {
    clientsByPhone, accountsByNumber, accountsById, fixedByNumber, fixedByAccountId, fixedById,
    services, servicesById, importPhoneCounts, importAccountCounts
  };
}

function exclusion(row, category, reason, requiredAction) {
  return { safe: false, category, reason, requiredAction };
}

function fixedCollisions(row, evidence, targetId = null) {
  return evidence.services.filter(service => Number(service.id) !== Number(targetId || 0) && (
    service.source_row_hash === row.row_fingerprint
    || (row.order_number && service.order_number === row.order_number)
    || (row.solution_id && service.solution_id === row.solution_id)
  ));
}

function classifyBulkSafety(row, evidence) {
  if (!row.action_id) return exclusion(row, 'missing_information', 'This row has no proposed action yet.', 'Add missing information');
  if (row.applied_status === 'applied' && row.action_type === 'create_mobile_record'
    && !String(row.live_account_number || '').trim()) {
    return exclusion(row, 'account_number', 'The customer exists but still needs an official account number.', 'Assign account number');
  }
  if (row.applied_status === 'applied') return exclusion(row, 'completed', 'This action is already completed and will not be applied again.', 'No action needed');
  if (row.applied_status === 'failed') return exclusion(row, 'failed', row.error_text || 'The previous action failed and requires investigation.', 'Check failed record');
  if (row.approval_status === 'rejected' || row.review_status === 'rejected') {
    return exclusion(row, 'exception', 'This row was rejected and remains excluded.', 'No action needed');
  }
  if (row.approval_status === 'deferred' || row.review_status === 'deferred') {
    return exclusion(row, 'exception', 'This row was deferred for individual review.', 'Add missing information');
  }
  if (row.import_status !== 'confirmed') return exclusion(row, 'exception', `Import status ${row.import_status || 'unknown'} is not eligible.`, 'Add missing information');
  if (!SUPPORTED_ACTIONS.has(row.action_type)) return exclusion(row, 'exception', `Action ${row.action_type || 'unknown'} is not supported for bulk finalisation.`, 'Add missing information');

  const canonicalPhone = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);
  const phoneMatches = canonicalPhone ? uniqueIds(evidence.clientsByPhone.get(canonicalPhone) || []) : [];
  const targetClientId = Number(row.target_entity_id || row.proposed_client_id);
  if (row.action_type === 'link_mobile_client') {
    if (row.classification !== 'exact_match') return exclusion(row, 'exception', 'The mobile match is no longer deterministic.', 'Review conflict');
    if (!canonicalPhone) return exclusion(row, 'missing_information', 'A valid canonical mobile number is required.', 'Add missing information');
    if (phoneMatches.length !== 1 || phoneMatches[0] !== targetClientId) {
      return exclusion(row, 'exception', 'The exact mobile target is stale or the phone now matches multiple customers.', 'Review conflict');
    }
    return { safe: true, category: 'existing_mobile', reason: 'One canonical phone still maps to one exact live customer.' };
  }
  if (row.action_type === 'resolve_mobile_conflict') {
    if (row.classification !== 'conflict' || row.review_status !== 'approved' || row.approval_status !== 'approved') {
      return exclusion(row, 'conflict', 'This mobile conflict still requires an approved individual decision.', 'Review conflict');
    }
    if (!canonicalPhone) return exclusion(row, 'missing_information', 'A valid canonical mobile number is required.', 'Add missing information');
    let allowed = [];
    try { allowed = resolvedMobileCandidateIds(row.candidate_json); } catch (error) {
      return exclusion(row, 'exception', error.message, 'Review conflict');
    }
    if (!allowed.includes(targetClientId) || Number(row.proposed_client_id) !== targetClientId || !phoneMatches.includes(targetClientId)) {
      return exclusion(row, 'exception', 'The approved mobile selection is stale or no longer matches the imported phone.', 'Review conflict');
    }
    return { safe: true, category: 'existing_mobile', reason: 'The approved selected customer is still a valid stored conflict candidate.' };
  }
  if (row.action_type === 'create_mobile_record') {
    if (!canonicalPhone) return exclusion(row, 'missing_information', 'A valid canonical mobile number is required.', 'Add missing information');
    if (!String(row.customer_name || '').trim()) return exclusion(row, 'missing_information', 'A customer or business name is required for safe bulk creation.', 'Add missing information');
    if ((evidence.importPhoneCounts.get(canonicalPhone) || 0) > 1) return exclusion(row, 'exception', 'The same new mobile appears more than once in the selected import scope.', 'Review conflict');
    if (phoneMatches.length) return exclusion(row, 'exception', 'This phone now belongs to a live customer; re-run matching before finalising.', 'Review conflict');
    return { safe: true, category: 'new_mobile', reason: 'The named customer has a valid canonical phone with no live or selected-scope duplicate.' };
  }

  const targetServiceId = Number(row.target_entity_type === 'fixed_services' ? row.target_entity_id : row.proposed_fixed_service_id);
  if (row.action_type === 'link_fixed_service'
    || (row.action_type === 'resolve_fixed_conflict' && row.target_entity_type === 'fixed_services')) {
    if (row.action_type === 'link_fixed_service' && row.classification !== 'exact_match') {
      return exclusion(row, 'exception', 'The fixed service match is no longer deterministic.', 'Review conflict');
    }
    if (row.action_type === 'resolve_fixed_conflict'
      && (row.review_status !== 'approved' || row.approval_status !== 'approved')) {
      return exclusion(row, 'conflict', 'This fixed conflict still requires an approved individual decision.', 'Review conflict');
    }
    if (!targetServiceId || !evidence.servicesById.has(targetServiceId)) {
      return exclusion(row, 'exception', 'The selected fixed service no longer exists.', 'Review conflict');
    }
    if (fixedCollisions(row, evidence, targetServiceId).length) {
      return exclusion(row, 'exception', 'The imported fixed identifiers now point to another service.', 'Review conflict');
    }
    return { safe: true, category: 'fixed', reason: 'The imported identifiers still map to one live fixed service.' };
  }

  const accountNumber = normaliseAccount(row.account_number);
  if (!accountNumber) return exclusion(row, 'missing_information', 'A valid account number is required for fixed processing.', 'Add missing information');
  if (!String(row.customer_name || '').trim() && row.action_type === 'create_fixed_account_and_service') {
    return exclusion(row, 'missing_information', 'A customer or business name is required for fixed account creation.', 'Add missing information');
  }
  if (row.action_type === 'create_fixed_account_and_service') {
    if (row.review_status !== 'approved' || row.approval_status !== 'approved') {
      return exclusion(row, 'fixed_approval', 'New fixed account creation still requires an individual business approval.', 'Approve fixed creation');
    }
    if ((evidence.importAccountCounts.get(accountNumber) || 0) > 1) {
      return exclusion(row, 'exception', 'The same new fixed account appears more than once in the selected import scope.', 'Review conflict');
    }
    if ((evidence.accountsByNumber.get(accountNumber) || []).length || (evidence.fixedByNumber.get(accountNumber) || []).length) {
      return exclusion(row, 'exception', 'This account number now exists and cannot be created again.', 'Review conflict');
    }
    if (fixedCollisions(row, evidence).length) return exclusion(row, 'exception', 'The fixed service identifiers already exist.', 'Review conflict');
    return { safe: true, category: 'fixed', reason: 'The approved named fixed account number and service identifiers are unique.' };
  }

  if (row.action_type === 'resolve_fixed_conflict'
    && (row.review_status !== 'approved' || row.approval_status !== 'approved')) {
    return exclusion(row, 'conflict', 'This fixed conflict still requires an approved individual decision.', 'Review conflict');
  }
  const accountId = Number(row.target_entity_type === 'customer_accounts' ? row.target_entity_id : row.proposed_account_id);
  const account = evidence.accountsById.get(accountId);
  if (!account) return exclusion(row, 'exception', 'The selected customer account no longer exists.', 'Review conflict');
  const linkedFixedAccounts = evidence.fixedByAccountId.get(accountId) || [];
  if (linkedFixedAccounts.length > 1) return exclusion(row, 'exception', 'The customer account now maps to multiple fixed accounts.', 'Review conflict');
  if (fixedCollisions(row, evidence).length) return exclusion(row, 'exception', 'The fixed service identifiers already exist.', 'Review conflict');
  return { safe: true, category: 'fixed', reason: 'The customer account is unique and the new fixed service identifiers are unused.' };
}

function decorateClassification(row, classification) {
  return {
    ...row,
    ...classification,
    reference: `Batch #${row.batch_id}, row ${row.source_row_number}`,
    source: row.original_filename
  };
}

function buildCounts(rows) {
  const counts = {
    selected: rows.length, safe: 0, existingMobile: 0, newMobile: 0, fixed: 0,
    excluded: 0, exceptions: 0, conflicts: 0, missingInformation: 0,
    fixedApprovals: 0, failed: 0, completed: 0
  };
  for (const row of rows) {
    if (row.safe) {
      counts.safe += 1;
      if (row.category === 'existing_mobile') counts.existingMobile += 1;
      if (row.category === 'new_mobile') counts.newMobile += 1;
      if (row.category === 'fixed') counts.fixed += 1;
    } else {
      counts.excluded += 1;
      if (row.category === 'conflict') counts.conflicts += 1;
      else if (row.category === 'missing_information') counts.missingInformation += 1;
      else if (row.category === 'fixed_approval') counts.fixedApprovals += 1;
      else if (row.category === 'failed') counts.failed += 1;
      else if (row.category === 'completed') counts.completed += 1;
      else counts.exceptions += 1;
    }
  }
  return counts;
}

async function loadBulkPreview(filtersInput, { connection = db } = {}) {
  const scope = await loadScopeRows(filtersInput, connection);
  const evidence = await loadSafetyEvidence(connection, scope.rows);
  const rows = scope.rows.map(row => decorateClassification(row, classifyBulkSafety(row, evidence)));
  return {
    filters: scope.filters,
    rows,
    safeRows: rows.filter(row => row.safe),
    excludedRows: rows.filter(row => !row.safe),
    counts: buildCounts(rows)
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function finaliseBulkSafe(filtersInput, context, {
  connectionFactory = () => db.getConnection(),
  previewLoader = loadBulkPreview,
  actionLoader = loadMonthlyImportActions,
  evidenceLoader = loadSafetyEvidence,
  actionCompleter = completeMonthlyImportAction,
  auditWriter = writeAudit
} = {}) {
  const preview = await previewLoader(filtersInput);
  const results = {
    selected: preview.counts.selected,
    applied: [],
    skipped: preview.rows.filter(row => row.category === 'completed'),
    exceptions: preview.rows.filter(row => !row.safe && !['completed', 'failed'].includes(row.category)),
    failed: preview.rows.filter(row => row.category === 'failed')
  };
  const safeIds = preview.safeRows.map(row => Number(row.action_id));
  for (const actionIds of chunks(safeIds, BULK_CHUNK_SIZE)) {
    const connection = await connectionFactory();
    const chunkResults = { applied: [], skipped: [], exceptions: [], failed: [] };
    try {
      await connection.beginTransaction();
      const actions = await actionLoader(connection, actionIds, { lock: true });
      const evidence = await evidenceLoader(connection, actions, { lock: true });
      const byId = new Map(actions.map(action => [Number(action.id), action]));
      for (let index = 0; index < actionIds.length; index += 1) {
        const actionId = actionIds[index];
        const action = byId.get(actionId);
        if (!action) {
          chunkResults.exceptions.push({ action_id: actionId, reason: 'The action no longer exists.', requiredAction: 'Add missing information' });
          continue;
        }
        const current = decorateClassification(action, classifyBulkSafety(action, evidence));
        if (current.category === 'completed') {
          chunkResults.skipped.push(current);
          continue;
        }
        if (!current.safe) {
          chunkResults.exceptions.push(current);
          continue;
        }
        const savepoint = `bulk_row_${index}`;
        await connection.query(`SAVEPOINT ${savepoint}`);
        try {
          const applied = await actionCompleter(connection, action, context, {
            approvePending: true,
            auditActionType: 'monthly_import_bulk_action_applied',
            auditDescription: `Monthly import action #${action.id} was revalidated and applied by bulk-safe finalisation.`,
            reviewNote: 'Approved during manager-confirmed bulk-safe Monthly Import finalisation.'
          });
          chunkResults.applied.push({ ...current, ...applied });
          await connection.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (error) {
          await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          const message = String(error.message || 'Bulk finalisation failed.').slice(0, 2000);
          await connection.execute(`
            UPDATE monthly_import_actions
            SET approval_status='approved',approved_by=COALESCE(approved_by,:userId),
              approved_at=COALESCE(approved_at,NOW()),applied_status='failed',error_text=:errorText
            WHERE id=:id AND applied_status='not_applied'
          `, { userId: context.userId, errorText: message, id: action.id });
          await connection.execute(`
            UPDATE monthly_import_matches
            SET review_status='approved',reviewed_by=COALESCE(reviewed_by,:userId),
              reviewed_at=COALESCE(reviewed_at,NOW()),
              review_notes=COALESCE(review_notes,'Approved during bulk-safe finalisation; live write failed and requires supported retry.')
            WHERE id=:matchId
          `, { userId: context.userId, matchId: action.match_id });
          await auditWriter(connection, context, 'monthly_import_bulk_action_failed', 'monthly_import_actions', action.id,
            `Monthly import action #${action.id} failed inside its isolated bulk savepoint and requires supported retry.`,
            { appliedStatus: action.applied_status },
            { appliedStatus: 'failed', errorText: message });
          chunkResults.failed.push({ ...current, reason: message, requiredAction: 'Check failed record' });
        }
      }
      await connection.commit();
      results.applied.push(...chunkResults.applied);
      results.skipped.push(...chunkResults.skipped);
      results.exceptions.push(...chunkResults.exceptions);
      results.failed.push(...chunkResults.failed);
    } catch (error) {
      await connection.rollback();
      for (const actionId of actionIds) {
        results.failed.push({ action_id: actionId, reason: String(error.message || 'Bulk chunk failed.'), requiredAction: 'Check failed record' });
      }
    } finally {
      connection.release();
    }
  }
  const counts = {
    selected: results.selected,
    applied: results.applied.length,
    skipped: results.skipped.length,
    exception: results.exceptions.length,
    failed: results.failed.length
  };
  const auditConnection = await connectionFactory();
  try {
    await auditConnection.beginTransaction();
    await auditWriter(auditConnection, context, 'monthly_import_bulk_finalised', 'monthly_import_actions', null,
      `Bulk-safe Monthly Import selected ${counts.selected}, applied ${counts.applied}, skipped ${counts.skipped}, moved ${counts.exception} to exceptions and recorded ${counts.failed} failed.`,
      { filters: preview.filters, preview: preview.counts },
      counts);
    await auditConnection.commit();
  } catch (error) {
    await auditConnection.rollback();
    throw error;
  } finally {
    auditConnection.release();
  }
  return { ...results, counts, filters: preview.filters };
}

module.exports = {
  BULK_CHUNK_SIZE,
  SUPPORTED_ACTIONS,
  normaliseAccount,
  loadScopeRows,
  loadSafetyEvidence,
  classifyBulkSafety,
  buildCounts,
  loadBulkPreview,
  finaliseBulkSafe
};
