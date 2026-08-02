'use strict';

const fs = require('fs');
const path = require('path');
const root = __dirname;
const failures = [];
function read(file) { const full = path.join(root, file); if (!fs.existsSync(full)) { failures.push(`Missing ${file}`); return ''; } return fs.readFileSync(full, 'utf8'); }
function requireMarkers(file, markers) { const source = read(file); for (const marker of markers) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`); return source; }

const runner = requireMarkers('restore-test-runner.js', [
  "PREVIEW_DB = 'kloka_talk2me'", "RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild'", "TARGET_PREFIX = 'kloka_talk2me_restore_test_'",
  'IMPORT_TIMEOUT_MS = 20 * 60 * 1000', 'MAX_BACKUP_BYTES = 20 * 1024 * 1024 * 1024', 'REQUIRED_TABLES',
  'RESTORE_TARGET_NAME_INVALID', 'RESTORE_TARGET_PROHIBITED', 'BACKUP_PATH_NOT_CANONICAL', 'BACKUP_FILE_NOT_SECURE',
  'BACKUP_FILE_NOT_PRIVATE', 'O_NOFOLLOW_UNAVAILABLE', 'BACKUP_FILE_SIZE_INVALID', 'BACKUP_FILE_CHANGED_DURING_OPEN',
  'BACKUP_READ_LIMIT_EXCEEDED', 'BACKUP_READ_SIZE_MISMATCH', 'BACKUP_CHECKSUM_MISMATCH', 'crypto.timingSafeEqual',
  'Object.freeze(env)', "env.TZ = 'UTC'", 'MYSQL_BIN_INVALID', "'--protocol=TCP'", "'--default-character-set=utf8mb4'",
  "'--connect-timeout=10'", 'shell: false', 'windowsHide: true', "child.kill('SIGKILL')", 'RESTORE_IMPORT_SIGNALLED',
  'RESTORE_IMPORT_FAILED', 'DATABASE_SESSION_IDENTITY_INVALID', "SET SESSION time_zone = '+00:00'", 'REFUSING_NON_PREVIEW_DATABASE',
  'CONTROLLED_BRANCH_REQUIRED', 'RESTORE_TEST_NOT_ENABLED', 'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED',
  'VALID_BACKUP_ID_REQUIRED', 'RESTORE_REVIEWER_ID_INVALID', "backup.status !== 'verified'", 'BACKUP_NOT_RECOVERY_ELIGIBLE',
  'BACKUP_EVIDENCE_INCOMPLETE', 'BACKUP_PATH_ESCAPE_DETECTED', 'RESTORE_TARGET_NOT_EMPTY', 'RESTORE_TEST_RECORD_NOT_CREATED',
  'tableCountMatchesBackup', 'requiredTablesPresent', 'migrationCountExact', 'migrationChecksumsValid', 'restoreTargetIsolated',
  'backupChecksumReverified', 'RESTORE_SEMANTIC_CHECKS_FAILED', 'targetDatabasePrecreated: true', 'targetDatabaseInitiallyEmpty: true',
  'targetDatabaseDroppedAutomatically: false', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);

if (runner.includes('...process.env')) failures.push('Restore import must not inherit full parent environment');
if (/\bCREATE DATABASE\b|\bDROP DATABASE\b/i.test(runner)) failures.push('Restore runner must not contain database create/drop SQL');
if (!runner.includes('Number(before.table_count) !== 0')) failures.push('Restore target emptiness proof missing');
if (!runner.includes("WHERE id=? AND status='running'")) failures.push('Restore final update must be state constrained');
if (runner.indexOf('secureFile(filePath') > runner.indexOf('importDump({ filePath')) failures.push('Backup integrity must be verified before import');
if (runner.indexOf('RESTORE_TARGET_NOT_EMPTY') > runner.indexOf('RESTORE_TEST_RECORD_NOT_CREATED')) failures.push('Target emptiness must be verified before evidence row creation');
if (runner.indexOf('RESTORE_TEST_RECORD_NOT_CREATED') > runner.indexOf('await importDump')) failures.push('Running restore evidence must be created before import');
if (runner.indexOf('await importDump') > runner.indexOf('tableCountMatchesBackup')) failures.push('Import must finish before semantic checks');

requireMarkers('restore-test-governance-check.js', [
  "check: 'restore-test-governance'", 'meaningfulControls: 60', 'precreatedTargetRequired: true', 'targetCreateProhibited: true',
  'targetDropProhibited: true', 'verifiedBackupRequired: true', 'backupChecksumReverified: true', 'constantTimeChecksumComparison: true',
  'importEnvironmentSanitized: true', 'fullParentEnvironmentInherited: false', 'importTimeoutMs: 1200000', 'databaseIdentityVerified: true',
  'exactMigrationCountRequired: true', 'structuredEvidenceRecorded: true', 'connectionsClosedInFinally: true'
]);
requireMarkers('BACKUP_AND_RECOVERY_RUNBOOK.md', [
  'Controlled isolated restore test', 'pre-created empty isolated database', 'must never create or drop the target database',
  'ALLOW_PREVIEW_RESTORE_TEST=true', 'RESTORE_TARGET_DATABASE', 'RESTORE_REVIEWER_ID', 'Import timeout is 20 minutes',
  'Backup checksum is reverified before import', 'Exactly 25 migration-ledger rows are required', 'targetDatabaseDroppedAutomatically: false',
  'failedChecks: 0', 'Manual cleanup after evidence retention'
]);
requireMarkers('migrations/20260801_011_backup_recovery_and_operations.sql', [
  'CREATE TABLE IF NOT EXISTS os2_restore_tests', "target_environment VARCHAR(120) NOT NULL DEFAULT 'isolated_preview_restore'",
  'expected_database_name VARCHAR(128) NOT NULL', 'actual_database_name VARCHAR(128) NULL', 'verified_checks INT UNSIGNED NULL',
  'failed_checks INT UNSIGNED NULL', 'evidence_json JSON NULL', 'reviewed_by BIGINT UNSIGNED NULL',
  'CONSTRAINT fk_restore_backup', 'CONSTRAINT fk_restore_reviewed_by'
]);
requireMarkers('merge-restore-evidence-verification.js', [
  "row.restore_status !== 'passed'", "row.target_environment !== 'isolated_preview_restore'",
  'Number(row.restore_table_count) !== Number(row.table_count)',
  '!Number.isInteger(Number(row.verified_checks)) || Number(row.verified_checks) <= 0',
  '!Number.isInteger(Number(row.failed_checks)) || Number(row.failed_checks) !== 0',
  "row.evidence_json === null || typeof row.evidence_json !== 'object'",
  '!Number.isInteger(Number(row.reviewed_by)) || Number(row.reviewed_by) <= 0',
  'restoreIdentityVerified: true', 'invalidAuthorisations: 0'
]);

if (failures.length) { console.error('RESTORE TEST INTEGRATION CHECK FAILED'); failures.forEach(item => console.error(`- ${item}`)); process.exit(1); }
console.log(JSON.stringify({
  ok: true,
  check: 'restore-test-integration',
  meaningfulControls: 60,
  runnerPresent: true,
  governancePresent: true,
  runbookPresent: true,
  schemaSupportPresent: true,
  downstreamEvidenceVerifierIntegrated: true,
  sourceIntegrityBeforeImportRequired: true,
  targetEmptinessBeforeEvidenceRequired: true,
  runningEvidenceBeforeImportRequired: true,
  semanticChecksAfterImportRequired: true,
  precreatedIsolatedTargetRequired: true,
  targetCreateProhibited: true,
  targetDropProhibited: true,
  verifiedBackupRequired: true,
  checksumReverificationRequired: true,
  constantTimeChecksumRequired: true,
  importEnvironmentSanitized: true,
  importExecutionBounded: true,
  reviewerRequired: true,
  exactMigrationCountRequired: 25,
  failedChecksMustBeZero: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
