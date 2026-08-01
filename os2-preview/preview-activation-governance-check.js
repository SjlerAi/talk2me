'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const topology = fs.readFileSync(path.join(root, 'workspace-topology-verification.js'), 'utf8');
const topologyGovernance = fs.readFileSync(path.join(root, 'workspace-topology-governance-check.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const requiredPreflightMarkers = [
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20',
  'PREVIEW_APP_ROOT',
  'PREVIEW_APP_ROOT must match the executing application root',
  'ALLOW_PRODUCTION_MUTATION=true',
  'ENABLE_CUSTOMER_MERGE_EXECUTION=true',
  "'workspace-topology-verification.js'",
  "'runtime-release-identity-check.js'",
  "'readiness-check.js'",
  "'deployment-check.js'",
  "'uat-gate-check.js'",
  "'release-manifest-check.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal',
  'result.status !== 0',
  'workspaceTopologyVerified: true',
  'databaseBackedVerificationExecuted: false',
  'migrationsExecuted: false',
  'previewRestartExecuted: false',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
];
for (const marker of requiredPreflightMarkers) {
  if (!preflight.includes(marker)) throw new Error(`Preview activation preflight missing marker: ${marker}`);
}

const topologyMarkers = [
  'O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification',
  'fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)',
  'fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.nlink !== 1',
  'descriptorStat.size > maxBytes',
  'must not be group or world writable',
  'must not have additional hard links',
  'owner differs from the preview application root',
  'Migration 025 is missing from the protected workspace',
  'directoryNoFollowVerification: true',
  'directoryDescriptorIdentityVerified: true',
  'protectedFileNoFollowVerification: true',
  'protectedFileDescriptorIdentityVerified: true',
  'protectedFileSizeLimitsEnforced: true',
  'protectedFilesSymlinkFree: true',
  'protectedFilesHardLinkFree: true',
  'ownershipConsistent: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
];
for (const marker of topologyMarkers) {
  if (!topology.includes(marker)) throw new Error(`Workspace topology verification missing marker: ${marker}`);
}

for (const marker of [
  'workspace-topology-governance',
  'directoryNoFollowRequired: true',
  'fileNoFollowRequired: true',
  'descriptorIdentityRequired: true',
  'hardLinkRejectionRequired: true',
  'boundedProtectedFilesRequired: true',
  'packageCommandRegistered: true',
  'normalValidationRegistered: true',
  'migration025Required: true'
]) {
  if (!topologyGovernance.includes(marker)) throw new Error(`Workspace topology governance missing marker: ${marker}`);
}

const orderedScripts = [
  "'workspace-topology-verification.js'",
  "'runtime-release-identity-check.js'",
  "'readiness-check.js'",
  "'deployment-check.js'",
  "'uat-gate-check.js'",
  "'release-manifest-check.js'"
];
for (let index = 1; index < orderedScripts.length; index += 1) {
  if (preflight.indexOf(orderedScripts[index - 1]) >= preflight.indexOf(orderedScripts[index])) {
    throw new Error('Preview activation preflight order is invalid');
  }
}

const requiredRunbookMarkers = [
  'talk2me.kloka.co.za',
  'talk2me.uent.co.za',
  'kloka_talk2me',
  'agent/talk2me-os2-integrated-rebuild',
  'Node.js: 20.x',
  'PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview',
  'workspace-topology-verification.js',
  'directory descriptors with `O_DIRECTORY | O_NOFOLLOW`',
  'protected workspace files with `O_NOFOLLOW`',
  'device/inode identity',
  'additional hard links',
  'bounded file sizes',
  'npm run verify:preview-activation-preflight',
  'npm ci',
  'npm run check',
  'ALLOW_PREVIEW_MIGRATIONS=true',
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'Restart only the preview Node.js application',
  'Migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.'
];
for (const marker of requiredRunbookMarkers) {
  if (!runbook.includes(marker)) throw new Error(`Preview activation runbook missing marker: ${marker}`);
}

if (pkg.scripts['verify:preview-activation-preflight'] !== 'node preview-activation-preflight.js') throw new Error('Missing verify:preview-activation-preflight command');
if (pkg.scripts['check:preview-activation-governance'] !== 'node preview-activation-governance-check.js') throw new Error('Missing check:preview-activation-governance command');
if (!pkg.scripts.check.includes('node --check preview-activation-preflight.js')) throw new Error('Preview activation preflight syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node --check preview-activation-governance-check.js')) throw new Error('Preview activation governance syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node preview-activation-governance-check.js')) throw new Error('Preview activation governance execution missing from normal validation');

console.log(JSON.stringify({
  ok: true,
  check: 'preview-activation-governance',
  application: pkg.name,
  version: pkg.version,
  orderedSourceChecks: orderedScripts.length,
  workspaceTopologyVerificationRequired: true,
  workspaceTopologyGovernanceRequired: true,
  directoryNoFollowVerificationRequired: true,
  protectedFileNoFollowVerificationRequired: true,
  protectedFileDescriptorIdentityRequired: true,
  protectedFileHardLinkRejectionRequired: true,
  protectedFileSizeLimitsRequired: true,
  ownershipConsistencyRequired: true,
  packageCommandRegistered: true,
  normalValidationRegistered: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  databaseBackedVerificationExecuted: false,
  migrationsExecuted: false,
  previewRestartExecuted: false
}, null, 2));
