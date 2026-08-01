'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];

function source(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    failures.push(`Missing UAT dependency ${file}`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}
function expect(condition, message) {
  if (!condition) failures.push(message);
}
function requireMarkers(file, markers) {
  const content = source(file);
  for (const marker of markers) expect(content.includes(marker), `${file} missing ${marker}`);
}

requireMarkers('preview-uat-runner.js', [
  "expectedHost = 'talk2me.kloka.co.za'",
  'REFUSING_NON_PREVIEW_URL',
  "UAT_ALLOW_MUTATIONS === 'true'",
  '/api/auth/login',
  '/api/dashboard',
  '/api/os2/customers/search',
  '/api/os2/work-items',
  '/api/os2/notifications',
  '/api/auth/logout'
]);
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
  'environmentBoundVerifierExcludedFromNormalExecution: true'
]);
requireMarkers('runtime-release-identity-check.js', [
  "expectedApplication = 'talk2me-os2-preview'",
  "expectedVersion = '0.59.0'",
  'expectedNodeMajor = 20',
  "expectedDatabase = 'kloka_talk2me'",
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);
requireMarkers('migration-ledger-bootstrap-evidence-verification.js', [
  'bootstrapMatchesWorkspace: true',
  'verifiedBackupEvidencePresent: true',
  'ledgerAbsentBeforeBootstrap: true',
  'advisoryLockLifecycleVerified: true'
]);
requireMarkers('migration-runner.js', [
  "required('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH')",
  'bootstrapEvidenceVerifiedBeforeDatabaseConnection: true',
  'ledgerStrictPrefixVerified: true',
  'advisoryLockReleased: true',
  'databaseConnectionClosedBeforeSuccess: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
]);
requireMarkers('preview-activation-preflight.js', [
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  "'release-source-integrity-check.js'",
  "'runtime-release-identity-check.js'",
  "'readiness-check.js'",
  "'deployment-check.js'",
  "'uat-gate-check.js'",
  "'release-manifest-check.js'",
  'releaseSourceIntegrityGovernanceVerified: true',
  'databaseBackedVerificationExecuted: false',
  'migrationsExecuted: false',
  'previewRestartExecuted: false'
]);
requireMarkers('schema-verification.js', [
  "dbName !== 'kloka_talk2me'",
  'information_schema.TABLES',
  'information_schema.COLUMNS',
  'duplicate active mobile numbers',
  'migrations.length < 25',
  'restore_test_id IS NULL'
]);
requireMarkers('preview-data-verification.js', [
  "expectedDatabase = 'kloka_talk2me'",
  "'schema-verification.js'",
  "'merge-restore-evidence-verification.js'",
  'result.error',
  'result.signal || result.status !== 0',
  'mergeExecutionEnabled: false'
]);
const previewData = source('preview-data-verification.js');
expect(previewData.indexOf('schema-verification.js') < previewData.indexOf('merge-restore-evidence-verification.js'), 'Preview data verification must run schema before restore evidence');
requireMarkers('migrations/20260801_025_merge_authorisation_restore_pin.sql', ['ADD COLUMN restore_test_id BIGINT NULL']);
requireMarkers('merge-restore-evidence-verification.js', [
  "database !== 'kloka_talk2me'",
  'rt.id = a.restore_test_id',
  'rt.backup_run_id <> a.backup_run_id',
  'rt.completed_at > a.authorised_at'
]);
requireMarkers('customer-merge-execution-readiness-routes.js', ['executionAvailable:false']);
requireMarkers('PREVIEW_UAT_RUNBOOK.md', [
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'schema-verification.js` first',
  'merge-restore-evidence-verification.js` second',
  'Running only `npm run verify:schema` is not sufficient',
  'mergeExecutionEnabled: false',
  'exact commit SHA and preview version'
]);
requireMarkers('PREVIEW_DEPLOYMENT_RUNBOOK.md', [
  'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'npm run verify:migration-ledger-bootstrap-evidence',
  'bootstrap evidence verifier again before opening MySQL',
  'only the final post-cleanup JSON success record confirms migration completion'
]);

const pkg = JSON.parse(source('package.json') || '{}');
const exactScripts = {
  'verify:release-source-integrity': 'node release-source-integrity-verification.js',
  'check:release-source-integrity': 'node release-source-integrity-check.js',
  'verify:runtime-release-identity': 'node runtime-release-identity-check.js',
  'verify:preview-activation-preflight': 'node preview-activation-preflight.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'migrate:preview': 'node migration-runner.js',
  'verify:schema': 'node schema-verification.js',
  'verify:merge-restore-evidence': 'node merge-restore-evidence-verification.js',
  'verify:preview-data': 'node preview-data-verification.js',
  'uat:preview': 'node preview-uat-runner.js'
};
for (const [name, command] of Object.entries(exactScripts)) expect(pkg.scripts?.[name] === command, `Package must expose exact ${name}`);
const normalCheck = String(pkg.scripts?.check || '');
for (const marker of [
  'node --check release-source-integrity-verification.js',
  'node --check release-source-integrity-check.js',
  'node release-source-integrity-check.js'
]) expect(normalCheck.includes(marker), `Normal validation missing ${marker}`);
expect(!normalCheck.includes('node release-source-integrity-verification.js'), 'Environment-bound release source verifier must not execute in normal validation');

if (failures.length) {
  console.error('UAT GATE CHECK FAILED');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  check: 'uat-gate',
  approvedSourceInventoryRequired: true,
  releaseSourceIntegrityVerificationRequired: true,
  releaseSourceIntegrityGovernanceRequired: true,
  dependencyLockInApprovedSourceRequired: true,
  runtimeReleaseIdentityRequired: true,
  previewActivationPreflightRequired: true,
  migrationLedgerBootstrapEvidenceRequired: true,
  migrationEvidenceVerifiedBeforeDatabaseConnection: true,
  migrationCompletionRequiresConfirmedLockRelease: true,
  previewDataVerificationRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
