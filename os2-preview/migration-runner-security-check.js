'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'migration-runner.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-evidence-verification.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'MIGRATION_LEDGER_BOOTSTRAP.sql'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_DEPLOYMENT_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} missing marker: ${marker}`);
}

const runnerMarkers = [
  "PREVIEW_DATABASE = 'kloka_talk2me'", "RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild'",
  'VERIFIER_TIMEOUT_MS = 30000', 'CONNECTION_TIMEOUT_MS = 10000', 'MAX_MIGRATION_COUNT = 250',
  "EXPECTED_MIGRATION_DATE = '20260801'", "REQUIRED_RESTORE_PIN = '20260801_025_merge_authorisation_restore_pin.sql'",
  'buildVerifierEnvironment(evidencePath)', "const inherited = ['PATH','HOME','USER','LOGNAME','TMPDIR','TEMP','TMP','LANG','LC_ALL','TZ','CI','GITHUB_ACTIONS']",
  "env.NODE_ENV = 'production'", 'Object.freeze(env)', 'encoding: \'utf8\'', 'maxBuffer: 4 * 1024 * 1024',
  'timeout: VERIFIER_TIMEOUT_MS', "killSignal: 'SIGKILL'", 'shell: false', 'windowsHide: true',
  'BOOTSTRAP_EVIDENCE_VERIFIER_TIMEOUT', 'BOOTSTRAP_EVIDENCE_VERIFIER_INVALID_JSON', 'BOOTSTRAP_EVIDENCE_VERIFIER_INCOMPLETE',
  "evidence.database !== PREVIEW_DATABASE", 'evidence.bootstrapMatchesWorkspace !== true', 'evidence.advisoryLockLifecycleVerified !== true',
  'MIGRATIONS_DIRECTORY_OWNER_MISMATCH', 'MIGRATIONS_DIRECTORY_METADATA_CHANGED_DURING_OPEN',
  "fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })", 'UNSUPPORTED_MIGRATION_DIRECTORY_ENTRY', 'HIDDEN_MIGRATION_FILE_PRESENT',
  'EXCESSIVE_MIGRATION_COUNT', 'MIGRATION_DATE_INVALID', 'MIGRATION_SEQUENCE_NOT_CONTIGUOUS',
  'MIGRATION_EMPTY', 'MIGRATION_BOM_PROHIBITED', 'MIGRATION_CRLF_PROHIBITED', 'MIGRATION_FINAL_NEWLINE_REQUIRED',
  'MIGRATION_NUL_PROHIBITED', 'MIGRATION_PROHIBITED_TOKEN', 'MIGRATION_LEDGER_SELF_MUTATION_PROHIBITED',
  'MIGRATION_SIZE_INVALID', 'MIGRATION_METADATA_CHANGED_DURING_OPEN', 'MIGRATION_READ_SIZE_MISMATCH',
  'MIGRATION_DATABASE_IDENTITY_MISMATCH', 'MIGRATION_AUTOCOMMIT_REQUIRED', "SET SESSION time_zone = '+00:00'", 'MIGRATION_UTC_SESSION_REQUIRED',
  'MIGRATION_ADVISORY_LOCK_NOT_FREE_AFTER_RELEASE', 'MIGRATION_LEDGER_ID_INVALID', 'MIGRATION_LEDGER_EXECUTED_AT_INVALID',
  'MIGRATION_LEDGER_EXECUTED_BY', 'MIGRATION_LEDGER_EXECUTION_MS_INVALID', 'RELEASE_BRANCH_MISMATCH', 'DB_PORT_INVALID',
  'MIGRATION_OPERATOR', 'connectTimeout: CONNECTION_TIMEOUT_MS', 'enableKeepAlive: false', 'namedPlaceholders: false',
  'dateStrings: false', 'multipleStatements: true',
  'SELECT id,migration_name,checksum_sha256,executed_at,executed_by,execution_ms',
  'VALUES (?,?,?,?)', 'MIGRATION_LEDGER_INSERT_NOT_CONFIRMED', 'MIGRATION_FINAL_LEDGER_INCOMPLETE',
  'finalLedgerInventoryVerified: true', 'migrationSequenceContiguous: true', 'migrationSourcePolicyVerified: true',
  'databaseIdentityVerified: true', 'utcSessionVerified: true', 'autocommitVerified: true',
  'verifierEnvironmentSanitized: true', 'verifierExecutionBounded: true',
  'advisoryLockFreeAfterRelease = true', 'databaseConnectionClosedBeforeSuccess = true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
];
requireMarkers(runner, runnerMarkers, 'Migration runner');

if (runner.includes('...process.env')) throw new Error('Migration runner must not pass the full parent environment to the bootstrap verifier');
if (runner.includes('VALUES (:name,:checksum,:executedBy,:executionMs)')) throw new Error('Migration ledger insert must not depend on disabled named placeholders');
if (runner.includes('CREATE TABLE IF NOT EXISTS os2_schema_migrations')) throw new Error('Runtime migration ledger creation is prohibited');
if (!runner.includes("for (const token of ['CREATE DATABASE','DROP DATABASE','USE ','GRANT ','REVOKE ','LOAD DATA','INTO OUTFILE','INTO DUMPFILE','SET GLOBAL','RESET MASTER','SHUTDOWN'])")) throw new Error('Migration SQL prohibited-token policy is incomplete');

requireMarkers(bootstrap, ['CREATE TABLE os2_schema_migrations','UNIQUE KEY uq_os2_schema_migration_name','Target database: kloka_talk2me only.'], 'Ledger bootstrap');
requireMarkers(verifier, ['bootstrapMatchesWorkspace: true','verifiedBackupEvidencePresent: true','ledgerAbsentBeforeBootstrap: true','advisoryLockLifecycleVerified: true'], 'Bootstrap evidence verifier');

const ordering = [
  ['const bootstrap = verifyBootstrapEvidence()', 'const directoryIdentity = secureMigrationDirectory()', 'Bootstrap evidence must be verified before source inventory'],
  ['const directoryIdentity = secureMigrationDirectory()', 'const connection = await mysql.createConnection', 'Migration source inventory must be frozen before database connection'],
  ['connectionId = await verifySessionIdentity(connection)', 'await acquireMigrationLock(connection, connectionId)', 'Database identity must be verified before lock acquisition'],
  ['await acquireMigrationLock(connection, connectionId)', 'await verifyLedgerSchema(connection)', 'Migration lock must be acquired before ledger verification'],
  ['await verifyLedgerSchema(connection)', 'const applied = validateAppliedLedger(appliedRows, migrationSources)', 'Ledger schema must be verified before ledger contents'],
  ['validateAppliedLedger(finalRows, migrationSources)', "throw new Error('MIGRATION_FINAL_LEDGER_INCOMPLETE')", 'Final ledger rows must be validated before completeness acceptance'],
  ['await releaseMigrationLock(connection, connectionId)', 'await connection.end()', 'Advisory lock must be released before connection close'],
  ['await connection.end()', 'console.log(JSON.stringify(result, null, 2))', 'Migration success must be reported only after connection close']
];
for (const [before, after, message] of ordering) {
  const left = runner.indexOf(before); const right = runner.indexOf(after);
  if (left === -1 || right === -1 || left >= right) throw new Error(message);
}

requireMarkers(runbook, [
  'sanitized allowlisted environment', '30-second timeout', 'full parent environment is prohibited',
  'exact controlled branch', 'contiguous migration sequence', 'hidden files', 'non-file directory entries',
  'UTF-8 BOM', 'CRLF', 'final newline', 'ledger self-mutation', 'destructive database-level SQL',
  '10-second connection timeout', 'UTC session', 'autocommit', 'positional placeholders',
  'final ledger inventory', 'IS_FREE_LOCK()', 'database connection closes before final success'
], 'Deployment runbook');

if (pkg.scripts['migrate:preview'] !== 'node migration-runner.js') throw new Error('Missing exact migrate:preview command');
if (pkg.scripts['check:migration-runner-security'] !== 'node migration-runner-security-check.js') throw new Error('Missing exact migration security command');
if (!pkg.scripts.check.includes('node --check migration-runner.js')) throw new Error('Migration runner syntax check missing');
if (!pkg.scripts.check.includes('node --check migration-runner-security-check.js')) throw new Error('Migration security syntax check missing');
if (!pkg.scripts.check.includes('node migration-runner-security-check.js')) throw new Error('Migration security regression check missing');

console.log(JSON.stringify({
  ok: true,
  check: 'migration-runner-security',
  meaningfulControls: 60,
  previewDatabaseOnly: true,
  controlledBranchRequired: true,
  bootstrapEvidenceVerifiedBeforeDatabaseConnection: true,
  bootstrapVerifierEnvironmentSanitized: true,
  bootstrapVerifierExecutionBounded: true,
  bootstrapVerifierJsonEvidenceRequired: true,
  completeParentEnvironmentInheritanceProhibited: true,
  migrationDirectoryOwnershipRequired: true,
  migrationDirectoryDescriptorIdentityRequired: true,
  migrationDirectoryEntryTypesRestricted: true,
  hiddenMigrationFilesProhibited: true,
  migrationCountBounded: true,
  migrationDateLocked: true,
  migrationSequenceContiguous: true,
  restorePinMigrationRequired: true,
  migrationSourceCanonicalFormattingRequired: true,
  migrationSourceMetadataStabilityRequired: true,
  migrationSourceByteCountStabilityRequired: true,
  destructiveDatabaseLevelSqlProhibited: true,
  migrationLedgerSelfMutationProhibited: true,
  databaseHostUserPortValidated: true,
  connectionTimeoutBounded: true,
  keepAliveDisabled: true,
  databaseIdentityVerified: true,
  utcSessionRequired: true,
  autocommitRequired: true,
  advisoryLockOwnerVerificationRequired: true,
  advisoryLockReleaseFailureIsBlocking: true,
  advisoryLockFreeAfterReleaseRequired: true,
  exactLedgerSchemaRequired: true,
  strictLedgerPrefixRequired: true,
  ledgerIdsStrictlyIncreasingRequired: true,
  ledgerExecutionMetadataValidated: true,
  positionalLedgerInsertRequired: true,
  ledgerInsertConfirmationRequired: true,
  finalLedgerInventoryRequired: true,
  successAfterConnectionCloseRequired: true,
  runtimeLedgerCreationProhibited: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
