const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  MAX_BULK_CLAIMS,
  normaliseClientIds,
  bulkClaimClients
} = require('../src/services/bulk-client-claim');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function renderAssignmentCentre(overrides = {}) {
  const template = read('views/client-assignment-centre.ejs');
  return ejs.render(template, {
    basePath: '',
    panelMode: false,
    view: 'unassigned',
    q: '',
    counts: { unassigned_count: 2, mine_count: 0, requests_count: 0, pending_count: 0, assigned_count: 0 },
    clients: [{
      id: 10,
      client_name: 'Available Account',
      lifecycle_status: 'client',
      linked_line_count: 2,
      linked_mobile_numbers: [],
      created_at: '2026-08-01T08:00:00Z',
      pending_claim_id: null,
      assigned_staff_id: null
    }, {
      id: 20,
      client_name: 'Pending Account',
      lifecycle_status: 'client',
      linked_line_count: 1,
      linked_mobile_numbers: [],
      created_at: '2026-08-02T08:00:00Z',
      pending_claim_id: 99,
      pending_requested_by_name: 'Other Agent',
      assigned_staff_id: null
    }],
    requests: [],
    isManagement: false,
    claimed: false,
    conflict: false,
    conflictOwner: '',
    reviewed: false,
    focusRequest: null,
    bulkResult: {},
    ...overrides
  });
}

async function run() {
  assert.deepStrictEqual(normaliseClientIds(['2', 1, '2', 0, 'bad', -4]), [2, 1], 'IDs must be positive and unique');
  assert.throws(() => normaliseClientIds(Array.from({ length: MAX_BULK_CLAIMS + 1 }, (_, index) => index + 1)),
    /Select no more than/, 'The server must bound oversized submissions');

  let active = 0;
  let maxActive = 0;
  const attempted = [];
  const ids = Array.from({ length: 100 }, (_, index) => index + 1);
  const summary = await bulkClaimClients([...ids, '1', 'not-an-id'], { claimant: { id: 7, name: 'Staff Agent' } }, {
    claimClient: async clientId => {
      attempted.push(clientId);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      if (clientId === 40) return { status: 'conflict', currentAssigneeName: 'Another Agent' };
      if (clientId === 75) return { status: 'claimed', idempotent: true };
      if (clientId === 88) throw new Error('Simulated bad record');
      return { status: 'claimed', idempotent: false };
    }
  });

  assert.deepStrictEqual(summary, { selected: 100, claimed: 97, alreadyMine: 1, conflicts: 1, failed: 1 });
  assert.strictEqual(attempted.length, 100, 'Every unique selected account must be attempted');
  assert.strictEqual(maxActive, 1, 'Bulk claims must run in sequence to avoid connection spikes and isolate results');
  await assert.rejects(() => bulkClaimClients([], { claimant: { id: 7 } }, { claimClient: async () => ({}) }),
    /Select at least one/, 'An empty submission must be rejected');

  const html = renderAssignmentCentre();
  assert(html.includes('action="/clients/bulk-claim"'));
  assert(html.includes('data-bulk-select-all') && html.includes('data-bulk-submit'));
  assert(html.includes('name="client_ids[]" value="10"'));
  assert(html.includes('name="client_ids[]" value="20"') && html.includes('disabled'));
  assert(html.includes('/public/js/client-assignment-centre.js'));
  assert(!html.includes('/clients/10/request-claim'), 'Unassigned accounts must use one bulk form instead of redirecting per account');

  const resultHtml = renderAssignmentCentre({
    clients: [],
    bulkResult: { complete: true, claimed: 98, alreadyMine: 0, conflicts: 2, failed: 0 }
  });
  assert(resultHtml.includes('98 claimed immediately'));
  assert(resultHtml.includes('2 conflicts sent to the Owner'));
  assert(resultHtml.includes('Open My Accounts'));

  const route = read('src/routes/client-assignment-centre.js');
  assert(route.includes("router.post('/clients/bulk-claim'"));
  assert(route.indexOf("router.post('/clients/bulk-claim'") < route.indexOf("router.post('/clients/:id/request-claim'"),
    'The literal bulk endpoint must be registered before the parameter route');
  assert(route.includes('await bulkClaimClients(req.body.client_ids'));
  assert(route.includes("view: 'unassigned'"), 'Bulk completion must return staff to the unassigned list');

  const browser = read('public/js/client-assignment-centre.js');
  const styles = read('public/css/client-assignment-centre.css');
  assert(browser.includes('selectAll.indeterminate') && browser.includes('Claiming ${selected}'));
  assert(styles.includes('.bulk-claim-toolbar{position:sticky'));

  console.log('Bulk client claim validation passed (100-account batch).');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
