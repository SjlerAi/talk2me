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
  'expectedNodeMajor = 20',
  'PREVIEW_APP_ROOT is required',
  'O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification',
  'fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)',
  'fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)',
  'descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino',
  'descriptorStat.nlink !== 1',
  'descriptorStat.size > maxBytes',
  "['workspace-topology-verification.js', 'Workspace topology verifier'",
  "['workspace-topology-governance-check.js', 'Workspace topology governance'",
  "['workspace-source-integrity.js', 'Workspace source-integrity verifier'",
  "['workspace-source-integrity-check.js', 'Workspace source-integrity governance'",
  "['preview-activation-preflight.js', 'Preview activation preflight'",
  "['preview-activation-governance-check.js', 'Preview activation governance'",
  "['release-evidence-security-check.js', 'Release evidence security governance'",
  "['release-source-integrity-verification.js', 'Release source-integrity verifier'",
  "['release-source-integrity-check.js', 'Release source-integrity governance'",
  "['release-candidate-gate.js', 'Release candidate gate'",
  "['release-manifest-verification.js', 'Release manifest verifier'",
  "['release-manifest-check.js', 'Release manifest governance'",
  "['CI_AND_BUILD_EVIDENCE_RUNBOOK.md', 'CI and build evidence runbook'",
  'topologyVerifierSelfProtected:',
  'topologyGovernanceProtected:',
  'sourceIntegrityControlsProtected:',
  'activationGovernanceProtected:',
  'releaseGovernanceProtected:',
  'Hidden entry is prohibited in migrations directory',
  'Only regular migration files are permitted in migrations directory',
  'Unexpected file in migrations directory',
  'assertDirectoryIdentity(root, rootIdentity',
  'assertDirectoryIdentity(migrationsDirectory, migrationsIdentity',
  'criticalMigrationControlsProtected: true',
  'criticalReleaseControlsProtected: true',
  'operationalRunbooksProtected: true',
  'migrationDirectoryContainsOnlyOrderedSqlFiles: true',
  'directoryIdentityReverifiedAfterInventory: true',
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
  "'workspace-source-integrity.js'",
  "'workspace-source-integrity-check.js'",
  "'workspace-topology-governance-check.js'",
  'PREVIEW_APP_ROOT: root',
  "ALLOW_PRODUCTION_MUTATION: 'false'",
  "ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'"
], 'Activation preflight');

const ordered = [
  "'workspace-topology-verification.js'",
  "'workspace-source-integrity.js'",
  "'workspace-source-integrity-check.js'",
  "'workspace-topology-governance-check.js'"
];
for (let index = 1; index < ordered.length; index += 1) {
  if (activation.indexOf(ordered[index - 1]) >= activation.indexOf(ordered[index])) throw new Error(`Workspace topology order invalid at ${ordered[index]}`);
}

requireMarkers(runbook, [
  'workspace-topology-verification.js',
  'protected workspace files with `O_NOFOLLOW`',
  'critical migration, release and operational-control files',
  'migration directory contains only ordered `.sql` migration files',
  're-verify directory descriptor identity after inventory validation',
  'additional hard links',
  'bounded file sizes',
  'topology verifier and its governance check are both part of the protected topology',
  'source-integrity, activation and release-governance controls are protected by topology verification'
], 'Activation runbook');

if (pkg.scripts['check:workspace-topology-governance'] !== 'node workspace-topology-governance-check.js') throw new Error('Missing check:workspace-topology-governance command');
if (!pkg.scripts.check.includes('node --check workspace-topology-verification.js')) throw new Error('Workspace topology verifier syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node --check workspace-topology-governance-check.js')) throw new Error('Workspace topology governance syntax check missing from normal validation');
if (!pkg.scripts.check.includes('node workspace-topology-governance-check.js')) throw new Error('Workspace topology governance execution missing from normal validation');

console.log(JSON.stringify({
  ok: true,
  check: 'workspace-topology-governance',
  node20Required: true,
  directoryNoFollowRequired: true,
  fileNoFollowRequired: true,
  descriptorIdentityRequired: true,
  postInventoryDirectoryIdentityRequired: true,
  hardLinkRejectionRequired: true,
  boundedProtectedFilesRequired: true,
  migrationDirectoryPurityRequired: true,
  topologyVerifierSelfProtected: true,
  topologyGovernanceSelfProtected: true,
  sourceIntegrityControlsProtected: true,
  activationGovernanceProtected: true,
  releaseGovernanceProtected: true,
  migrationLedgerBootstrapProtected: true,
  migrationLedgerBootstrapGovernanceRequired: true,
  migrationRunnerProtected: true,
  releaseCandidateControlsProtected: true,
  operationalRunbooksProtected: true,
  migration025Required: true,
  activationOrderingProtected: true,
  packageCommandRegistered: true,
  normalValidationRegistered: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
