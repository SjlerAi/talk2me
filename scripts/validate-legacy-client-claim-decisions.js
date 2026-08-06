'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { extractLegacyClaimRequestId, canDecide, classify, decideLegacyClaim } = require('../src/services/legacy-client-claim-decision');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const task = { title: 'Client claim awaiting approval', message: 'Open the Client Assignment Centre to approve or reject request #7.' };
assert.strictEqual(extractLegacyClaimRequestId(task), 7);
assert.strictEqual(extractLegacyClaimRequestId({ ...task, title: 'Unrelated message' }), null);
assert.strictEqual(extractLegacyClaimRequestId({ ...task, message: 'No request number' }), null);

const pendingManager = { request_type: 'claim_client', status: 'pending_manager', required_approval_role: 'manager', proposed_data_json: '{}' };
const pendingOwner = { ...pendingManager, status: 'pending_owner', required_approval_role: 'owner', proposed_data_json: '{"ownership_conflict":true}' };
assert(canDecide({ role: 'owner' }, pendingManager));
assert(canDecide({ role: 'manager' }, pendingManager));
assert(canDecide({ role: 'admin' }, pendingManager));
assert(!canDecide({ role: 'staff' }, pendingManager));
assert(!canDecide({ role: 'manager' }, pendingOwner));
assert(!canDecide({ role: 'admin' }, pendingOwner));
assert(canDecide({ role: 'owner' }, pendingOwner));

const request = { request_type: 'claim_client', requested_by: 12 };
const scope = overrides => ({ requestedClient: { id: 4, is_active: 1 }, activeClients: [{ id: 4 }], accountId: 3,
  accountNumber: 'A1', accounts: [], assignments: [], fixedAccounts: [], pendingClaims: [{ requested_by: 12 }], ...overrides });
assert.strictEqual(classify(scope(), request, {}).classification, 'safe_to_apply');
assert.strictEqual(classify(scope({ assignments: [{ client_id: 4, assigned_staff_id: 12 }] }), request, {}).classification, 'already_correct');
assert.deepStrictEqual(classify(scope({ assignments: [{ client_id: 4, assigned_staff_id: 19 }] }), request, {}),
  { classification: 'ownership_conflict', reason: 'Ownership conflict - review required' });
assert.strictEqual(classify(scope({ pendingClaims: [{ requested_by: 12 }, { requested_by: 19 }] }), request, {}).classification, 'ownership_conflict');
assert.strictEqual(classify(scope({ requestedClient: { id: 4, is_active: 0 }, activeClients: [] }), request, {}).classification, 'exception');
assert.strictEqual(classify(scope({ assignments: [{ client_id: 99, assigned_staff_id: 12 }] }), request, {}).classification, 'exception');

const service = read('src/services/legacy-client-claim-decision.js');
const route = read('src/routes/legacy-client-claim-decisions.js');
const assignmentRoute = read('src/routes/client-assignment-centre.js');
const inbox = read('views/tasks-work-inbox.ejs');
const detail = read('views/task-work-detail.ejs');
const centre = read('views/client-assignment-centre.ejs');
const server = read('server.js');
assert(service.includes('beginTransaction()') && service.includes('FOR UPDATE'));
assert(service.includes("status='applied'") && service.includes("status='rejected'"));
assert(service.includes('duplicate_request_ids'));
assert(service.includes('INSERT INTO audit_log') && service.includes('ip_address,user_agent'));
assert(service.lastIndexOf('resolveMessages(conn') > service.lastIndexOf("status='applied'"));
assert(route.includes("router.post('/legacy-client-claims/:id/decision'") && route.includes("router.post('/client-claims/:id/decision'"));
assert(assignmentRoute.includes("/client-claims/:id/owner-decision") && assignmentRoute.includes('only for owner resolution'));
assert(inbox.includes('Approve safely') && inbox.includes('Open claim') && inbox.includes('Reject / Review'));
assert(detail.includes('Approve safely') && centre.includes('/legacy-client-claims/'));
assert(inbox.includes('name="panel" value="1"') && route.includes("panelMode(req) ? '&panel=1'"));
assert(server.indexOf("require('./src/routes/legacy-client-claim-decisions')") < server.indexOf("require('./src/routes/client-assignment-centre')"));
assert(!service.includes('CREATE TABLE') && !service.includes('ALTER TABLE'));

const templateFiles = [];
function templates(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) templates(target);
    else if (entry.name.endsWith('.ejs')) templateFiles.push(target);
  }
}
templates(path.join(root, 'views'));
for (const file of templateFiles) ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });

class SafeClaimConnection {
  constructor() {
    this.request = { id: 7, request_type: 'claim_client', record_id: 4, client_id: 4, account_number: 'A1',
      proposed_data_json: '{}', required_approval_role: 'manager', status: 'pending_manager', requested_by: 12 };
    this.messages = [7, 8, 9].map(id => ({ id, title: task.title, message: task.message, status: 'unread', assigned_to: id, related_client_id: 4 }));
    this.assignments = [];
    this.audits = [];
    this.comments = [];
    this.notificationResolutions = 0;
    this.commits = 0;
    this.rollbacks = 0;
  }
  async beginTransaction() { this.inTransaction = true; }
  async commit() { assert(this.inTransaction); this.commits += 1; this.inTransaction = false; }
  async rollback() { this.rollbacks += 1; this.inTransaction = false; }
  release() {}
  async execute(sql, params = {}) { return this.handle(sql, params); }
  async query(sql, params = []) { return this.handle(sql, params); }
  async handle(sql, params) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT * FROM data_change_requests WHERE id=')) return [[{ ...this.request }]];
    if (compact.startsWith('SELECT id,full_name,is_active FROM staff_users')) return [[{ id: 12, full_name: 'Claimant One', is_active: 1 }]];
    if (compact.startsWith('SELECT id,account_id,account_number,client_name,is_active FROM clients WHERE id=')) {
      return [[{ id: 4, account_id: 10, account_number: 'A1', client_name: 'Example Client', is_active: 1 }]];
    }
    if (compact.startsWith('SELECT id,account_number,account_number_normalised,')) {
      return [[{ id: 10, account_number: 'A1', account_number_normalised: 'A1', account_status: 'active', assigned_staff_id: null }]];
    }
    if (compact.startsWith('SELECT id,account_id,account_number,client_name,is_active,')) {
      return [[{ id: 4, account_id: 10, account_number: 'A1', client_name: 'Example Client', is_active: 1 }]];
    }
    if (compact.startsWith('SELECT id,client_id,account_number,assigned_staff_id,')) return [this.assignments.map(row => ({ ...row }))];
    if (compact.startsWith('SELECT id,account_id,account_number,account_number_normalised,')) return [[]];
    if (compact.startsWith("SELECT * FROM data_change_requests WHERE request_type IN")) return [[{ ...this.request }]];
    if (compact.startsWith('INSERT INTO client_assignments')) {
      this.assignments = [{ id: 1, client_id: 4, account_number: 'A1', assigned_staff_id: 12 }];
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith('UPDATE customer_accounts SET assigned_staff_id=')) return [{ affectedRows: 1 }];
    if (compact.startsWith('UPDATE fixed_accounts SET assigned_staff_id=')) return [{ affectedRows: 0 }];
    if (compact.startsWith("UPDATE data_change_requests SET status='applied'")) { this.request.status = 'applied'; return [{ affectedRows: 1 }]; }
    if (compact.startsWith('SELECT id,title,message,status,assigned_to,')) return [this.messages.map(row => ({ ...row }))];
    if (compact.startsWith("UPDATE staff_tasks SET status='completed'")) { this.messages.forEach(row => { row.status = 'completed'; }); return [{ affectedRows: 3 }]; }
    if (compact.startsWith('UPDATE staff_task_notifications SET resolved_at=')) { this.notificationResolutions += 1; return [{ affectedRows: 1 }]; }
    if (compact.startsWith('INSERT INTO staff_task_comments')) { this.comments.push(params); return [{ insertId: this.comments.length }]; }
    if (compact.startsWith('INSERT INTO audit_log')) { this.audits.push(params); return [{ insertId: this.audits.length }]; }
    throw new Error(`Unhandled validation SQL: ${compact}`);
  }
}

async function validateDecisionTransaction() {
  const conn = new SafeClaimConnection();
  const database = { getConnection: async () => conn };
  const result = await decideLegacyClaim(7, 'approve', {
    messageId: 7,
    user: { id: 2, full_name: 'Owner User', role: 'owner' },
    ipAddress: '127.0.0.1', userAgent: 'validation-agent'
  }, database);
  assert.strictEqual(result.classification, 'safe_to_apply');
  assert.strictEqual(conn.request.status, 'applied');
  assert.strictEqual(conn.assignments[0].assigned_staff_id, 12);
  assert(conn.messages.every(row => row.status === 'completed'));
  assert.strictEqual(conn.audits.length, 1);
  assert.strictEqual(conn.comments.length, 3);
  assert.strictEqual(conn.notificationResolutions, 1);
  assert.strictEqual(conn.audits[0].ip, '127.0.0.1');
  assert.strictEqual(conn.audits[0].userAgent, 'validation-agent');
  assert.strictEqual(conn.commits, 1);
  assert.strictEqual(conn.rollbacks, 0);
  const second = await decideLegacyClaim(7, 'approve', { user: { id: 2, full_name: 'Owner User', role: 'owner' } }, database);
  const third = await decideLegacyClaim(7, 'approve', { user: { id: 2, full_name: 'Owner User', role: 'owner' } }, database);
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(third.idempotent, true);
  assert.deepStrictEqual(second.repairedMessageIds, []);
  assert.deepStrictEqual(third.repairedMessageIds, []);
  assert.strictEqual(conn.assignments.length, 1);
  assert.strictEqual(conn.audits.length, 1);
  assert.strictEqual(conn.comments.length, 3);
  assert.strictEqual(conn.notificationResolutions, 1);
  assert(conn.messages.every(row => row.status === 'completed'));
  assert.strictEqual(conn.commits, 3);
  assert.strictEqual(conn.rollbacks, 0);
  conn.messages[0].status = 'unread';
  const staleRepair = await decideLegacyClaim(7, 'approve', { user: { id: 2, full_name: 'Owner User', role: 'owner' } }, database);
  assert.deepStrictEqual(staleRepair.repairedMessageIds, [7]);
  assert.strictEqual(conn.assignments.length, 1);
  assert.strictEqual(conn.audits.length, 1);
  assert.strictEqual(conn.comments.length, 3);
  assert.strictEqual(conn.notificationResolutions, 2);
  assert(conn.messages.every(row => row.status === 'completed'));
  console.log(`Legacy claim decision validation passed (${templateFiles.length} EJS templates compiled).`);
}

validateDecisionTransaction().catch(error => { console.error(error); process.exitCode = 1; });
