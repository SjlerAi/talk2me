'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];
function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { failures.push(`Missing deployment dependency ${file}`); return ''; }
  return fs.readFileSync(full, 'utf8');
}
function requireMarkers(file, markers) {
  const value = read(file);
  for (const marker of markers) if (!value.includes(marker)) failures.push(`${file} missing ${marker}`);
  return value;
}

requireMarkers('release-source-integrity-verification.js', [
  'RELEASE_SOURCE_INVENTORY_SHA256', "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", 'verifierTimeoutMs = 30000',
  "killSignal: 'SIGKILL'", 'shell: false', 'exactApprovedInventoryMatched: true',
  'evidence.packageLockPresent !== true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('migration-runner.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'", "RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild'",
  'bootstrapEvidenceVerifiedBeforeDatabaseConnection: true', 'MIGRATION_FINAL_LEDGER_INCOMPLETE',
  'advisoryLockFreeAfterRelease = true', 'databaseConnectionClosedBeforeSuccess = true',
  'runtimeCreateTableUsed: false', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('schema-verification.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'", 'EXPECTED_MIGRATION_COUNT = 25', 'CONNECTION_TIMEOUT_MS = 10000',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED',
  'connectTimeout: CONNECTION_TIMEOUT_MS', 'enableKeepAlive: false', 'namedPlaceholders: false',
  'DATABASE_IDENTITY_MISMATCH', 'AUTOCOMMIT_REQUIRED', "SET SESSION time_zone = '+00:00'", 'UTC_SESSION_REQUIRED',
  'INVALID_TABLE_ENGINE', 'INVALID_TABLE_COLLATION', 'MISSING_COLUMNS',
  'SELECT id,migration_name,checksum_sha256,executed_at,executed_by,execution_ms FROM os2_schema_migrations ORDER BY id ASC',
  'MIGRATION_COUNT_MISMATCH', 'MIGRATION_NAME_SEQUENCE_INVALID', 'DUPLICATE_MIGRATION_NAME',
  'MIGRATION_CHECKSUM_INVALID', 'MIGRATION_EXECUTED_AT_INVALID', 'MIGRATION_EXECUTED_BY_INVALID',
  'MIGRATION_EXECUTION_MS_INVALID', 'RESTORE_PIN_MIGRATION_NOT_APPLIED',
  'ORPHAN_ACCOUNTS', 'ORPHAN_MOBILE_LINES', 'ORPHAN_WORK_ITEMS', 'NEGATIVE_IMPORT_COUNTS',
  'INVALID_EXPORT_CHECKSUMS', 'VERIFIED_BACKUPS_WITHOUT_CHECKSUM',
  "check: 'schema-verification'", 'exactMigrationCountVerified: true',
  'migrationLedgerColumnNamesCorrected: true', 'restorePinMigrationApplied: true',
  'migrationLedgerSequenceVerified: true', 'migrationLedgerChecksumsVerified: true',
  'migrationExecutionMetadataVerified: true', 'zeroDefectCheckCount',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('merge-restore-evidence-verification.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'", 'CONNECTION_TIMEOUT_MS = 10000', 'MAX_INVALID_ROWS = 100',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED',
  'connectTimeout: CONNECTION_TIMEOUT_MS', 'enableKeepAlive: false', 'namedPlaceholders: false',
  'DATABASE_IDENTITY_MISMATCH', 'AUTOCOMMIT_REQUIRED', "SET SESSION time_zone = '+00:00'", 'UTC_SESSION_REQUIRED',
  'backup_not_verified', 'backup_type_invalid', 'backup_database_invalid', 'backup_timestamps_invalid',
  'backup_verification_order_invalid', 'backup_storage_path_invalid', 'backup_file_name_invalid',
  'backup_checksum_invalid', 'backup_file_size_invalid', 'backup_table_count_invalid', 'backup_row_count_invalid',
  'restore_not_passed', 'restore_target_invalid', 'restore_database_invalid', 'restore_timestamps_invalid',
  'restore_before_backup_verification', 'restore_table_count_mismatch', 'verified_checks_invalid',
  'failed_checks_present', 'restore_evidence_json_missing', 'restore_reviewer_missing',
  'restore_after_authorisation', 'authorisation_expiry_invalid', 'authorisation_not_pristine',
  'AUTHORISED_WITHOUT_PINNED_RESTORE', "check: 'merge-restore-evidence-verification'",
  'invalidAuthorisations: 0', 'authorisedWithoutPinnedRestore: 0',
  'backupIdentityVerified: true', 'restoreIdentityVerified: true', 'authorisationOrderingVerified: true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
const previewData = requireMarkers('preview-data-verification.js', [
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20', 'verifierTimeoutMs = 60000', 'maxVerifierOutputBytes = 4 * 1024 * 1024',
  "'schema-verification.js'", "'merge-restore-evidence-verification.js'", 'Object.freeze(env)',
  'timeout: verifierTimeoutMs', "killSignal: 'SIGKILL'", 'shell: false', 'windowsHide: true',
  'VERIFIER_OUTPUT_INVALID_JSON', 'VERIFIER_SESSION_EVIDENCE_INCOMPLETE', 'VERIFIER_SAFETY_EVIDENCE_INVALID',
  'SCHEMA_MIGRATION_COUNT_INVALID', 'SCHEMA_LEDGER_EVIDENCE_MISSING', 'SCHEMA_ZERO_DEFECT_MAP_MISSING',
  'SCHEMA_ZERO_DEFECT_COUNT_INVALID', 'RESTORE_EVIDENCE_MISSING', 'RESTORE_INSPECTION_COUNT_INVALID',
  'exactMigrationLedgerVerified: true', 'restoreEvidenceSemanticsVerified: true',
  'databaseBackedVerificationExecuted: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
if (previewData.includes('env: process.env') || previewData.includes('...process.env')) failures.push('preview-data-verification.js must not inherit the complete parent environment');
if (previewData.indexOf("'schema-verification.js'") >= previewData.indexOf("'merge-restore-evidence-verification.js'")) failures.push('Schema verification must precede restore-evidence verification');

requireMarkers('PREVIEW_DEPLOYMENT_RUNBOOK.md', [
  'talk2me.kloka.co.za', 'talk2me.uent.co.za', 'npm run migrate:preview',
  'npm run verify:preview-data', 'exactly 25 migration ledger rows',
  '`checksum_sha256` and `executed_at`', '18 zero-defect data checks',
  'backup status `verified`', 'isolated_preview_restore', 'restore reviewer',
  'schema verification must complete before restore-evidence verification',
  'Restart only the preview Node.js application'
]);

const pkg = JSON.parse(read('package.json') || '{}');
const requiredScripts = {
  'verify:release-source-integrity': 'node release-source-integrity-verification.js',
  'bootstrap:migration-ledger': 'node migration-ledger-bootstrap-runner.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'migrate:preview': 'node migration-runner.js',
  'verify:schema': 'node schema-verification.js',
  'verify:merge-restore-evidence': 'node merge-restore-evidence-verification.js',
  'verify:preview-data': 'node preview-data-verification.js',
  'check:deployment': 'node deployment-check.js'
};
for (const [name, command] of Object.entries(requiredScripts)) if (pkg.scripts?.[name] !== command) failures.push(`package.json missing exact ${name} command`);
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of ['node --check schema-verification.js','node --check merge-restore-evidence-verification.js','node --check preview-data-verification.js','node deployment-check.js']) {
  if (!normalCheck.includes(marker)) failures.push(`Normal validation missing ${marker}`);
}
if (normalCheck.includes('node schema-verification.js') || normalCheck.includes('node preview-data-verification.js')) failures.push('Database-backed verifiers must not execute during normal source validation');

if (failures.length) {
  console.error('DEPLOYMENT CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'deployment-controls',
  application: pkg.name,
  version: pkg.version,
  meaningfulControls: 60,
  database: 'kloka_talk2me',
  exactMigrationLedgerSchemaRequired: true,
  exactMigrationCountRequired: 25,
  restorePinMigrationRequired: true,
  tableEngineAndCollationVerificationRequired: true,
  migrationExecutionMetadataRequired: true,
  schemaZeroDefectChecksRequired: 18,
  orphanDataChecksRequired: true,
  exportAndBackupIntegrityChecksRequired: true,
  pinnedBackupEvidenceRequired: true,
  pinnedRestoreEvidenceRequired: true,
  restoreReviewerRequired: true,
  restoreEvidenceJsonRequired: true,
  authorisationOrderingRequired: true,
  schemaVerificationBeforeRestoreEvidenceRequired: true,
  databaseVerifierEnvironmentSanitized: true,
  databaseVerifierExecutionBounded: true,
  databaseIdentityVerificationRequired: true,
  utcSessionRequired: true,
  autocommitRequired: true,
  previewDataVerificationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
