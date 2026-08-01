'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const topology = fs.readFileSync(path.join(root, 'workspace-topology-verification.js'), 'utf8');
const topologyGovernance = fs.readFileSync(path.join(root, 'workspace-topology-governance-check.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${label} missing marker: ${marker}`);
  }
}

requireMarkers(preflight, [
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20',
  'PREVIEW_APP_ROOT must match the executing application root',
  "ALLOW_PRODUCTION_MUTATION: 'false'",
  "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal',
  'result.status !== 0',
  'orderedGovernanceChecksCompleted: completed.length',
  'bootstrapGovernanceVerified: true',
  'bootstrapRunnerGovernanceVerified: true',
  'bootstrapEvidenceGovernanceVerified: true',
  'migrationRunnerSecurityVerified: true',
  'releaseEvidenceSecurityVerified: true',
  'databaseBackedVerificationExecuted: false',
  'migrationsExecuted: false',
  'previewRestartExecuted: false',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Preview activation preflight');

const orderedScripts = [
  "'workspace-topology-verification.js'",
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
  "'release-manifest-check.js'"
];
for (const script of orderedScripts) {
  if (!preflight.includes(script)) throw new Error(`Preview activation preflight missing ordered script ${script}`);
}
for (let index = 1; index < orderedScripts.length; index += 1) {
  if (preflight.indexOf(orderedScripts[index - 1]) >= preflight.indexOf(orderedScripts[index])) {
    throw new Error(`Preview activation preflight order is invalid at ${orderedScripts[index]}`);
  }
}

requireMarkers(topology, [
  'O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification',
  'fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)',
  'fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'protectedFilesHardLinkFree: true',
  'ownershipConsistent: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Workspace topology verification');

requireMarkers(topologyGovernance, [
  "check: 'workspace-topology-governance'",
  'packageCommandRegistered: true',
  'normalValidationRegistered: true',
  'migrationLedgerBootstrapProtected: true',
  'migration025Required: true'
], 'Workspace topology governance');

requireMarkers(runbook, [
  'talk2me.kloka.co.za',
  'talk2me.uent.co.za',
  'kloka_talk2me',
  'agent/talk2me-os2-integrated-rebuild',
  'PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview',
  'npm run verify:preview-activation-preflight',
  'npm ci',
  'npm run check',
  'Restart only the preview Node.js application'
], 'Preview activation runbook');

if (pkg.scripts['verify:preview-activation-preflight'] !== 'node preview-activation-preflight.js') throw new Error('Missing verify:preview-activation-preflight command');
if (pkg.scripts['check:preview-activation-governance'] !== 'node preview-activation-governance-check.js') throw new Error('Missing check:preview-activation-governance command');
if (!pkg.scripts.check.includes('node --check preview-activation-preflight.js')) throw new Error('Preview activation preflight syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node --check preview-activation-governance-check.js')) throw new Error('Preview activation governance syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node preview-activation-governance-check.js')) throw new Error('Preview activation governance regression check missing from normal validation');

console.log(JSON.stringify({
  ok: true,
  check: 'preview-activation-governance',
  application: pkg.name,
  version: pkg.version,
  orderedSourceChecks: orderedScripts.length,
  packageCommandRegistered: true,
  normalValidationRegistered: true,
  workspaceTopologyVerificationRequired: true,
  workspaceTopologyGovernanceRequired: true,
  migrationLedgerBootstrapGovernanceRequired: true,
  migrationLedgerBootstrapRunnerGovernanceRequired: true,
  migrationLedgerBootstrapEvidenceGovernanceRequired: true,
  migrationRunnerSecurityRequired: true,
  runtimeReleaseIdentityRequired: true,
  readinessRequired: true,
  deploymentGovernanceRequired: true,
  uatGovernanceRequired: true,
  releaseEvidenceSecurityRequired: true,
  releaseManifestGovernanceRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  databaseBackedVerificationExecuted: false,
  migrationsExecuted: false,
  previewRestartExecuted: false
}, null, 2));
