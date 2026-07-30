'use strict';

const db = require('../config/db');
const { normaliseSouthAfricanMobile, MOBILE_PHONE_FIELDS } = require('./sa-phone-normalisation');

function normaliseAccount(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normaliseIdentifier(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function normaliseMac(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-F0-9]/g, '');
}

function addToMap(map, key, value) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

function uniqueById(values, key = 'id') {
  return [...new Map(values.map(value => [Number(value[key]), value])).values()];
}

async function loadReferenceData(connection) {
  const [clients] = await connection.query(`
    SELECT id,client_name,account_id,account_number,
      cell_number_normalised,cell_number,
      main_contact_number_normalised,main_contact_number,alt_number
    FROM clients
    WHERE COALESCE(cell_number_normalised,cell_number,main_contact_number_normalised,main_contact_number,alt_number) IS NOT NULL
  `);
  const mobile = new Map();
  for (const client of clients) {
    for (const field of MOBILE_PHONE_FIELDS) {
      const canonical = normaliseSouthAfricanMobile(client[field]);
      if (!canonical) continue;
      const candidates = mobile.get(canonical) || new Map();
      const existing = candidates.get(Number(client.id)) || {
        id: Number(client.id),
        clientName: client.client_name,
        accountId: client.account_id ? Number(client.account_id) : null,
        accountNumber: client.account_number || null,
        matchedFields: []
      };
      if (!existing.matchedFields.includes(field)) existing.matchedFields.push(field);
      candidates.set(Number(client.id), existing);
      mobile.set(canonical, candidates);
    }
  }

  const [accounts] = await connection.query('SELECT id,account_number,account_number_normalised,display_name FROM customer_accounts');
  const accountsByNumber = new Map();
  for (const account of accounts) addToMap(accountsByNumber, normaliseAccount(account.account_number_normalised || account.account_number), account);

  const [fixedAccounts] = await connection.query('SELECT id,account_id,account_number,account_number_normalised,customer_name FROM fixed_accounts');
  const fixedAccountsByAccountId = new Map();
  const fixedAccountsByNumber = new Map();
  for (const account of fixedAccounts) {
    if (account.account_id) addToMap(fixedAccountsByAccountId, Number(account.account_id), account);
    addToMap(fixedAccountsByNumber, normaliseAccount(account.account_number_normalised || account.account_number), account);
  }

  const [services] = await connection.query(`
    SELECT id,fixed_account_id,service_title,branch_name,order_number,solution_id,mac_address,mac_address_normalised,sim_number
    FROM fixed_services
  `);
  const servicesByFixedAccount = new Map();
  for (const service of services) addToMap(servicesByFixedAccount, Number(service.fixed_account_id), service);
  return { mobile, accountsByNumber, fixedAccountsByAccountId, fixedAccountsByNumber, servicesByFixedAccount };
}

function mobileResult(row, references) {
  const canonical = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);
  const candidates = canonical ? [...(references.mobile.get(canonical)?.values() || [])] : [];
  const candidateJson = { canonicalPhone: canonical || null, clients: candidates };
  if (candidates.length === 1) {
    return {
      classification: 'exact_match', domain: 'mobile', confidence: 100,
      proposedClientId: candidates[0].id, proposedAccountId: candidates[0].accountId,
      reason: `Canonical phone ${canonical} uniquely matches client #${candidates[0].id} via ${candidates[0].matchedFields.join(', ')}.`,
      candidates: candidateJson, actionType: 'link_mobile_client', targetType: 'clients', targetId: candidates[0].id
    };
  }
  if (candidates.length > 1) {
    return {
      classification: 'conflict', domain: 'mobile', confidence: 0,
      reason: `Canonical phone ${canonical} matches ${candidates.length} distinct clients and requires management selection.`,
      candidates: candidateJson, actionType: 'resolve_mobile_conflict', targetType: 'clients', targetId: null
    };
  }
  return {
    classification: 'new_record', domain: 'mobile', confidence: 0,
    reason: canonical ? `No existing client has canonical phone ${canonical}.` : 'The imported phone is not a plausible South African mobile number.',
    candidates: candidateJson, actionType: 'create_mobile_record', targetType: 'clients', targetId: null
  };
}

function fixedResult(row, references) {
  const accountNumber = normaliseAccount(row.account_number);
  const accountCandidates = uniqueById(references.accountsByNumber.get(accountNumber) || []);
  const candidateJson = {
    accountNumber: accountNumber || null,
    accounts: accountCandidates.map(account => ({
      id: Number(account.id), accountNumber: account.account_number, displayName: account.display_name,
      matchedFields: ['account_number']
    })),
    fixedAccounts: [],
    services: []
  };
  if (accountCandidates.length === 0) {
    return {
      classification: 'new_record', domain: 'fixed', confidence: 0,
      reason: `No customer account matches normalised account number ${accountNumber || '(blank)'}.`,
      candidates: candidateJson, actionType: 'create_fixed_account_and_service', targetType: 'customer_accounts', targetId: null
    };
  }
  if (accountCandidates.length > 1) {
    return {
      classification: 'conflict', domain: 'fixed', confidence: 0,
      reason: `Normalised account number ${accountNumber} matches multiple customer accounts.`,
      candidates: candidateJson, actionType: 'resolve_fixed_conflict', targetType: 'customer_accounts', targetId: null
    };
  }

  const account = accountCandidates[0];
  const linkedFixedAccounts = uniqueById([
    ...(references.fixedAccountsByAccountId.get(Number(account.id)) || []),
    ...(references.fixedAccountsByNumber.get(accountNumber) || [])
  ]);
  candidateJson.fixedAccounts = linkedFixedAccounts.map(item => ({
    id: Number(item.id), accountId: item.account_id ? Number(item.account_id) : null,
    accountNumber: item.account_number, customerName: item.customer_name, matchedFields: ['account_number']
  }));

  const services = uniqueById(linkedFixedAccounts.flatMap(item => references.servicesByFixedAccount.get(Number(item.id)) || []));
  const imported = {
    order_number: normaliseIdentifier(row.order_number),
    solution_id: normaliseIdentifier(row.solution_id),
    mac_address: normaliseMac(row.mac_address),
    sim_number: normaliseIdentifier(row.sim_number)
  };
  const serviceCandidates = services.map(service => {
    const matchedFields = [];
    if (imported.order_number && imported.order_number === normaliseIdentifier(service.order_number)) matchedFields.push('order_number');
    if (imported.solution_id && imported.solution_id === normaliseIdentifier(service.solution_id)) matchedFields.push('solution_id');
    if (imported.mac_address && imported.mac_address === normaliseMac(service.mac_address_normalised || service.mac_address)) matchedFields.push('mac_address');
    if (imported.sim_number && imported.sim_number === normaliseIdentifier(service.sim_number)) matchedFields.push('sim_number');
    return {
      id: Number(service.id), fixedAccountId: Number(service.fixed_account_id),
      title: service.service_title || service.branch_name || null,
      orderNumber: service.order_number || null, solutionId: service.solution_id || null,
      matchedFields
    };
  }).filter(service => service.matchedFields.length);
  candidateJson.services = serviceCandidates;

  if (serviceCandidates.length > 1) {
    return {
      classification: 'conflict', domain: 'fixed', confidence: 0, proposedAccountId: Number(account.id),
      reason: `Account ${account.account_number} is unique, but imported service identifiers match ${serviceCandidates.length} services.`,
      candidates: candidateJson, actionType: 'resolve_fixed_conflict', targetType: 'fixed_services', targetId: null
    };
  }
  if (serviceCandidates.length === 1) {
    const service = serviceCandidates[0];
    return {
      classification: 'exact_match', domain: 'fixed', confidence: 100,
      proposedAccountId: Number(account.id), proposedFixedAccountId: service.fixedAccountId, proposedFixedServiceId: service.id,
      reason: `Account ${account.account_number} and ${service.matchedFields.join(', ')} uniquely match fixed service #${service.id}.`,
      candidates: candidateJson, actionType: 'link_fixed_service', targetType: 'fixed_services', targetId: service.id
    };
  }
  if (linkedFixedAccounts.length > 1) {
    return {
      classification: 'conflict', domain: 'fixed', confidence: 60, proposedAccountId: Number(account.id),
      reason: `Account ${account.account_number} is unique, but it links to multiple fixed accounts and no service identifier resolves the conflict.`,
      candidates: candidateJson, actionType: 'resolve_fixed_conflict', targetType: 'fixed_accounts', targetId: null
    };
  }
  return {
    classification: 'exact_match', domain: 'fixed', confidence: 85,
    proposedAccountId: Number(account.id),
    proposedFixedAccountId: linkedFixedAccounts[0] ? Number(linkedFixedAccounts[0].id) : null,
    reason: `Normalised account number uniquely matches customer account #${account.id}; no existing fixed service matches the imported identifiers.`,
    candidates: candidateJson, actionType: 'create_fixed_service', targetType: 'customer_accounts', targetId: Number(account.id)
  };
}

function proposedPayload(row, result) {
  return {
    importRowId: Number(row.id), classification: result.classification, matchDomain: result.domain,
    proposedClientId: result.proposedClientId || null, proposedAccountId: result.proposedAccountId || null,
    proposedFixedAccountId: result.proposedFixedAccountId || null, proposedFixedServiceId: result.proposedFixedServiceId || null,
    imported: {
      phone: normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised) || null,
      accountNumber: normaliseAccount(row.account_number) || null, customerName: row.customer_name || null,
      orderNumber: row.order_number || null, solutionId: row.solution_id || null,
      macAddress: normaliseMac(row.mac_address) || null, simNumber: row.sim_number || null,
      packageName: row.package_name || null, transactionDate: row.transaction_date || null
    }
  };
}

async function upsertResult(connection, row, result) {
  const [matchWrite] = await connection.execute(`
    INSERT INTO monthly_import_matches
      (import_row_id,classification,match_domain,confidence_score,proposed_client_id,proposed_account_id,
       proposed_fixed_account_id,proposed_fixed_service_id,match_reason,candidate_json)
    VALUES
      (:rowId,:classification,:domain,:confidence,:clientId,:accountId,:fixedAccountId,:fixedServiceId,:reason,:candidates)
    ON DUPLICATE KEY UPDATE
      id=LAST_INSERT_ID(id),classification=VALUES(classification),match_domain=VALUES(match_domain),
      confidence_score=VALUES(confidence_score),match_reason=VALUES(match_reason),candidate_json=VALUES(candidate_json),
      proposed_client_id=IF(review_status<>'pending',proposed_client_id,VALUES(proposed_client_id)),
      proposed_account_id=IF(review_status<>'pending',proposed_account_id,VALUES(proposed_account_id)),
      proposed_fixed_account_id=IF(review_status<>'pending',proposed_fixed_account_id,VALUES(proposed_fixed_account_id)),
      proposed_fixed_service_id=IF(review_status<>'pending',proposed_fixed_service_id,VALUES(proposed_fixed_service_id)),
      updated_at=CURRENT_TIMESTAMP
  `, {
    rowId: row.id, classification: result.classification, domain: result.domain, confidence: result.confidence,
    clientId: result.proposedClientId || null, accountId: result.proposedAccountId || null,
    fixedAccountId: result.proposedFixedAccountId || null, fixedServiceId: result.proposedFixedServiceId || null,
    reason: result.reason, candidates: JSON.stringify(result.candidates)
  });
  const matchId = Number(matchWrite.insertId);
  const proposed = proposedPayload(row, result);
  await connection.execute(`
    INSERT INTO monthly_import_actions
      (import_row_id,match_id,action_type,target_entity_type,target_entity_id,before_json,proposed_json)
    VALUES (:rowId,:matchId,:actionType,:targetType,:targetId,NULL,:proposed)
    ON DUPLICATE KEY UPDATE
      action_type=IF(approval_status<>'pending',action_type,VALUES(action_type)),
      target_entity_type=IF(approval_status<>'pending',target_entity_type,VALUES(target_entity_type)),
      target_entity_id=IF(approval_status<>'pending',target_entity_id,VALUES(target_entity_id)),
      proposed_json=IF(approval_status<>'pending',proposed_json,VALUES(proposed_json)),
      updated_at=CURRENT_TIMESTAMP
  `, {
    rowId: row.id, matchId, actionType: result.actionType, targetType: result.targetType,
    targetId: result.targetId || null, proposed: JSON.stringify(proposed)
  });
}

async function runMatching({ batchId = null } = {}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const params = {};
    let filter = '';
    if (batchId !== null) {
      const numericBatchId = Number(batchId);
      if (!Number.isInteger(numericBatchId) || numericBatchId < 1) throw new Error('A valid confirmed batch is required.');
      params.batchId = numericBatchId;
      filter = 'AND r.batch_id=:batchId';
      const [[batch]] = await connection.execute('SELECT id,status FROM monthly_import_batches WHERE id=:batchId FOR UPDATE', params);
      if (!batch) throw new Error('Import batch not found.');
      if (batch.status !== 'confirmed') throw new Error('Only a confirmed batch can be matched.');
    }
    const [rows] = await connection.execute(`
      SELECT r.*,b.import_type
      FROM monthly_import_rows r
      JOIN monthly_import_batches b ON b.id=r.batch_id
      WHERE b.status='confirmed' AND r.import_status='confirmed' ${filter}
      ORDER BY r.batch_id,r.id
    `, params);
    const references = await loadReferenceData(connection);
    const summary = { total: 0, exact_match: 0, possible_match: 0, new_record: 0, conflict: 0 };
    for (const row of rows) {
      const result = row.import_type === 'fixed_base' ? fixedResult(row, references) : mobileResult(row, references);
      await upsertResult(connection, row, result);
      summary.total += 1;
      summary[result.classification] = (summary[result.classification] || 0) + 1;
    }
    await connection.commit();
    return summary;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  runMatching,
  normaliseAccount,
  normaliseIdentifier,
  normaliseMac,
  mobileResult,
  fixedResult
};
