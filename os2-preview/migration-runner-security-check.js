'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'migration-runner.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-evidence-verification.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'MIGRATION_LEDGER_BOOTSTRAP.sql'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_DEPLOYMENT_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const markers = [
  "PREVIEW_DATABASE = 'kloka_talk2me'",
  "BOOTSTRAP_EVIDENCE_VERIFIER = path.join(__dirname, 'migration-ledger-bootstrap-evidence-verification.js')",
  "required('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH')",
  'spawnSync(process.execPath, [BOOTSTRAP_EVIDENCE_VERIFIER]',
  "stdio: 'inherit'",
  'BOOTSTRAP_EVIDENCE_VERIFIER_START_FAILED',
  'BOOTSTRAP_EVIDENCE_VERIFIER_SIGNALLED',
  'BOOTSTRAP_EVIDENCE_VERIFICATION_FAILED',
  'bootstrapEvidenceVerifiedBeforeDatabaseConnection: true',
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
  'MIGRATION_ADVISORY_LOCK_OWNERSHIP_LOST',
  'MIGRATION_ADVISORY_LOCK_RELEASE_NOT_CONFIRMED',
  'advisoryLockReleased = await releaseMigrationLock(connection, lockConnectionId)',
  'MIGRATION_COMPLETION_EVIDENCE_INCOMPLETE',
  'result.advisoryLockReleased = true',
  'result.databaseConnectionClosedBeforeSuccess = true',
  'MIGRATION_LEDGER_NOT_STRICT_PREFIX',
  'MIGRATION_CHECKSUM_MISMATCH',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
];
for (const marker of markers) if (!runner.includes(marker)) throw new Error(`Migration runner missing security marker: ${marker}`);
if (runner.includes('CREATE TABLE IF NOT EXISTS os2_schema_migrations')) throw new Error('Runtime migration ledger creation is prohibited');
if (runner.includes('MIGRATION_ADVISORY_LOCK_RELEASE_FAILED:')) throw new Error('Advisory-lock release failure must not be swallowed');
for (const marker of ['CREATE TABLE os2_schema_migrations','UNIQUE KEY uq_os2_schema_migration_name','Target database: kloka_talk2me only.']) {
  if (!bootstrap.includes(marker)) throw new Error(`Ledger bootstrap missing marker: ${marker}`);
}
for (const marker of ['bootstrapMatchesWorkspace: true','verifiedBackupEvidencePresent: true','ledgerAbsentBeforeBootstrap: true','advisoryLockLifecycleVerified: true']) {
  if (!verifier.includes(marker)) throw new Error(`Bootstrap evidence verifier missing marker: ${marker}`);
}
if (runner.indexOf('verifyBootstrapEvidence()') > runner.indexOf('mysql.createConnection')) throw new Error('Bootstrap evidence must be verified before database connection');
if (runner.indexOf('acquireMigrationLock(connection)') > runner.indexOf('verifyLedgerSchema(connection)')) throw new Error('Migration lock must be acquired before ledger verification');
if (runner.indexOf('verifyLedgerSchema(connection)') > runner.indexOf('validateAppliedLedger(appliedRows, migrationSources)')) throw new Error('Ledger schema must be verified before ledger contents');
if (runner.indexOf('console.log(JSON.stringify(result, null, 2))') < runner.indexOf('await connection.end()')) throw new Error('Migration success must be reported only after connection close');
if (runner.indexOf('result.advisoryLockReleased = true') < runner.indexOf('await releaseMigrationLock(connection, lockConnectionId)')) throw new Error('Lock release evidence must be recorded only after confirmed release');
for (const marker of ['MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH','npm run verify:migration-ledger-bootstrap-evidence','Do not proceed to controlled migrations when the evidence pair is absent','lock release failure is a hard stop','success is reported only after the database connection closes']) {
  if (!runbook.includes(marker)) throw new Error(`Deployment runbook missing migration evidence marker: ${marker}`);
}
if (!pkg.scripts.check.includes('node migration-runner-security-check.js')) throw new Error('Migration security regression check missing');

console.log(JSON.stringify({
  ok: true,
  check: 'migration-runner-security',
  reviewedLedgerBootstrapRequired: true,
  runtimeLedgerCreationProhibited: true,
  bootstrapEvidenceRequired: true,
  bootstrapEvidenceVerifiedBeforeDatabaseConnection: true,
  bootstrapEvidenceVerifierOutputInherited: true,
  exactLedgerSchemaRequired: true,
  strictLedgerPrefixRequired: true,
  advisoryLockOwnerVerificationRequired: true,
  advisoryLockReleaseFailureIsBlocking: true,
  successAfterConnectionCloseRequired: true,
  completionEvidenceRequired: true,
  previewDatabaseOnly: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
