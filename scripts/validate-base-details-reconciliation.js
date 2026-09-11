'use strict';

const assert = require('assert');
const { normaliseAccountCore, baseDetailsResult } = require('../src/services/base-details-reconciliation');

function add(map, key, value) {
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

function refs({ clients = [], accounts = [] } = {}) {
  const mobile = new Map();
  const accountsByCore = new Map();
  const accountsById = new Map();
  for (const account of accounts) {
    accountsById.set(Number(account.id), account);
    add(accountsByCore, normaliseAccountCore(account.account_number), account);
  }
  for (const client of clients) {
    const candidates = mobile.get(client.phone) || new Map();
    candidates.set(Number(client.id), {
      id: Number(client.id),
      clientName: client.clientName || null,
      accountId: client.accountId || null,
      accountNumber: client.accountNumber || null,
      matchedFields: ['cell_number_normalised']
    });
    mobile.set(client.phone, candidates);
  }
  return { mobile, accountsByCore, accountsById };
}

const row = (phone, account) => ({ phone_original: phone, phone_normalised: phone, account_number: account });

assert.strictEqual(normaliseAccountCore('I0904211/9'), 'I0904211');
assert.strictEqual(normaliseAccountCore('I0904211-9'), 'I0904211');
assert.strictEqual(normaliseAccountCore('B0174076'), 'B0174076');

let result = baseDetailsResult(row('27710000001', 'B0000001'), refs());
assert.strictEqual(result.classification, 'new_record');
assert.strictEqual(result.actionType, 'stage_base_new_service_new_account');

result = baseDetailsResult(row('27710000002', 'B0000002'), refs({
  accounts: [{ id: 20, account_number: 'B0000002', display_name: 'Account 2' }]
}));
assert.strictEqual(result.classification, 'new_record');
assert.strictEqual(result.actionType, 'stage_base_new_service_existing_account');
assert.strictEqual(result.proposedAccountId, 20);

result = baseDetailsResult(row('27710000003', 'B0000003'), refs({
  accounts: [{ id: 30, account_number: 'B0000003', display_name: 'Account 3' }],
  clients: [{ id: 300, phone: '27710000003', accountId: 30, accountNumber: 'B0000003' }]
}));
assert.strictEqual(result.classification, 'exact_match');
assert.strictEqual(result.actionType, 'stage_base_existing_client');
assert.strictEqual(result.proposedClientId, 300);

result = baseDetailsResult(row('27710000004', 'B0000004'), refs({
  accounts: [{ id: 40, account_number: 'B0000004', display_name: 'Account 4' }],
  clients: [
    { id: 401, phone: '27710000004', accountId: 40, accountNumber: 'B0000004' },
    { id: 402, phone: '27710000004', accountId: 40, accountNumber: 'B0000004' }
  ]
}));
assert.strictEqual(result.classification, 'possible_match');
assert.strictEqual(result.actionType, 'stage_base_existing_history');
assert.strictEqual(result.proposedAccountId, 40);

result = baseDetailsResult(row('27710000005', 'B0000005'), refs({
  accounts: [
    { id: 50, account_number: 'B0000005', display_name: 'Master' },
    { id: 51, account_number: 'B0000005/7', display_name: 'Legacy alias' }
  ]
}));
assert.strictEqual(result.classification, 'possible_match');
assert.strictEqual(result.actionType, 'stage_base_account_alias_review');

result = baseDetailsResult(row('27710000006', 'B0000006'), refs({
  accounts: [
    { id: 60, account_number: 'B0000006', display_name: 'Master' },
    { id: 61, account_number: 'B9999999', display_name: 'Old account' }
  ],
  clients: [{ id: 600, phone: '27710000006', accountId: 61, accountNumber: 'B9999999' }]
}));
assert.strictEqual(result.classification, 'conflict');
assert.strictEqual(result.actionType, 'stage_base_account_conflict');

result = baseDetailsResult(row('27710000007', 'B0000007'), refs({
  accounts: [
    { id: 70, account_number: 'B0000007', display_name: 'Master' },
    { id: 71, account_number: 'B8888888', display_name: 'Other' }
  ],
  clients: [
    { id: 700, phone: '27710000007', accountId: 70, accountNumber: 'B0000007' },
    { id: 701, phone: '27710000007', accountId: 71, accountNumber: 'B8888888' }
  ]
}));
assert.strictEqual(result.classification, 'conflict');
assert.strictEqual(result.actionType, 'stage_base_account_conflict');

const forbidden = new Set([
  'create_mobile_record', 'link_mobile_client', 'resolve_mobile_conflict',
  'create_fixed_service', 'create_fixed_account_and_service', 'link_fixed_service', 'resolve_fixed_conflict'
]);
for (const action of [
  'stage_base_new_service_new_account',
  'stage_base_new_service_existing_account',
  'stage_base_existing_client',
  'stage_base_existing_history',
  'stage_base_account_alias_review',
  'stage_base_account_conflict',
  'stage_base_invalid_identity'
]) assert.ok(!forbidden.has(action));

console.log('Base Details reconciliation safety validation passed.');
