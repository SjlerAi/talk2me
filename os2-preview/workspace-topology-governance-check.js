'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const verifier = fs.readFileSync(path.join(root, 'workspace-topology-verification.js'), 'utf8');
const bootstrapGovernance = fs.readFileSync(path.join(root, 'migration-ledger-bootstrap-governance-check.js'), 'utf8');
const activation = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} missing ${marker}`);
}

requireMarkers(verifier, [
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'PREVIEW_APP_ROOT is required',
  'O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification',
  'fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)',
  'fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.nlink !== 1',
  'descriptorStat.size > maxBytes',
  'package-lock.json',
  'MIGRATION_LEDGER_BOOTSTRAP.sql',
  'migrationLedgerBootstrapPresent',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'protectedFileNoFollowVerification: true',
  'protectedFileDescriptorIdentityVerified: true',
  'protectedFileSizeLimitsEnforced: true',
  'protectedFilesHardLinkFree: true',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
], 'Workspace verifier');

requireMarkers(bootstrapGovernance, [
  "check: 'migration-ledger-bootstrap-governance'",
  "bootstrapFile: 'MIGRATION_LEDGER_BOOTSTRAP.sql'",
  'createsExactlyOneTable: true',
  'runtimeLedgerCreationDisabled: true',
  'workspaceProtectionRequired: true',
  'previewDatabaseOnly: true'
], 'Bootstrap governance');

requireMarkers(activation, [
  "'workspace-topology-verification.js'",
  'PREVIEW_APP_ROOT: root',
  "ALLOW_PRODUCTION_MUTATION: 'false'",
  "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'"
], 'Activation preflight');

requireMarkers(runbook, [
  'workspace-topology-verification.js',
  'protected workspace files with `O_NOFOLLOW`',
  'device/inode identity',
  'additional hard links',
  'bounded file sizes'
], 'Activation runbook');

if (pkg.scripts['check:workspace-topology-governance'] !== 'node workspace-topology-governance-check.js') throw new Error('Missing check:workspace-topology-governance command');
if (!pkg.scripts.check.includes('node --check workspace-topology-governance-check.js')) throw new Error('Workspace topology governance syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node workspace-topology-governance-check.js')) throw new Error('Workspace topology governance execution missing from normal validation');

console.log(JSON.stringify({
  ok: true,
  check: 'workspace-topology-governance',
  directoryNoFollowRequired: true,
  fileNoFollowRequired: true,
  descriptorIdentityRequired: true,
  hardLinkRejectionRequired: true,
  boundedProtectedFilesRequired: true,
  migrationLedgerBootstrapProtected: true,
  migrationLedgerBootstrapGovernanceRequired: true,
  migration025Required: true,
  packageCommandRegistered: true,
  normalValidationRegistered: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
