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
const cssPath = path.join(root, 'public', 'css', 'monthly-import-management.css');

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
  const css = fs.readFileSync(cssPath, 'utf8');
  assert(view.includes("panelMode?'?panel=1'"), 'panel=1 navigation must be preserved');
  assert(view.includes('row.error_text'), 'Failed actions must display their stored error');
  assert(!view.includes('<table'), 'The manager view must not use the former technical table');
  assert(!/min-width\s*:\s*1180px/i.test(css), 'No table min-width may force horizontal scrolling');
  assert(!/overflow-x\s*:\s*(auto|scroll)/i.test(css), 'The result layout must not require horizontal scrolling');
  assert(css.includes('@media(max-width:1100px)') && css.includes('@media(max-width:650px)'),
    'Companion-window and mobile responsive layouts are required');
  for (const label of ['Customer', 'Supplier', 'Result', 'What needs to happen', 'Action']) {
    assert(view.includes(`>${label}<`), `Default manager group is missing: ${label}`);
  }
  assert(view.includes('<summary>Advanced filters</summary>'));
  assert(view.includes('<summary>View details</summary>'));
  for (const detail of ['Batch ID', 'Source row', 'Source filename', 'Canonical phone',
    'Match classification', 'Confidence', 'Review status', 'Action type', 'Approval status',
    'Applied status', 'Proposed IDs', 'Live IDs', 'Error']) {
    assert(view.includes(`>${detail}<`), `Technical details are missing: ${detail}`);
  }

  const baseRow = {
    batch_id: 7, source_row_number: 12, original_filename: 'very-long-source-file.xlsx',
    customer_name: 'Manager View Customer', phone_original: '0820000000', phone_normalised: '27820000000',
    imported_account_number: 'VB100', source_system: 'B12', import_type: 'activation',
    classification: 'new_record', confidence_score: 42, review_status: 'pending',
    action_type: 'create_mobile_record', approval_status: 'pending', applied_status: 'not_applied',
    proposed_client_id: 101, proposed_account_id: 102, proposed_fixed_account_id: null,
    proposed_fixed_service_id: null, live_client_id: null, live_account_id: null,
    live_fixed_account_id: null, live_fixed_service_id: null, error_text: null
  };
  const rendered = ejs.render(view, {
    basePath: '/talk2me', panelMode: true, appVersion: 'test',
    filters: {
      batch: '', customer_name: '', phone: '', account_number: '', source_system: '', import_type: '',
      business_status: '', completion: '', date_from: '', date_to: '', filename: '', canonical_phone: '',
      domain: '', classification: '', review_status: '', approval_status: '', applied_status: '',
      page_size: 50
    },
    batches: [], summary: {
      total: 5, mobile_updated: 0, new_customers_created_total: 1, new_mobile_account: 1,
      fixed_created: 0, fixed_updated: 0, conflict: 1, ready: 1, rejected: 0, deferred: 0,
      failed: 1, completed_total: 0
    },
    pagination: { total: 5, page: 1, pages: 1, pageSize: 50 },
    statusRules: [
      { key: 'new_mobile_account', label: 'New customer needs account number' },
      { key: 'conflict', label: 'Needs conflict review' }
    ],
    bulkPreview: {
      counts: {
        safe: 2, existingMobile: 1, newMobile: 1, fixed: 0, excluded: 3,
        exceptions: 0, conflicts: 1, missingInformation: 1, fixedApprovals: 0,
        failed: 1, completed: 0
      }
    },
    notice: '', error: '',
    rows: [
      { ...baseRow, status_key: 'new_mobile_account', live_client_id: 201, live_client_name: 'New Customer' },
      { ...baseRow, status_key: 'conflict', action_type: 'resolve_mobile_conflict', match_id: 21 },
      { ...baseRow, status_key: 'failed', action_id: 31, error_text: 'Finalisation failed' },
      { ...baseRow, status_key: 'ready', action_type: 'link_mobile_client' },
      {
        ...baseRow, status_key: 'approval_required', action_type: 'create_fixed_account_and_service',
        match_id: 41, approval_status: 'pending', applied_status: 'not_applied'
      }
    ]
  }, { filename: viewPath });
  const defaultMarkup = [...rendered.matchAll(/<article class="mim-result-card">([\s\S]*?)<details class="mim-technical">/g)]
    .map(match => match[1]).join('\n');
  for (const rawValue of ['create_mobile_record', 'new_record', 'not_applied', 'proposed_client_id']) {
    assert(!defaultMarkup.includes(rawValue), `Raw technical value leaked into the default manager row: ${rawValue}`);
  }
  for (const rawValue of ['create_mobile_record', 'new_record', 'not_applied']) {
    assert(rendered.includes(rawValue), `View details must expose technical value: ${rawValue}`);
  }
  for (const actionPath of [
    '/approvals?q=',
    '/backoffice/data-import/batches/7/review?filter=conflict&amp;panel=1',
    '/backoffice/monthly-import-management/actions/31/retry?panel=1',
    '/backoffice/data-import?panel=1#finalise',
    '/backoffice/data-import/batches/7/matches/41/decision?panel=1'
  ]) {
    assert(rendered.includes(actionPath), `Existing action URL changed or disappeared: ${actionPath}`);
  }
  assert(rendered.includes('/backoffice/monthly-import-management.csv?panel=1'),
    'CSV export URL and panel state must remain available');
  const bulkSummary = rendered.match(/<section class="mim-bulk-workflow"[\s\S]*?<\/section>/);
  assert(bulkSummary, 'Structured bulk processing summary must render');
  assert.strictEqual((bulkSummary[0].match(/class="panel mim-bulk-section/g) || []).length, 2,
    'Safe records and exceptions must render as separate structured sections');
  assert.strictEqual((bulkSummary[0].match(/class="mim-bulk-breakdown"/g) || []).length, 2,
    'Safe records and exceptions must each render a structured breakdown');
  assert(!bulkSummary[0].includes('mim-bulk-counts'),
    'The former dense inline bulk count sentence must not render');
  const bulkSummaryText = bulkSummary[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  for (const wording of [
    '2 safe to process',
    'These records can be approved together',
    'Preview 2 safe records',
    'Approve and finalise 2 safe records',
    '3 exceptions',
    'These records need individual attention',
    'Review 3 exceptions'
  ]) {
    assert(bulkSummaryText.includes(wording), `Bulk summary wording or dynamic count missing: ${wording}`);
  }
  for (const actionPath of [
    '/backoffice/monthly-import-management/bulk/preview?panel=1#safe',
    '/backoffice/monthly-import-management/bulk/preview?panel=1#confirm',
    '/backoffice/monthly-import-management/bulk/preview?panel=1#exceptions'
  ]) {
    assert(bulkSummary[0].includes(actionPath),
      `Bulk action URL changed or panel=1 was not preserved: ${actionPath}`);
  }
  assert(!/overflow-x\s*:\s*(auto|scroll)/i.test(css),
    'Bulk summary must not introduce horizontal scrolling');
  for (const responsiveRule of [
    '.mim-bulk-workflow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))',
    '@media(max-width:850px){.mim-bulk-workflow,.mim-bulk-confirm{grid-template-columns:1fr}',
    '.mim-bulk-section .btn{display:block;width:100%;min-width:0;white-space:normal',
    '.mim-bulk-breakdown dt{min-width:0'
  ]) {
    assert(css.includes(responsiveRule),
      `Bulk summary overflow protection is missing: ${responsiveRule}`);
  }

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
