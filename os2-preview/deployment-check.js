'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];

function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { failures.push(`Missing deployment dependency ${file}`); return ''; }
  return fs.readFileSync(full, 'utf8');
}
function requireMarkers(file, markers) {
  const value = read(file);
  for (const marker of markers) if (!value.includes(marker)) failures.push(`${file} missing ${marker}`);
}

requireMarkers('release-source-integrity-verification.js', [
  'RELEASE_SOURCE_INVENTORY_SHA256', "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'verifierTimeoutMs = 30000', "killSignal: 'SIGKILL'", 'shell: false', 'exactApprovedInventoryMatched: true',
  'evidence.packageLockPresent !== true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('migration-runner.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'", "RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild'",
  'bootstrapEvidenceVerifiedBeforeDatabaseConnection: true', 'finalLedgerInventoryVerified: true',
  'advisoryLockFreeAfterRelease = true', 'databaseConnectionClosedBeforeSuccess = true',
  'runtimeCreateTableUsed: false', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('migration-ledger-bootstrap-runner.js', [
  "expectedDatabase = 'kloka_talk2me'", 'ALLOW_MIGRATION_LEDGER_BOOTSTRAP_NOT_ENABLED',
  'VERIFIED_BACKUP_REFERENCE', 'VERIFIED_BACKUP_SHA256', 'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'privateAtomicEvidencePublished: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
]);
requireMarkers('migration-ledger-bootstrap-evidence-verification.js', [
  'bootstrapMatchesWorkspace: true', 'verifiedBackupEvidencePresent: true',
  'ledgerAbsentBeforeBootstrap: true', 'advisoryLockLifecycleVerified: true'
]);
requireMarkers('workspace-topology-verification.js', [
  'PREVIEW_APP_ROOT is required', '20260801_025_merge_authorisation_restore_pin.sql',
  'protectedFilesHardLinkFree: true', 'ownershipConsistent: true'
]);
requireMarkers('preview-activation-governance-check.js', [
  'orderedSourceChecks: orderedScripts.length', 'releaseSourceIntegrityGovernanceRequired: true', 'previewRestartExecuted: false'
]);
requireMarkers('runtime-release-identity-check.js', [
  "expectedApplication = 'talk2me-os2-preview'", "expectedVersion = '0.59.0'", 'expectedNodeMajor = 20', "expectedDatabase = 'kloka_talk2me'"
]);

const previewDataMarkers = [
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", 'expectedNodeMajor = 20',
  'verifierTimeoutMs = 60000', 'maxVerifierOutputBytes = 4 * 1024 * 1024',
  "{ file: 'schema-verification.js', check: 'schema-verification' }",
  "{ file: 'merge-restore-evidence-verification.js', check: 'merge-restore-evidence-verification' }",
  'PREVIEW_DATABASE_REQUIRED', 'CONTROLLED_BRANCH_REQUIRED', 'PREVIEW_APP_ROOT_INVALID', 'NODE_20_REQUIRED',
  'PRODUCTION_MUTATION_FLAG_PROHIBITED', 'MERGE_EXECUTION_FLAG_PROHIBITED',
  'buildChildEnvironment()', "const inheritedKeys = ['PATH','HOME','USER','LOGNAME','TMPDIR','TEMP','TMP','LANG','LC_ALL','TZ','CI','GITHUB_ACTIONS']",
  'Object.freeze(env)', "env.NODE_ENV = 'production'", "env.ALLOW_PRODUCTION_MUTATION = 'false'", "env.ENABLE_CUSTOMER_MERGE_EXECUTION = 'false'",
  'DB_HOST_REQUIRED', 'DB_USER_REQUIRED', 'DB_PORT_INVALID', 'CHILD_ENVIRONMENT_KEY_LIMIT_EXCEEDED',
  'encoding: \'utf8\'', 'maxBuffer: maxVerifierOutputBytes', 'timeout: verifierTimeoutMs', "killSignal: 'SIGKILL'", 'shell: false', 'windowsHide: true',
  'VERIFIER_TIMEOUT', 'VERIFIER_START_FAILED', 'VERIFIER_SIGNALLED', 'VERIFIER_FAILED',
  'VERIFIER_OUTPUT_INVALID_JSON', 'VERIFIER_OUTPUT_NOT_SUCCESSFUL', 'VERIFIER_DATABASE_MISMATCH',
  'SCHEMA_TABLE_EVIDENCE_INCOMPLETE', 'SCHEMA_COLUMN_EVIDENCE_INCOMPLETE', 'SCHEMA_MIGRATION_EVIDENCE_INCOMPLETE',
  'SCHEMA_ZERO_DEFECT_EVIDENCE_MISSING', 'RESTORE_VERIFIER_IDENTITY_MISMATCH', 'INVALID_RESTORE_AUTHORISATIONS_DETECTED',
  'VERIFIER_COMPLETION_COUNT_MISMATCH', 'VERIFIER_ORDER_MISMATCH',
  'schemaVerifiedBeforeRestoreEvidence: true', 'verifierEnvironmentSanitized: true',
  'verifierEnvironmentFrozen: Object.isFrozen(childEnvironment)', 'fullParentEnvironmentInherited: false',
  'nodeOptionsInherited: false', 'nodePathInherited: false', 'bashEnvInherited: false',
  'gitDirectoryOverrideInherited: false', 'npmUserConfigOverrideInherited: false',
  'verifierOutputBytesBounded: true', 'verifierShellDisabled: true', "verifierForcedKillSignal: 'SIGKILL'",
  'schemaEvidenceParsed: true', 'schemaZeroDefectEvidenceVerified: true', 'restoreEvidenceParsed: true',
  'restoreAuthorisationDefects: 0', 'databaseBackedVerificationExecuted: true',
  'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
];
requireMarkers('preview-data-verification.js', previewDataMarkers);
const previewDataSource = read('preview-data-verification.js');
if (previewDataSource.includes('env: process.env')) failures.push('preview-data-verification.js must not pass the complete parent environment');
if (previewDataSource.indexOf("'schema-verification.js'") >= previewDataSource.indexOf("'merge-restore-evidence-verification.js'")) failures.push('Schema verification must remain before restore-evidence verification');
if (previewDataSource.indexOf('JSON.parse') >= previewDataSource.indexOf('evidence.push')) failures.push('Verifier JSON evidence must be parsed before acceptance');

requireMarkers('PREVIEW_DEPLOYMENT_RUNBOOK.md', [
  'talk2me.kloka.co.za', 'talk2me.uent.co.za', 'MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'npm run bootstrap:migration-ledger', 'npm run verify:migration-ledger-bootstrap-evidence', 'npm run migrate:preview',
  'DB_NAME=kloka_talk2me', 'npm run verify:preview-data', 'Preview data-verification orchestration',
  'sanitized allowlisted environment', '60-second timeout', '4 MiB output limit',
  'schema verification must complete first', 'zero-defect evidence', 'restore-authorisation defect count must be zero',
  'Restart only the preview Node.js application'
]);

const pkg = JSON.parse(read('package.json') || '{}');
const requiredScripts = {
  'verify:release-source-integrity': 'node release-source-integrity-verification.js',
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
for (const marker of ['node --check preview-data-verification.js','node deployment-check.js']) if (!normalCheck.includes(marker)) failures.push(`Normal validation missing ${marker}`);
if (normalCheck.includes('node preview-data-verification.js')) failures.push('Database-bound preview data verification must not execute during normal source validation');

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
  meaningfulPreviewDataControls: 60,
  nodeMajorRequired: 20,
  database: 'kloka_talk2me',
  controlledBranchRequired: true,
  approvedSourceInventoryRequired: true,
  migrationLedgerBootstrapRequired: true,
  bootstrapEvidenceRequired: true,
  migrationFinalLedgerReconciliationRequired: true,
  previewDataVerificationRequired: true,
  previewDataVerifierOrderRequired: true,
  previewDataChildEnvironmentSanitized: true,
  previewDataChildExecutionBounded: true,
  previewDataJsonEvidenceRequired: true,
  previewDataSchemaZeroDefectEvidenceRequired: true,
  previewDataRestoreEvidenceRequired: true,
  databaseBackedVerifierExcludedFromNormalValidation: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
