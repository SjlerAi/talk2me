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
  const value = read(file);
  for (const marker of markers) if (!value.includes(marker)) failures.push(`${file} missing ${marker}`);
}

requireMarkers('release-source-integrity-verification.js', [
  'RELEASE_SOURCE_INVENTORY_SHA256',
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'verifierTimeoutMs = 30000',
  "killSignal: 'SIGKILL'",
  'shell: false',
  'exactApprovedInventoryMatched: true',
  'evidence.packageLockPresent !== true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);
requireMarkers('release-source-integrity-check.js', [
  "check: 'release-source-integrity-governance'",
  'packageCommandsRegistered: true',
  'normalSyntaxValidationRegistered: true',
  'normalGovernanceValidationRegistered: true',
  'environmentBoundVerifierExcludedFromNormalExecution: true',
  'verificationBeforeReleasePublicationRequired: true',
  'postFreezeVerificationBeforeIndividualFilesRequired: true'
]);
requireMarkers('migration-runner.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'",
  "required('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH')",
  'bootstrapEvidenceVerifiedBeforeDatabaseConnection: true',
  'ALLOW_PREVIEW_MIGRATIONS_NOT_ENABLED',
  'MIGRATION_CHECKSUM_MISMATCH',
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
  'privateAtomicEvidencePublished: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);
requireMarkers('migration-ledger-bootstrap-evidence-verification.js', [
  'bootstrapMatchesWorkspace: true',
  'verifiedBackupEvidencePresent: true',
  'ledgerAbsentBeforeBootstrap: true',
  'advisoryLockLifecycleVerified: true'
]);
requireMarkers('workspace-topology-verification.js', [
  'PREVIEW_APP_ROOT is required',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'protectedFilesHardLinkFree: true',
  'ownershipConsistent: true'
]);
requireMarkers('preview-activation-governance-check.js', [
  'orderedSourceChecks: orderedScripts.length',
  'releaseSourceIntegrityGovernanceRequired: true',
  'releaseSourceIntegrityCommandsRegistered: true',
  'releaseSourceIntegrityNormalValidationRegistered: true',
  'previewRestartExecuted: false'
]);
requireMarkers('runtime-release-identity-check.js', [
  "expectedApplication = 'talk2me-os2-preview'",
  "expectedVersion = '0.59.0'",
  'expectedNodeMajor = 20',
  "expectedDatabase = 'kloka_talk2me'"
]);
requireMarkers('preview-data-verification.js', [
  "expectedDatabase = 'kloka_talk2me'",
  "'schema-verification.js'",
  "'merge-restore-evidence-verification.js'",
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
  'verify:release-source-integrity': 'node release-source-integrity-verification.js',
  'check:release-source-integrity': 'node release-source-integrity-check.js',
  'bootstrap:migration-ledger': 'node migration-ledger-bootstrap-runner.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'migrate:preview': 'node migration-runner.js',
  'verify:runtime-release-identity': 'node runtime-release-identity-check.js',
  'verify:preview-activation-preflight': 'node preview-activation-preflight.js',
  'verify:preview-data': 'node preview-data-verification.js',
  'check:readiness': 'node readiness-check.js',
  'check:deployment': 'node deployment-check.js'
};
for (const [name, command] of Object.entries(requiredScripts)) if (pkg.scripts?.[name] !== command) failures.push(`package.json missing exact ${name} command`);
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of [
  'node --check release-source-integrity-verification.js',
  'node --check release-source-integrity-check.js',
  'node release-source-integrity-check.js'
]) if (!normalCheck.includes(marker)) failures.push(`Normal validation missing ${marker}`);
if (normalCheck.includes('node release-source-integrity-verification.js')) failures.push('Environment-bound release source verifier must not execute during normal validation');

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
  approvedSourceInventoryRequired: true,
  releaseSourceIntegrityVerificationRequired: true,
  releaseSourceIntegrityGovernanceRequired: true,
  releaseSourceIntegrityBoundedExecutionRequired: true,
  dependencyLockInApprovedSourceRequired: true,
  migrationLedgerBootstrapRequired: true,
  bootstrapEvidenceRequired: true,
  bootstrapEvidenceVerifiedBeforeMigrationConnection: true,
  migrationCompletionRequiresLockRelease: true,
  databaseConnectionClosedBeforeMigrationSuccess: true,
  previewDataVerificationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
