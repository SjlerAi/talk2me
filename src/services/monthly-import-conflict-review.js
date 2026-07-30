'use strict';

const { normaliseSouthAfricanMobile, MOBILE_PHONE_FIELDS } = require('./sa-phone-normalisation');

const FIELD_LABELS = Object.freeze({
  cell_number_normalised: 'normalised cellphone',
  cell_number: 'cellphone',
  main_contact_number_normalised: 'normalised main contact',
  main_contact_number: 'main contact',
  alt_number: 'alternate number',
  account_number: 'account number',
  order_number: 'order number',
  solution_id: 'solution ID',
  mac_address: 'MAC address',
  sim_number: 'SIM number'
});

const SELECTION_TYPES = Object.freeze({
  clients: {
    kind: 'client',
    inputName: 'client_id',
    label: 'client',
    buttonLabel: 'Use selected client',
    targetType: 'clients',
    matchColumn: 'proposed_client_id'
  },
  accounts: {
    kind: 'customer-account',
    inputName: 'account_id',
    label: 'customer account',
    buttonLabel: 'Use selected customer account',
    targetType: 'customer_accounts',
    matchColumn: 'proposed_account_id'
  },
  fixedAccounts: {
    kind: 'fixed-account',
    inputName: 'fixed_account_id',
    label: 'fixed account',
    buttonLabel: 'Use selected fixed account',
    targetType: 'fixed_accounts',
    matchColumn: 'proposed_fixed_account_id'
  },
  services: {
    kind: 'fixed-service',
    inputName: 'fixed_service_id',
    label: 'fixed service',
    buttonLabel: 'Use selected fixed service',
    targetType: 'fixed_services',
    matchColumn: 'proposed_fixed_service_id'
  }
});

class ConflictReviewValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictReviewValidationError';
  }
}

function parseCandidateJson(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : (value || {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new ConflictReviewValidationError('Stored match candidates are invalid. Run Process Monthly Import again.');
  }
}

function idsFor(candidates, key) {
  return [...new Set((Array.isArray(candidates[key]) ? candidates[key] : [])
    .map(item => Number(item?.id))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
}

function normaliseAccount(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normaliseIdentifier(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function normaliseMac(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-F0-9]/g, '');
}

function mobileMatchEvidence(client, canonicalPhone) {
  const canonical = normaliseSouthAfricanMobile(canonicalPhone);
  if (!canonical) return [];
  return MOBILE_PHONE_FIELDS
    .filter(field => normaliseSouthAfricanMobile(client[field]) === canonical)
    .map(field => ({ field, label: FIELD_LABELS[field] }));
}

function accountMatchEvidence(account, importedAccountNumber) {
  const imported = normaliseAccount(importedAccountNumber);
  if (!imported) return [];
  const current = normaliseAccount(account.account_number_normalised || account.account_number);
  return current === imported ? [{ field: 'account_number', label: FIELD_LABELS.account_number }] : [];
}

function fixedServiceMatchEvidence(service, imported) {
  const evidence = [];
  if (normaliseIdentifier(imported.order_number) && normaliseIdentifier(imported.order_number) === normaliseIdentifier(service.order_number)) {
    evidence.push({ field: 'order_number', label: FIELD_LABELS.order_number });
  }
  if (normaliseIdentifier(imported.solution_id) && normaliseIdentifier(imported.solution_id) === normaliseIdentifier(service.solution_id)) {
    evidence.push({ field: 'solution_id', label: FIELD_LABELS.solution_id });
  }
  if (normaliseMac(imported.mac_address) && normaliseMac(imported.mac_address) === normaliseMac(service.mac_address_normalised || service.mac_address)) {
    evidence.push({ field: 'mac_address', label: FIELD_LABELS.mac_address });
  }
  if (normaliseIdentifier(imported.sim_number) && normaliseIdentifier(imported.sim_number) === normaliseIdentifier(service.sim_number)) {
    evidence.push({ field: 'sim_number', label: FIELD_LABELS.sim_number });
  }
  return evidence;
}

function selectionKeyFor(row, candidates) {
  if (row.classification !== 'conflict') return null;
  if (row.match_domain === 'mobile') return 'clients';
  if (idsFor(candidates, 'services').length > 1) return 'services';
  if (idsFor(candidates, 'accounts').length > 1) return 'accounts';
  if (idsFor(candidates, 'fixedAccounts').length > 1) return 'fixedAccounts';
  return null;
}

function selectionFor(row, candidates, hydratedByKey) {
  const key = selectionKeyFor(row, candidates);
  if (!key) return null;
  const spec = SELECTION_TYPES[key];
  const allowedIds = idsFor(candidates, key);
  const hydrated = allowedIds.map(id => hydratedByKey[key].get(id)).filter(Boolean);
  return {
    ...spec,
    key,
    allowedIds,
    candidateCount: allowedIds.length,
    candidates: hydrated
  };
}

function placeholders(ids) {
  return ids.map(() => '?').join(',');
}

async function queryIds(connection, sql, ids) {
  if (!ids.length) return [];
  const [rows] = await connection.execute(sql.replace(':candidateIds', placeholders(ids)), ids);
  return rows;
}

function uniqueIds(rows, key) {
  return [...new Set(rows.flatMap(row => idsFor(parseCandidateJson(row.candidate_json), key)))];
}

function candidateSummary(kind, row, evidence) {
  if (kind === 'clients') {
    return {
      id: Number(row.id),
      kind: 'client',
      title: row.client_name || `Client #${row.id}`,
      subtitle: `Client #${row.id}`,
      contacts: [
        row.cell_number && `Cell ${row.cell_number}`,
        row.main_contact_number && `Main ${row.main_contact_number}`,
        row.alt_number && `Alternate ${row.alt_number}`,
        row.email
      ].filter(Boolean),
      facts: [
        row.account_number && `Account ${row.account_number}`,
        row.city_town && `Town ${row.city_town}`,
        row.handset && `Handset ${row.handset}`,
        row.upgrade_date && `Upgrade ${String(row.upgrade_date).slice(0, 10)}`,
        row.assigned_staff_name && `Assigned to ${row.assigned_staff_name}`
      ].filter(Boolean),
      evidence,
      openPath: `/customers/${Number(row.id)}/360`,
      live: row
    };
  }
  if (kind === 'accounts') {
    const openPath = row.representative_client_id
      ? `/customers/${Number(row.representative_client_id)}/360`
      : (row.representative_fixed_account_id
          ? `/fixed/accounts/${Number(row.representative_fixed_account_id)}`
          : `/clients/assignment-centre?q=${encodeURIComponent(row.account_number || row.display_name || '')}`);
    return {
      id: Number(row.id),
      kind: 'customer-account',
      title: row.display_name || row.account_number,
      subtitle: `Customer account #${row.id}`,
      contacts: [row.account_number && `Account ${row.account_number}`].filter(Boolean),
      facts: [
        row.account_status && `Status ${row.account_status}`,
        row.assigned_staff_name && `Assigned to ${row.assigned_staff_name}`,
        `${Number(row.mobile_line_count || 0)} mobile line(s)`,
        `${Number(row.fixed_account_count || 0)} fixed account(s)`
      ],
      evidence,
      openPath,
      live: row
    };
  }
  if (kind === 'fixedAccounts') {
    return {
      id: Number(row.id),
      kind: 'fixed-account',
      title: row.customer_name || row.account_number,
      subtitle: `Fixed account #${row.id}`,
      contacts: [
        row.contact_number && `Contact ${row.contact_number}`,
        row.email
      ].filter(Boolean),
      facts: [
        row.account_number && `Account ${row.account_number}`,
        row.account_status && `Status ${row.account_status}`,
        row.assigned_staff_name && `Assigned to ${row.assigned_staff_name}`,
        `${Number(row.service_count || 0)} service(s)`
      ],
      evidence,
      openPath: `/fixed/accounts/${Number(row.id)}`,
      live: row
    };
  }
  return {
    id: Number(row.id),
    kind: 'fixed-service',
    title: row.service_title || row.branch_name || `Fixed service #${row.id}`,
    subtitle: `Fixed service #${row.id}`,
    contacts: [
      row.order_number && `Order ${row.order_number}`,
      row.solution_id && `Solution ${row.solution_id}`,
      row.sim_number && `SIM ${row.sim_number}`,
      row.mac_address && `MAC ${row.mac_address}`
    ].filter(Boolean),
    facts: [
      row.account_number && `Account ${row.account_number}`,
      row.branch_name && `Branch ${row.branch_name}`,
      row.package_name && `Package ${row.package_name}`,
      row.router_model && `Router ${row.router_model}`,
      row.service_status && `Status ${row.service_status}`,
      row.assigned_staff_name && `Assigned to ${row.assigned_staff_name}`
    ].filter(Boolean),
    evidence,
    openPath: `/fixed/accounts/${Number(row.fixed_account_id)}`,
    openHash: `service-${Number(row.id)}`,
    live: row
  };
}

async function hydrateConflictCandidates(connection, rows) {
  const clientIds = uniqueIds(rows, 'clients');
  const accountIds = uniqueIds(rows, 'accounts');
  const fixedAccountIds = uniqueIds(rows, 'fixedAccounts');
  const serviceIds = uniqueIds(rows, 'services');

  const [clients, accounts, fixedAccounts, services] = await Promise.all([
    queryIds(connection, `
      SELECT c.id,c.client_name,c.cell_number,c.cell_number_normalised,
        c.main_contact_number,c.main_contact_number_normalised,c.alt_number,c.email,
        COALESCE(ca.account_number,c.account_number) account_number,c.city_town,c.handset,
        COALESCE(c.next_upgrade_date,c.upgrade_date) upgrade_date,
        COALESCE((SELECT su.full_name
          FROM client_assignments cla
          JOIN staff_users su ON su.id=cla.assigned_staff_id
          WHERE cla.client_id=c.id AND cla.is_active=1
          ORDER BY cla.updated_at DESC,cla.id DESC LIMIT 1),account_staff.full_name) assigned_staff_name
      FROM clients c
      LEFT JOIN customer_accounts ca ON ca.id=c.account_id
      LEFT JOIN staff_users account_staff ON account_staff.id=ca.assigned_staff_id
      WHERE c.id IN (:candidateIds)
    `, clientIds),
    queryIds(connection, `
      SELECT ca.id,ca.account_number,ca.account_number_normalised,ca.display_name,ca.account_status,
        su.full_name assigned_staff_name,
        (SELECT COUNT(*) FROM clients c WHERE c.account_id=ca.id) mobile_line_count,
        (SELECT COUNT(*) FROM fixed_accounts fa WHERE fa.account_id=ca.id) fixed_account_count,
        (SELECT MIN(c.id) FROM clients c WHERE c.account_id=ca.id) representative_client_id,
        (SELECT MIN(fa.id) FROM fixed_accounts fa WHERE fa.account_id=ca.id) representative_fixed_account_id
      FROM customer_accounts ca
      LEFT JOIN staff_users su ON su.id=ca.assigned_staff_id
      WHERE ca.id IN (:candidateIds)
    `, accountIds),
    queryIds(connection, `
      SELECT fa.id,fa.account_id,fa.account_number,fa.account_number_normalised,fa.customer_name,
        fa.contact_name,fa.contact_number,fa.contact_number_normalised,fa.email,fa.account_status,
        su.full_name assigned_staff_name,
        (SELECT COUNT(*) FROM fixed_services fs WHERE fs.fixed_account_id=fa.id) service_count
      FROM fixed_accounts fa
      LEFT JOIN staff_users su ON su.id=fa.assigned_staff_id
      WHERE fa.id IN (:candidateIds)
    `, fixedAccountIds),
    queryIds(connection, `
      SELECT fs.id,fs.fixed_account_id,fs.service_title,fs.branch_name,fs.order_number,
        fs.router_model,fs.mac_address,fs.mac_address_normalised,fs.solution_id,fs.sim_number,
        fs.package_name,fs.activation_date,fs.service_status,
        fa.account_number,fa.customer_name,su.full_name assigned_staff_name
      FROM fixed_services fs
      JOIN fixed_accounts fa ON fa.id=fs.fixed_account_id
      LEFT JOIN staff_users su ON su.id=fa.assigned_staff_id
      WHERE fs.id IN (:candidateIds)
    `, serviceIds)
  ]);

  const rawMaps = {
    clients: new Map(clients.map(row => [Number(row.id), row])),
    accounts: new Map(accounts.map(row => [Number(row.id), row])),
    fixedAccounts: new Map(fixedAccounts.map(row => [Number(row.id), row])),
    services: new Map(services.map(row => [Number(row.id), row]))
  };

  return rows.map(row => {
    const stored = parseCandidateJson(row.candidate_json);
    const canonicalPhone = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);
    const hydratedByKey = {
      clients: new Map([...rawMaps.clients].map(([id, value]) => [
        id,
        candidateSummary('clients', value, mobileMatchEvidence(value, canonicalPhone))
      ])),
      accounts: new Map([...rawMaps.accounts].map(([id, value]) => [
        id,
        candidateSummary('accounts', value, accountMatchEvidence(value, row.account_number))
      ])),
      fixedAccounts: new Map([...rawMaps.fixedAccounts].map(([id, value]) => [
        id,
        candidateSummary('fixedAccounts', value, accountMatchEvidence(value, row.account_number))
      ])),
      services: new Map([...rawMaps.services].map(([id, value]) => [
        id,
        candidateSummary('services', value, fixedServiceMatchEvidence(value, row))
      ]))
    };
    return {
      ...row,
      imported_canonical_phone: canonicalPhone || null,
      selection: selectionFor(row, stored, hydratedByKey)
    };
  });
}

function selectedIdFromBody(selection, body) {
  if (!selection) return null;
  const selectedId = Number(body?.[selection.inputName]);
  return Number.isSafeInteger(selectedId) && selectedId > 0 ? selectedId : null;
}

function requireValidSelection(selection, body) {
  if (!selection) {
    throw new ConflictReviewValidationError('This conflict has no valid candidate set. Run Process Monthly Import again.');
  }
  const selectedId = selectedIdFromBody(selection, body);
  if (!selectedId) {
    throw new ConflictReviewValidationError(
      `Select one of the ${selection.candidateCount} ${selection.label} records before approving.`
    );
  }
  if (!selection.allowedIds.includes(selectedId)) {
    throw new ConflictReviewValidationError('The selected candidate is not valid for this imported row.');
  }
  if (
    selection.candidates.length !== selection.candidateCount
    || selection.candidates.some(item => !item.evidence.length)
  ) {
    throw new ConflictReviewValidationError('This conflict has become stale. Run Process Monthly Import again.');
  }
  const candidate = selection.candidates.find(item => item.id === selectedId);
  if (!candidate) {
    throw new ConflictReviewValidationError('The selected candidate no longer exists. Run Process Monthly Import again.');
  }
  if (!candidate.evidence.length) {
    throw new ConflictReviewValidationError('The selected candidate no longer matches the imported row. Run Process Monthly Import again.');
  }
  return candidate;
}

module.exports = {
  ConflictReviewValidationError,
  parseCandidateJson,
  idsFor,
  mobileMatchEvidence,
  accountMatchEvidence,
  fixedServiceMatchEvidence,
  selectionKeyFor,
  hydrateConflictCandidates,
  selectedIdFromBody,
  requireValidSelection,
  SELECTION_TYPES
};
