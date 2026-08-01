'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const bootstrapPath = path.join(root, 'MIGRATION_LEDGER_BOOTSTRAP.sql');
const runner = fs.readFileSync(path.join(root, 'migration-runner.js'), 'utf8');
const topology = fs.readFileSync(path.join(root, 'workspace-topology-verification.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_DEPLOYMENT_RUNBOOK.md'), 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

const forbidden = [
  'CREATE TABLE IF NOT EXISTS',
  'DROP TABLE',
  'ALTER TABLE',
  'INSERT INTO',
  'UPDATE ',
  'DELETE FROM'
];
for (const token of forbidden) {
  if (bootstrap.toUpperCase().includes(token.toUpperCase())) throw new Error(`Bootstrap contains prohibited token: ${token}`);
}

const requiredBootstrapMarkers = [
  'Target database: kloka_talk2me only.',
  'CREATE TABLE os2_schema_migrations',
  'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
  'migration_name VARCHAR(255) NOT NULL',
  'checksum_sha256 CHAR(64) NOT NULL',
  'executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'execution_ms INT UNSIGNED NOT NULL DEFAULT 0',
  'PRIMARY KEY (id)',
  'UNIQUE KEY uq_os2_schema_migration_name (migration_name)',
  'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
];
for (const marker of requiredBootstrapMarkers) {
  if (!bootstrap.includes(marker)) throw new Error(`Bootstrap missing required marker: ${marker}`);
}

if ((bootstrap.match(/CREATE TABLE/g) || []).length !== 1) throw new Error('Bootstrap must create exactly one table');
if (!runner.includes('MIGRATION_LEDGER_BOOTSTRAP_REQUIRED')) throw new Error('Migration runner must fail closed when ledger bootstrap is absent');
if (runner.includes('CREATE TABLE IF NOT EXISTS os2_schema_migrations')) throw new Error('Migration runner must not create the ledger at runtime');
if (!topology.includes("MIGRATION_LEDGER_BOOTSTRAP.sql")) throw new Error('Workspace topology must protect the ledger bootstrap file');
if (!topology.includes('migrationLedgerBootstrapPresent')) throw new Error('Workspace topology must report ledger bootstrap presence');
for (const marker of ['MIGRATION_LEDGER_BOOTSTRAP.sql', 'Do not use application startup or the migration runner to create this table', 'MIGRATION_LEDGER_BOOTSTRAP_REQUIRED']) {
  if (!runbook.includes(marker)) throw new Error(`Deployment runbook missing bootstrap marker: ${marker}`);
}

const sha256 = crypto.createHash('sha256').update(bootstrap).digest('hex');
console.log(JSON.stringify({
  ok: true,
  check: 'migration-ledger-bootstrap-governance',
  bootstrapFile: 'MIGRATION_LEDGER_BOOTSTRAP.sql',
  sha256,
  createsExactlyOneTable: true,
  runtimeLedgerCreationDisabled: true,
  workspaceProtectionRequired: true,
  previewDatabaseOnly: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
