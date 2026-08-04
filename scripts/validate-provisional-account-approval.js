const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  applyProvisionalAccountApproval,
  canAccessGeneralApprovals,
  canAccessProvisionalApproval,
  isProvisionalAccountRequest,
  normaliseOfficialAccountNumber
} = require('../src/services/provisional-account-approval');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}
const decisionRoute = read('src/routes/approval-decisions-safe.js');
const centreRoute = read('src/routes/approval-centre.js');
const serviceSource = read('src/services/provisional-account-approval.js');
const templateSource = read('views/approval-centre.ejs');
const permissionSource = read('src/middleware/permissions.js');
const indexSource = read('src/routes/index.js');
const accountSchema = read('migrations/023_v3_2_0_unique_customer_accounts_and_claims.sql');

for (const role of ['owner', 'manager', 'admin']) {
  assert(canAccessProvisionalApproval({ role }), `${role} must access provisional approvals`);
}
assert(!canAccessProvisionalApproval({ role: 'staff' }), 'Staff must not access provisional approvals');
assert(canAccessGeneralApprovals({ role: 'owner' }));
assert(canAccessGeneralApprovals({ role: 'manager' }));
assert(!canAccessGeneralApprovals({ role: 'admin' }), 'Admin must not receive unrelated approval access');
assert(!canAccessGeneralApprovals({ role: 'staff' }));

assert.throws(() => normaliseOfficialAccountNumber('   '), /Official account number required/);
assert.strictEqual(normaliseOfficialAccountNumber(' vb 0123 '), 'VB0123');
assert.throws(() => normaliseOfficialAccountNumber('bad account!'), /valid official account number/);
assert(isProvisionalAccountRequest({
  request_type: 'assign_account_number', entity_type: 'clients',
  proposed_data_json: JSON.stringify({ monthly_import_row_id: 87 })
}));
assert(isProvisionalAccountRequest({ request_type: 'assign_account_number', entity_type: 'clients' }, {
  provisional_client_ids: [1], fixed_service: { branch_name: 'Main' }
}));
assert(!isProvisionalAccountRequest({ request_type: 'update_client', entity_type: 'clients' }, {}));

function existingAccountConnection(expectedRole, options = {}) {
  const calls = [];
  const account = {
    id: 44,
    account_number: 'VB0123',
    account_number_normalised: 'VB0123',
    display_name: 'Acme',
    account_status: 'active'
  };
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM clients WHERE id IN')) {
        return [[{ id: 7, account_id: null, account_number: null, client_name: 'Acme', is_active: 1 }]];
      }
      if (sql.includes('FROM client_assignments WHERE client_id IN')) {
        return [[{ client_id: 7, assigned_staff_id: 3, assigned_by: 3, is_active: 1 }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params) {
      calls.push(sql);
      if (sql.includes('FROM customer_accounts WHERE account_number_normalised')) return [[account]];
      if (sql.includes('FROM fixed_accounts')) return [[{
        id: 50, account_id: 44, account_number: 'VB0123', account_number_normalised: 'VB0123',
        linked_mobile_account_number: 'VB0123'
      }]];
      if (sql.includes('UPDATE fixed_accounts SET')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM fixed_services')) return [[{
        id: 71, fixed_account_id: 50, source_row_hash: 'existing', order_number: 'SO-87', solution_id: 'SOL-87'
      }]];
      if (sql.includes('UPDATE clients SET')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO client_assignments')) return [{ affectedRows: 1 }];
      if (sql.includes('UPDATE data_change_requests SET')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO audit_log')) {
        const after = JSON.parse(params.afterJson);
        assert.strictEqual(after.new_official_value, 'VB0123');
        assert.deepStrictEqual(after.affected.customer_ids, [7]);
        assert.strictEqual(after.role, expectedRole);
        assert.strictEqual(after.result, 'linked_existing_account');
        assert(after.official_account_number_entered_by.id);
        assert(after.approved_by.id);
        assert(after.timestamp && after.ip && after.user_agent);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO staff_tasks')) {
        assert(sql.includes("s.role='owner'"));
        assert(params.message.includes('User'));
        assert(params.message.includes('VB0123'));
        assert(params.message.includes('/approvals?tab=history&q=87'));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    }
  };
}

async function run() {
  for (const role of ['owner', 'manager', 'admin']) {
    const connection = existingAccountConnection(role);
    const result = await applyProvisionalAccountApproval(connection, {
      request: {
        id: 87, request_type: 'assign_account_number', entity_type: 'clients', record_id: 7,
        client_id: 7, requested_by: 3, account_number: null, status: 'pending_manager', summary: 'Assign account'
      },
      proposal: { monthly_import_row_id: 999, client_name: 'Acme' },
      officialAccountNumber: ' vb 0123 ',
      comment: 'Supplier account confirmed',
      user: { id: 9, role, full_name: `${role} User` },
      ipAddress: '127.0.0.1',
      userAgent: 'validation-agent',
      historyUrl: '/approvals?tab=history&q=87'
    });
    assert.strictEqual(result.result, 'linked_existing_account');
    assert(!connection.calls.some(sql => sql.includes('INSERT INTO customer_accounts')),
      'An existing account must be linked without duplicate creation');
    assert(connection.calls.some(sql => sql.includes('FOR UPDATE')), 'Target rows must be locked');
    assert(connection.calls.some(sql => sql.includes('INSERT INTO audit_log')), `${role} approval must be audited`);
    assert.strictEqual(
      connection.calls.some(sql => sql.includes('INSERT INTO staff_tasks')),
      role !== 'owner',
      `${role} completion owner-notification behavior is incorrect`
    );
  }

  const fixedConnection = existingAccountConnection('owner', { fixed: true });
  const fixedResult = await applyProvisionalAccountApproval(fixedConnection, {
    request: {
      id: 88, request_type: 'assign_account_number', entity_type: 'clients', record_id: 7,
      client_id: 7, requested_by: 3, account_number: null, status: 'pending_manager', summary: 'Assign fixed account'
    },
    proposal: {
      provisional_client_ids: [7], client_name: 'Acme',
      fixed_service: { branch_name: 'Main', order_number: 'SO-87', solution_id: 'SOL-87' }
    },
    officialAccountNumber: 'VB0123',
    user: { id: 1, role: 'owner', full_name: 'Owner User' },
    ipAddress: '127.0.0.1', userAgent: 'validation-agent',
    historyUrl: '/approvals?tab=history&q=88'
  });
  assert.strictEqual(fixedResult.affected.fixed_account_id, 50);
  assert.strictEqual(fixedResult.affected.fixed_service_id, 71);
  assert(!fixedConnection.calls.some(sql => sql.includes('INSERT INTO fixed_services')),
    'An existing fixed service relationship must be preserved without duplication');

  assert(decisionRoute.includes('await conn.beginTransaction()'));
  assert(decisionRoute.includes('FOR UPDATE'));
  const serviceCallIndex = decisionRoute.indexOf('applyProvisionalAccountApproval(conn');
  assert(serviceCallIndex >= 0 && decisionRoute.indexOf('await conn.commit()', serviceCallIndex) > serviceCallIndex,
    'Approval service work must occur before transaction commit');
  assert(decisionRoute.includes('await conn.rollback()'));
  assert(decisionRoute.includes('!canAccessGeneralApprovals(req.session.user)'));
  assert(centreRoute.includes('canAccessGeneralApprovals(user) || item.provisionalAccountApproval'));
  assert(serviceSource.includes("error.code !== 'ER_DUP_ENTRY'"), 'Duplicate account races must re-read the canonical account');
  assert(accountSchema.includes('UNIQUE KEY uq_customer_accounts_number (account_number_normalised)'),
    'Canonical account number uniqueness must remain enforced by the database');
  assert(serviceSource.includes("status IN ('pending_manager','pending_owner')"), 'Pending status must be revalidated on write');
  assert(serviceSource.includes("['admin', 'manager'].includes(roleOf(user))"));
  assert(serviceSource.includes("s.role='owner' AND s.id<>:createdBy"), 'Owner approval must not self-notify');

  assert(templateSource.includes('Official account number required'));
  assert(templateSource.includes('This imported provisional mobile line or fixed service cannot be approved until the official account number has been entered.'));
  assert(templateSource.includes('Save account number and approve'));
  for (const template of filesBelow(path.join(root, 'views')).filter(file => file.endsWith('.ejs'))) {
    ejs.compile(fs.readFileSync(template, 'utf8'), { filename: template });
  }

  assert(permissionSource.includes("owner: new Set(['*'])"), 'Global permission definitions must remain intact');
  assert(indexSource.includes("router.post('/backoffice/clients/:id/delete', requireAuth, requireRole('owner')"),
    'Customer deletion must remain owner-only');
  assert(indexSource.includes("requireRole('owner','manager')"), 'Existing role-management boundaries must remain unchanged');
  console.log('Provisional account approval validation passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
