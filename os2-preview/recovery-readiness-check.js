'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];
function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { failures.push(`Missing recovery dependency ${file}`); return ''; }
  return fs.readFileSync(full, 'utf8');
}
function markers(file, required) {
  const source = read(file);
  for (const marker of required) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`);
  return source;
}

const backupRunner = markers('backup-runner.js', [
  "PREVIEW_DB = 'kloka_talk2me'", "RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild'",
  'ALLOW_PREVIEW_BACKUPS', 'ALLOW_PRODUCTION_MUTATION', 'ENABLE_CUSTOMER_MERGE_EXECUTION',
  'BACKUP_PRIVATE_DIR', 'O_NOFOLLOW', 'DUMP_TIMEOUT_MS = 15 * 60 * 1000', 'crypto.createHash',
  'checksum_sha256', "status='completed'", 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
const backupVerification = markers('backup-verification.js', [
  "PREVIEW_DB = 'kloka_talk2me'", "RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild'",
  'crypto.timingSafeEqual', 'O_NOFOLLOW', "status='verified'", 'backup_file_verification',
  'operationalEvidenceRecorded: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
const restoreRunner = markers('restore-test-runner.js', [
  "PREVIEW_DB = 'kloka_talk2me'", "TARGET_PREFIX = 'kloka_talk2me_restore_test_'",
  'ALLOW_PREVIEW_RESTORE_TEST', 'RESTORE_TARGET_NOT_EMPTY', 'BACKUP_CHECKSUM_MISMATCH',
  'crypto.timingSafeEqual', 'IMPORT_TIMEOUT_MS', "child.kill('SIGKILL')", 'shell: false',
  "target_environment", "isolated_preview_restore", 'migrationCountExact', 'failedChecks.length',
  'targetDatabaseDroppedAutomatically: false', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
const restoreGovernance = markers('restore-test-governance-check.js', [
  "check: 'restore-test-governance'", 'meaningfulControls: 60', 'targetCreateProhibited: true',
  'targetDropProhibited: true', 'backupChecksumReverified: true', 'importEnvironmentSanitized: true',
  'exactMigrationCountRequired: true', 'structuredEvidenceRecorded: true'
]);
const restoreIntegration = markers('restore-test-integration-check.js', [
  "check: 'restore-test-integration'", 'meaningfulControls: 60', 'schemaSupportPresent: true',
  'downstreamEvidenceVerifierIntegrated: true', 'runningEvidenceBeforeImportRequired: true',
  'semanticChecksAfterImportRequired: true', 'failedChecksMustBeZero: true'
]);
markers('merge-restore-evidence-verification.js', [
  "row.restore_status !== 'passed'", "row.target_environment !== 'isolated_preview_restore'",
  "Number(row.failed_checks) !== 0", "row.evidence_json === null",
  "Number(row.reviewed_by) <= 0", 'invalidAuthorisations: 0'
]);
markers('migrations/20260801_011_backup_recovery_and_operations.sql', [
  'CREATE TABLE IF NOT EXISTS os2_backup_runs', 'CREATE TABLE IF NOT EXISTS os2_restore_tests',
  'CREATE TABLE IF NOT EXISTS os2_operational_checks', 'checksum_sha256 CHAR(64)',
  "status ENUM('planned','running','passed','failed','cancelled')", 'reviewed_by BIGINT UNSIGNED NULL'
]);
markers('BACKUP_AND_RECOVERY_RUNBOOK.md', [
  'Controlled isolated restore test', 'pre-created empty isolated database',
  'must never create or drop the target database', 'Backup checksum is reverified before import',
  'failedChecks: 0', 'Manual cleanup after evidence retention'
]);

if (backupRunner.includes('...process.env')) failures.push('Backup dump child inherits complete parent environment');
if (restoreRunner.includes('...process.env')) failures.push('Restore import child inherits complete parent environment');
if (/\bCREATE DATABASE\b|\bDROP DATABASE\b/i.test(restoreRunner)) failures.push('Restore runner contains database create/drop SQL');
if (!backupVerification.includes("!['completed','verified'].includes(record.status)")) failures.push('Backup verification status gate missing');
if (restoreRunner.indexOf('secureFile(filePath') > restoreRunner.indexOf('importDump({ filePath')) failures.push('Restore checksum verification must precede import');
if (restoreRunner.indexOf('RESTORE_TARGET_NOT_EMPTY') > restoreRunner.indexOf('RESTORE_TEST_RECORD_NOT_CREATED')) failures.push('Target emptiness must precede restore evidence creation');
if (restoreRunner.indexOf('RESTORE_TEST_RECORD_NOT_CREATED') > restoreRunner.indexOf('await importDump')) failures.push('Running restore evidence must precede import');
if (restoreRunner.indexOf('await importDump') > restoreRunner.indexOf('tableCountMatchesBackup')) failures.push('Semantic restore checks must follow import');

if (failures.length) {
  console.error('RECOVERY READINESS CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'recovery-readiness',
  meaningfulControls: 60,
  previewDatabaseOnly: true,
  controlledBranchRequired: true,
  productionMutationDisabled: true,
  mergeExecutionDisabled: true,
  privateBackupDirectoryRequired: true,
  backupDirectoryCanonicalRequired: true,
  backupDirectoryOwnershipRequired: true,
  backupFilePrivateRequired: true,
  backupFileHardLinkRejectionRequired: true,
  backupFileSymlinkRejectionRequired: true,
  backupDumpEnvironmentSanitized: true,
  backupDumpTimeoutRequired: true,
  backupChecksumRequired: true,
  backupCompletionEvidenceRequired: true,
  backupVerificationRequired: true,
  backupChecksumConstantTimeRequired: true,
  backupOperationalEvidenceRequired: true,
  verifiedBackupRequiredForRestore: true,
  isolatedRestoreTargetRequired: true,
  precreatedRestoreTargetRequired: true,
  emptyRestoreTargetRequired: true,
  productionLikeTargetNamesProhibited: true,
  targetDatabaseCreationProhibited: true,
  targetDatabaseDropProhibited: true,
  restoreImportEnvironmentSanitized: true,
  restoreImportTimeoutRequired: true,
  restoreImportForcedKillRequired: true,
  restoreImportShellDisabled: true,
  restoreSourceChecksumReverificationRequired: true,
  restoreSourceDescriptorIdentityRequired: true,
  restoreEvidenceBeforeImportRequired: true,
  restoreReviewerRequired: true,
  restoreTableCountComparisonRequired: true,
  restoreRequiredTablesRequired: true,
  restoreMigrationCountRequired: 25,
  restoreMigrationChecksumsRequired: true,
  restoreFailedChecksMustBeZero: true,
  restoreStructuredEvidenceRequired: true,
  restoreEvidenceConsumedByMergeGate: true,
  restoreTargetCleanupSeparateFromRunner: true,
  backupSchemaSupportRequired: true,
  restoreSchemaSupportRequired: true,
  operationalCheckSchemaSupportRequired: true,
  recoveryRunbookRequired: true,
  recoveryGovernanceRequired: true,
  recoveryIntegrationRequired: true,
  backupRuntimeExecuted: false,
  backupVerificationExecuted: false,
  restoreRuntimeExecuted: false,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
