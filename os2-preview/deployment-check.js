'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];

function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    failures.push(`Missing deployment dependency ${file}`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}

function requireMarkers(file, markers) {
  const source = read(file);
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${file} missing ${marker}`);
  }
}

requireMarkers('migration-runner.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'",
  "required('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH')",
  'verifyBootstrapEvidence()',
  'bootstrapEvidenceVerifiedBeforeDatabaseConnection: true',
  'ALLOW_PREVIEW_MIGRATIONS_NOT_ENABLED',
  'MIGRATION_CHECKSUM_MISMATCH',
  'MIGRATION_ADVISORY_LOCK_RELEASE_NOT_CONFIRMED',
  'advisoryLockReleased: true',
  'databaseConnectionClosedBeforeSuccess: true',
  'runtimeCreateTableUsed: false',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

requireMarkers('migration-ledger-bootstrap-runner.js', [
  "expectedDatabase = 'kloka_talk2me'",
  'ALLOW_MIGRATION_LEDGER_BOOTSTRAP_NOT_ENABLED',
  'VERIFIED_BACKUP_REFERENCE',
  'VERIFIED_BACKUP_SHA256',
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE',
  'privateAtomicEvidencePublished: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

requireMarkers('migration-ledger-bootstrap-evidence-verification.js', [
  'migration-ledger-bootstrap-evidence-verification',
  'bootstrapMatchesWorkspace: true',
  'verifiedBackupEvidencePresent: true',
  'ledgerAbsentBeforeBootstrap: true',
  'advisoryLockLifecycleVerified: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

requireMarkers('workspace-topology-verification.js', [
  'PREVIEW_APP_ROOT is required',
  'O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification',
  'MIGRATION_LEDGER_BOOTSTRAP.sql',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'protectedFilesHardLinkFree: true',
  'ownershipConsistent: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

requireMarkers('workspace-topology-governance-check.js', [
  "check: 'workspace-topology-governance'",
  'packageCommandRegistered: true',
  'normalValidationRegistered: true',
  'migrationLedgerBootstrapProtected: true',
  'migration025Required: true'
]);

requireMarkers('preview-activation-governance-check.js', [
  "check: 'preview-activation-governance'",
  'packageCommandRegistered: true',
  'normalValidationRegistered: true',
  'workspaceTopologyVerificationRequired: true',
  'previewRestartExecuted: false'
]);

requireMarkers('release-evidence-security-check.js', [
  "check: 'release-evidence-security'",
  'packageCommandRegistered: true',
  'normalValidationRegistered: true',
  'noFollowRequired: true',
  'descriptorIdentityRequired: true',
  'boundedReadsRequired: true'
]);

requireMarkers('runtime-release-identity-check.js', [
  "expectedApplication = 'talk2me-os2-preview'",
  "expectedVersion = '0.59.0'",
  'expectedNodeMajor = 20',
  "expectedDatabase = 'kloka_talk2me'",
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);

requireMarkers('preview-data-verification.js', [
  "expectedDatabase = 'kloka_talk2me'",
  "'schema-verification.js'",
  "'merge-restore-evidence-verification.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal || result.status !== 0',
  'mergeExecutionEnabled: false'
]);

requireMarkers('PREVIEW_DEPLOYMENT_RUNBOOK.md', [
  'talk2me.kloka.co.za',
  'talk2me.uent.co.za',
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'npm run bootstrap:migration-ledger',
  'npm run verify:migration-ledger-bootstrap-evidence',
  'npm run migrate:preview',
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'Restart only the preview Node.js application',
  'only the final post-cleanup JSON success record confirms migration completion'
]);

const pkg = JSON.parse(read('package.json') || '{}');
const requiredScripts = {
  'bootstrap:migration-ledger': 'node migration-ledger-bootstrap-runner.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'migrate:preview': 'node migration-runner.js',
  'verify:runtime-release-identity': 'node runtime-release-identity-check.js',
  'verify:preview-activation-preflight': 'node preview-activation-preflight.js',
  'verify:preview-data': 'node preview-data-verification.js',
  'check:migration-ledger-bootstrap-runner': 'node migration-ledger-bootstrap-runner-check.js',
  'check:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-check.js',
  'check:migration-runner-security': 'node migration-runner-security-check.js',
  'check:workspace-topology-governance': 'node workspace-topology-governance-check.js',
  'check:preview-activation-governance': 'node preview-activation-governance-check.js',
  'check:release-evidence-security': 'node release-evidence-security-check.js',
  'check:readiness': 'node readiness-check.js',
  'check:deployment': 'node deployment-check.js'
};
for (const [name, command] of Object.entries(requiredScripts)) {
  if (!pkg.scripts || pkg.scripts[name] !== command) failures.push(`package.json missing exact ${name} command`);
}

const normalCheck = pkg.scripts && pkg.scripts.check || '';
for (const command of [
  'node migration-ledger-bootstrap-runner-check.js',
  'node migration-ledger-bootstrap-evidence-check.js',
  'node migration-runner-security-check.js',
  'node workspace-topology-governance-check.js',
  'node preview-activation-governance-check.js',
  'node release-evidence-security-check.js'
]) {
  if (!normalCheck.includes(command)) failures.push(`Normal validation missing ${command}`);
}

if (failures.length) {
  console.error('DEPLOYMENT CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'deployment-controls',
  application: pkg.name,
  version: pkg.version,
  nodeMajorRequired: 20,
  database: 'kloka_talk2me',
  migrationLedgerBootstrapRequired: true,
  bootstrapEvidenceRequired: true,
  bootstrapEvidenceVerifiedBeforeMigrationConnection: true,
  migrationCompletionRequiresLockRelease: true,
  databaseConnectionClosedBeforeMigrationSuccess: true,
  workspaceTopologyGovernanceRequired: true,
  previewActivationGovernanceRequired: true,
  secureReleaseEvidenceVerificationRequired: true,
  previewDataVerificationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
