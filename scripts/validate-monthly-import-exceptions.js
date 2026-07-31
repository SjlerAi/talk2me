'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const servicePath = path.join(root, 'src', 'services', 'monthly-import-exceptions.js');
const matcherPath = path.join(root, 'src', 'services', 'monthly-import-matcher.js');
const bulkPath = path.join(root, 'src', 'services', 'monthly-import-bulk-finaliser.js');
const managementRoutePath = path.join(root, 'src', 'routes', 'monthly-import-management.js');
const legacyRoutePath = path.join(root, 'src', 'routes', 'monthly-data-import.js');
const queueViewPath = path.join(root, 'views', 'monthly-import-exceptions.ejs');
const managementViewPath = path.join(root, 'views', 'monthly-import-management.ejs');
const dataImportViewPath = path.join(root, 'views', 'monthly-data-import.ejs');
const cssPath = path.join(root, 'public', 'css', 'monthly-import-management.css');

const {
  exceptionFilters,
  exceptionKind,
  managerAction
} = require(servicePath);
const { mobileResult } = require(matcherPath);
const { classifyBulkSafety } = require(bulkPath);

function evidence(clients = []) {
  const clientsByPhone = new Map();
  for (const client of clients) clientsByPhone.set('27820000000', [...(clientsByPhone.get('27820000000') || []), client]);
  return {
    clientsByPhone,
    accountsByNumber: new Map(),
    accountsById: new Map(),
    fixedByNumber: new Map(),
    fixedByAccountId: new Map(),
    fixedById: new Map(),
    services: [],
    servicesById: new Map(),
    importPhoneCounts: new Map([['27820000000', 1]]),
    importAccountCounts: new Map()
  };
}

const baseRow = {
  id: 11,
  row_id: 11,
  batch_id: 7,
  source_row_number: 3,
  import_status: 'confirmed',
  import_type: 'activation',
  phone_original: '0820000000',
  phone_normalised: '27820000000',
  customer_name: '',
  account_number: '',
  row_fingerprint: 'hash-11',
  classification: 'new_record',
  match_domain: 'mobile',
  review_status: 'pending',
  action_id: 21,
  action_type: 'create_mobile_record',
  target_entity_type: 'clients',
  target_entity_id: null,
  approval_status: 'pending',
  applied_status: 'not_applied'
};

const missingName = classifyBulkSafety(baseRow, evidence());
assert.strictEqual(missingName.safe, false);
assert.strictEqual(missingName.category, 'missing_information');
assert.strictEqual(exceptionKind({ ...baseRow, ...missingName }), 'missing_name');
assert.strictEqual(managerAction({ ...baseRow, ...missingName }), 'Add customer or business name');

const corrected = { ...baseRow, customer_name: 'Corrected Customer' };
const correctedMatch = mobileResult(corrected, { mobile: new Map() });
const correctedSafety = classifyBulkSafety({
  ...corrected,
  classification: correctedMatch.classification,
  action_type: correctedMatch.actionType
}, evidence());
assert.strictEqual(correctedMatch.classification, 'new_record', 'Corrected row should be rematched');
assert.strictEqual(correctedSafety.safe, true, 'Named row with unique valid phone should return to safe processing');

const ambiguousClients = [
  { id: 31, clientName: 'One', accountId: null, accountNumber: null, matchedFields: ['cell_number'] },
  { id: 32, clientName: 'Two', accountId: null, accountNumber: null, matchedFields: ['main_contact_number'] }
];
const ambiguousMatch = mobileResult(corrected, {
  mobile: new Map([['27820000000', new Map(ambiguousClients.map(item => [item.id, item]))]])
});
assert.strictEqual(ambiguousMatch.classification, 'conflict',
  'A corrected phone matching multiple live customers must become a conflict');

assert.strictEqual(exceptionKind({ ...baseRow, review_status: 'deferred', approval_status: 'deferred' }), 'deferred');
assert.strictEqual(exceptionKind({ ...baseRow, review_status: 'rejected', approval_status: 'rejected' }), 'rejected');
assert.strictEqual(exceptionKind({ ...baseRow, applied_status: 'failed' }), 'failed');
assert.deepStrictEqual(exceptionFilters({ exception: 'missing_name', page: '-4', page_size: '25', batch: '7' }), {
  batch: 7, exception: 'missing_name', search: '', live_search: '', focus_row: '', page: 1, page_size: 25
});

const serviceSource = fs.readFileSync(servicePath, 'utf8');
const matcherSource = fs.readFileSync(matcherPath, 'utf8');
const routeSource = fs.readFileSync(managementRoutePath, 'utf8');
const legacyRouteSource = fs.readFileSync(legacyRoutePath, 'utf8');
const queueView = fs.readFileSync(queueViewPath, 'utf8');
const managementView = fs.readFileSync(managementViewPath, 'utf8');
const dataImportView = fs.readFileSync(dataImportViewPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

for (const required of [
  'FOR UPDATE', 'matchSingleRow', 'classifyBulkSafety', 'loadSafetyEvidence',
  'monthly_import_exception_corrected', 'monthly_import_exception_linked',
  'monthly_import_exception_${status}', 'writeAudit', 'beginTransaction()', 'rollback()'
]) {
  assert(serviceSource.includes(required), `Exception service safety/audit behavior missing: ${required}`);
}
assert(matcherSource.includes('resetDecision'), 'One-row rematching must reset stale decisions before rebuilding');
assert(matcherSource.includes("review_status='pending'"));
assert(matcherSource.includes("approval_status='pending'"));
assert(serviceSource.includes('The selected live record is not a current match candidate'));
assert(serviceSource.includes('The selected customer no longer matches the imported phone.'));
assert(serviceSource.includes('The selected customer account no longer matches the imported account number.'));

for (const forbidden of [
  /DELETE\s+FROM\s+(clients|customer_accounts|fixed_accounts|fixed_services)/i,
  /UPDATE\s+(clients|customer_accounts|fixed_accounts|fixed_services)/i,
  /\b(deactivate|merge customer)\b/i
]) {
  assert(!forbidden.test(serviceSource), `Forbidden live CRM mutation found: ${forbidden}`);
}

for (const route of [
  "router.get('/backoffice/monthly-import-management/exceptions'",
  "exceptions/:rowId/correct'",
  "exceptions/:rowId/link'",
  "exceptions/:rowId/decision'"
]) {
  assert(routeSource.includes(route), `Exception route missing: ${route}`);
}
assert(routeSource.includes('requireAuth, ownerManagerOnly'));
assert(routeSource.includes('retryMonthlyImportAction'));
assert(routeSource.includes("req.body.return_to === 'exceptions'"));

const route = require(managementRoutePath);
for (const role of ['owner', 'manager']) {
  let allowed = false;
  route.ownerManagerOnly({ session: { user: { role } } }, {}, () => { allowed = true; });
  assert(allowed, `${role} must be allowed into exception review`);
}
let denied = 0;
route.ownerManagerOnly({ session: { user: { role: 'staff' } } }, {
  status(code) { denied = code; return this; },
  render() { return this; }
}, () => {});
assert.strictEqual(denied, 403);

assert(managementView.includes('/backoffice/monthly-import-management/exceptions?<%= bulkQuery %>'),
  'Review exceptions must open the dedicated queue with current context');
assert(!managementView.includes('bulk/preview?<%= bulkQuery %>#exceptions">Review'));
assert(queueView.includes("panelMode?'?panel=1':''"));
for (const wording of [
  'Save and recheck', 'Link existing', 'Defer', 'Reject',
  'Back to Monthly Import Management', 'View technical details',
  'Safe records return to bulk approval'
]) {
  assert(queueView.includes(wording), `Manager queue wording missing: ${wording}`);
}

assert(legacyRouteSource.includes('Legacy finalisation is disabled.'));
assert(!dataImportView.includes('name="confirm_finalise"'));
assert(!dataImportView.includes('>Finalise Import</button>'));
assert(dataImportView.includes('Only records classified as safe may be approved through Monthly Import Management.'));
assert(dataImportView.includes('/backoffice/monthly-import-management/exceptions'));

assert(!/overflow-x\s*:\s*(auto|scroll)/i.test(css), 'Exception queue must not require horizontal scrolling');
for (const responsive of [
  '.mie-shell{min-width:0;max-width:100%}',
  '.mie-card{display:grid',
  '.mie-card .btn{white-space:normal',
  '@media(max-width:850px)',
  '.mie-toolbar form{grid-template-columns:1fr}'
]) {
  assert(css.includes(responsive), `Exception queue responsive rule missing: ${responsive}`);
}

ejs.compile(queueView, { filename: queueViewPath });
const rendered = ejs.render(queueView, {
  basePath: '/talk2me',
  appVersion: 'test',
  panelMode: true,
  filters: {
    batch: 7, exception: 'missing_name', search: '', live_search: '', focus_row: '',
    page: 1, page_size: 25
  },
  scope: { batch: 7, customer_name: 'Dealer' },
  exceptionFilters: [
    ['all', 'All outstanding'],
    ['missing_name', 'Missing customer/business name']
  ],
  total: 1,
  pagination: { page: 1, pages: 1, pageSize: 25 },
  liveMatches: [],
  notice: '',
  error: '',
  rows: [{
    ...baseRow,
    original_filename: 'dealer.xlsx',
    reason: 'A customer or business name is required for safe bulk creation.',
    requiredAction: 'Add missing information',
    category: 'missing_information',
    exception_kind: 'missing_name',
    manager_action: 'Add customer or business name',
    technical_status: 'new_record / pending'
  }]
}, { filename: queueViewPath });
for (const value of [
  '/backoffice/monthly-import-management?batch=7&amp;customer_name=Dealer&amp;panel=1',
  '/exceptions/11/correct?panel=1',
  'name="panel" value="1"',
  'Save and recheck'
]) {
  assert(rendered.includes(value), `Rendered queue context/action missing: ${value}`);
}

console.log('Monthly Import exception workflow validation passed.');
