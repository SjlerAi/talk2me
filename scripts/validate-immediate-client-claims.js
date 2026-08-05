const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { claimClient } = require('../src/services/client-claim');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}

function fakeDatabase(options = {}) {
  const state = {
    clients: [
      { id: 10, account_id: 50, account_number: 'AC 100', client_name: 'Acme Main', is_active: 1 },
      { id: 11, account_id: 50, account_number: 'AC 100', client_name: 'Acme Line', is_active: 1 }
    ],
    account: { id: 50, account_number: 'AC 100', account_number_normalised: 'AC100', assigned_staff_id: null },
    staff: new Map([[1, { id: 1, full_name: 'Owner One' }], [2, { id: 2, full_name: 'Alice Agent' }], [3, { id: 3, full_name: 'Bob Agent' }]]),
    assignments: new Map(),
    requests: options.requests ? options.requests.map(row => ({ ...row })) : [],
    tasks: [], audits: [], nextRequestId: 100
  };
  let locked = false;
  const waiters = [];
  async function lock() {
    if (!locked) { locked = true; return; }
    await new Promise(resolve => waiters.push(resolve));
    locked = true;
  }
  function unlock() { locked = false; const next = waiters.shift(); if (next) next(); }

  function connection() {
    let ownsLock = false;
    return {
      async beginTransaction() {},
      async commit() { if (ownsLock) { ownsLock = false; unlock(); } },
      async rollback() { if (ownsLock) { ownsLock = false; unlock(); } },
      release() {},
      async query(sql) {
        if (sql.includes('FROM client_assignments a')) {
          return [[...state.assignments.values()].map(row => ({
            ...row, assigned_staff_name: state.staff.get(row.assigned_staff_id).full_name
          }))];
        }
        if (sql.includes('FROM data_change_requests r')) {
          return [state.requests.filter(row => ['pending_manager', 'pending_owner'].includes(row.status))];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      async execute(sql, params = {}) {
        if (sql.includes('FROM clients WHERE id=:clientId') && sql.includes('FOR UPDATE')) {
          if (!ownsLock) { await lock(); ownsLock = true; }
          return [[state.clients.find(client => client.id === Number(params.clientId)) || null]];
        }
        if (sql.includes('FROM clients') && sql.includes('ORDER BY id FOR UPDATE')) return [state.clients.map(row => ({ ...row }))];
        if (sql.includes('FROM customer_accounts')) return [[{ ...state.account }]];
        if (sql.includes('INSERT INTO staff_tasks')) { state.tasks.push({ message: params.message }); return [{ affectedRows: 1 }]; }
        if (sql.includes('FROM staff_users')) return [[state.staff.get(Number(params.id)) || null]];
        if (sql.includes('INSERT INTO client_assignments')) {
          state.assignments.set(Number(params.clientId), {
            id: Number(params.clientId), client_id: Number(params.clientId), account_number: params.accountNumber,
            assigned_staff_id: Number(params.staffId), assigned_at: new Date().toISOString(), updated_at: new Date().toISOString()
          });
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('UPDATE customer_accounts SET')) {
          state.account.assigned_staff_id = Number(params.staffId);
          state.account.assignment_confirmed_at = new Date().toISOString();
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('UPDATE fixed_accounts SET')) return [{ affectedRows: 0 }];
        if (sql.includes('INSERT INTO audit_log')) {
          state.audits.push({ ...params, before: JSON.parse(params.beforeJson), after: JSON.parse(params.afterJson) });
          return [{ insertId: state.audits.length }];
        }
        if (sql.includes('INSERT INTO data_change_requests')) {
          const row = {
            id: state.nextRequestId++, request_type: 'claim_client', client_id: Number(params.clientId),
            record_id: Number(params.recordId), account_number: params.accountNumber, requested_by: Number(params.requestedBy),
            status: 'pending_owner', proposed_data_json: params.proposal, created_at: new Date().toISOString()
          };
          state.requests.push(row);
          return [{ insertId: row.id }];
        }
        if (sql.includes('UPDATE data_change_requests SET')) {
          const row = state.requests.find(request => request.id === Number(params.id));
          if (row) {
            if (sql.includes("status='applied'")) row.status = 'applied';
            if (sql.includes("status='pending_owner'")) row.status = 'pending_owner';
            if (sql.includes("status='cancelled'")) row.status = 'cancelled';
            if (params.proposal) row.proposed_data_json = params.proposal;
          }
          return [{ affectedRows: row ? 1 : 0 }];
        }
        throw new Error(`Unexpected execute: ${sql}`);
      }
    };
  }
  return { state, getConnection: async () => connection() };
}

function context(id, name) {
  return { claimant: { id, name }, ipAddress: '127.0.0.1', userAgent: 'claim-validator', basePath: '/talk2me' };
}

async function run() {
  const database = fakeDatabase();
  const first = await claimClient(10, context(2, 'Alice Agent'), database);
  assert.strictEqual(first.status, 'claimed');
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(database.state.account.assigned_staff_id, 2, 'Claimant must become the account assignee');
  assert.deepStrictEqual([...database.state.assignments.keys()], [10, 11], 'Every linked client must receive one assignment row');
  assert.strictEqual(database.state.requests.length, 0, 'A successful claim must not create an approval request');
  assert.strictEqual(database.state.audits[0].staffId, 2);
  assert.strictEqual(database.state.audits[0].after.account_id, 50);
  assert.deepStrictEqual(database.state.audits[0].after.client_ids, [10, 11]);
  assert.strictEqual(database.state.audits[0].ip, '127.0.0.1');
  assert.strictEqual(database.state.audits[0].userAgent, 'claim-validator');
  assert.strictEqual(database.state.audits[0].after.result, 'claimed');

  const retry = await claimClient(11, context(2, 'Alice Agent'), database);
  assert.strictEqual(retry.idempotent, true, 'Same-user retries must be idempotent');
  assert.strictEqual(database.state.assignments.size, 2, 'Retry must not duplicate assignment rows');
  assert.strictEqual(database.state.requests.length, 0);

  const conflict = await claimClient(10, context(3, 'Bob Agent'), database);
  assert.strictEqual(conflict.status, 'conflict');
  assert.strictEqual(database.state.account.assigned_staff_id, 2, 'A competing claim must not overwrite ownership');
  assert.strictEqual(database.state.requests.length, 1);
  assert.strictEqual(database.state.tasks.length, 1);
  const proposal = JSON.parse(database.state.requests[0].proposed_data_json);
  assert.strictEqual(proposal.claimant_name, 'Bob Agent');
  assert.strictEqual(proposal.current_assignee_name, 'Alice Agent');
  assert(proposal.claim_timestamp && proposal.current_assignment_timestamp && proposal.links.owner_resolution);

  await claimClient(11, context(3, 'Bob Agent'), database);
  assert.strictEqual(database.state.requests.length, 1, 'A retry must reuse the unresolved conflict');
  assert.strictEqual(database.state.tasks.length, 1, 'A retry must not duplicate owner notifications');

  const concurrentDb = fakeDatabase();
  const concurrent = await Promise.all([
    claimClient(10, context(2, 'Alice Agent'), concurrentDb),
    claimClient(11, context(3, 'Bob Agent'), concurrentDb)
  ]);
  assert.strictEqual(concurrent.filter(result => result.status === 'claimed').length, 1, 'Only one concurrent first claim may win');
  assert.strictEqual(concurrent.filter(result => result.status === 'conflict').length, 1);
  assert.strictEqual(new Set([...concurrentDb.state.assignments.values()].map(row => row.assigned_staff_id)).size, 1);

  const legacyDb = fakeDatabase({ requests: [{
    id: 80, request_type: 'claim_account', record_id: 50, client_id: 10, account_number: 'AC 100',
    requested_by: 2, status: 'pending_manager', proposed_data_json: '{}', created_at: '2026-01-01T08:00:00Z'
  }] });
  await claimClient(10, context(2, 'Alice Agent'), legacyDb);
  assert.strictEqual(legacyDb.state.requests[0].status, 'applied', 'An already-applied same-user legacy claim must be recognised');
  assert.strictEqual(legacyDb.state.requests.length, 1, 'Legacy history must be preserved without duplicates');

  const legacyConflictDb = fakeDatabase({ requests: [80, 81].map(id => ({
    id, request_type: 'claim_account', record_id: 50, client_id: 10, account_number: 'AC 100',
    requested_by: 3, status: 'pending_manager', proposed_data_json: '{}', created_at: `2026-01-0${id - 79}T08:00:00Z`
  })) });
  await claimClient(10, context(2, 'Alice Agent'), legacyConflictDb);
  assert.strictEqual(legacyConflictDb.state.requests.filter(row => row.status === 'pending_owner').length, 1,
    'Duplicate legacy claims must surface as one owner conflict');
  assert.strictEqual(legacyConflictDb.state.requests.filter(row => row.status === 'cancelled').length, 1);
  assert.strictEqual(legacyConflictDb.state.tasks.length, 1, 'A legacy conflict must notify the owner once');

  const service = read('src/services/client-claim.js');
  const assignmentRoute = read('src/routes/client-assignment-centre.js');
  const indexRoute = read('src/routes/index.js');
  const decisionRoute = read('src/routes/approval-decisions-safe.js');
  const provisionalService = read('src/services/provisional-account-approval.js');
  const assignmentTemplate = read('views/client-assignment-centre.ejs');
  const customerTemplate = read('views/customer-360.ejs');
  const approvalTemplate = read('views/approval-centre.ejs');
  const schemaSql = read('sql/ONE_OFF_089_immediate_client_claims.sql');
  assert(service.includes('await conn.beginTransaction()') && service.includes('ORDER BY id FOR UPDATE'));
  assert(service.includes("s.role='owner'") && service.includes('conflict_notification_created'));
  assert(!assignmentRoute.includes("VALUES ('claim_client','clients',:clientId,:clientId,:account,:summary,:reason,:json,'manager','pending_manager'"));
  assert(!indexRoute.includes("VALUES ('claim_account','customer_accounts',:accountId,:clientId,:accountNumber,:summary,:reason,:json,'manager','pending_manager'"));
  assert(assignmentRoute.includes('claimClient(requestedClientId'));
  assert(indexRoute.includes('claimClient(clientId'));
  assert(assignmentTemplate.includes('Claim client') && customerTemplate.includes('Claim client'));
  assert(assignmentTemplate.includes('Client claimed successfully.') && customerTemplate.includes('Client claimed successfully.'));
  assert(!assignmentTemplate.includes('waiting for approval') && !customerTemplate.includes('waiting for approval'));
  assert(assignmentRoute.includes("query.set('panel', '1')") && indexRoute.includes("query.set('panel','1')"));
  assert(decisionRoute.includes('applyProvisionalAccountApproval(conn'), 'Provisional account-number approval must remain wired in');
  assert(provisionalService.includes("request_type || '') !== 'assign_account_number'"));
  assert(assignmentRoute.includes('Only an owner can reassign a client while resolving an ownership conflict.'));
  assert(approvalTemplate.includes('Assign to claimant') && approvalTemplate.includes('Keep current assignment'));
  assert(approvalTemplate.includes("item.ownershipConflict||currentUser.role==='owner'"));
  assert(indexRoute.includes("router.post('/backoffice/clients/:id/assign', requireAuth, requireRole('owner','manager')"));
  assert(indexRoute.includes("router.post('/backoffice/clients/:id/delete', requireAuth, requireRole('owner')"));
  assert(schemaSql.includes("LOCATE('''claim_client'''") && schemaSql.includes('@t2m_claim_column_type'),
    'The enum extension must preserve the database current request-type definition');

  for (const template of filesBelow(path.join(root, 'views')).filter(file => file.endsWith('.ejs'))) {
    ejs.compile(fs.readFileSync(template, 'utf8'), { filename: template });
  }
  console.log('Immediate client claim validation passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
