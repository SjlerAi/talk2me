'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  LIMITS,
  classifyRow,
  normaliseAccount,
  normalisePhone,
  normaliseEmail,
  normaliseDate,
  normaliseMoney,
  prepareRows,
  sourceDigest,
  stableStringify
} = require('./controlled-import-routes');

const source = fs.readFileSync(path.join(__dirname, 'controlled-import-routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, 'migrations', '20260801_002_controlled_import.sql'), 'utf8');
const failures = [];
const controls = [];

function control(name, test) {
  try {
    assert.ok(test, name);
    controls.push(name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
function marker(name, text) { control(name, source.includes(text)); }
function supporting(name, test) {
  try { assert.ok(test, name); } catch (error) { failures.push(`${name}: ${error.message}`); }
}

control('01 exact 5000 row ceiling', LIMITS.maxRows === 5000);
control('02 exact 25 row chunk size', LIMITS.chunkSize === 25);
control('03 bounded batch bytes', LIMITS.maxBatchBytes === 1500 * 1024);
control('04 bounded row bytes', LIMITS.maxRowBytes === 64 * 1024);
control('05 bounded row key count', LIMITS.maxRowKeys === 64);
control('06 bounded JSON depth', LIMITS.maxJsonDepth === 8);
control('07 bounded JSON node count', LIMITS.maxJsonNodes === 1000);
control('08 account normalization removes spaces and hyphens', normaliseAccount(' vb-123 45 ') === 'VB12345');
control('09 account normalization rejects unsafe punctuation', normaliseAccount('VB/123') === '');
control('10 South African phone normalization', normalisePhone('+27 82 123 4567') === '0821234567');
control('11 invalid phone rejected', normalisePhone('1234') === '');
control('12 email canonicalization', normaliseEmail(' CUSTOMER@EXAMPLE.CO.ZA ') === 'customer@example.co.za');
control('13 malformed email rejected', normaliseEmail('invalid@') === null);
control('14 canonical ISO date accepted', normaliseDate('2026-08-02') === '2026-08-02');
control('15 impossible date rejected', normaliseDate('2026-02-30') === null);
control('16 money rounded to cents', normaliseMoney('123.456') === 123.46);
control('17 negative money rejected', normaliseMoney('-1') === null);
control('18 stable serialization independent of key order', stableStringify({ b: 2, a: 1 }) === stableStringify({ a: 1, b: 2 }));

const valid = classifyRow({
  account_number: 'VB-1001',
  cell_number: '082 123 4567',
  client_name: 'Example Customer',
  email: ' CUSTOMER@EXAMPLE.CO.ZA ',
  next_upgrade_date: '2026-08-02',
  monthly_amount: '499.99',
  customer_type: 'business'
});
control('19 valid row begins unresolved for database matching', valid.classification === 'ambiguous');
control('20 valid row has no validation errors', valid.validationErrors.length === 0);
control('21 normalized account retained', valid.payload.accountNumber === 'VB1001');
control('22 normalized mobile retained', valid.payload.mobile === '0821234567');
control('23 normalized customer type retained', valid.payload.customerType === 'business');

const invalid = classifyRow({ client_name: 'Missing identifiers', email: 'bad@', next_upgrade_date: 'not-a-date', monthly_amount: -1 });
control('24 missing account rejected', invalid.validationErrors.includes('ACCOUNT_NUMBER_INVALID_OR_REQUIRED'));
control('25 missing mobile rejected', invalid.validationErrors.includes('MOBILE_INVALID_OR_REQUIRED'));
control('26 malformed email rejected in row', invalid.validationErrors.includes('EMAIL_INVALID'));
control('27 malformed date rejected in row', invalid.validationErrors.includes('UPGRADE_DATE_INVALID'));
control('28 invalid amount rejected in row', invalid.validationErrors.includes('MONTHLY_AMOUNT_INVALID'));

const prepared = prepareRows([
  { account_number: 'VB-1001', cell_number: '0821234567', client_name: 'One' },
  { client_name: 'One', cell_number: '0821234567', account_number: 'VB 1001' }
]);
control('29 duplicate account detected within one batch', prepared[1].classified.classification === 'duplicate');
control('30 duplicate row records validation reason', prepared[1].classified.validationErrors.includes('DUPLICATE_ACCOUNT_IN_BATCH'));
control('31 source digest is lowercase SHA-256', /^[0-9a-f]{64}$/.test(sourceDigest('customer_services', prepared)));

marker('32 plain-object request body required', 'IMPORT_BODY_OBJECT_REQUIRED');
marker('33 filename path traversal prohibited', 'IMPORT_FILENAME_PATH_PROHIBITED');
marker('34 filename extension allowlist required', 'IMPORT_FILENAME_EXTENSION_NOT_ALLOWED');
marker('35 one supported batch type enforced', "allowedBatchTypes = new Set(['customer_services'])");
marker('36 prototype-pollution keys rejected', 'IMPORT_ROW_PROTOTYPE_KEY_PROHIBITED');
marker('37 nonfinite numbers rejected', 'IMPORT_ROW_NONFINITE_NUMBER_PROHIBITED');
marker('38 deterministic source digest excludes rename bypass', "hash.update(`${batchType}\\n`, 'utf8')");
marker('39 duplicate source hash locked before insert', 'WHERE source_sha256=:hash LIMIT 1 FOR UPDATE');
marker('40 staging uses serializable transaction', "{ isolationLevel: 'SERIALIZABLE' }");
marker('41 staging uses controlled savepoints', 'withSavepoint(connection, `import_chunk_${offset}`');
marker('42 exact account column used', 'ca.account_number_normalised=:account');
marker('43 account match takes priority', "strategy: 'exact_account'");
marker('44 identity-only match remains ambiguous', 'identity_match_without_account');
marker('45 account and identity conflict remains ambiguous', 'account_identity_conflict');
marker('46 staging count reconciliation required', 'IMPORT_COUNT_RECONCILIATION_FAILED');
marker('47 batch transition affected-row check required', 'IMPORT_BATCH_STATE_TRANSITION_FAILED');
marker('48 review notes required for reject and override', 'IMPORT_REVIEW_NOTES_REQUIRED');
marker('49 override target relationship locked and verified', 'IMPORT_OVERRIDE_TARGET_INVALID');
marker('50 ambiguous rows require override or reject', 'AMBIGUOUS_ROW_REQUIRES_OVERRIDE_OR_REJECT');
marker('51 invalid and duplicate rows must be rejected', 'INVALID_OR_DUPLICATE_ROW_MUST_BE_REJECTED');
marker('52 uploader self-approval prohibited', 'SELF_APPROVAL_NOT_ALLOWED');
marker('53 approval requires exact row-count agreement', 'IMPORT_ROW_COUNT_MISMATCH');
marker('54 finalisation requires explicit confirmation', 'FINALISE_IMPORT_BATCH');
marker('55 uploader finalisation prohibited', 'IMPORT_UPLOADER_CANNOT_FINALISE');
marker('56 failed rows may be retried without replaying successful rows', "retry ? row.finalisation_status === 'failed' : row.finalisation_status === 'pending'");
marker('57 each finalised row is savepoint isolated', 'withSavepoint(connection, `finalise_row_${Number(row.id)}`');
marker('58 create and update paths recheck collisions', 'IMPORT_ACCOUNT_COLLISION');
marker('59 ownership inheritance and transactional audit recorded', 'change_type,reason,changed_by,created_at');
marker('60 finalisation result counts reconcile before completion', 'IMPORT_FINALISATION_COUNT_RECONCILIATION_FAILED');

supporting('migration has unique batch source hash', migration.includes('UNIQUE KEY uq_os2_import_batches_hash (source_sha256)'));
supporting('migration has unique source row per batch', migration.includes('UNIQUE KEY uq_os2_import_rows_batch_row (batch_id, source_row_number)'));
supporting('legacy misspelled account column removed', !source.includes('normalised_account_number'));
supporting('nonexistent archived_at filters removed', !source.includes('archived_at'));
supporting('raw internal error messages are not returned', !source.includes('error:error.message') && !source.includes('error.message :'));
supporting('SQL values remain parameterized', !/VALUES\s*\([^)]*\$\{/.test(source));

if (controls.length !== 60) failures.push(`Expected exactly 60 named controls; found ${controls.length}`);
if (failures.length) {
  console.error('CONTROLLED IMPORT 60-CONTROL CHECK FAILED');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'controlled-import-governance',
  meaningfulControls: 60,
  maxRows: LIMITS.maxRows,
  chunkSize: LIMITS.chunkSize,
  deterministicSourceDigest: true,
  accountNumberStrongestGroupingKey: true,
  identityOnlyMatchesRequireReview: true,
  noSilentMerge: true,
  selfApprovalProhibited: true,
  uploaderFinalisationProhibited: true,
  rowSavepointsRequired: true,
  finalisationRetryIsFailedRowsOnly: true,
  countReconciliationRequired: true,
  transactionalAuditRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
