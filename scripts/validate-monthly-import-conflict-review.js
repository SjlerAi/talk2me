'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  ConflictReviewValidationError,
  mobileMatchEvidence,
  accountMatchEvidence,
  fixedServiceMatchEvidence,
  hydrateConflictCandidates,
  requireValidSelection
} = require('../src/services/monthly-import-conflict-review');

const root = path.join(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'src', 'routes', 'monthly-data-import.js'), 'utf8');
const matcherSource = fs.readFileSync(path.join(root, 'src', 'services', 'monthly-import-matcher.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(root, 'views', 'monthly-data-import.ejs'), 'utf8');
const partialSource = fs.readFileSync(path.join(root, 'views', 'partials', 'monthly-import-candidate-cards.ejs'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'public', 'css', 'monthly-data-import.css'), 'utf8');
const browserSource = fs.readFileSync(path.join(root, 'public', 'js', 'monthly-import-conflict-review.js'), 'utf8');

// Confirm the exact matcher-produced stored shape. Display hydration may consume
// only IDs from this JSON; matcher snapshots are not trusted for rendering.
assert(matcherSource.includes('const candidateJson = { canonicalPhone: canonical || null, clients: candidates }'));
assert(matcherSource.includes('clientName: client.client_name'));
assert(matcherSource.includes('accountId: client.account_id ? Number(client.account_id) : null'));
assert(matcherSource.includes('accountNumber: client.account_number || null'));
assert(matcherSource.includes('matchedFields: []'));
assert(matcherSource.includes('accounts: accountCandidates.map'));
assert(matcherSource.includes('fixedAccounts: []'));
assert(matcherSource.includes('services: []'));

// Every supported phone field must produce current matching evidence.
const phone = '27765143149';
const fields = [
  'cell_number_normalised',
  'cell_number',
  'main_contact_number_normalised',
  'main_contact_number',
  'alt_number'
];
for (const field of fields) {
  const evidence = mobileMatchEvidence({ [field]: field.includes('normalised') ? phone : '076 514 3149' }, phone);
  assert.deepStrictEqual(evidence.map(item => item.field), [field], `${field} must identify matching evidence.`);
}

const clients = [
  {
    id: 101, client_name: 'Candidate One', cell_number: '076 514 3149',
    cell_number_normalised: phone, main_contact_number: null,
    main_contact_number_normalised: null, alt_number: null,
    email: 'one@example.test', account_number: 'ACC-1', city_town: 'Bloemfontein',
    handset: 'Phone A', upgrade_date: '2027-01-01', assigned_staff_name: 'Manager One'
  },
  {
    id: 202, client_name: 'Candidate Two', cell_number: '0765143149',
    cell_number_normalised: phone, main_contact_number: null,
    main_contact_number_normalised: null, alt_number: null,
    email: 'two@example.test', account_number: 'ACC-2', city_town: 'Welkom',
    handset: 'Phone B', upgrade_date: '2028-02-02', assigned_staff_name: 'Manager Two'
  }
];
const accounts = [
  {
    id: 301, account_number: 'ACC-301', account_number_normalised: 'ACC301',
    display_name: 'Account Candidate One', account_status: 'active',
    assigned_staff_name: 'Manager One', mobile_line_count: 2, fixed_account_count: 0,
    representative_client_id: 101, representative_fixed_account_id: null
  },
  {
    id: 302, account_number: 'ACC-301', account_number_normalised: 'ACC301',
    display_name: 'Account Candidate Two', account_status: 'active',
    assigned_staff_name: 'Manager Two', mobile_line_count: 1, fixed_account_count: 0,
    representative_client_id: 202, representative_fixed_account_id: null
  }
];
const fixedAccounts = [
  {
    id: 401, account_id: 301, account_number: 'FIX-401', account_number_normalised: 'FIX401',
    customer_name: 'Fixed Account One', contact_number: '011 000 0001',
    email: 'fixed-one@example.test', account_status: 'active',
    assigned_staff_name: 'Manager One', service_count: 1
  },
  {
    id: 402, account_id: 301, account_number: 'FIX-401', account_number_normalised: 'FIX401',
    customer_name: 'Fixed Account Two', contact_number: '011 000 0002',
    email: 'fixed-two@example.test', account_status: 'active',
    assigned_staff_name: 'Manager Two', service_count: 1
  }
];
const services = [
  {
    id: 501, fixed_account_id: 401, service_title: 'Fibre One', branch_name: 'Branch One',
    order_number: 'ORD-500', solution_id: 'SOL-1', mac_address: 'AA:BB:CC:DD:EE:01',
    sim_number: null, package_name: '100 Mbps', service_status: 'active',
    account_number: 'FIX-401', assigned_staff_name: 'Manager One'
  },
  {
    id: 502, fixed_account_id: 402, service_title: 'Fibre Two', branch_name: 'Branch Two',
    order_number: 'ORD-500', solution_id: 'SOL-2', mac_address: 'AA:BB:CC:DD:EE:02',
    sim_number: null, package_name: '200 Mbps', service_status: 'active',
    account_number: 'FIX-401', assigned_staff_name: 'Manager Two'
  }
];

const mockConnection = {
  async execute(sql) {
    if (sql.includes('FROM customer_accounts ca')) return [accounts];
    if (sql.includes('FROM fixed_accounts fa')) return [fixedAccounts];
    if (sql.includes('FROM fixed_services fs')) return [services];
    if (sql.includes('FROM clients c')) return [clients];
    throw new Error(`Unexpected hydration SQL: ${sql}`);
  }
};

async function main() {
  const [row] = await hydrateConflictCandidates(mockConnection, [{
    id: 77,
    classification: 'conflict',
    match_domain: 'mobile',
    candidate_json: JSON.stringify({
      canonicalPhone: phone,
      clients: [
        { id: 101, clientName: 'untrusted old name', matchedFields: ['cell_number'] },
        { id: 202, clientName: 'untrusted old name', matchedFields: ['cell_number'] }
      ]
    }),
    phone_original: '0765143149',
    phone_normalised: phone,
    account_number: null
  }]);

  assert(row.selection, 'A mobile conflict must expose a candidate selection.');
  assert.strictEqual(row.selection.candidates.length, 2, 'Both mobile candidates must be hydrated.');
  assert.strictEqual(row.selection.candidates[0].title, 'Candidate One', 'Display details must come from live hydration.');
  assert.strictEqual(row.selection.candidates[1].title, 'Candidate Two', 'Display details must come from live hydration.');
  assert(!JSON.stringify(row.selection.candidates).includes('untrusted old name'));

  const html = ejs.render(partialSource, {
    row,
    basePath: '/talk2me',
    panelMode: true
  }, { filename: path.join(root, 'views', 'partials', 'monthly-import-candidate-cards.ejs') });
  assert(html.includes('Candidate 1'));
  assert(html.includes('Candidate 2'));
  assert(html.includes('Candidate One'));
  assert(html.includes('Candidate Two'));
  assert(html.includes('name=\"client_id\" value=\"101\"'));
  assert(html.includes('Matched on'));
  assert(html.includes('/talk2me/customers/101/360?panel=1'));

  const conflictFixtures = [
    {
      id: 78, classification: 'conflict', match_domain: 'fixed',
      candidate_json: JSON.stringify({
        accountNumber: 'ACC301',
        accounts: [{ id: 301 }, { id: 302 }],
        fixedAccounts: [],
        services: []
      }),
      account_number: 'ACC-301'
    },
    {
      id: 79, classification: 'conflict', match_domain: 'fixed',
      candidate_json: JSON.stringify({
        accountNumber: 'FIX401',
        accounts: [{ id: 301 }],
        fixedAccounts: [{ id: 401 }, { id: 402 }],
        services: []
      }),
      account_number: 'FIX-401'
    },
    {
      id: 80, classification: 'conflict', match_domain: 'fixed',
      candidate_json: JSON.stringify({
        accountNumber: 'FIX401',
        accounts: [{ id: 301 }],
        fixedAccounts: [{ id: 401 }, { id: 402 }],
        services: [{ id: 501 }, { id: 502 }]
      }),
      account_number: 'FIX-401',
      order_number: 'ORD-500'
    }
  ];
  const hydratedFixed = await hydrateConflictCandidates(mockConnection, conflictFixtures);
  assert.deepStrictEqual(
    hydratedFixed.map(item => item.selection.key),
    ['accounts', 'fixedAccounts', 'services'],
    'All fixed-domain conflict target types must be hydrated.'
  );
  assert(hydratedFixed.every(item => item.selection.candidates.length === 2));
  assert(hydratedFixed.flatMap(item => item.selection.candidates).every(item => item.evidence.length));
  assert.deepStrictEqual(accountMatchEvidence(accounts[0], 'ACC-301').map(item => item.field), ['account_number']);
  assert.deepStrictEqual(fixedServiceMatchEvidence(services[0], { order_number: 'ORD-500' }).map(item => item.field), ['order_number']);
  for (const fixedRow of hydratedFixed) {
    const fixedHtml = ejs.render(partialSource, {
      row: fixedRow,
      basePath: '/talk2me',
      panelMode: true
    }, { filename: path.join(root, 'views', 'partials', 'monthly-import-candidate-cards.ejs') });
    assert(fixedHtml.includes('Candidate 1'));
    assert(fixedHtml.includes('Candidate 2'));
    assert(fixedHtml.includes(`name="${fixedRow.selection.inputName}"`));
    assert(fixedHtml.includes('panel=1'));
  }

  assert.throws(
    () => requireValidSelection(row.selection, {}),
    error => error instanceof ConflictReviewValidationError && /Select one of the 2 client records/.test(error.message),
    'Approval without a candidate must be blocked clearly.'
  );
  const selected = requireValidSelection(row.selection, { client_id: '202' });
  assert.strictEqual(selected.id, 202, 'A valid selected client must be accepted.');
  assert.throws(
    () => requireValidSelection(row.selection, { client_id: '999' }),
    /not valid for this imported row/,
    'An ID outside the stored allowed set must be rejected.'
  );

  const staleSelection = {
    ...row.selection,
    candidates: row.selection.candidates.map((candidate, index) => index ? candidate : { ...candidate, evidence: [] })
  };
  assert.throws(
    () => requireValidSelection(staleSelection, { client_id: '101' }),
    /conflict has become stale/,
    'A stale live candidate must be rejected.'
  );

  // Transactional route behavior and safety invariants.
  assert(routeSource.includes('SELECT * FROM monthly_import_actions WHERE match_id=:matchId FOR UPDATE'));
  assert(routeSource.includes('WHERE m.id=:matchId AND r.batch_id=:batchId FOR UPDATE'));
  assert(routeSource.includes('proposed_client_id=COALESCE(:clientId,proposed_client_id)'));
  assert(routeSource.includes('target_entity_type=:targetType,target_entity_id=:targetId'));
  assert(routeSource.includes("applied_status='not_applied'"));
  assert(routeSource.includes('beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after)'));
  assert(routeSource.includes("m.review_status='pending'"));
  assert(routeSource.includes("a.approval_status='pending'"));
  assert(routeSource.includes('r.mac_address,r.sim_number'));
  assert(routeSource.includes('error instanceof ConflictReviewValidationError'));
  assert(routeSource.includes('backoffice/data-import?error='));
  assert(routeSource.includes('${panelQuery(req)}#exceptions'));
  assert(!routeSource.slice(routeSource.indexOf("router.post('/backoffice/data-import/batches/:batchId/matches/:matchId/decision")).includes('UPDATE clients SET'));
  assert(!routeSource.slice(routeSource.indexOf("router.post('/backoffice/data-import/batches/:batchId/matches/:matchId/decision")).includes('DELETE FROM clients'));

  // Client-side and layout behavior.
  assert(partialSource.includes('type=\"radio\"'));
  assert(viewSource.includes('data-use-selected disabled'));
  assert(viewSource.includes('Exclude this imported row'));
  assert(viewSource.includes('Defer decision'));
  assert(viewSource.includes('name=\"panel\" value=\"1\"'));
  assert(viewSource.includes('conflict-inline-error'));
  assert(browserSource.includes('approve.disabled = !selected'));
  assert(browserSource.includes("card.classList.toggle('selected'"));
  assert(cssSource.includes('overflow-x: hidden'));
  assert(cssSource.includes('grid-template-columns: repeat(auto-fit, minmax(min(270px, 100%), 1fr))'));
  assert(cssSource.includes('overflow-wrap: anywhere'));

  console.log('Monthly import conflict review validation passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
