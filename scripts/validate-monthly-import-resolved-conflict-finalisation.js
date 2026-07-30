'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');
const {
  MOBILE_PHONE_FIELDS,
  finaliseMonthlyImport,
  isFinalisableAction,
  requireResolvedMobileTarget,
  requireUniqueMobileTarget,
  resolvedMobileCandidateIds
} = require('../src/services/monthly-import-finaliser');

const canonicalPhone = '27765143149';
const finaliserSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'monthly-import-finaliser.js'),
  'utf8'
);

assert(finaliserSource.includes('m.reviewed_by,m.reviewed_at,m.review_notes,m.candidate_json'));
assert(finaliserSource.includes('reviewed_by=COALESCE(reviewed_by,:userId)'));
assert(finaliserSource.includes('approved_by=COALESCE(approved_by,:userId)'));
assert(finaliserSource.includes('other matching client records were not changed'));
assert(finaliserSource.includes('await connection.rollback()'));

function client(id, field = 'cell_number_normalised', value = canonicalPhone) {
  return {
    id,
    client_name: `Client ${id}`,
    cell_number: null,
    cell_number_normalised: null,
    main_contact_number: null,
    main_contact_number_normalised: null,
    alt_number: null,
    package_name: null,
    contract_term_months: 36,
    [field]: value
  };
}

function resolvedAction(overrides = {}) {
  return {
    id: 701,
    action_id: 701,
    import_row_id: 901,
    row_id: 901,
    match_id: 801,
    action_type: 'resolve_mobile_conflict',
    target_entity_type: 'clients',
    target_entity_id: 101,
    approval_status: 'approved',
    approved_by: 12,
    approved_at: '2026-07-30 09:00:00',
    applied_status: 'not_applied',
    classification: 'conflict',
    review_status: 'approved',
    reviewed_by: 12,
    reviewed_at: '2026-07-30 08:59:00',
    review_notes: 'Manager selected client 101.',
    candidate_json: JSON.stringify({
      canonicalPhone,
      clients: [{ id: 101 }, { id: 202 }]
    }),
    proposed_client_id: 101,
    proposed_account_id: null,
    proposed_fixed_account_id: null,
    proposed_fixed_service_id: null,
    phone_original: '076 514 3149',
    phone_normalised: canonicalPhone,
    customer_name: 'Imported Customer',
    transaction_date: null,
    agent_code: null,
    package_name: 'Imported Package',
    import_type: 'new_connection',
    source_system: 'Dealer report',
    ...overrides
  };
}

function createStatefulConnection(actions, clients) {
  const state = {
    actions: actions.map(action => ({ ...action })),
    clients: clients.map(value => ({ ...value })),
    audits: [],
    updateCounts: new Map(),
    commits: 0,
    rollbacks: 0
  };
  let snapshot = null;

  const connection = {
    state,
    async beginTransaction() {
      snapshot = {
        actions: structuredClone(state.actions),
        clients: structuredClone(state.clients),
        audits: structuredClone(state.audits),
        updateCounts: new Map(state.updateCounts)
      };
    },
    async query(sql) {
      if (!sql.includes('FROM monthly_import_actions a')) throw new Error(`Unexpected query: ${sql}`);
      const finalised = state.actions.filter(action => action.applied_status === 'applied').length;
      return [[{
        finalised,
        failed: 0,
        approved_ready: state.actions.filter(action => action.approval_status === 'approved' && action.applied_status === 'not_applied').length,
        proposed_new: 0,
        unresolved: 0,
        excluded: state.actions.filter(action => ['rejected', 'deferred'].includes(action.approval_status)).length,
        mobile_updates: 0,
        fixed_updates: 0,
        provisional_mobile: 0,
        fixed_creates: 0
      }]];
    },
    async execute(sql, params = {}) {
      if (sql.includes('FROM monthly_import_actions a') && sql.includes('ORDER BY a.id')) {
        return [state.actions.filter(isFinalisableAction).map(action => ({ ...action }))];
      }
      if (sql.includes('FROM clients') && sql.includes('WHERE COALESCE(')) {
        return [state.clients.map(value => ({ ...value }))];
      }
      if (sql.includes('SELECT * FROM clients WHERE id=:id')) {
        const found = state.clients.find(value => Number(value.id) === Number(params.id));
        return [[found ? { ...found } : undefined]];
      }
      if (sql.includes('UPDATE clients SET')) {
        const found = state.clients.find(value => Number(value.id) === Number(params.id));
        if (!found) throw new Error(`Missing mock client ${params.id}`);
        if (!String(found.package_name || '').trim()) found.package_name = params.packageName;
        state.updateCounts.set(Number(params.id), (state.updateCounts.get(Number(params.id)) || 0) + 1);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE monthly_import_actions')) {
        const found = state.actions.find(value => Number(value.action_id) === Number(params.id));
        found.applied_status = 'applied';
        found.approval_status = 'approved';
        found.target_entity_type = params.targetType;
        found.target_entity_id = params.targetId;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE monthly_import_matches')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO audit_log')) {
        state.audits.push({ ...params });
        return [{ insertId: state.audits.length }];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    },
    async commit() {
      state.commits += 1;
      snapshot = null;
    },
    async rollback() {
      state.rollbacks += 1;
      if (snapshot) {
        state.actions = snapshot.actions;
        state.clients = snapshot.clients;
        state.audits = snapshot.audits;
        state.updateCounts = snapshot.updateCounts;
        snapshot = null;
      }
    },
    release() {}
  };
  return connection;
}

async function main() {
  const allowed = resolvedAction();
  assert.deepStrictEqual(resolvedMobileCandidateIds(allowed.candidate_json), [101, 202]);

  // A deterministic exact match must retain global uniqueness.
  assert.throws(
    () => requireUniqueMobileTarget([client(101), client(202)], canonicalPhone, 101),
    /matches multiple clients/,
    'Automatic exact matches must still reject a globally ambiguous phone.'
  );

  // A resolved conflict validates the selected target through every matcher field.
  for (const field of MOBILE_PHONE_FIELDS) {
    assert.strictEqual(
      requireResolvedMobileTarget(allowed, client(101, field, field.includes('normalised') ? canonicalPhone : '076 514 3149'), canonicalPhone),
      101,
      `A selected client matching through ${field} must remain valid.`
    );
  }
  assert.throws(
    () => requireResolvedMobileTarget({ ...allowed, candidate_json: '{' }, client(101), canonicalPhone),
    /stored mobile conflict candidates are invalid/
  );
  assert.throws(
    () => requireResolvedMobileTarget({
      ...allowed,
      candidate_json: JSON.stringify({ clients: [{ id: 101 }] })
    }, client(101), canonicalPhone),
    /stored mobile conflict candidates are invalid/
  );
  assert.throws(
    () => requireResolvedMobileTarget({
      ...allowed,
      candidate_json: JSON.stringify({ clients: [{ id: 202 }, { id: 303 }] })
    }, client(101), canonicalPhone),
    /not an allowed candidate/
  );
  assert.throws(
    () => requireResolvedMobileTarget({ ...allowed, proposed_client_id: 202 }, client(101), canonicalPhone),
    /disagrees with the stored manager selection/
  );
  assert.throws(
    () => requireResolvedMobileTarget({ ...allowed, target_entity_type: 'fixed_services' }, client(101), canonicalPhone),
    /target type must be clients/
  );
  assert.throws(
    () => requireResolvedMobileTarget({ ...allowed, review_status: 'deferred' }, client(101), canonicalPhone),
    /not approved/
  );
  assert.throws(
    () => requireResolvedMobileTarget({ ...allowed, applied_status: 'applied' }, client(101), canonicalPhone),
    /already been applied/
  );
  assert.throws(
    () => requireResolvedMobileTarget(allowed, null, canonicalPhone),
    /no longer exists/
  );
  assert.throws(
    () => requireResolvedMobileTarget(allowed, client(101, 'cell_number', '083 000 0000'), canonicalPhone),
    /selected client no longer matches this imported phone/
  );
  assert.strictEqual(isFinalisableAction({ ...allowed, approval_status: 'rejected' }), false);
  assert.strictEqual(isFinalisableAction({ ...allowed, approval_status: 'deferred' }), false);

  const selected = client(101);
  const unselected = { ...client(202), package_name: 'Untouched Package', notes: 'Keep me unchanged' };
  const successConnection = createStatefulConnection([allowed], [selected, unselected]);
  const originalGetConnection = db.getConnection;
  db.getConnection = async () => successConnection;
  try {
    const beforeUnselected = structuredClone(unselected);
    const first = await finaliseMonthlyImport({ userId: 12, ip: '127.0.0.1', userAgent: 'validator' });
    assert.strictEqual(first.applied, 1, 'An approved resolved conflict must apply with two live phone matches.');
    assert.strictEqual(successConnection.state.clients.find(value => value.id === 101).package_name, 'Imported Package');
    assert.deepStrictEqual(
      successConnection.state.clients.find(value => value.id === 202),
      beforeUnselected,
      'The unselected matching client must remain completely unchanged.'
    );
    assert.strictEqual(successConnection.state.updateCounts.get(101), 1);
    assert.strictEqual(successConnection.state.updateCounts.has(202), false);
    assert(successConnection.state.audits.some(entry =>
      entry.description.includes('manually resolved mobile conflict')
      && entry.description.includes('selected client #101')
      && entry.description.includes('other matching client records were not changed')
    ), 'Audit output must identify the selected manager-resolved target and unchanged alternatives.');

    const second = await finaliseMonthlyImport({ userId: 12, ip: '127.0.0.1', userAgent: 'validator' });
    assert.strictEqual(second.applied, 0, 'Repeated finalisation must apply no action twice.');
    assert.strictEqual(successConnection.state.updateCounts.get(101), 1, 'Repeated finalisation must create no duplicate update.');

    const rollbackConnection = createStatefulConnection([
      resolvedAction(),
      resolvedAction({
        id: 702,
        action_id: 702,
        match_id: 802,
        target_entity_id: 303,
        proposed_client_id: 303,
        candidate_json: JSON.stringify({ clients: [{ id: 303 }, { id: 404 }] })
      })
    ], [
      client(101),
      client(202),
      client(303, 'cell_number', '083 000 0000'),
      client(404)
    ]);
    db.getConnection = async () => rollbackConnection;
    await assert.rejects(
      finaliseMonthlyImport({ userId: 12, ip: '127.0.0.1', userAgent: 'validator' }),
      /selected client no longer matches this imported phone/
    );
    assert.strictEqual(rollbackConnection.state.rollbacks, 1, 'A stale resolved conflict must roll back the complete transaction.');
    assert.strictEqual(rollbackConnection.state.actions.every(action => action.applied_status === 'not_applied'), true);
    assert.strictEqual(rollbackConnection.state.clients.find(value => value.id === 101).package_name, null);
    assert.strictEqual(rollbackConnection.state.audits.length, 0, 'Rolled-back audit writes must not survive.');
  } finally {
    db.getConnection = originalGetConnection;
  }

  console.log('Monthly import resolved-conflict finalisation validation passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
