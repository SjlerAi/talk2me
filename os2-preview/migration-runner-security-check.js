'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'migration-runner.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'MIGRATION_LEDGER_BOOTSTRAP.sql'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_DEPLOYMENT_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const markers = [
  "PREVIEW_DATABASE = 'kloka_talk2me'",
  'verifyLedgerSchema(connection)',
  'MIGRATION_LEDGER_BOOTSTRAP_REQUIRED',
  'information_schema.TABLES',
  'information_schema.COLUMNS',
  'information_schema.STATISTICS',
  'MIGRATION_LEDGER_ENGINE_INVALID',
  'MIGRATION_LEDGER_COLLATION_INVALID',
  'MIGRATION_LEDGER_PRIMARY_KEY_INVALID',
  'MIGRATION_LEDGER_UNIQUE_KEY_INVALID',
  'runtimeCreateTableUsed: false',
  'ledgerBootstrapVerified: true',
  'SELECT CONNECTION_ID() AS connection_id',
  'SELECT GET_LOCK(?, ?) AS acquired',
  'SELECT IS_USED_LOCK(?) AS owner_connection_id',
  'MIGRATION_LEDGER_NOT_STRICT_PREFIX',
  'MIGRATION_CHECKSUM_MISMATCH',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
];
for (const marker of markers) if (!runner.includes(marker)) throw new Error(`Migration runner missing security marker: ${marker}`);
if (runner.includes('CREATE TABLE IF NOT EXISTS os2_schema_migrations')) throw new Error('Runtime migration ledger creation is prohibited');
for (const marker of ['CREATE TABLE os2_schema_migrations','UNIQUE KEY uq_os2_schema_migration_name','Target database: kloka_talk2me only.']) {
  if (!bootstrap.includes(marker)) throw new Error(`Ledger bootstrap missing marker: ${marker}`);
}
if (runner.indexOf('acquireMigrationLock(connection)') > runner.indexOf('verifyLedgerSchema(connection)')) throw new Error('Migration lock must be acquired before ledger verification');
if (runner.indexOf('verifyLedgerSchema(connection)') > runner.indexOf('validateAppliedLedger(appliedRows, migrationSources)')) throw new Error('Ledger schema must be verified before ledger contents');
if (!pkg.scripts.check.includes('node migration-runner-security-check.js')) throw new Error('Migration security regression check missing');

console.log(JSON.stringify({
  ok: true,
  check: 'migration-runner-security',
  reviewedLedgerBootstrapRequired: true,
  runtimeLedgerCreationProhibited: true,
  exactLedgerSchemaRequired: true,
  strictLedgerPrefixRequired: true,
  advisoryLockOwnerVerificationRequired: true,
  previewDatabaseOnly: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
