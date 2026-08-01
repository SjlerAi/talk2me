'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'migration-runner.js'), 'utf8');

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
  'SELECT GET_LOCK(?, ?) AS acquired',
  'MIGRATION_ADVISORY_LOCK_NOT_ACQUIRED',
  'SELECT RELEASE_LOCK(?) AS released',
  'MIGRATION_CHECKSUM_MISMATCH',
  'advisoryLockUsed: true',
  'secureMigrationReads: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
];

for (const marker of markers) {
  if (!runner.includes(marker)) throw new Error(`Migration runner missing security marker: ${marker}`);
}

if (runner.indexOf('secureMigrationDirectory()') > runner.indexOf('mysql.createConnection')) {
  throw new Error('Migration source validation must complete before database connection');
}
if (runner.indexOf('acquireMigrationLock(connection)') > runner.indexOf('ensureLedger(connection)')) {
  throw new Error('Migration advisory lock must be acquired before ledger or migration activity');
}
if (!runner.includes('if (lockAcquired) await releaseMigrationLock(connection)')) {
  throw new Error('Migration advisory lock release is not protected in cleanup');
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
  advisoryLockRequired: true,
  previewDatabaseOnly: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
