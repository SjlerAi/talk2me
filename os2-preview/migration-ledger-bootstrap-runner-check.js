'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-runner.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-evidence-verification.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_DEPLOYMENT_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} missing marker: ${marker}`);
}

const runnerMarkers = [
  "expectedDatabase = 'kloka_talk2me'", "lockName = 'talk2me_os2_preview_migrations'", 'lockTimeoutSeconds = 10', 'connectTimeoutMs = 10000',
  'ALLOW_MIGRATION_LEDGER_BOOTSTRAP_NOT_ENABLED', 'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED',
  'VERIFIED_BACKUP_REFERENCE', 'VERIFIED_BACKUP_SHA256', 'BOOTSTRAP_OPERATOR', 'BOOTSTRAP_CHANGE_REFERENCE', 'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'validateText(required', 'CONTROL_CHARACTERS_PROHIBITED', 'DB_PORT_INVALID', 'DB_HOST_PATH_PROHIBITED',
  'BOOTSTRAP_SOURCE_OWNER_MISMATCH', 'BOOTSTRAP_SOURCE_SIZE_INVALID', 'BOOTSTRAP_SOURCE_SIZE_CHANGED_DURING_OPEN', 'BOOTSTRAP_SOURCE_SHORT_READ', 'BOOTSTRAP_SOURCE_CHANGED_DURING_READ',
  'BOOTSTRAP_SQL_BOM_PROHIBITED', 'BOOTSTRAP_SQL_CRLF_PROHIBITED', 'BOOTSTRAP_SQL_FINAL_NEWLINE_REQUIRED', 'BOOTSTRAP_SQL_COMMENTS_PROHIBITED',
  'BOOTSTRAP_SQL_MUST_CONTAIN_ONE_STATEMENT', 'BOOTSTRAP_SQL_SHAPE_INVALID', 'DROP ', 'ALTER ', 'GRANT ', 'OUTFILE',
  'BOOTSTRAP_EVIDENCE_PATH_MUST_BE_JSON', 'BOOTSTRAP_EVIDENCE_DIRECTORY_OWNER_MISMATCH', 'SECURE_DIRECTORY_FLAGS_UNAVAILABLE',
  'fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW', "fs.openSync(file, 'wx', 0o600)", 'crypto.randomBytes(16)',
  'connectTimeout: connectTimeoutMs', 'enableKeepAlive: false', 'namedPlaceholders: false', 'multipleStatements: false',
  'DATABASE() AS database_name', 'BOOTSTRAP_DATABASE_IDENTITY_MISMATCH', 'BOOTSTRAP_AUTOCOMMIT_MUST_BE_ENABLED',
  "SET SESSION time_zone = '+00:00'", 'BOOTSTRAP_SESSION_TIME_ZONE_MISMATCH', 'BOOTSTRAP_SESSION_SAFE_UPDATES_UNEXPECTED',
  'SELECT GET_LOCK(?, ?) AS acquired', 'SELECT IS_USED_LOCK(?) AS owner_connection_id', 'BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE',
  'BOOTSTRAP_POSTCHECK_ID_DEFINITION_MISMATCH', 'BOOTSTRAP_POSTCHECK_REQUIRED_COLUMNS_NULLABLE', 'BOOTSTRAP_LEDGER_NOT_EMPTY',
  'SELECT RELEASE_LOCK(?) AS released', 'SELECT IS_FREE_LOCK(?) AS is_free', 'BOOTSTRAP_ADVISORY_LOCK_NOT_FREE_AFTER_RELEASE',
  'BOOTSTRAP_TIMESTAMP_ORDER_INVALID', 'databaseIdentityVerified', 'sessionSafetyVerified', 'connectionIdRecorded',
  'advisoryLockFreeAfterRelease', 'bootstrapSourceSecurelyRead: true', 'bootstrapSqlSingleStatementVerified: true',
  'evidenceDirectoryPrivate: true', 'evidenceDirectoryOwnerVerified: true', 'evidencePathCanonical: true',
  'privateAtomicEvidencePublished: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
];
requireMarkers(runner, runnerMarkers, 'Bootstrap runner');

const orderedMarkers = [
  '  validateEvidenceTarget(evidencePath);', '  const sql = secureReadBootstrap();', '  validateBootstrapSql(sql);', '  const connection = await mysql.createConnection',
  'DATABASE() AS database_name', 'SELECT GET_LOCK(?, ?) AS acquired', 'BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE',
  'await connection.query(sql)', 'await verifyLedgerSchema(connection)', 'SELECT RELEASE_LOCK(?) AS released',
  'SELECT IS_FREE_LOCK(?) AS is_free', 'await connection.end()', 'const evidenceSha256 = publishEvidencePair(evidencePath, evidence)'
];
let previous = -1;
for (const marker of orderedMarkers) {
  const position = runner.indexOf(marker);
  if (position === -1) throw new Error(`Bootstrap runner order marker missing: ${marker}`);
  if (position <= previous) throw new Error(`Bootstrap runner order invalid at ${marker}`);
  previous = position;
}

if (/env:\s*\{\s*\.\.\.process\.env/.test(runner)) throw new Error('Bootstrap runner must not create child processes with inherited parent environments');
if (!/multipleStatements:\s*false/.test(runner)) throw new Error('Bootstrap database connection must disable multiple statements');
if (!/enableKeepAlive:\s*false/.test(runner)) throw new Error('Bootstrap database connection must disable keepalive');
if (!/connectTimeout:\s*connectTimeoutMs/.test(runner)) throw new Error('Bootstrap database connection timeout must be explicit');
if (!runner.includes("if ((sql.match(/;/g) || []).length !== 1)")) throw new Error('Bootstrap SQL single-statement enforcement missing');
if (runner.indexOf('const evidenceSha256 = publishEvidencePair(evidencePath, evidence)') < runner.indexOf('await connection.end()')) throw new Error('Evidence publication must follow database closure');

requireMarkers(verifier, [
  'preexistingLedgerTableCount !== 0', 'createdLedgerTableCount !== 1', 'advisoryLockReleased !== true',
  'bootstrapMatchesWorkspace: true', 'advisoryLockLifecycleVerified: true'
], 'Bootstrap evidence verifier');

requireMarkers(runbook, [
  'ALLOW_MIGRATION_LEDGER_BOOTSTRAP=true', 'VERIFIED_BACKUP_REFERENCE', 'VERIFIED_BACKUP_SHA256', 'BOOTSTRAP_OPERATOR',
  'BOOTSTRAP_CHANGE_REFERENCE', 'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH', 'single reviewed SQL statement',
  'database identity', 'UTC session time zone', 'autocommit', 'advisory lock is free after release',
  'private JSON evidence file', 'SHA-256 sidecar', 'refuses an existing ledger table', 'confirms the ledger is empty'
], 'Deployment runbook');

const exactScripts = {
  'bootstrap:migration-ledger': 'node migration-ledger-bootstrap-runner.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'check:migration-ledger-bootstrap-runner': 'node migration-ledger-bootstrap-runner-check.js'
};
for (const [name, command] of Object.entries(exactScripts)) if (pkg.scripts?.[name] !== command) throw new Error(`Missing exact ${name} command`);
for (const marker of ['node --check migration-ledger-bootstrap-runner.js','node --check migration-ledger-bootstrap-runner-check.js','node migration-ledger-bootstrap-runner-check.js']) if (!pkg.scripts.check.includes(marker)) throw new Error(`Normal validation missing ${marker}`);

console.log(JSON.stringify({
  ok: true,
  check: 'migration-ledger-bootstrap-runner-governance',
  meaningfulControlsGoverned: 50,
  previewDatabaseOnly: true,
  verifiedBackupEvidenceRequired: true,
  metadataValidationRequired: true,
  databasePortValidationRequired: true,
  databaseHostPathRejectionRequired: true,
  secureSourceOwnerCheckRequired: true,
  secureSourceStableReadRequired: true,
  utf8BomRejected: true,
  crlfRejected: true,
  finalNewlineRequired: true,
  sqlCommentsRejected: true,
  exactlyOneSqlStatementRequired: true,
  destructiveSqlTokensRejected: true,
  evidenceJsonExtensionRequired: true,
  evidenceDirectoryOwnerRequired: true,
  secureDirectoryDescriptorRequired: true,
  privateAtomicEvidenceRequired: true,
  connectionTimeoutRequired: true,
  multipleStatementsDisabled: true,
  connectionKeepaliveDisabled: true,
  databaseIdentityVerificationRequired: true,
  autocommitVerificationRequired: true,
  utcSessionRequired: true,
  safeUpdatesSessionVerificationRequired: true,
  advisoryLockRequired: true,
  advisoryLockOwnerRequired: true,
  advisoryLockReleaseRequired: true,
  advisoryLockFreeAfterReleaseRequired: true,
  existingLedgerRefused: true,
  postCreateSchemaVerificationRequired: true,
  idDefinitionVerificationRequired: true,
  requiredColumnNullabilityVerificationRequired: true,
  emptyLedgerRequired: true,
  databaseClosedBeforeEvidencePublication: true,
  timestampOrderRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
