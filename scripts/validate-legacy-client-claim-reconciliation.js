'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  classifyLegacyClaimData,
  filtersFrom,
  filterScopes,
  summaryFor,
  toCsv
} = require('../src/services/legacy-client-claim-reconciliation');
const { managementOnly, isPanelRequest } = require('../src/routes/legacy-client-claim-reconciliation');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const activeStaff = (id, name) => ({ requested_by: id, claimant_name: name, claimant_is_active: 1 });
const request = (id, staffId = 7, extra = {}) => ({
  id, request_type: 'claim_client', record_id: 10, client_id: 10, account_number: 'AC 100',
  proposed_data_json: JSON.stringify({ client_id: 10, linked_client_ids: [10, 11], account_number: 'AC 100', assigned_staff_id: staffId }),
  created_at: `2026-01-${String(id).padStart(2, '0')}T08:00:00.000Z`, status: 'pending_owner',
  ...activeStaff(staffId, staffId === 7 ? 'Alice Agent' : 'Bob Agent'), ...extra
});
const clients = [
  { id: 10, account_id: 50, account_number: 'AC 100', client_name: 'Acme Main', is_active: 1 },
  { id: 11, account_id: 50, account_number: 'AC 100', client_name: 'Acme Line', is_active: 1 }
];
const account = assignedStaffId => ({
  id: 50, account_number: 'AC 100', account_number_normalised: 'AC100', display_name: 'Acme',
  account_status: 'active', assigned_staff_id: assignedStaffId || null,
  assigned_staff_name: assignedStaffId === 7 ? 'Alice Agent' : assignedStaffId ? 'Bob Agent' : null,
  assignee_is_active: assignedStaffId ? 1 : null
});
const assignment = (clientId, staffId = 7) => ({
  id: clientId, client_id: clientId, account_number: 'AC 100', assigned_staff_id: staffId,
  assigned_staff_name: staffId === 7 ? 'Alice Agent' : 'Bob Agent', assignee_is_active: 1
});
const classify = overrides => classifyLegacyClaimData({
  requests: [request(1)], clients, accounts: [account()], assignments: [], fixedAccounts: [], ...overrides
});

let scopes = classify({});
assert.strictEqual(scopes.length, 1, 'Linked client lines must form one account-level scope.');
assert.strictEqual(scopes[0].classification, 'safe_to_apply', 'An unassigned active scope with one claimant is safe to apply.');
assert.strictEqual(scopes[0].linkedActiveClientCount, 2);

scopes = classify({ accounts: [account(7)] });
assert.strictEqual(scopes[0].classification, 'already_correct', 'An account-wide matching assignment is already correct.');
scopes = classify({ assignments: [assignment(10), assignment(11)] });
assert.strictEqual(scopes[0].classification, 'already_correct', 'Matching assignment on every active line is already correct.');
scopes = classify({ accounts: [account(8)] });
assert.strictEqual(scopes[0].classification, 'ownership_conflict', 'A trusted different assignee is an ownership conflict.');

scopes = classify({ requests: [request(1), request(2, 8)] });
assert.strictEqual(scopes.length, 1);
assert.strictEqual(scopes[0].classification, 'ownership_conflict', 'Different claimants in one scope are an ownership conflict.');
scopes = classify({ requests: [request(1), request(2)] });
assert.strictEqual(scopes.length, 1);
assert.strictEqual(scopes[0].classification, 'safe_to_apply', 'Duplicate requests by one claimant must not create a false conflict.');
assert.strictEqual(scopes[0].requestCount, 2);

scopes = classify({ requests: [request(1, 7, { claimant_is_active: 0 })] });
assert.strictEqual(scopes[0].classification, 'exception', 'Inactive claimants are exceptions.');
scopes = classify({ requests: [{ ...request(1), proposed_data_json: '{bad json' }] });
assert.strictEqual(scopes[0].classification, 'exception', 'Malformed proposals are exceptions.');
scopes = classify({ clients: clients.map(client => ({ ...client, is_active: 0 })) });
assert.strictEqual(scopes[0].classification, 'exception', 'Scopes without an active client are exceptions.');
scopes = classify({
  requests: [{ ...request(1), account_number: null, proposed_data_json: JSON.stringify({ client_id: 10, assigned_staff_id: 7 }) }],
  clients: [{ ...clients[0], account_id: null, account_number: null }], accounts: []
});
assert.strictEqual(scopes[0].classification, 'exception', 'Scopes without a reliable account grouping identifier are exceptions.');

const complete = [
  ...classify({}),
  ...classify({ accounts: [account(7)], requests: [request(3)] }),
  ...classify({ accounts: [account(8)], requests: [request(4)] })
];
const safeOnly = filterScopes(complete, filtersFrom({ classification: 'safe_to_apply' }));
assert(safeOnly.length > 0 && safeOnly.every(scope => scope.classification === 'safe_to_apply'));
const csv = toCsv(safeOnly);
assert(csv.includes('Safe to apply'));
assert(!csv.includes('Ownership conflict'), 'Filtered CSV must contain only the current filtered rows.');
const summary = summaryFor(complete, 9);
assert.strictEqual(summary.totalPendingClaims, 9, 'Request count must remain distinct from unique scope count.');
assert.strictEqual(summary.uniqueScopes, complete.length);

for (const role of ['owner', 'manager', 'admin']) {
  let allowed = false;
  managementOnly({ session: { user: { role } } }, {}, () => { allowed = true; });
  assert(allowed, `${role} must be allowed.`);
}
let blocked = false;
managementOnly({ session: { user: { role: 'staff' } } }, {
  status(code) { assert.strictEqual(code, 403); return this; },
  render(view) { assert.strictEqual(view, 'error'); blocked = true; }
}, () => assert.fail('Staff must not pass access control.'));
assert(blocked, 'Staff must receive access denied.');
assert.strictEqual(isPanelRequest({ query: { panel: '1' } }), true);

const serviceSource = read('src/services/legacy-client-claim-reconciliation.js');
const routeSource = read('src/routes/legacy-client-claim-reconciliation.js');
const viewSource = read('views/legacy-client-claim-reconciliation.ejs');
const serverSource = read('server.js');
for (const source of [serviceSource, routeSource]) {
  assert(!/`\s*(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(source), 'Report code must contain no write SQL.');
  assert(!/\b(?:beginTransaction|commit|rollback)\s*\(/.test(source), 'Report code must contain no transaction mutation API.');
  assert(!/FOR\s+UPDATE/i.test(source), 'Report code must contain no row locks.');
}
assert(!/router\.(?:post|put|patch|delete)\s*\(/.test(routeSource), 'Report route must expose GET only.');
assert(!/method\s*=\s*["']post/i.test(viewSource), 'Report screen must contain no write form.');
assert(routeSource.includes("['owner', 'manager', 'admin']"));
assert(routeSource.includes('legacy-client-claim-reconciliation.csv'));
assert(viewSource.includes('No records are changed from this screen.'));
assert(viewSource.includes("if (panelMode) params.set('panel', '1')"));
assert(serverSource.includes("require('./src/routes/legacy-client-claim-reconciliation')"));
assert(read('src/services/client-claim.js').includes('async function claimClient'));
assert(read('src/services/client-claim.js').includes('INSERT INTO client_assignments'));
assert(read('src/routes/provisional-mobile-save.js').includes('provisional'));
assert(read('src/routes/provisional-fixed-save.js').includes('provisional'));

for (const filename of fs.readdirSync(path.join(root, 'views')).filter(name => name.endsWith('.ejs'))) {
  ejs.compile(read(path.join('views', filename)), { filename: path.join(root, 'views', filename) });
}

console.log('Legacy client claim reconciliation validation passed.');
process.exit(0);
