'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const servicePath = path.join(root, 'src', 'services', 'monthly-import-management.js');
const finaliserPath = path.join(root, 'src', 'services', 'monthly-import-finaliser.js');
const routePath = path.join(root, 'src', 'routes', 'monthly-import-management.js');
const importRoutePath = path.join(root, 'src', 'routes', 'monthly-data-import.js');
const viewPath = path.join(root, 'views', 'monthly-import-management.ejs');

const {
  classifyBusinessStatus,
  filtersFrom,
  whereFor,
  loadManagement,
  toCsv
} = require(servicePath);

function status(expected, row) {
  assert.strictEqual(classifyBusinessStatus(row).label, expected);
}

status('Existing customer updated', { applied_status: 'applied', action_type: 'link_mobile_client' });
status('New customer created', { applied_status: 'applied', action_type: 'create_mobile_record', live_account_number: 'B123' });
status('New customer needs account number', { applied_status: 'applied', action_type: 'create_mobile_record', live_account_number: '' });
status('Existing fixed account/service updated', { applied_status: 'applied', action_type: 'link_fixed_service' });
status('Fixed account/service created', { applied_status: 'applied', action_type: 'create_fixed_service' });
status('Fixed account/service created', { applied_status: 'applied', action_type: 'resolve_fixed_conflict', before_json: null });
status('Existing fixed account/service updated', { applied_status: 'applied', action_type: 'resolve_fixed_conflict', before_json: '{}' });
status('Needs conflict review', {
  applied_status: 'not_applied', review_status: 'pending', classification: 'conflict', action_type: 'resolve_mobile_conflict'
});
status('Ready to finalise', {
  applied_status: 'not_applied', approval_status: 'approved', action_type: 'link_mobile_client'
});
status('Rejected', { applied_status: 'not_applied', approval_status: 'rejected' });
status('Deferred', { applied_status: 'not_applied', approval_status: 'deferred' });
status('Failed / needs attention', { applied_status: 'failed', error_text: 'Database failure' });
status('Completed', { applied_status: 'applied', action_type: 'legacy_action' });
status('Not yet processed', {});

const filters = filtersFrom({
  batch: '7', date_from: '2026-07-01', date_to: '2026-07-31', filename: 'dealer',
  customer_name: 'Acme', phone: '082', canonical_phone: '2782', account_number: 'VB',
  domain: 'fixed', import_type: 'fixed_base', source_system: 'fixed_base',
  classification: 'new_record', business_status: 'fixed_created', review_status: 'approved',
  approval_status: 'approved', applied_status: 'applied', completion: 'completed',
  page: '2', page_size: '100'
});
assert.strictEqual(filters.page, 2);
assert.strictEqual(filters.page_size, 100);
const where = whereFor(filters);
for (const fragment of ['b.id=:batch', 'b.created_at>=:dateFrom', 'b.original_filename LIKE :filename',
  'r.customer_name LIKE :customerName', 'r.phone_original LIKE :phone', 'r.phone_normalised LIKE :canonicalPhone',
  'm.match_domain=:domain', 'm.classification=:classification', 'a.applied_status=:appliedStatus']) {
  assert(where.sql.includes(fragment), `Missing filter SQL: ${fragment}`);
}
assert.strictEqual(filtersFrom({ page: '-3', page_size: '999' }).page_size, 50);

let queryCount = 0;
const sampleRows = [
  {
    batch_id: 7, source_row_number: 2, original_filename: 'mobile.xlsx',
    business_status: 'mobile_updated', applied_status: 'applied', action_type: 'link_mobile_client',
    live_client_id: 91, live_client_name: 'Correct Client', live_client_phone: '0820000000',
    live_account_number: 'B91'
  },
  {
    batch_id: 7, source_row_number: 3, original_filename: 'fixed.xlsx',
    business_status: 'fixed_created', applied_status: 'applied', action_type: 'create_fixed_service',
    live_fixed_account_id: 44, live_fixed_account_number: 'VB44', live_fixed_service_id: 45,
    live_fixed_service_title: 'Branch'
  },
  {
    batch_id: 7, source_row_number: 4, original_filename: 'fixed.xlsx',
    business_status: 'fixed_updated', applied_status: 'applied', action_type: 'link_fixed_service',
    live_fixed_account_id: 54, live_fixed_account_number: 'I54', live_fixed_service_id: 55
  }
];
const mockConnection = {
  async query(sql) {
    queryCount += 1;
    if (sql.includes('SELECT COUNT(*) total')) return [[{ total: 3 }], []];
    if (sql.includes('SELECT business_status,COUNT(*)')) {
      return [[
        { business_status: 'mobile_updated', total: 1 },
        { business_status: 'fixed_created', total: 1 },
        { business_status: 'fixed_updated', total: 1 }
      ], []];
    }
    if (sql.includes('SELECT r.id row_id')) return [sampleRows, []];
    if (sql.includes('SELECT id,original_filename')) {
      return [[{ id: 7, original_filename: 'mobile.xlsx', total_rows: 3, valid_rows: 3 }], []];
    }
    throw new Error(`Unexpected management query: ${sql}`);
  }
};

(async () => {
  const result = await loadManagement({ page: 1, page_size: 25 }, {
    connection: mockConnection,
    panelMode: true
  });
  assert.strictEqual(queryCount, 4, 'Management page must use a bounded query count (no N+1)');
  assert.strictEqual(result.pagination.pageSize, 25);
  assert.strictEqual(result.pagination.total, 3);
  assert.strictEqual(result.rows[0].live_path, '/customers/91/360?panel=1');
  assert.strictEqual(result.rows[0].live_client_name, 'Correct Client');
  assert.strictEqual(result.rows[1].live_path, '/fixed/accounts/44?panel=1#service-45');
  assert.strictEqual(result.rows[2].live_path, '/fixed/accounts/54?panel=1#service-55');

  const csv = toCsv(result.rows);
  assert(csv.includes('Correct Client'));
  assert(csv.includes('Existing customer updated'));
  assert(csv.includes('VB44'));
  assert(!csv.includes('unfiltered.xlsx'), 'CSV must contain only the supplied filtered rows');

  const route = require(routePath);
  const gate = route.ownerManagerOnly;
  for (const role of ['owner', 'manager']) {
    let passed = false;
    gate({ session: { user: { role } } }, {}, () => { passed = true; });
    assert(passed, `${role} should be allowed`);
  }
  let denied = null;
  const response = {
    status(code) { denied = code; return this; },
    render() { return this; }
  };
  gate({ session: { user: { role: 'staff' } } }, response, () => {});
  assert.strictEqual(denied, 403);

  ejs.compile(fs.readFileSync(viewPath, 'utf8'), { filename: viewPath });
  const view = fs.readFileSync(viewPath, 'utf8');
  assert(view.includes("panelMode?'?panel=1'"), 'panel=1 navigation must be preserved');
  assert(view.includes('row.error_text'), 'Failed actions must display their stored error');
  assert(view.includes('Open conflict review'));
  assert(view.includes('Open account-number approval'));

  const finaliser = fs.readFileSync(finaliserPath, 'utf8');
  for (const guard of ['beginTransaction()', 'FOR UPDATE', "applied_status === 'applied'",
    'monthly_import_action_retried', 'writeAudit', 'createFixedAccountAndService']) {
    assert(finaliser.includes(guard), `Missing finalisation safety guard: ${guard}`);
  }
  const importRoute = fs.readFileSync(importRoutePath, 'utf8');
  assert(importRoute.includes("action.action_type !== 'create_fixed_account_and_service'"));
  assert(importRoute.includes("req.body.return_to === 'management'"));

  require(path.join(root, 'src', 'routes', 'os-launcher-settings.js'));
  console.log('Monthly Import Management validator passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
