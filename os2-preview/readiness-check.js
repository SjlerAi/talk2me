'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const failures = [];
const warnings = [];

function requireEnv(name) {
  if (!String(process.env[name] || '').trim()) failures.push(`Missing ${name}`);
}
function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    failures.push(`Missing file ${file}`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}
function requireMarkers(file, markers) {
  const source = read(file);
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`);
}

['DB_HOST','DB_USER','DB_NAME','PREVIEW_APP_ROOT'].forEach(requireEnv);
if (process.env.DB_NAME && process.env.DB_NAME !== 'kloka_talk2me') failures.push('DB_NAME is not the preview database');
if (process.env.PREVIEW_APP_ROOT && path.resolve(process.env.PREVIEW_APP_ROOT) !== root) failures.push('PREVIEW_APP_ROOT does not match the executing preview application root');
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor !== 20) failures.push(`Node.js 20.x is required, found ${process.versions.node}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') failures.push('ALLOW_PRODUCTION_MUTATION must remain false');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') failures.push('ENABLE_CUSTOMER_MERGE_EXECUTION must remain false');
if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') warnings.push('NODE_ENV is not production');
if (!fs.existsSync(path.join(root, 'package-lock.json'))) warnings.push('package-lock.json is absent and remains a release-freeze blocker');

const requiredFiles = [
  'server.js','package.json','MIGRATION_LEDGER_BOOTSTRAP.sql',
  'migration-ledger-bootstrap-governance-check.js','migration-ledger-bootstrap-runner.js',
  'migration-ledger-bootstrap-runner-check.js','migration-ledger-bootstrap-evidence-verification.js',
  'migration-ledger-bootstrap-evidence-check.js','migration-runner.js','migration-runner-security-check.js',
  'workspace-topology-verification.js','workspace-topology-governance-check.js',
  'workspace-source-integrity.js','workspace-source-integrity-check.js',
  'preview-activation-preflight.js','preview-activation-governance-check.js',
  'release-evidence-security-check.js','release-manifest-check.js',
  'runtime-release-identity-check.js','deployment-check.js','uat-gate-check.js',
  'schema-verification.js','preview-data-verification.js','merge-restore-evidence-verification.js',
  'PREVIEW_ACTIVATION_RUNBOOK.md','PREVIEW_DEPLOYMENT_RUNBOOK.md','PREVIEW_UAT_RUNBOOK.md'
];
requiredFiles.forEach(read);

requireMarkers('workspace-source-integrity.js', [
  'canonicalInventory','inventorySha256','secureDescriptorReads: true',
  'canonicalPathBinding: true','hardLinkRejection: true','boundedReads: true'
]);
requireMarkers('workspace-source-integrity-check.js', [
  "check: 'workspace-source-integrity-governance'",
  'packageCommandRegistered: true','normalSyntaxValidationRegistered: true',
  'normalGovernanceValidationRegistered: true','environmentBoundVerifierExcludedFromNormalExecution: true'
]);
requireMarkers('preview-activation-preflight.js', [
  "'workspace-topology-verification.js'",
  "'workspace-source-integrity.js'",
  "'workspace-source-integrity-check.js'",
  "'workspace-topology-governance-check.js'",
  "'migration-ledger-bootstrap-governance-check.js'",
  "'migration-ledger-bootstrap-runner-check.js'",
  "'migration-ledger-bootstrap-evidence-check.js'",
  "'migration-runner-security-check.js'",
  "'runtime-release-identity-check.js'",
  "'readiness-check.js'",
  "'deployment-check.js'",
  "'uat-gate-check.js'",
  "'release-evidence-security-check.js'",
  "'release-manifest-check.js'",
  'workspaceSourceIntegrityVerified: true',
  'workspaceSourceIntegrityGovernanceVerified: true',
  'orderedGovernanceChecksCompleted: completed.length',
  'databaseBackedVerificationExecuted: false',
  'migrationsExecuted: false',
  'previewRestartExecuted: false'
]);
requireMarkers('preview-activation-governance-check.js', [
  "check: 'preview-activation-governance'",
  'orderedSourceChecks: orderedScripts.length',
  'workspaceSourceIntegrityRequired: true',
  'workspaceSourceIntegrityGovernanceRequired: true',
  'migrationLedgerBootstrapGovernanceRequired: true',
  'migrationLedgerBootstrapRunnerGovernanceRequired: true',
  'migrationLedgerBootstrapEvidenceGovernanceRequired: true',
  'migrationRunnerSecurityRequired: true',
  'releaseEvidenceSecurityRequired: true',
  'packageCommandRegistered: true',
  'normalValidationRegistered: true'
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
requireMarkers('migration-ledger-bootstrap-runner.js', [
  'VERIFIED_BACKUP_REFERENCE','VERIFIED_BACKUP_SHA256','MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH',
  'BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE','privateAtomicEvidencePublished: true'
]);
requireMarkers('migration-ledger-bootstrap-evidence-verification.js', [
  'bootstrapMatchesWorkspace: true','verifiedBackupEvidencePresent: true',
  'ledgerAbsentBeforeBootstrap: true','advisoryLockLifecycleVerified: true'
]);
requireMarkers('deployment-check.js', [
  'migrationLedgerBootstrapRequired: true','bootstrapEvidenceRequired: true',
  'migrationCompletionRequiresLockRelease: true','databaseConnectionClosedBeforeMigrationSuccess: true'
]);
requireMarkers('uat-gate-check.js', [
  'migrationLedgerBootstrapEvidenceRequired: true',
  'migrationEvidenceVerifiedBeforeDatabaseConnection: true',
  'migrationCompletionRequiresConfirmedLockRelease: true'
]);
requireMarkers('PREVIEW_UAT_RUNBOOK.md', [
  'bootstrap evidence path and bootstrap source SHA-256',
  'final migration completion result showing evidence verification, lock release and connection closure',
  'Do not treat individual `applied <migration>` messages as migration completion evidence.'
]);

const migrationDir = path.join(root, 'migrations');
let migrationCount = 0;
if (!fs.existsSync(migrationDir)) {
  failures.push('Missing migrations directory');
} else {
  const migrations = fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
  migrationCount = migrations.length;
  if (migrationCount < 25) failures.push(`Expected at least 25 migrations, found ${migrationCount}`);
  if (!migrations.includes('20260801_025_merge_authorisation_restore_pin.sql')) failures.push('Missing migration 20260801_025_merge_authorisation_restore_pin.sql');
}

const pkg = JSON.parse(read('package.json') || '{}');
const exactScripts = {
  'verify:workspace-source-integrity': 'node workspace-source-integrity.js',
  'check:workspace-source-integrity': 'node workspace-source-integrity-check.js',
  'verify:preview-activation-preflight': 'node preview-activation-preflight.js',
  'check:preview-activation-governance': 'node preview-activation-governance-check.js',
  'check:workspace-topology-governance': 'node workspace-topology-governance-check.js',
  'check:release-evidence-security': 'node release-evidence-security-check.js',
  'bootstrap:migration-ledger': 'node migration-ledger-bootstrap-runner.js',
  'verify:migration-ledger-bootstrap-evidence': 'node migration-ledger-bootstrap-evidence-verification.js',
  'migrate:preview': 'node migration-runner.js',
  'check:deployment': 'node deployment-check.js',
  'check:uat-gate': 'node uat-gate-check.js'
};
for (const [name, command] of Object.entries(exactScripts)) {
  if (!pkg.scripts || pkg.scripts[name] !== command) failures.push(`Missing exact package command ${name}`);
}
if (!pkg.scripts || !pkg.scripts.check.includes('node --check workspace-source-integrity.js')) failures.push('Normal validation missing workspace source integrity syntax check');
if (!pkg.scripts || !pkg.scripts.check.includes('node --check workspace-source-integrity-check.js')) failures.push('Normal validation missing workspace source integrity governance syntax check');
if (!pkg.scripts || !pkg.scripts.check.includes('node workspace-source-integrity-check.js')) failures.push('Normal validation missing workspace source integrity governance execution');

const summary = {
  ok: failures.length === 0,
  application: pkg.name,
  version: pkg.version,
  nodeVersion: process.versions.node,
  applicationRoot: process.env.PREVIEW_APP_ROOT || null,
  database: process.env.DB_NAME || null,
  migrationCount,
  orderedActivationGovernanceChecksRequired: 14,
  deterministicWorkspaceSourceIntegrityRequired: true,
  workspaceSourceIntegrityPackageCommandsRequired: true,
  migrationLedgerBootstrapEvidenceRequired: true,
  migrationEvidenceVerifiedBeforeDatabaseConnection: true,
  migrationCompletionRequiresConfirmedLockRelease: true,
  databaseConnectionClosedBeforeMigrationSuccess: true,
  workspaceTopologyGovernanceRequired: true,
  releaseEvidenceSecurityRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  failures,
  warnings
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
