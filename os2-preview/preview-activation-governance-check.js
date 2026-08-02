'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const topology = fs.readFileSync(path.join(root, 'workspace-topology-verification.js'), 'utf8');
const topologyGovernance = fs.readFileSync(path.join(root, 'workspace-topology-governance-check.js'), 'utf8');
const sourceIntegrity = fs.readFileSync(path.join(root, 'workspace-source-integrity.js'), 'utf8');
const sourceIntegrityGovernance = fs.readFileSync(path.join(root, 'workspace-source-integrity-check.js'), 'utf8');
const releaseSourceGovernance = fs.readFileSync(path.join(root, 'release-source-integrity-check.js'), 'utf8');
const recoveryReadiness = fs.readFileSync(path.join(root, 'recovery-readiness-check.js'), 'utf8');
const recoveryRelease = fs.readFileSync(path.join(root, 'recovery-release-gate.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} missing marker: ${marker}`);
}

requireMarkers(preflight, [
  "expectedDatabase = 'kloka_talk2me'", "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'", 'expectedNodeMajor = 20',
  'childTimeoutMs = 30000', 'PREVIEW_APP_ROOT must match the executing application root',
  "const inheritedKeys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ', 'CI', 'GITHUB_ACTIONS']",
  "const prohibitedKeys = ['NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV', 'CDPATH', 'GIT_DIR', 'GIT_WORK_TREE', 'NPM_CONFIG_PREFIX', 'NPM_CONFIG_USERCONFIG']",
  'buildChildEnvironment()', 'Object.freeze(childEnv)', 'childEnvironmentKeys.length > inheritedKeys.length + 6',
  "childEnv.ALLOW_PRODUCTION_MUTATION = 'false'", "childEnv.ENABLE_CUSTOMER_MERGE_EXECUTION = 'false'", "childEnv.NODE_ENV = 'production'",
  'env: childEnvironment', "stdio: 'inherit'", 'timeout: childTimeoutMs', "killSignal: 'SIGKILL'", 'shell: false', 'windowsHide: true',
  "result.error.code === 'ETIMEDOUT'", 'result.signal', 'result.status !== 0',
  'childEnvironmentSanitized: true', 'childEnvironmentFrozen: Object.isFrozen(childEnvironment)', 'childEnvironmentAllowlistApplied: true',
  'nodeOptionsInherited: false', 'nodePathInherited: false', 'bashEnvInherited: false', 'envStartupHookInherited: false',
  'gitDirectoryOverrideInherited: false', 'gitWorkTreeOverrideInherited: false', 'npmPrefixOverrideInherited: false', 'npmUserConfigOverrideInherited: false',
  'productionNodeEnvironmentForced: true', 'previewRootForced: true', 'previewDatabaseForced: true', 'releaseBranchForced: true',
  'productionMutationDisabledInChildren: true', 'mergeExecutionDisabledInChildren: true',
  'restoreTestGovernanceVerified: true', 'restoreTestIntegrationVerified: true', 'recoveryReadinessVerified: true',
  'recoveryReleaseGateVerified: true', 'backupRuntimeExecuted: false', 'backupVerificationExecuted: false',
  'restoreTestExecuted: false', 'databaseBackedVerificationExecuted: false', 'migrationsExecuted: false',
  'previewRestartExecuted: false', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Preview activation preflight');

if (preflight.includes('...process.env')) throw new Error('Preview activation must not inherit the complete parent environment');
for (const prohibited of ['NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'GIT_DIR', 'GIT_WORK_TREE', 'NPM_CONFIG_USERCONFIG']) {
  if (!preflight.includes(`'${prohibited}'`)) throw new Error(`Preview activation prohibited environment list missing ${prohibited}`);
}

const orderedScripts = [
  "'workspace-topology-verification.js'", "'workspace-source-integrity.js'", "'workspace-source-integrity-check.js'",
  "'workspace-topology-governance-check.js'", "'migration-ledger-bootstrap-governance-check.js'",
  "'migration-ledger-bootstrap-runner-check.js'", "'migration-ledger-bootstrap-evidence-check.js'",
  "'migration-runner-security-check.js'", "'restore-test-governance-check.js'", "'restore-test-integration-check.js'",
  "'recovery-readiness-check.js'", "'recovery-release-gate.js'", "'runtime-release-identity-check.js'",
  "'readiness-check.js'", "'deployment-check.js'", "'uat-gate-check.js'", "'release-evidence-security-check.js'",
  "'release-source-integrity-check.js'", "'release-manifest-check.js'"
];
for (const script of orderedScripts) if (!preflight.includes(script)) throw new Error(`Preview activation preflight missing ordered script ${script}`);
for (let index = 1; index < orderedScripts.length; index += 1) if (preflight.indexOf(orderedScripts[index - 1]) >= preflight.indexOf(orderedScripts[index])) throw new Error(`Preview activation preflight order is invalid at ${orderedScripts[index]}`);

requireMarkers(topology, [
  'O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification',
  'fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)',
  'fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)', 'protectedFilesHardLinkFree: true',
  'ownershipConsistent: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'
], 'Workspace topology verification');
requireMarkers(topologyGovernance, ["check: 'workspace-topology-governance'", 'packageCommandRegistered: true', 'normalValidationRegistered: true', 'migrationLedgerBootstrapProtected: true', 'migration025Required: true'], 'Workspace topology governance');
requireMarkers(sourceIntegrity, ["check: 'workspace-source-integrity'", 'inventorySha256', 'recoveryReadinessProtected: files.some', 'recoveryReleaseGateProtected: files.some', 'secureDescriptorReads: true', 'canonicalPathBinding: true', 'hardLinkRejection: true', 'ownershipConsistency: true', 'boundedReads: true'], 'Workspace source integrity');
requireMarkers(sourceIntegrityGovernance, ["check: 'workspace-source-integrity-governance'", 'deterministicInventoryRequired: true', 'recoveryReadinessProtectionRequired: true', 'recoveryReleaseGateProtectionRequired: true', 'recoveryReleaseGatePreflightRegistrationRequired: true', 'packageCommandRegistered: true', 'normalSyntaxValidationRegistered: true', 'normalGovernanceValidationRegistered: true', 'environmentBoundVerifierExcludedFromNormalExecution: true'], 'Workspace source integrity governance');
requireMarkers(releaseSourceGovernance, ["check: 'release-source-integrity-governance'", 'boundedExecutionRequired: true', 'forcedKillSignalRequired: true', 'shellExecutionDisabled: true', 'protectedFileCountConsistencyRequired: true', 'verificationBeforeReleasePublicationRequired: true', 'postFreezeVerificationBeforeIndividualFilesRequired: true'], 'Release source integrity governance');
requireMarkers(recoveryReadiness, ["check: 'recovery-readiness'", 'meaningfulControls: 60', 'backupGenerationGoverned: true', 'backupVerificationGoverned: true', 'isolatedRestoreGoverned: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'], 'Recovery readiness governance');
requireMarkers(recoveryRelease, ["check: 'recovery-release-gate'", 'meaningfulControls: 60', 'exactPackageCommandsRequired: true', 'normalSyntaxValidationRequired: true', 'normalGovernanceExecutionRequired: true', 'environmentChangingRecoveryCommandsExcludedFromNormalValidation: true', 'productionMutationEnabled: false', 'mergeExecutionEnabled: false'], 'Recovery release governance');

requireMarkers(runbook, [
  'talk2me.kloka.co.za', 'talk2me.uent.co.za', 'kloka_talk2me', 'agent/talk2me-os2-integrated-rebuild',
  'sanitized allowlisted child environment', '`NODE_OPTIONS`', '`NODE_PATH`', '`BASH_ENV`', '`GIT_DIR`', '`GIT_WORK_TREE`', '`NPM_CONFIG_USERCONFIG`',
  '`NODE_ENV=production`', 'production mutation and merge execution are forced off',
  '30-second execution limit', 'forced `SIGKILL` termination', 'shell execution disabled',
  'npm run verify:preview-activation-preflight', 'npm ci', 'npm run check', 'Restart only the preview Node.js application'
], 'Preview activation runbook');

const exactScripts = {
  'verify:preview-activation-preflight': 'node preview-activation-preflight.js',
  'check:preview-activation-governance': 'node preview-activation-governance-check.js',
  'restore:test': 'node restore-test-runner.js',
  'check:restore-test-governance': 'node restore-test-governance-check.js',
  'check:restore-test-integration': 'node restore-test-integration-check.js',
  'check:recovery-readiness': 'node recovery-readiness-check.js',
  'check:recovery-release': 'node recovery-release-gate.js'
};
for (const [name, command] of Object.entries(exactScripts)) if (pkg.scripts[name] !== command) throw new Error(`Missing exact ${name} command`);
for (const marker of [
  'node --check preview-activation-preflight.js', 'node --check preview-activation-governance-check.js',
  'node --check restore-test-runner.js', 'node --check restore-test-governance-check.js',
  'node --check restore-test-integration-check.js', 'node --check recovery-readiness-check.js',
  'node --check recovery-release-gate.js', 'node restore-test-governance-check.js',
  'node restore-test-integration-check.js', 'node recovery-readiness-check.js',
  'node recovery-release-gate.js', 'node preview-activation-governance-check.js'
]) if (!pkg.scripts.check.includes(marker)) throw new Error(`Normal validation missing ${marker}`);
if (pkg.scripts.check.includes('&& node restore-test-runner.js &&')) throw new Error('Environment-bound restore runner must not execute in normal validation');
if (pkg.scripts.check.includes('&& node backup-runner.js &&')) throw new Error('Environment-bound backup runner must not execute in normal validation');
if (pkg.scripts.check.includes('&& node backup-verification.js &&')) throw new Error('Environment-bound backup verification must not execute in normal validation');

console.log(JSON.stringify({
  ok: true,
  check: 'preview-activation-governance',
  application: pkg.name,
  version: pkg.version,
  orderedSourceChecks: orderedScripts.length,
  activationChildExecutionBounded: true,
  activationChildTimeoutMs: 30000,
  activationChildForcedKillSignalRequired: true,
  activationChildShellExecutionDisabled: true,
  activationChildWindowHidden: true,
  completeParentEnvironmentInheritanceProhibited: true,
  childEnvironmentAllowlistRequired: true,
  childEnvironmentFrozenRequired: true,
  childEnvironmentKeyCountBounded: true,
  nodeOptionsInheritanceProhibited: true,
  nodePathInheritanceProhibited: true,
  bashEnvInheritanceProhibited: true,
  envStartupHookInheritanceProhibited: true,
  cdPathInheritanceProhibited: true,
  gitDirectoryOverrideInheritanceProhibited: true,
  gitWorkTreeOverrideInheritanceProhibited: true,
  npmPrefixOverrideInheritanceProhibited: true,
  npmUserConfigOverrideInheritanceProhibited: true,
  productionNodeEnvironmentRequired: true,
  previewRootForced: true,
  previewDatabaseForced: true,
  releaseBranchForced: true,
  productionMutationDisabledInChildren: true,
  mergeExecutionDisabledInChildren: true,
  workspaceTopologyVerificationRequired: true,
  workspaceSourceIntegrityRequired: true,
  restoreTestGovernanceRequired: true,
  restoreTestIntegrationRequired: true,
  recoveryReadinessRequired: true,
  recoveryReleaseGateRequired: true,
  recoveryPackageCommandsRequired: true,
  recoverySyntaxValidationRequired: true,
  recoveryGovernanceExecutionRequired: true,
  environmentChangingRecoveryExecutionExcluded: true,
  releaseSourceIntegrityGovernanceRequired: true,
  releaseManifestGovernanceRequired: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  databaseBackedVerificationExecuted: false,
  backupRuntimeExecuted: false,
  backupVerificationExecuted: false,
  restoreTestExecuted: false,
  migrationsExecuted: false,
  previewRestartExecuted: false
}, null, 2));
