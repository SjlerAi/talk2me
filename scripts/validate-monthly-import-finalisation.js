'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SIM_CONTRACT_MONTHS,
  MOBILE_PHONE_FIELDS,
  effectiveContractTerm,
  matchingClientIds,
  requireUniqueMobileTarget,
  isFinalisableAction,
  AUTO_APPROVED_ACTIONS,
  FINALISABLE_NEW_ACTIONS
} = require('../src/services/monthly-import-finaliser');
const { normaliseSouthAfricanMobile } = require('../src/services/sa-phone-normalisation');

assert.deepStrictEqual(
  [...AUTO_APPROVED_ACTIONS].sort(),
  ['link_fixed_service', 'link_mobile_client'],
  'Only deterministic existing-record links may be automatically approved.'
);
assert(!AUTO_APPROVED_ACTIONS.has('resolve_mobile_conflict'));
assert(!AUTO_APPROVED_ACTIONS.has('resolve_fixed_conflict'));
assert(!AUTO_APPROVED_ACTIONS.has('create_mobile_record'));
assert.deepStrictEqual(
  [...FINALISABLE_NEW_ACTIONS].sort(),
  ['create_fixed_service', 'create_mobile_record'],
  'Only safe, matched-account new-record actions may be approved by explicit finalisation.'
);
assert(!FINALISABLE_NEW_ACTIONS.has('create_fixed_account_and_service'));

assert.strictEqual(normaliseSouthAfricanMobile('082 123 4567'), '27821234567');
assert.strictEqual(normaliseSouthAfricanMobile('+27 82 123 4567'), '27821234567');
assert.strictEqual(normaliseSouthAfricanMobile('011 123 4567'), '');

// Contract-term behavior: new/missing terms use the current 36-month rule, while
// any positive trusted term already stored on a client remains unchanged.
assert.strictEqual(SIM_CONTRACT_MONTHS, 36, 'The current SIM-contract rule is 36 months.');
assert.strictEqual(effectiveContractTerm(null), 36, 'A missing trusted term must default to 36 months.');
assert.strictEqual(effectiveContractTerm(undefined), 36, 'An absent trusted term must default to 36 months.');
assert.strictEqual(effectiveContractTerm(0), 36, 'A non-positive term is not trusted and must default to 36 months.');
assert.strictEqual(effectiveContractTerm(24), 24, 'A trusted existing 24-month term must be preserved.');
assert.strictEqual(effectiveContractTerm(48), 48, 'Any trusted positive existing term must be preserved.');

// Exact-match revalidation must canonicalise the same complete field set as the
// matcher and deduplicate multiple matching fields belonging to one client.
assert.deepStrictEqual(MOBILE_PHONE_FIELDS, [
  'cell_number_normalised',
  'cell_number',
  'main_contact_number_normalised',
  'main_contact_number',
  'alt_number'
]);
assert.deepStrictEqual(
  matchingClientIds([{ id: 11, main_contact_number_normalised: '27821234567' }], '082 123 4567'),
  [11],
  'A canonical main-contact match must remain valid.'
);
assert.deepStrictEqual(
  matchingClientIds([{ id: 12, main_contact_number: '+27 82 123 4567' }], '27821234567'),
  [12],
  'A raw main-contact match must remain valid.'
);
assert.deepStrictEqual(
  matchingClientIds([{ id: 13, alt_number: '082-123-4567' }], '+27 82 123 4567'),
  [13],
  'An alternate-number match must remain valid.'
);
assert.deepStrictEqual(
  matchingClientIds([{ id: 14, cell_number: '0821234567', alt_number: '+27 82 123 4567' }], '27821234567'),
  [14],
  'One client matching through multiple supported fields must remain one candidate.'
);
assert.deepStrictEqual(
  matchingClientIds([{ id: 15, cell_number: '0831234567' }], '27821234567'),
  [],
  'A stale phone match must fail revalidation.'
);
assert.deepStrictEqual(
  matchingClientIds([
    { id: 16, cell_number: '0821234567' },
    { id: 17, main_contact_number: '+27 82 123 4567' }
  ], '27821234567'),
  [16, 17],
  'A phone that has become ambiguous must expose both clients and block finalisation.'
);
assert.throws(
  () => requireUniqueMobileTarget([{ id: 15, cell_number: '0831234567' }], '27821234567', 15),
  /no longer has the imported canonical phone/,
  'A stale exact match must block finalisation.'
);
assert.throws(
  () => requireUniqueMobileTarget([
    { id: 16, cell_number: '0821234567' },
    { id: 17, alt_number: '+27 82 123 4567' }
  ], '27821234567', 16),
  /matches multiple clients/,
  'An exact match that has become ambiguous must block finalisation.'
);
assert.strictEqual(
  requireUniqueMobileTarget([{ id: 18, main_contact_number: '0821234567' }], '27821234567', 18),
  18,
  'A unique match through any supported field must pass finalisation revalidation.'
);

// Idempotency predicate: after the first successful application changes the action
// state, the same finalisation selection must contain zero actions.
const rerunActions = [{
  action_type: 'create_mobile_record',
  approval_status: 'pending',
  applied_status: 'not_applied'
}];
assert.strictEqual(rerunActions.filter(isFinalisableAction).length, 1);
rerunActions[0].applied_status = 'applied';
assert.strictEqual(
  rerunActions.filter(isFinalisableAction).length,
  0,
  'A second finalisation run must select zero already-applied actions and create zero duplicates.'
);

const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'monthly-import-finaliser.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'monthly-data-import.js'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'monthly-data-import.ejs'), 'utf8');
const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'ONE_OFF_064_monthly_import_finalisation.sql'), 'utf8');
assert(service.includes("WHERE a.applied_status='not_applied'"), 'Finalisation must skip already-applied actions.');
assert(service.includes('FOR UPDATE'), 'Finalisation must lock the selected action and target rows.');
assert(service.includes('await connection.beginTransaction()'), 'Finalisation must use a database transaction.');
assert(service.includes('await connection.rollback()'), 'Finalisation must roll back on failure.');
assert(service.includes("m.classification='conflict'"), 'Unresolved conflicts must be counted and block finalisation.');
assert(service.includes('source_row_hash=:hash'), 'Fixed-service source hashes must be checked before writes.');
assert(service.includes('order_number=:orderNumber'), 'Fixed order-number uniqueness must be checked before writes.');
assert(service.includes('solution_id=:solutionId'), 'Fixed solution-ID uniqueness must be checked before writes.');
assert(service.includes('monthly_import_action_applied'), 'Applied action transitions must be audited.');
assert(service.includes('monthly_import_finalised'), 'The finalisation run must be audited.');
assert(!/\b24\b/.test(service), 'The Monthly Import finaliser must not contain a hard-coded 24-month default.');
assert(service.includes('contractTerm: SIM_CONTRACT_MONTHS'), 'New provisional mobile records must use the 36-month constant.');
assert(
  service.includes('contract_term_months IS NULL OR contract_term_months<=0 THEN :defaultTerm ELSE contract_term_months'),
  'Missing client contract terms must use the 36-month default for upgrade-date calculations.'
);
assert(
  service.includes('ELSE contract_term_months END'),
  'Trusted existing positive contract terms must be preserved.'
);
assert(service.includes('main_contact_number_normalised,main_contact_number,alt_number'), 'Finalisation must load all matcher phone fields.');
assert(routes.includes("name: 'dealer_reports', maxCount: 10"), 'Monthly upload must accept multiple report files.');
assert(routes.includes("router.post('/backoffice/data-import/process'"), 'The unified process route must exist.');
assert(routes.includes("router.post('/backoffice/data-import/finalise', requireAuth, managerOwnerOnly"), 'Only managers and owners may finalise.');
assert(routes.includes('Legacy finalisation is disabled. Finalise only safe records through Monthly Import Management.'),
  'The legacy finalisation POST must refuse to bypass bulk-safe processing.');
assert(!view.includes('name="confirm_finalise"'), 'The retired legacy finalisation form must not be rendered.');
assert(view.includes('/backoffice/monthly-import-management'), 'The legacy page must link to bulk-safe management.');
assert(view.includes('/backoffice/monthly-import-management/exceptions'), 'The legacy page must link to exception review.');
assert(view.includes("panelMode?'?panel=1':''"), 'Monthly Import links and forms must preserve panel mode.');
assert(view.includes('-monthly-import-64'), 'The Monthly Import stylesheet cache key must be versioned for issue 64.');

// Mirror the reviewed SQL's append-only transformation to prove that every known
// and future enum value is retained, and that rerunning it makes no further change.
function appendEnumValue(columnType, value) {
  const quoted = `'${value.replace(/'/g, "''")}'`;
  if (columnType.includes(quoted)) return columnType;
  assert(/^enum\(.+\)$/i.test(columnType), 'Preflight COLUMN_TYPE must be a valid enum.');
  return `${columnType.slice(0, -1)},${quoted})`;
}
const migration024 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '024_v3_2_3_line_service_editing.sql'), 'utf8');
const existingRequestTypes = [...migration024.matchAll(/'([^']+)'/g)].map(match => match[1]);
existingRequestTypes.push('future_production_workflow');
const currentColumnType = `enum(${existingRequestTypes.map(value => `'${value}'`).join(',')})`;
const extendedColumnType = appendEnumValue(currentColumnType, 'assign_account_number');
for (const value of existingRequestTypes) {
  assert(extendedColumnType.includes(`'${value}'`), `Existing request_type ${value} must be preserved.`);
}
assert(extendedColumnType.endsWith(",'assign_account_number')"), 'assign_account_number must be appended when missing.');
assert.strictEqual(
  appendEnumValue(extendedColumnType, 'assign_account_number'),
  extendedColumnType,
  'assign_account_number must not be added again when already present.'
);
assert(sql.includes('FROM information_schema.COLUMNS'), 'The one-off SQL must preflight the live column schema.');
assert(sql.includes('COLUMN_TYPE'), 'The one-off SQL must read the live COLUMN_TYPE.');
assert(sql.includes('LEFT(@t2m_request_type_column_type'), 'The ALTER must derive its enum from the complete live COLUMN_TYPE.');
assert(sql.includes("LOCATE('''assign_account_number'''"), 'The SQL must add assign_account_number only when missing.');
assert(!sql.includes("'create_client'"), 'The reviewed SQL must not replace the enum with a hard-coded value list.');

console.log('Monthly import finalisation validation passed.');
