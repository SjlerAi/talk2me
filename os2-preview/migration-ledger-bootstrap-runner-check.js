'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const runner = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-runner.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-evidence-verification.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_DEPLOYMENT_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const runnerMarkers = [
  "expectedDatabase = 'kloka_talk2me'",
  "lockName = 'talk2me_os2_preview_migrations'",
  'ALLOW_MIGRATION_LEDGER_BOOTSTRAP_NOT_ENABLED',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED',
  'MERGE_EXECUTION_FLAG_PROHIBITED',
  'VERIFIED_BACKUP_REFERENCE',
  'VERIFIED_BACKUP_SHA256',
  'BOOTSTRAP_OPERATOR',
  'BOOTSTRAP_CHANGE_REFERENCE',
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'BOOTSTRAP_SOURCE_HARD_LINK_PROHIBITED',
  'BOOTSTRAP_SOURCE_WRITABLE_BY_GROUP_OR_WORLD',
  'BOOTSTRAP_SQL_MUST_CREATE_EXACTLY_ONE_TABLE',
  'BOOTSTRAP_EVIDENCE_PATH_MUST_BE_ABSOLUTE',
  'BOOTSTRAP_EVIDENCE_DIRECTORY_NOT_PRIVATE',
  'BOOTSTRAP_EVIDENCE_ALREADY_EXISTS',
  "fs.openSync(file, 'wx', 0o600)",
  'fs.fsyncSync(descriptor)',
  'fs.linkSync(checksumTemp, checksumPath)',
  'fs.linkSync(evidenceTemp, evidencePath)',
  'syncDirectory(directory)',
  'SELECT CONNECTION_ID() AS connection_id',
  'SELECT GET_LOCK(?, 10) AS acquired',
  'SELECT IS_USED_LOCK(?) AS owner_connection_id',
  'BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE',
  'verifyLedgerSchema(connection)',
  'BOOTSTRAP_LEDGER_NOT_EMPTY',
  'SELECT RELEASE_LOCK(?) AS released',
  'BOOTSTRAP_ADVISORY_LOCK_RELEASE_NOT_CONFIRMED',
  'preexistingLedgerTableCount: 0',
  'createdLedgerTableCount: 1',
  'advisoryLockReleased',
  'privateAtomicEvidencePublished: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
];
for (const marker of runnerMarkers) {
  if (!runner.includes(marker)) throw new Error(`Bootstrap runner missing marker: ${marker}`);
}

if (runner.indexOf('secureReadBootstrap()') > runner.indexOf('mysql.createConnection')) throw new Error('Bootstrap source must be secured before database connection');
if (runner.indexOf('validateEvidenceTarget(evidencePath)') > runner.indexOf('mysql.createConnection')) throw new Error('Evidence target must be validated before database connection');
if (runner.indexOf('BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE') > runner.indexOf('await connection.query(sql)')) throw new Error('Existing ledger-table refusal must precede bootstrap execution');
if (runner.indexOf('verifyLedgerSchema(connection)') < runner.indexOf('await connection.query(sql)')) throw new Error('Post-bootstrap schema verification must follow bootstrap execution');
if (runner.indexOf('publishEvidencePair(evidencePath, evidence)') < runner.indexOf('await connection.end()')) throw new Error('Evidence publication must occur only after database cleanup and lock release');

const verifierMarkers = [
  'preexistingLedgerTableCount !== 0',
  'createdLedgerTableCount !== 1',
  'advisoryLockReleased !== true',
  'bootstrapMatchesWorkspace: true',
  'advisoryLockLifecycleVerified: true'
];
for (const marker of verifierMarkers) if (!verifier.includes(marker)) throw new Error(`Bootstrap evidence verifier missing marker: ${marker}`);

const runbookMarkers = [
  'ALLOW_MIGRATION_LEDGER_BOOTSTRAP=true',
  'VERIFIED_BACKUP_REFERENCE',
  'VERIFIED_BACKUP_SHA256',
  'BOOTSTRAP_OPERATOR',
  'BOOTSTRAP_CHANGE_REFERENCE',
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'migration-ledger-bootstrap-runner.js',
  'private JSON evidence file',
  'SHA-256 sidecar',
  'refuses an existing ledger table',
  'confirms the ledger is empty'
];
for (const marker of runbookMarkers) if (!runbook.includes(marker)) throw new Error(`Deployment runbook missing bootstrap runner marker: ${marker}`);

if (pkg.scripts['bootstrap:migration-ledger'] !== 'node migration-ledger-bootstrap-runner.js') throw new Error('Missing bootstrap:migration-ledger command');
if (pkg.scripts['verify:migration-ledger-bootstrap-evidence'] !== 'node migration-ledger-bootstrap-evidence-verification.js') throw new Error('Missing bootstrap evidence verification command');
if (pkg.scripts['check:migration-ledger-bootstrap-runner'] !== 'node migration-ledger-bootstrap-runner-check.js') throw new Error('Missing bootstrap runner governance command');
if (!pkg.scripts.check.includes('node --check migration-ledger-bootstrap-runner.js')) throw new Error('Bootstrap runner syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node --check migration-ledger-bootstrap-runner-check.js')) throw new Error('Bootstrap runner governance syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node migration-ledger-bootstrap-runner-check.js')) throw new Error('Bootstrap runner governance missing from normal validation');

console.log(JSON.stringify({
  ok: true,
  check: 'migration-ledger-bootstrap-runner-governance',
  previewDatabaseOnly: true,
  verifiedBackupEvidenceRequired: true,
  explicitExecutionFlagRequired: true,
  secureSourceReadRequired: true,
  advisoryLockRequired: true,
  existingLedgerRefused: true,
  postCreateSchemaVerificationRequired: true,
  emptyLedgerRequired: true,
  privateAtomicEvidenceRequired: true,
  evidencePublishedAfterLockRelease: true,
  evidenceVerifierRegistered: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
