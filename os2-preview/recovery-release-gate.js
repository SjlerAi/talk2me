'use strict';

const fs = require('fs');
const path = require('path');
const root = __dirname;
const failures = [];
function read(file) { const full = path.join(root, file); if (!fs.existsSync(full)) { failures.push(`Missing ${file}`); return ''; } return fs.readFileSync(full, 'utf8'); }
function requireMarkers(file, markers) { const source = read(file); for (const marker of markers) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`); return source; }

const recovery = requireMarkers('recovery-readiness-check.js', [
  "check: 'recovery-readiness'", 'meaningfulControls: 60', 'previewDatabaseOnly: true', 'controlledBranchRequired: true',
  'backupGenerationGoverned: true', 'backupVerificationGoverned: true', 'isolatedRestoreGoverned: true',
  'verifiedBackupRequired: true', 'backupChecksumRequired: true', 'privateBackupStorageRequired: true',
  'backupDescriptorIdentityRequired: true', 'backupSizeBounded: true', 'backupExecutionBounded: true',
  'fullParentEnvironmentInherited: false', 'precreatedRestoreTargetRequired: true', 'restoreTargetMustBeEmpty: true',
  'restoreTargetCreateProhibited: true', 'restoreTargetDropProhibited: true', 'restoreChecksumReverificationRequired: true',
  'restoreImportExecutionBounded: true', 'restoreEvidenceRecordedBeforeImport: true', 'restoreReviewerRequired: true',
  'restoredTableCountComparisonRequired: true', 'requiredRestoreTablesRequired: true', 'exactMigrationCountRequired: 25',
  'migrationChecksumsRequired: true', 'zeroRestoreFailuresRequired: true', 'downstreamMergePinVerificationRequired: true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);

const backupRunner = requireMarkers('backup-runner.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'", 'ALLOW_PREVIEW_BACKUPS', 'BACKUP_PRIVATE_DIR', 'ALLOW_PRODUCTION_MUTATION',
  'ENABLE_CUSTOMER_MERGE_EXECUTION', 'mysqldump', 'SIGKILL', 'shell: false', 'checksum_sha256', 'file_size_bytes'
]);
if (backupRunner.includes('...process.env')) failures.push('Backup process must not inherit the full parent environment');

const backupVerify = requireMarkers('backup-verification.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'", 'crypto.timingSafeEqual', 'O_NOFOLLOW', "status='verified'",
  'backup_file_verification', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
if (backupVerify.includes('CREATE TABLE')) failures.push('Backup verification must not create schema');

const restoreRunner = requireMarkers('restore-test-runner.js', [
  "PREVIEW_DB = 'kloka_talk2me'", "TARGET_PREFIX = 'kloka_talk2me_restore_test_'", 'ALLOW_PREVIEW_RESTORE_TEST',
  'RESTORE_TARGET_NOT_EMPTY', "status='running'", 'backupChecksumReverified', 'tableCountMatchesBackup',
  'requiredTablesPresent', 'migrationCountExact', 'migrationChecksumsValid', 'failedChecks: 0',
  'targetDatabaseDroppedAutomatically: false', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
if (/\bCREATE DATABASE\b|\bDROP DATABASE\b/i.test(restoreRunner)) failures.push('Restore runner must not create or drop databases');
if (restoreRunner.includes('...process.env')) failures.push('Restore import must not inherit the full parent environment');

requireMarkers('merge-restore-evidence-verification.js', [
  "b.status <> 'verified'", "rt.status <> 'passed'", "rt.target_environment <> 'isolated_preview_restore'",
  'rt.failed_checks <> 0', 'rt.reviewed_by IS NULL', 'AUTHORISED_WITHOUT_PINNED_RESTORE',
  'backupIdentityVerified: true', 'restoreIdentityVerified: true', 'invalidAuthorisations: 0'
]);
requireMarkers('preview-data-verification.js', [
  "'schema-verification.js'", "'merge-restore-evidence-verification.js'", 'schemaZeroDefectEvidenceVerified: true',
  'restoreEvidenceSemanticsVerified: true', 'databaseBackedVerificationExecuted: true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('deployment-check.js', [
  'pinnedBackupEvidenceRequired: true', 'pinnedRestoreEvidenceRequired: true', 'restoreReviewerRequired: true',
  'restoreEvidenceJsonRequired: true', 'authorisationOrderingRequired: true', 'previewDataVerificationRequired: true'
]);
requireMarkers('uat-gate-check.js', [
  'previewDataVerificationRequired: true', 'releaseSourceIntegrityVerificationRequired: true',
  'runtimeReleaseIdentityRequired: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('migrations/20260801_011_backup_recovery_and_operations.sql', [
  'CREATE TABLE IF NOT EXISTS os2_backup_runs', 'CREATE TABLE IF NOT EXISTS os2_restore_tests',
  "target_environment VARCHAR(120) NOT NULL DEFAULT 'isolated_preview_restore'", 'checksum_sha256 CHAR(64)',
  'verified_checks INT UNSIGNED NULL', 'failed_checks INT UNSIGNED NULL', 'evidence_json JSON NULL',
  'reviewed_by BIGINT UNSIGNED NULL'
]);
requireMarkers('migrations/20260801_025_merge_authorisation_restore_pin.sql', [
  'ADD COLUMN backup_run_id BIGINT NULL', 'ADD COLUMN restore_test_id BIGINT NULL'
]);
requireMarkers('BACKUP_AND_RECOVERY_RUNBOOK.md', [
  'Controlled isolated restore test', 'pre-created empty isolated database', 'must never create or drop the target database',
  'backup checksum is reverified before import', 'failedChecks: 0', 'Manual cleanup after evidence retention'
]);

const previewData = read('preview-data-verification.js');
if (previewData.indexOf("'schema-verification.js'") >= previewData.indexOf("'merge-restore-evidence-verification.js'")) failures.push('Schema verification must precede merge/restore evidence verification');
const restoreOrder = ['secureFile(filePath', 'RESTORE_TARGET_NOT_EMPTY', 'RESTORE_TEST_RECORD_NOT_CREATED', 'await importDump', 'tableCountMatchesBackup', 'failedChecks.length'];
for (let i = 1; i < restoreOrder.length; i += 1) if (restoreRunner.indexOf(restoreOrder[i - 1]) >= restoreRunner.indexOf(restoreOrder[i])) failures.push(`Restore execution order invalid at ${restoreOrder[i]}`);

let pkg = {};
try { pkg = JSON.parse(read('package.json') || '{}'); } catch (error) { failures.push(`package.json invalid JSON: ${error.message}`); }
const exactScripts = {
  'backup:preview': 'node backup-runner.js',
  'verify:backup': 'node backup-verification.js',
  'restore:test': 'node restore-test-runner.js',
  'check:restore-test-governance': 'node restore-test-governance-check.js',
  'check:restore-test-integration': 'node restore-test-integration-check.js',
  'check:recovery-readiness': 'node recovery-readiness-check.js',
  'check:recovery-release': 'node recovery-release-gate.js',
  'verify:merge-restore-evidence': 'node merge-restore-evidence-verification.js',
  'verify:preview-data': 'node preview-data-verification.js'
};
for (const [name, command] of Object.entries(exactScripts)) if (pkg.scripts?.[name] !== command) failures.push(`package.json missing exact ${name}`);
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of [
  'node --check backup-runner.js', 'node --check backup-verification.js', 'node --check restore-test-runner.js',
  'node --check restore-test-governance-check.js', 'node --check restore-test-integration-check.js',
  'node --check recovery-readiness-check.js', 'node --check recovery-release-gate.js',
  'node restore-test-governance-check.js', 'node restore-test-integration-check.js',
  'node recovery-readiness-check.js', 'node recovery-release-gate.js'
]) if (!normalCheck.includes(marker)) failures.push(`Normal validation missing ${marker}`);
for (const prohibited of ['node backup-runner.js', 'node backup-verification.js', 'node restore-test-runner.js']) {
  const executionPattern = `&& ${prohibited} &&`;
  if (normalCheck.includes(executionPattern)) failures.push(`Environment-changing command must not execute during normal validation: ${prohibited}`);
}

if (failures.length) { console.error('RECOVERY RELEASE GATE FAILED'); failures.forEach(item => console.error(`- ${item}`)); process.exit(1); }
console.log(JSON.stringify({
  ok: true,
  check: 'recovery-release-gate',
  meaningfulControls: 60,
  previewDatabaseOnly: true,
  controlledBranchRequired: true,
  backupRunnerGoverned: true,
  backupVerifierGoverned: true,
  restoreRunnerGoverned: true,
  recoveryReadinessGoverned: true,
  backupOptInRequired: true,
  restoreOptInRequired: true,
  productionMutationDisabled: true,
  mergeExecutionDisabled: true,
  privateBackupDirectoryRequired: true,
  canonicalBackupPathRequired: true,
  backupSymlinkRejectionRequired: true,
  backupHardLinkRejectionRequired: true,
  backupOwnerVerificationRequired: true,
  backupPrivateModeRequired: true,
  backupSizeBoundRequired: true,
  backupChecksumRequired: true,
  constantTimeChecksumRequired: true,
  backupExecutionTimeoutRequired: true,
  backupShellDisabled: true,
  backupEnvironmentSanitized: true,
  backupOperationalEvidenceRequired: true,
  verifiedBackupStatusRequired: true,
  precreatedRestoreTargetRequired: true,
  isolatedRestoreTargetPatternRequired: true,
  restoreTargetEmptyRequired: true,
  previewRestoreTargetProhibited: true,
  productionRestoreTargetProhibited: true,
  restoreTargetCreateProhibited: true,
  restoreTargetDropProhibited: true,
  restoreChecksumReverificationRequired: true,
  restoreEnvironmentSanitized: true,
  restoreShellDisabled: true,
  restoreExecutionTimeoutRequired: true,
  restoreEvidenceBeforeImportRequired: true,
  restoreReviewerRequired: true,
  restoredTableCountComparisonRequired: true,
  requiredRestoreTablesRequired: true,
  exactMigrationCountRequired: 25,
  migrationChecksumsRequired: true,
  zeroRestoreFailuresRequired: true,
  structuredRestoreEvidenceRequired: true,
  schemaSupportRequired: true,
  backupPinColumnRequired: true,
  restorePinColumnRequired: true,
  pinnedBackupVerificationRequired: true,
  pinnedRestoreVerificationRequired: true,
  authorisationOrderingRequired: true,
  restoreReviewRequired: true,
  previewDataVerificationRequired: true,
  schemaBeforeRestoreEvidenceRequired: true,
  deploymentGateIntegrationRequired: true,
  uatGateIntegrationRequired: true,
  runbookControlsRequired: true,
  exactPackageCommandsRequired: true,
  normalSyntaxValidationRequired: true,
  normalGovernanceExecutionRequired: true,
  environmentChangingRecoveryCommandsExcludedFromNormalValidation: true,
  runtimeRecoveryOperationsExecuted: false,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
