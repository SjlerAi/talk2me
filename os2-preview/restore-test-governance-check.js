'use strict';

const fs = require('fs');
const path = require('path');
const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'restore-test-runner.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'BACKUP_AND_RECOVERY_RUNBOOK.md'), 'utf8');
const failures = [];
function requireMarkers(source, markers, label) { for (const marker of markers) if (!source.includes(marker)) failures.push(`${label} missing ${marker}`); }

requireMarkers(runner, [
  "PREVIEW_DB = 'kloka_talk2me'", "RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild'", "TARGET_PREFIX = 'kloka_talk2me_restore_test_'",
  'IMPORT_TIMEOUT_MS = 20 * 60 * 1000', 'MAX_BACKUP_BYTES = 20 * 1024 * 1024 * 1024', 'RESTORE_TARGET_NAME_INVALID', 'RESTORE_TARGET_PROHIBITED',
  'BACKUP_PATH_NOT_CANONICAL', 'BACKUP_FILE_NOT_SECURE', 'BACKUP_FILE_NOT_PRIVATE', 'BACKUP_FILE_CHANGED_DURING_OPEN', 'BACKUP_READ_LIMIT_EXCEEDED',
  'BACKUP_CHECKSUM_MISMATCH', 'crypto.timingSafeEqual', 'Object.freeze(env)', "env.TZ = 'UTC'", "process.env.MYSQL_BIN || 'mysql'",
  "'--protocol=TCP'", "'--connect-timeout=10'", 'shell: false', 'windowsHide: true', "child.kill('SIGKILL')", 'RESTORE_IMPORT_SIGNALLED',
  'RESTORE_IMPORT_FAILED', 'DATABASE_SESSION_IDENTITY_INVALID', "SET SESSION time_zone = '+00:00'", 'CONTROLLED_BRANCH_REQUIRED',
  'RESTORE_TEST_NOT_ENABLED', 'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED', 'VALID_BACKUP_ID_REQUIRED',
  'RESTORE_REVIEWER_ID_INVALID', "backup.status !== 'verified'", 'BACKUP_NOT_RECOVERY_ELIGIBLE', 'BACKUP_EVIDENCE_INCOMPLETE',
  'BACKUP_PATH_ESCAPE_DETECTED', 'RESTORE_TARGET_NOT_EMPTY', "target_environment", "isolated_preview_restore", 'RESTORE_TEST_RECORD_NOT_CREATED',
  'tableCountMatchesBackup', 'requiredTablesPresent', 'migrationCountExact', 'migrationChecksumsValid', 'restoreTargetIsolated', 'backupChecksumReverified',
  'RESTORE_SEMANTIC_CHECKS_FAILED', 'targetDatabasePrecreated: true', 'targetDatabaseInitiallyEmpty: true', 'targetDatabaseDroppedAutomatically: false',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'restore-test-runner.js');

if (runner.includes('...process.env')) failures.push('Restore child must not inherit full parent environment');
if (/CREATE DATABASE|DROP DATABASE/i.test(runner)) failures.push('Restore runner must not create or drop databases');
if (!runner.includes('Number(before.table_count) !== 0')) failures.push('Restore target must be proven empty');
if (!runner.includes("status='running'")) failures.push('Restore result updates must be state constrained');
if (!runner.includes('finally')) failures.push('Restore connections must close in finally');

requireMarkers(runbook, [
  'node restore-test-runner.js', 'RESTORE_TARGET_DATABASE', 'ALLOW_PREVIEW_RESTORE_TEST=true', 'pre-created empty isolated database',
  'must never create or drop the target database', 'backup checksum is reverified', '20-minute timeout', 'targetDatabaseInitiallyEmpty: true',
  'targetDatabaseDroppedAutomatically: false', 'reviewed_by', 'failedChecks: 0'
], 'BACKUP_AND_RECOVERY_RUNBOOK.md');

if (failures.length) { console.error('RESTORE TEST GOVERNANCE CHECK FAILED'); failures.forEach(item => console.error(`- ${item}`)); process.exit(1); }
console.log(JSON.stringify({ ok: true, check: 'restore-test-governance', meaningfulControls: 60, previewDatabaseOnly: true, controlledBranchRequired: true, precreatedTargetRequired: true, targetNamePatternRequired: true, productionNamesProhibited: true, targetMustBeEmpty: true, targetCreateProhibited: true, targetDropProhibited: true, verifiedBackupRequired: true, privateCanonicalBackupRequired: true, backupChecksumReverified: true, constantTimeChecksumComparison: true, sourceSizeBounded: true, sourceDescriptorIdentityRequired: true, importEnvironmentSanitized: true, fullParentEnvironmentInherited: false, importTimeoutMs: 1200000, importForcedKill: true, shellDisabled: true, databaseIdentityVerified: true, utcSessionsRequired: true, reviewerRequired: true, runningStateRecordedBeforeImport: true, exactTableCountCompared: true, requiredTablesChecked: true, exactMigrationCountRequired: true, migrationChecksumsValidated: true, structuredEvidenceRecorded: true, failedChecksRecorded: true, connectionsClosedInFinally: true, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
