'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bulkPath = path.join(root, 'src', 'services', 'monthly-import-bulk-finaliser.js');
const finaliserPath = path.join(root, 'src', 'services', 'monthly-import-finaliser.js');
const routePath = path.join(root, 'src', 'routes', 'monthly-import-management.js');
const managementViewPath = path.join(root, 'views', 'monthly-import-management.ejs');
const previewViewPath = path.join(root, 'views', 'monthly-import-bulk-preview.ejs');
const resultsViewPath = path.join(root, 'views', 'monthly-import-bulk-results.ejs');

const {
  BULK_CHUNK_SIZE,
  classifyBulkSafety,
  buildCounts,
  finaliseBulkSafe
} = require(bulkPath);

function evidence(overrides = {}) {
  return {
    clientsByPhone: new Map(),
    accountsByNumber: new Map(),
    accountsById: new Map(),
    fixedByNumber: new Map(),
    fixedByAccountId: new Map(),
    fixedById: new Map(),
    services: [],
    servicesById: new Map(),
    importPhoneCounts: new Map(),
    importAccountCounts: new Map(),
    ...overrides
  };
}

const base = {
  action_id: 1, id: 1, match_id: 11, row_id: 101, batch_id: 7, source_row_number: 4,
  original_filename: 'dealer.xlsx', import_status: 'confirmed', classification: 'exact_match',
  review_status: 'pending', approval_status: 'pending', applied_status: 'not_applied',
  phone_original: '0820000000', phone_normalised: '27820000000', customer_name: 'Safe Customer',
  row_fingerprint: 'hash-1', action_type: 'link_mobile_client',
  target_entity_type: 'clients', target_entity_id: 10, proposed_client_id: 10
};

let result = classifyBulkSafety(base, evidence({
  clientsByPhone: new Map([['27820000000', [{ id: 10 }]]])
}));
assert(result.safe && result.category === 'existing_mobile', 'Exact unique mobile update should be bulk safe');

result = classifyBulkSafety({
  ...base, action_type: 'create_mobile_record', classification: 'new_record',
  target_entity_id: null, proposed_client_id: null
}, evidence({ importPhoneCounts: new Map([['27820000000', 1]]) }));
assert(result.safe && result.category === 'new_mobile', 'Valid unique named mobile creation should be bulk safe');

const fixedService = { id: 20, fixed_account_id: 30, source_row_hash: 'hash-1', order_number: 'SO1', solution_id: 'SOL1' };
result = classifyBulkSafety({
  ...base, action_type: 'link_fixed_service', match_domain: 'fixed',
  target_entity_type: 'fixed_services', target_entity_id: 20, proposed_fixed_service_id: 20,
  order_number: 'SO1', solution_id: 'SOL1', account_number: 'VB100'
}, evidence({ services: [fixedService], servicesById: new Map([[20, fixedService]]) }));
assert(result.safe && result.category === 'fixed', 'Exact unique fixed update should be bulk safe');

result = classifyBulkSafety({
  ...base, action_type: 'create_fixed_account_and_service', classification: 'new_record',
  match_domain: 'fixed', review_status: 'approved', approval_status: 'approved',
  target_entity_type: 'customer_accounts', target_entity_id: null, account_number: 'VB200'
}, evidence({ importAccountCounts: new Map([['VB200', 1]]) }));
assert(result.safe && result.category === 'fixed', 'Individually approved unique fixed creation should be bulk safe');

result = classifyBulkSafety({
  ...base, action_type: 'resolve_mobile_conflict', classification: 'conflict',
  review_status: 'pending', approval_status: 'pending'
}, evidence());
assert(!result.safe && result.category === 'conflict', 'Unresolved conflict must be excluded');
result = classifyBulkSafety({
  ...base, action_type: 'resolve_mobile_conflict', classification: 'conflict',
  review_status: 'approved', approval_status: 'approved', target_entity_id: 10,
  proposed_client_id: 10, candidate_json: JSON.stringify({ clients: [{ id: 10 }, { id: 11 }] })
}, evidence({ clientsByPhone: new Map([['27820000000', [{ id: 10 }, { id: 11 }]]]) }));
assert(result.safe, 'Approved resolved mobile selection should be safe while the selected target remains valid');

result = classifyBulkSafety({
  ...base, action_type: 'create_mobile_record', classification: 'new_record',
  customer_name: '', target_entity_id: null, proposed_client_id: null
}, evidence({ importPhoneCounts: new Map([['27820000000', 1]]) }));
assert(!result.safe && result.category === 'missing_information', 'Missing name must be excluded for new mobile creation');
result = classifyBulkSafety({
  ...base, action_type: 'create_mobile_record', classification: 'new_record',
  target_entity_id: null, proposed_client_id: null
}, evidence({
  clientsByPhone: new Map([['27820000000', [{ id: 88 }]]]),
  importPhoneCounts: new Map([['27820000000', 1]])
}));
assert(!result.safe && /live customer/i.test(result.reason), 'Duplicate live phone must be excluded');

result = classifyBulkSafety({
  ...base, action_type: 'create_mobile_record', classification: 'new_record',
  phone_original: 'invalid', phone_normalised: null, target_entity_id: null, proposed_client_id: null
}, evidence());
assert(!result.safe && /canonical mobile/i.test(result.reason), 'Missing or invalid canonical phone must be excluded');

result = classifyBulkSafety({
  ...base, action_type: 'create_fixed_account_and_service', classification: 'new_record',
  match_domain: 'fixed', review_status: 'approved', approval_status: 'approved', account_number: 'VB300'
}, evidence({
  accountsByNumber: new Map([['VB300', [{ id: 300 }]]]),
  importAccountCounts: new Map([['VB300', 1]])
}));
assert(!result.safe && /now exists/i.test(result.reason), 'Duplicate account number must be excluded');
result = classifyBulkSafety({
  ...base, action_type: 'create_fixed_account_and_service', classification: 'new_record',
  match_domain: 'fixed', review_status: 'pending', approval_status: 'pending', account_number: 'VB301'
}, evidence({ importAccountCounts: new Map([['VB301', 1]]) }));
assert(!result.safe && result.category === 'fixed_approval', 'Fixed creation awaiting a business decision must be excluded');

result = classifyBulkSafety(base, evidence({
  clientsByPhone: new Map([['27820000000', [{ id: 99 }]]])
}));
assert(!result.safe && /stale|multiple/i.test(result.reason), 'Stale exact mobile target must be excluded');

for (const state of ['rejected', 'deferred']) {
  result = classifyBulkSafety({ ...base, approval_status: state }, evidence());
  assert(!result.safe, `${state} row must be excluded`);
}
result = classifyBulkSafety({ ...base, applied_status: 'applied' }, evidence());
assert(!result.safe && result.category === 'completed', 'Already applied action must be skipped');
result = classifyBulkSafety({
  ...base, applied_status: 'applied', action_type: 'create_mobile_record', live_account_number: ''
}, evidence());
assert(!result.safe && result.requiredAction === 'Assign account number', 'Provisional customer must remain in the account-number exception queue');
result = classifyBulkSafety({ ...base, action_type: 'unsupported_write' }, evidence());
assert(!result.safe && /not supported/i.test(result.reason), 'Unsupported action must be excluded');
result = classifyBulkSafety({ ...base, applied_status: 'failed', error_text: 'Needs investigation' }, evidence());
assert(!result.safe && result.category === 'failed' && result.requiredAction === 'Check failed record',
  'Failed row must remain excluded for supported retry investigation');

assert.strictEqual(BULK_CHUNK_SIZE, 25, 'Bulk processing must use bounded chunks');

function fakeConnection() {
  return {
    began: 0, committed: 0, rolledBack: 0, released: 0, statements: [],
    async beginTransaction() { this.began += 1; },
    async commit() { this.committed += 1; },
    async rollback() { this.rolledBack += 1; },
    release() { this.released += 1; },
    async query(sql) { this.statements.push(sql); return [[], []]; },
    async execute(sql) { this.statements.push(sql); return [{ affectedRows: 1 }, []]; }
  };
}

function action(id, phone, extra = {}) {
  return {
    ...base, action_id: id, id, match_id: id + 100, row_id: id + 200,
    source_row_number: id, phone_original: phone, phone_normalised: phone,
    target_entity_id: id + 1000, proposed_client_id: id + 1000, ...extra
  };
}

(async () => {
  const previewRows = [1, 2, 3, 4].map(id => ({
    ...action(id, `2782000000${id}`), safe: true, category: 'existing_mobile', reason: 'Preview safe'
  }));
  const preview = {
    filters: { batch: 7, panel: '1' },
    rows: previewRows,
    safeRows: previewRows,
    excludedRows: [],
    counts: { ...buildCounts(previewRows), selected: 4, safe: 4 }
  };
  const currentActions = [
    action(1, '27820000001'),
    action(2, '27820000002'),
    action(3, '27820000003', { applied_status: 'applied' }),
    action(4, '27820000004', {
      action_type: 'resolve_mobile_conflict', classification: 'conflict',
      review_status: 'pending', approval_status: 'pending'
    })
  ];
  const currentEvidence = evidence({
    clientsByPhone: new Map([
      ['27820000001', [{ id: 1001 }]],
      ['27820000002', [{ id: 1002 }]],
      ['27820000003', [{ id: 1003 }]]
    ])
  });
  const connections = [];
  const audits = [];
  let completionCalls = 0;
  const execution = await finaliseBulkSafe({ batch: 7, panel: '1' }, { userId: 9, ip: '127.0.0.1', userAgent: 'validator' }, {
    connectionFactory: async () => {
      const connection = fakeConnection();
      connections.push(connection);
      return connection;
    },
    previewLoader: async () => preview,
    actionLoader: async () => currentActions,
    evidenceLoader: async () => currentEvidence,
    actionCompleter: async (connection, row) => {
      completionCalls += 1;
      if (row.id === 2) throw new Error('Isolated row failure');
      return { actionId: row.id, targetType: 'clients', targetId: row.target_entity_id };
    },
    auditWriter: async (connection, context, actionType, entityType, entityId, description, before, after) => {
      audits.push({ actionType, entityId, before, after });
    }
  });
  assert.strictEqual(execution.counts.selected, preview.counts.selected, 'Preview and execution selected counts must match');
  assert.strictEqual(execution.counts.applied, 1, 'One safe row should apply');
  assert.strictEqual(execution.counts.skipped, 1, 'Already-applied row should be skipped');
  assert.strictEqual(execution.counts.exception, 1, 'Newly unsafe row should move to exceptions');
  assert.strictEqual(execution.counts.failed, 1, 'Isolated action failure should be reported');
  assert.strictEqual(completionCalls, 2, 'Only rows still classified safe may reach the finaliser');
  assert(connections[0].statements.some(sql => sql.startsWith('SAVEPOINT bulk_row_')));
  assert(connections[0].statements.some(sql => sql.startsWith('ROLLBACK TO SAVEPOINT bulk_row_')),
    'One unsafe execution must not roll back other rows');
  assert(audits.some(row => row.actionType === 'monthly_import_bulk_action_failed'));
  assert(audits.some(row => row.actionType === 'monthly_import_bulk_finalised'), 'Bulk operation aggregate must be audited');

  let secondCompletionCalls = 0;
  const second = await finaliseBulkSafe({ batch: 7 }, { userId: 9 }, {
    connectionFactory: async () => fakeConnection(),
    previewLoader: async () => preview,
    actionLoader: async () => currentActions.map(row => ({ ...row, applied_status: 'applied' })),
    evidenceLoader: async () => currentEvidence,
    actionCompleter: async () => { secondCompletionCalls += 1; },
    auditWriter: async () => {}
  });
  assert.strictEqual(second.counts.applied, 0);
  assert.strictEqual(secondCompletionCalls, 0, 'Second execution must never reapply completed actions');
  assert.strictEqual(second.counts.skipped, 4, 'Second execution should skip all completed rows');

  const stableRows = [action(11, '27820000011'), action(12, '27820000012')]
    .map(row => ({ ...row, safe: true, category: 'existing_mobile', reason: 'Preview safe' }));
  const stablePreview = {
    filters: { batch: 7 }, rows: stableRows, safeRows: stableRows, excludedRows: [],
    counts: { ...buildCounts(stableRows), selected: 2, safe: 2 }
  };
  const stableEvidence = evidence({
    clientsByPhone: new Map([
      ['27820000011', [{ id: 1011 }]],
      ['27820000012', [{ id: 1012 }]]
    ])
  });
  const stableExecution = await finaliseBulkSafe({ batch: 7 }, { userId: 9 }, {
    connectionFactory: async () => fakeConnection(),
    previewLoader: async () => stablePreview,
    actionLoader: async () => stableRows,
    evidenceLoader: async () => stableEvidence,
    actionCompleter: async (connection, row) => ({ actionId: row.id, targetType: 'clients', targetId: row.target_entity_id }),
    auditWriter: async () => {}
  });
  assert.strictEqual(stableExecution.counts.applied, stablePreview.counts.safe,
    'When state is unchanged, preview safe count must equal execution applied count');

  const bulkSource = fs.readFileSync(bulkPath, 'utf8');
  for (const forbidden of ['DELETE FROM clients', 'DELETE FROM fixed_accounts', 'UPDATE clients SET is_active=0',
    'UPDATE fixed_accounts SET account_status', 'MERGE']) {
    assert(!bulkSource.toUpperCase().includes(forbidden.toUpperCase()), `Bulk service contains forbidden mutation: ${forbidden}`);
  }
  for (const required of ['FOR UPDATE', 'SAVEPOINT', 'ROLLBACK TO SAVEPOINT',
    'monthly_import_bulk_action_applied', 'monthly_import_bulk_finalised']) {
    assert(bulkSource.includes(required), `Bulk safety mechanism missing: ${required}`);
  }
  const finaliserSource = fs.readFileSync(finaliserPath, 'utf8');
  assert(finaliserSource.includes('completeMonthlyImportAction'));
  assert(finaliserSource.includes('loadMonthlyImportActions'));

  const route = require(routePath);
  const gate = route.ownerManagerOnly;
  for (const role of ['owner', 'manager']) {
    let allowed = false;
    gate({ session: { user: { role } } }, {}, () => { allowed = true; });
    assert(allowed, `${role} should be allowed to use bulk workflow`);
  }
  let denied = 0;
  gate({ session: { user: { role: 'staff' } } }, {
    status(code) { denied = code; return this; }, render() { return this; }
  }, () => {});
  assert.strictEqual(denied, 403, 'Staff must be denied');

  const managementView = fs.readFileSync(managementViewPath, 'utf8');
  const previewView = fs.readFileSync(previewViewPath, 'utf8');
  const resultsView = fs.readFileSync(resultsViewPath, 'utf8');
  for (const label of ['Safe to process', 'Existing customers to update', 'New customers to create',
    'Fixed records', 'Exceptions', 'Conflicts', 'Missing information', 'Fixed approvals',
    'Failed', 'Already completed', 'Preview safe records', 'Approve and finalise safe records', 'Review exceptions']) {
    assert(managementView.includes(label), `Bulk management wording missing: ${label}`);
  }
  assert(previewView.includes('No live customer records will be merged or deleted.'));
  assert(previewView.includes('return_query'));
  assert(resultsView.includes('Back to filtered results'));
  for (const view of [managementView, previewView, resultsView]) {
    assert(view.includes('panel=1'), 'Bulk navigation must preserve panel=1');
  }

  console.log('Bulk Monthly Import validator passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
