'use strict';

const db = require('../config/db');

const MAX_PENDING_REQUESTS = 5000;
const MAX_IDENTIFIERS = 10000;
const PAGE_SIZES = new Set([25, 50, 100]);
const CLASSIFICATIONS = Object.freeze([
  { key: 'safe_to_apply', label: 'Safe to apply' },
  { key: 'already_correct', label: 'Already correct' },
  { key: 'ownership_conflict', label: 'Ownership conflict' },
  { key: 'exception', label: 'Exception' }
]);
const CLASSIFICATION_LABELS = new Map(CLASSIFICATIONS.map(item => [item.key, item.label]));

function clean(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normaliseAccount(value) {
  return clean(value, 120).replace(/\s+/g, '').toUpperCase();
}

function parseProposal(value) {
  try {
    const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Proposal is not an object.');
    return { proposal: parsed, error: null };
  } catch (_) {
    return { proposal: {}, error: 'Malformed proposal data.' };
  }
}

function unique(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))];
}

function bounded(values, label) {
  const result = unique(values);
  if (result.length > MAX_IDENTIFIERS) throw new Error(`${label} exceeds the safe report limit.`);
  return result;
}

function inClause(values) {
  return values.map(() => '?').join(',');
}

function requestIdentifiers(request) {
  const parsed = parseProposal(request.proposed_data_json);
  const proposal = parsed.proposal;
  const clientIds = [request.client_id, proposal.client_id];
  if (request.request_type === 'claim_client') clientIds.push(request.record_id);
  if (Array.isArray(proposal.linked_client_ids)) clientIds.push(...proposal.linked_client_ids);
  const accountIds = [proposal.account_id];
  if (request.request_type === 'claim_account') accountIds.push(request.record_id);
  const accountNumbers = [request.account_number, proposal.account_number];
  return {
    parsed,
    clientIds: unique(clientIds.map(positiveId)),
    accountIds: unique(accountIds.map(positiveId)),
    accountNumbers: unique(accountNumbers.map(normaliseAccount))
  };
}

class UnionFind {
  constructor() { this.parents = new Map(); }
  add(value) { if (value && !this.parents.has(value)) this.parents.set(value, value); }
  find(value) {
    this.add(value);
    const parent = this.parents.get(value);
    if (parent !== value) this.parents.set(value, this.find(parent));
    return this.parents.get(value);
  }
  union(left, right) {
    if (!left || !right) return;
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents.set(rightRoot, leftRoot);
  }
  unionAll(values) {
    const tokens = unique(values);
    if (!tokens.length) return;
    tokens.forEach(token => this.add(token));
    for (let index = 1; index < tokens.length; index += 1) this.union(tokens[0], tokens[index]);
  }
}

function clientTokens(client) {
  return unique([
    positiveId(client.id) ? `client:${positiveId(client.id)}` : null,
    positiveId(client.account_id) ? `account-id:${positiveId(client.account_id)}` : null,
    normaliseAccount(client.account_number) ? `account-number:${normaliseAccount(client.account_number)}` : null
  ]);
}

function accountTokens(account) {
  return unique([
    positiveId(account.id) ? `account-id:${positiveId(account.id)}` : null,
    normaliseAccount(account.account_number_normalised || account.account_number)
      ? `account-number:${normaliseAccount(account.account_number_normalised || account.account_number)}` : null
  ]);
}

function fixedTokens(account) {
  return unique([
    positiveId(account.account_id) ? `account-id:${positiveId(account.account_id)}` : null,
    positiveId(account.linked_client_id) ? `client:${positiveId(account.linked_client_id)}` : null,
    normaliseAccount(account.account_number_normalised || account.account_number)
      ? `account-number:${normaliseAccount(account.account_number_normalised || account.account_number)}` : null,
    normaliseAccount(account.linked_mobile_account_number)
      ? `account-number:${normaliseAccount(account.linked_mobile_account_number)}` : null
  ]);
}

function assignmentTokens(assignment) {
  return unique([
    positiveId(assignment.client_id) ? `client:${positiveId(assignment.client_id)}` : null,
    normaliseAccount(assignment.account_number)
      ? `account-number:${normaliseAccount(assignment.account_number)}` : null
  ]);
}

function tokensForRequest(request) {
  const identifiers = requestIdentifiers(request);
  return unique([
    ...identifiers.clientIds.map(id => `client:${id}`),
    ...identifiers.accountIds.map(id => `account-id:${id}`),
    ...identifiers.accountNumbers.map(number => `account-number:${number}`)
  ]);
}

function primaryClientIds(request) {
  const identifiers = requestIdentifiers(request);
  const proposal = identifiers.parsed.proposal;
  return unique([
    positiveId(request.client_id),
    positiveId(proposal.client_id),
    request.request_type === 'claim_client' ? positiveId(request.record_id) : null
  ]);
}

function rootForTokens(unionFind, tokens, fallback) {
  return tokens.length ? unionFind.find(tokens[0]) : fallback;
}

function associationRoot(unionFind, tokens) {
  return tokens.length ? unionFind.find(tokens[0]) : null;
}

function decorateClassification(scope, classification, reason) {
  return {
    ...scope,
    classification,
    classificationLabel: CLASSIFICATION_LABELS.get(classification),
    reason
  };
}

function classifyScope(scope) {
  const structuralProblems = [];
  const requests = scope.requests;
  const activeClients = scope.clients.filter(client => Number(client.is_active) === 1);
  const clientById = new Map(scope.clients.map(client => [Number(client.id), client]));
  const claimantIds = unique(requests.map(request => positiveId(request.requested_by)));
  const activeClaimantIds = unique(requests
    .filter(request => Number(request.claimant_is_active) === 1)
    .map(request => positiveId(request.requested_by)));

  for (const request of requests) {
    const identifiers = requestIdentifiers(request);
    if (identifiers.parsed.error) structuralProblems.push(`Request #${request.id} has malformed proposal data.`);
    if (!positiveId(request.requested_by) || !request.claimant_name || Number(request.claimant_is_active) !== 1) {
      structuralProblems.push(`Request #${request.id} has a missing or inactive claimant.`);
    }
    const proposedClaimant = positiveId(identifiers.parsed.proposal.assigned_staff_id
      || identifiers.parsed.proposal.claimant_id);
    if (proposedClaimant && proposedClaimant !== positiveId(request.requested_by)) {
      structuralProblems.push(`Request #${request.id} names a different claimant in its proposal.`);
    }
    const directClientIds = primaryClientIds(request);
    if (!directClientIds.length && request.request_type === 'claim_client') {
      structuralProblems.push(`Request #${request.id} does not identify a client.`);
    }
    for (const clientId of directClientIds) {
      const client = clientById.get(clientId);
      if (!client || Number(client.is_active) !== 1) {
        structuralProblems.push(`Requested client #${clientId} is missing or inactive.`);
      }
    }
  }

  if (!activeClients.length) structuralProblems.push('No active client or line exists in this scope.');
  const accountIds = unique([
    ...activeClients.map(client => positiveId(client.account_id)),
    ...scope.accounts.map(account => positiveId(account.id))
  ]);
  const accountNumbers = unique([
    ...activeClients.map(client => normaliseAccount(client.account_number)),
    ...scope.accounts.map(account => normaliseAccount(account.account_number_normalised || account.account_number)),
    ...requests.flatMap(request => requestIdentifiers(request).accountNumbers)
  ]);
  if (accountIds.length > 1) structuralProblems.push('Linked records contain inconsistent account IDs.');
  if (accountNumbers.length > 1) structuralProblems.push('Linked records contain inconsistent account numbers.');
  if (scope.accounts.length > 1) structuralProblems.push('More than one canonical customer account matches this scope.');
  if (scope.accounts.some(account => ['inactive', 'cancelled'].includes(String(account.account_status || '').toLowerCase()))) {
    structuralProblems.push('The canonical customer account is not active.');
  }
  if (!accountIds.length && !accountNumbers.length) {
    structuralProblems.push('No reliable account grouping identifier exists for this scope.');
  }
  const evidence = [];
  const assignmentRows = [];
  for (const assignment of scope.assignments) {
    if (!positiveId(assignment.assigned_staff_id)) continue;
    assignmentRows.push({
      staffId: Number(assignment.assigned_staff_id),
      staffName: assignment.assigned_staff_name || `Staff #${assignment.assigned_staff_id}`,
      staffActive: Number(assignment.assignee_is_active) === 1,
      source: `Client #${assignment.client_id}`,
      clientId: Number(assignment.client_id)
    });
  }
  for (const account of scope.accounts) {
    if (!positiveId(account.assigned_staff_id)) continue;
    assignmentRows.push({
      staffId: Number(account.assigned_staff_id),
      staffName: account.assigned_staff_name || `Staff #${account.assigned_staff_id}`,
      staffActive: Number(account.assignee_is_active) === 1,
      source: `Customer account #${account.id}`,
      accountWide: true
    });
  }
  for (const account of scope.fixedAccounts) {
    if (!positiveId(account.assigned_staff_id)
        || ['inactive', 'cancelled'].includes(String(account.account_status || '').toLowerCase())) continue;
    assignmentRows.push({
      staffId: Number(account.assigned_staff_id),
      staffName: account.assigned_staff_name || `Staff #${account.assigned_staff_id}`,
      staffActive: Number(account.assignee_is_active) === 1,
      source: `Fixed account #${account.id}`
    });
  }
  for (const assignment of assignmentRows) {
    evidence.push(`${assignment.source}: ${assignment.staffName}`);
    if (!assignment.staffActive) structuralProblems.push(`${assignment.source} is assigned to missing or inactive staff.`);
  }

  const currentAssigneeIds = unique(assignmentRows.map(row => row.staffId));
  if (structuralProblems.length) {
    return decorateClassification({ ...scope, evidence }, 'exception', unique(structuralProblems).join(' '));
  }
  if (activeClaimantIds.length > 1) {
    return decorateClassification({ ...scope, evidence }, 'ownership_conflict',
      'Different active staff members submitted pending claims for the same customer/account scope.');
  }
  if (currentAssigneeIds.length > 1) {
    return decorateClassification({ ...scope, evidence }, 'ownership_conflict',
      'Linked trusted records have different current assignees.');
  }
  const claimantId = activeClaimantIds[0] || claimantIds[0];
  if (currentAssigneeIds.length === 1 && currentAssigneeIds[0] !== claimantId) {
    return decorateClassification({ ...scope, evidence }, 'ownership_conflict',
      'This scope is currently assigned to a different active staff member.');
  }
  if (!currentAssigneeIds.length) {
    return decorateClassification({ ...scope, evidence }, 'safe_to_apply',
      'The active scope has one active claimant and no trusted current assignee.');
  }

  const accountWideCorrect = assignmentRows.some(row => row.accountWide && row.staffId === claimantId);
  const assignedClientIds = new Set(assignmentRows
    .filter(row => row.clientId && row.staffId === claimantId)
    .map(row => row.clientId));
  const allClientsCorrect = activeClients.every(client => assignedClientIds.has(Number(client.id)));
  if (accountWideCorrect || allClientsCorrect) {
    return decorateClassification({ ...scope, evidence }, 'already_correct',
      'The full active scope is already assigned to the legacy claimant with no contradictory assignment.');
  }
  return decorateClassification({ ...scope, evidence }, 'exception',
    'Assignment coverage is incomplete, so the scope cannot be interpreted safely.');
}

function classifyLegacyClaimData(data) {
  const requests = (data.requests || []).map(request => ({ ...request }));
  const clients = data.clients || [];
  const accounts = data.accounts || [];
  const assignments = data.assignments || [];
  const fixedAccounts = data.fixedAccounts || [];
  const unionFind = new UnionFind();

  for (const client of clients) unionFind.unionAll(clientTokens(client));
  for (const account of accounts) unionFind.unionAll(accountTokens(account));
  for (const account of fixedAccounts) unionFind.unionAll(fixedTokens(account));
  for (const assignment of assignments) unionFind.unionAll(assignmentTokens(assignment));
  for (const request of requests) unionFind.unionAll(tokensForRequest(request));

  const groups = new Map();
  for (const request of requests) {
    const tokens = tokensForRequest(request);
    const root = rootForTokens(unionFind, tokens, `request:${request.id}`);
    if (!groups.has(root)) groups.set(root, { root, requests: [], clients: [], accounts: [], assignments: [], fixedAccounts: [] });
    groups.get(root).requests.push(request);
  }
  const addAssociated = (rows, tokenBuilder, key) => {
    for (const row of rows) {
      const root = associationRoot(unionFind, tokenBuilder(row));
      if (root && groups.has(root)) groups.get(root)[key].push(row);
    }
  };
  addAssociated(clients, clientTokens, 'clients');
  addAssociated(accounts, accountTokens, 'accounts');
  addAssociated(assignments, assignmentTokens, 'assignments');
  addAssociated(fixedAccounts, fixedTokens, 'fixedAccounts');

  return [...groups.values()].map(group => {
    const classified = classifyScope(group);
    const activeClients = group.clients.filter(client => Number(client.is_active) === 1);
    const mainClient = activeClients[0] || group.clients[0] || null;
    const account = group.accounts[0] || null;
    const accountNumber = account?.account_number
      || activeClients.map(client => clean(client.account_number, 120)).find(Boolean)
      || group.requests.map(request => clean(request.account_number, 120)).find(Boolean)
      || null;
    const accountId = positiveId(account?.id)
      || activeClients.map(client => positiveId(client.account_id)).find(Boolean)
      || null;
    const claimantEntries = unique(group.requests.map(request => `${request.requested_by}:${request.claimant_name || `Staff #${request.requested_by}`}`))
      .map(value => ({ id: Number(value.split(':')[0]), name: value.slice(value.indexOf(':') + 1) }));
    const currentEntries = unique([
      ...group.assignments.filter(row => row.assigned_staff_id).map(row => `${row.assigned_staff_id}:${row.assigned_staff_name || `Staff #${row.assigned_staff_id}`}`),
      ...group.accounts.filter(row => row.assigned_staff_id).map(row => `${row.assigned_staff_id}:${row.assigned_staff_name || `Staff #${row.assigned_staff_id}`}`),
      ...group.fixedAccounts
        .filter(row => row.assigned_staff_id
          && !['inactive', 'cancelled'].includes(String(row.account_status || '').toLowerCase()))
        .map(row => `${row.assigned_staff_id}:${row.assigned_staff_name || `Staff #${row.assigned_staff_id}`}`)
    ]).map(value => ({ id: Number(value.split(':')[0]), name: value.slice(value.indexOf(':') + 1) }));
    return {
      ...classified,
      accountNumber,
      accountId,
      customerName: account?.display_name || mainClient?.client_name
        || group.fixedAccounts[0]?.customer_name || 'Unknown customer',
      linkedActiveClientCount: activeClients.length,
      clientIds: group.clients.map(client => Number(client.id)).sort((a, b) => a - b),
      clientNames: unique(group.clients.map(client => clean(client.client_name)).filter(Boolean)),
      mainClientId: positiveId(mainClient?.id),
      requestIds: group.requests.map(request => Number(request.id)).sort((a, b) => a - b),
      requestCount: group.requests.length,
      claimants: claimantEntries,
      claimTimestamps: group.requests.map(request => request.created_at).filter(Boolean),
      currentAssignees: currentEntries
    };
  }).sort((left, right) => {
    const order = ['exception', 'ownership_conflict', 'safe_to_apply', 'already_correct'];
    return order.indexOf(left.classification) - order.indexOf(right.classification)
      || String(left.accountNumber || left.customerName).localeCompare(String(right.accountNumber || right.customerName));
  });
}

function filtersFrom(input = {}) {
  const classification = clean(input.classification, 40);
  const claimant = clean(input.claimant, 40);
  const currentAssignee = clean(input.current_assignee, 40);
  const pageSize = Number(input.page_size);
  return {
    classification: CLASSIFICATION_LABELS.has(classification) ? classification : '',
    claimant: /^\d+$/.test(claimant) ? Number(claimant) : '',
    current_assignee: currentAssignee === 'unassigned' ? 'unassigned'
      : /^\d+$/.test(currentAssignee) ? Number(currentAssignee) : '',
    search: clean(input.search, 200),
    page: Math.max(1, Number(input.page) || 1),
    page_size: PAGE_SIZES.has(pageSize) ? pageSize : 25
  };
}

function filterScopes(scopes, filters) {
  const search = filters.search.toLowerCase();
  return scopes.filter(scope => {
    if (filters.classification && scope.classification !== filters.classification) return false;
    if (filters.claimant && !scope.claimants.some(claimant => claimant.id === filters.claimant)) return false;
    if (filters.current_assignee === 'unassigned' && scope.currentAssignees.length) return false;
    if (Number.isInteger(filters.current_assignee)
        && !scope.currentAssignees.some(assignee => assignee.id === filters.current_assignee)) return false;
    if (search) {
      const haystack = [scope.accountNumber, scope.accountId, scope.customerName,
        ...scope.clientIds, ...scope.clientNames].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function summaryFor(scopes, totalPendingClaims) {
  const summary = {
    totalPendingClaims: Number(totalPendingClaims || 0),
    uniqueScopes: scopes.length,
    safe_to_apply: 0,
    already_correct: 0,
    ownership_conflict: 0,
    exception: 0
  };
  for (const scope of scopes) summary[scope.classification] += 1;
  return summary;
}

function optionsFor(scopes) {
  const claimantMap = new Map();
  const assigneeMap = new Map();
  for (const scope of scopes) {
    scope.claimants.forEach(item => claimantMap.set(item.id, item.name));
    scope.currentAssignees.forEach(item => assigneeMap.set(item.id, item.name));
  }
  const sort = ([, left], [, right]) => left.localeCompare(right);
  return {
    claimants: [...claimantMap.entries()].sort(sort).map(([id, name]) => ({ id, name })),
    currentAssignees: [...assigneeMap.entries()].sort(sort).map(([id, name]) => ({ id, name }))
  };
}

function addLinks(scope, basePath, panelMode) {
  const panel = panelMode ? '&panel=1' : '';
  const panelStart = panelMode ? '?panel=1' : '';
  const requestSearch = scope.requestIds[0] || '';
  return {
    ...scope,
    customerUrl: scope.mainClientId ? `${basePath}/customers/${scope.mainClientId}/360${panelStart}` : null,
    approvalHistoryUrl: `${basePath}/approvals?tab=history&q=${encodeURIComponent(requestSearch)}${panel}`,
    assignmentCentreUrl: `${basePath}/clients/assignment-centre?view=all&q=${encodeURIComponent(scope.accountNumber || scope.customerName || '')}${panel}`
  };
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

async function loadLegacyData(connection = db) {
  const [[count]] = await connection.query(`SELECT COUNT(*) total
    FROM data_change_requests
    WHERE request_type IN ('claim_client','claim_account')
      AND status IN ('pending_manager','pending_owner')`);
  const total = Number(count?.total || 0);
  if (total > MAX_PENDING_REQUESTS) {
    throw new Error(`The report found ${total} pending legacy claims, above the safe limit of ${MAX_PENDING_REQUESTS}.`);
  }
  const requests = await queryRows(connection, `SELECT r.id,r.request_type,r.record_id,r.client_id,r.account_number,
      r.proposed_data_json,r.requested_by,r.created_at,r.status,
      claimant.full_name claimant_name,claimant.is_active claimant_is_active,claimant.role claimant_role
    FROM data_change_requests r
    LEFT JOIN staff_users claimant ON claimant.id=r.requested_by
    WHERE r.request_type IN ('claim_client','claim_account')
      AND r.status IN ('pending_manager','pending_owner')
    ORDER BY r.created_at,r.id LIMIT ${MAX_PENDING_REQUESTS + 1}`);
  if (requests.length > MAX_PENDING_REQUESTS) {
    throw new Error(`The report found more than ${MAX_PENDING_REQUESTS} pending legacy claims, above the safe report limit.`);
  }
  if (!requests.length) return { total, requests: [], clients: [], accounts: [], assignments: [], fixedAccounts: [] };

  const identifiers = requests.map(requestIdentifiers);
  const seedClientIds = bounded(identifiers.flatMap(item => item.clientIds), 'Client identifiers');
  let seedClients = [];
  if (seedClientIds.length) {
    seedClients = await queryRows(connection, `SELECT id,account_id,account_number,client_name,is_active,lifecycle_status,line_status
      FROM clients WHERE id IN (${inClause(seedClientIds)})`, seedClientIds);
  }
  const accountIds = bounded([
    ...identifiers.flatMap(item => item.accountIds),
    ...seedClients.map(client => positiveId(client.account_id))
  ], 'Account identifiers');
  const accountNumbers = bounded([
    ...identifiers.flatMap(item => item.accountNumbers),
    ...seedClients.map(client => normaliseAccount(client.account_number))
  ], 'Account numbers');
  const clientClauses = [];
  const clientParams = [];
  if (seedClientIds.length) { clientClauses.push(`id IN (${inClause(seedClientIds)})`); clientParams.push(...seedClientIds); }
  if (accountIds.length) { clientClauses.push(`account_id IN (${inClause(accountIds)})`); clientParams.push(...accountIds); }
  if (accountNumbers.length) {
    clientClauses.push(`UPPER(REPLACE(TRIM(COALESCE(account_number,'')),' ','')) IN (${inClause(accountNumbers)})`);
    clientParams.push(...accountNumbers);
  }
  const clients = clientClauses.length ? await queryRows(connection, `SELECT id,account_id,account_number,client_name,
      is_active,lifecycle_status,line_status FROM clients WHERE ${clientClauses.join(' OR ')} ORDER BY id`, clientParams) : [];
  const scopeClientIds = bounded(clients.map(client => positiveId(client.id)), 'Scope client identifiers');
  const scopeAccountIds = bounded([...accountIds, ...clients.map(client => positiveId(client.account_id))], 'Scope account identifiers');
  const scopeAccountNumbers = bounded([...accountNumbers, ...clients.map(client => normaliseAccount(client.account_number))], 'Scope account numbers');

  const accountClauses = [];
  const accountParams = [];
  if (scopeAccountIds.length) { accountClauses.push(`a.id IN (${inClause(scopeAccountIds)})`); accountParams.push(...scopeAccountIds); }
  if (scopeAccountNumbers.length) {
    accountClauses.push(`a.account_number_normalised IN (${inClause(scopeAccountNumbers)})`);
    accountParams.push(...scopeAccountNumbers);
  }
  const assignmentClauses = [];
  const assignmentParams = [];
  if (scopeClientIds.length) { assignmentClauses.push(`ca.client_id IN (${inClause(scopeClientIds)})`); assignmentParams.push(...scopeClientIds); }
  if (scopeAccountNumbers.length) {
    assignmentClauses.push(`UPPER(REPLACE(TRIM(COALESCE(ca.account_number,'')),' ','')) IN (${inClause(scopeAccountNumbers)})`);
    assignmentParams.push(...scopeAccountNumbers);
  }
  const fixedClauses = [];
  const fixedParams = [];
  if (scopeAccountIds.length) { fixedClauses.push(`fa.account_id IN (${inClause(scopeAccountIds)})`); fixedParams.push(...scopeAccountIds); }
  if (scopeClientIds.length) { fixedClauses.push(`fa.linked_client_id IN (${inClause(scopeClientIds)})`); fixedParams.push(...scopeClientIds); }
  if (scopeAccountNumbers.length) {
    fixedClauses.push(`fa.account_number_normalised IN (${inClause(scopeAccountNumbers)})
      OR UPPER(REPLACE(TRIM(COALESCE(fa.linked_mobile_account_number,'')),' ','')) IN (${inClause(scopeAccountNumbers)})`);
    fixedParams.push(...scopeAccountNumbers, ...scopeAccountNumbers);
  }

  const [accounts, assignments, fixedAccounts] = await Promise.all([
    accountClauses.length ? queryRows(connection, `SELECT a.id,a.account_number,a.account_number_normalised,
        a.display_name,a.account_status,a.assigned_staff_id,a.assignment_confirmed_at,
        assignee.full_name assigned_staff_name,assignee.is_active assignee_is_active
      FROM customer_accounts a LEFT JOIN staff_users assignee ON assignee.id=a.assigned_staff_id
      WHERE ${accountClauses.join(' OR ')} ORDER BY a.id`, accountParams) : [],
    assignmentClauses.length ? queryRows(connection, `SELECT ca.id,ca.client_id,ca.account_number,ca.assigned_staff_id,
        ca.assigned_at,ca.updated_at,assignee.full_name assigned_staff_name,assignee.is_active assignee_is_active
      FROM client_assignments ca LEFT JOIN staff_users assignee ON assignee.id=ca.assigned_staff_id
      WHERE ca.is_active=1 AND (${assignmentClauses.join(' OR ')}) ORDER BY ca.client_id,ca.id`, assignmentParams) : [],
    fixedClauses.length ? queryRows(connection, `SELECT fa.id,fa.account_id,fa.account_number,fa.account_number_normalised,
        fa.customer_name,fa.linked_mobile_account_number,fa.linked_client_id,fa.assigned_staff_id,fa.account_status,
        assignee.full_name assigned_staff_name,assignee.is_active assignee_is_active
      FROM fixed_accounts fa LEFT JOIN staff_users assignee ON assignee.id=fa.assigned_staff_id
      WHERE ${fixedClauses.join(' OR ')} ORDER BY fa.id`, fixedParams) : []
  ]);
  return { total, requests, clients, accounts, assignments, fixedAccounts };
}

async function loadLegacyClaimReconciliation(input = {}, options = {}) {
  const filters = filtersFrom(input);
  const data = await loadLegacyData(options.connection || db);
  const scopes = classifyLegacyClaimData(data).map(scope => addLinks(
    scope, options.basePath || '', Boolean(options.panelMode)
  ));
  const filtered = filterScopes(scopes, filters);
  const page = Math.min(filters.page, Math.max(1, Math.ceil(filtered.length / filters.page_size)));
  const rows = options.exportAll ? filtered : filtered.slice((page - 1) * filters.page_size, page * filters.page_size);
  return {
    filters: { ...filters, page },
    rows,
    summary: summaryFor(scopes, data.total),
    options: optionsFor(scopes),
    pagination: {
      total: filtered.length,
      page,
      pageSize: filters.page_size,
      pages: Math.max(1, Math.ceil(filtered.length / filters.page_size))
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
    ['Classification', row => row.classificationLabel],
    ['Reason', row => row.reason],
    ['Account number', row => row.accountNumber],
    ['Account ID', row => row.accountId],
    ['Customer / business', row => row.customerName],
    ['Linked active clients / lines', row => row.linkedActiveClientCount],
    ['Legacy request count', row => row.requestCount],
    ['Legacy request IDs', row => row.requestIds.join('; ')],
    ['Original claimants', row => row.claimants.map(item => `${item.name} (#${item.id})`).join('; ')],
    ['Original claim timestamps', row => row.claimTimestamps.join('; ')],
    ['Current assignees', row => row.currentAssignees.map(item => `${item.name} (#${item.id})`).join('; ') || 'Unassigned'],
    ['Client IDs', row => row.clientIds.join('; ')],
    ['Client names', row => row.clientNames.join('; ')],
    ['Assignment evidence', row => row.evidence.join('; ') || 'No current assignment evidence'],
    ['Customer 360', row => row.customerUrl],
    ['Approval History', row => row.approvalHistoryUrl],
    ['Assignment Centre', row => row.assignmentCentreUrl]
  ];
  return [
    columns.map(([label]) => csvCell(label)).join(','),
    ...rows.map(row => columns.map(([, getter]) => csvCell(getter(row))).join(','))
  ].join('\r\n');
}

module.exports = {
  CLASSIFICATIONS,
  MAX_PENDING_REQUESTS,
  normaliseAccount,
  parseProposal,
  requestIdentifiers,
  classifyLegacyClaimData,
  filtersFrom,
  filterScopes,
  summaryFor,
  loadLegacyData,
  loadLegacyClaimReconciliation,
  toCsv
};
