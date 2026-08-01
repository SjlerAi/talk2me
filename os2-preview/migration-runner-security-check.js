'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'migration-runner.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_DEPLOYMENT_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const markers = [
  "PREVIEW_DATABASE = 'kloka_talk2me'",
  "MIGRATION_LOCK_NAME = 'talk2me_os2_preview_migrations'",
  'MIGRATION_LOCK_TIMEOUT_SECONDS = 10',
  'MAX_MIGRATION_BYTES = 4 * 1024 * 1024',
  'O_NOFOLLOW and O_DIRECTORY',
  'fs.openSync(MIGRATIONS_DIR, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)',
  'fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.nlink !== 1',
  'descriptorStat.size > MAX_MIGRATION_BYTES',
  'INVALID_MIGRATION_FILENAME_PRESENT',
  'INSUFFICIENT_MIGRATION_COUNT',
  'MIGRATION_025_MISSING',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED',
  'MERGE_EXECUTION_FLAG_PROHIBITED',
  'SELECT CONNECTION_ID() AS connection_id',
  'SELECT GET_LOCK(?, ?) AS acquired',
  'SELECT IS_USED_LOCK(?) AS owner_connection_id',
  'MIGRATION_ADVISORY_LOCK_OWNER_MISMATCH',
  'MIGRATION_ADVISORY_LOCK_OWNERSHIP_LOST',
  'SELECT RELEASE_LOCK(?) AS released',
  'MIGRATION_ADVISORY_LOCK_RELEASE_NOT_CONFIRMED',
  'SELECT migration_name, checksum_sha256 FROM os2_schema_migrations ORDER BY id ASC',
  'MIGRATION_LEDGER_LONGER_THAN_SOURCE_INVENTORY',
  'MIGRATION_LEDGER_NOT_STRICT_PREFIX',
  'MIGRATION_LEDGER_CHECKSUM_INVALID',
  'MIGRATION_CHECKSUM_MISMATCH',
  'ledgerStrictPrefixVerified: true',
  'advisoryLockUsed: true',
  'advisoryLockOwnerVerified: true',
  'secureMigrationReads: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
];

for (const marker of markers) {
  if (!runner.includes(marker)) throw new Error(`Migration runner missing security marker: ${marker}`);
}

const runbookMarkers = [
  'Do not substitute `npm install` for the controlled release path.',
  'bind the advisory lock to the current MySQL `CONNECTION_ID()`',
  'verify advisory-lock ownership through `IS_USED_LOCK()` before migration work',
  'require the applied ledger to be an exact strict prefix of the ordered source inventory',
  'reject unknown, duplicate, reordered, skipped, or future ledger entries',
  'validate every stored ledger checksum before applying any new migration',
  'require `RELEASE_LOCK()` to report successful release',
  'Any ledger gap, order mismatch, checksum mismatch, or advisory-lock ownership mismatch is a hard stop'
];
for (const marker of runbookMarkers) {
  if (!runbook.includes(marker)) throw new Error(`Preview deployment runbook missing migration security marker: ${marker}`);
}

if (runner.indexOf('secureMigrationDirectory()') > runner.indexOf('mysql.createConnection')) {
  throw new Error('Migration source validation must complete before database connection');
}
if (runner.indexOf('acquireMigrationLock(connection)') > runner.indexOf('ensureLedger(connection)')) {
  throw new Error('Migration advisory lock must be acquired before ledger or migration activity');
}
if (runner.indexOf('validateAppliedLedger(appliedRows, migrationSources)') > runner.indexOf('for (const migration of migrationSources)')) {
  throw new Error('Migration ledger integrity must be validated before applying migrations');
}
if (!runner.includes('if (lockAcquired) await releaseMigrationLock(connection, lockConnectionId)')) {
  throw new Error('Migration advisory lock release is not protected in cleanup');
}
if (pkg.scripts['check:migration-runner-security'] !== 'node migration-runner-security-check.js') {
  throw new Error('Missing check:migration-runner-security command');
}
if (!pkg.scripts.check.includes('node --check migration-runner-security-check.js')) {
  throw new Error('Migration runner security syntax check missing from normal validation');
}
if (!pkg.scripts.check.includes('node migration-runner-security-check.js')) {
  throw new Error('Migration runner security regression check missing from normal validation');
}

console.log(JSON.stringify({
  ok: true,
  check: 'migration-runner-security',
  secureDirectoryOpenRequired: true,
  secureFileOpenRequired: true,
  descriptorIdentityRequired: true,
  hardLinkRejectionRequired: true,
  boundedMigrationFilesRequired: true,
  strictMigrationInventoryRequired: true,
  strictLedgerPrefixRequired: true,
  ledgerChecksumValidationRequired: true,
  advisoryLockRequired: true,
  advisoryLockOwnerVerificationRequired: true,
  advisoryLockReleaseConfirmationRequired: true,
  deploymentRunbookProtected: true,
  runbookMarkers: runbookMarkers.length,
  previewDatabaseOnly: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
