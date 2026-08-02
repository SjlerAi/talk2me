'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;
const childTimeoutMs = 30000;
const database = String(process.env.DB_NAME || '').trim();
const branch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
const configuredRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'preview-activation-preflight', error: message, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  process.exit(1);
}

if (database !== expectedDatabase) fail(`Preview activation requires DB_NAME=${expectedDatabase}; found ${database || 'missing'}`);
if (branch !== expectedBranch) fail(`Preview activation requires RELEASE_BRANCH or GITHUB_REF_NAME=${expectedBranch}; found ${branch || 'missing'}`);
if (!configuredRoot) fail('Preview activation requires PREVIEW_APP_ROOT');
if (!path.isAbsolute(configuredRoot)) fail('PREVIEW_APP_ROOT must be absolute');
if (path.normalize(configuredRoot) !== configuredRoot) fail('PREVIEW_APP_ROOT must be normalized');
if (configuredRoot !== root) fail(`PREVIEW_APP_ROOT must match the executing application root: ${root}`);
if (!Number.isInteger(nodeMajor) || nodeMajor !== expectedNodeMajor) fail(`Preview activation requires Node.js ${expectedNodeMajor}.x; found ${process.versions.node}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('Preview activation refuses ALLOW_PRODUCTION_MUTATION=true');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('Preview activation refuses ENABLE_CUSTOMER_MERGE_EXECUTION=true');

const checks = [
  'workspace-topology-verification.js',
  'workspace-source-integrity.js',
  'workspace-source-integrity-check.js',
  'workspace-topology-governance-check.js',
  'migration-ledger-bootstrap-governance-check.js',
  'migration-ledger-bootstrap-runner-check.js',
  'migration-ledger-bootstrap-evidence-check.js',
  'migration-runner-security-check.js',
  'restore-test-governance-check.js',
  'restore-test-integration-check.js',
  'recovery-readiness-check.js',
  'recovery-release-gate.js',
  'runtime-release-identity-check.js',
  'readiness-check.js',
  'deployment-check.js',
  'uat-gate-check.js',
  'release-evidence-security-check.js',
  'release-source-integrity-check.js',
  'release-manifest-check.js'
];

const inheritedKeys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ', 'CI', 'GITHUB_ACTIONS'];
const prohibitedKeys = ['NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV', 'CDPATH', 'GIT_DIR', 'GIT_WORK_TREE', 'NPM_CONFIG_PREFIX', 'NPM_CONFIG_USERCONFIG'];
function buildChildEnvironment() {
  const childEnv = {};
  for (const key of inheritedKeys) if (typeof process.env[key] === 'string' && process.env[key].length > 0) childEnv[key] = process.env[key];
  for (const key of prohibitedKeys) if (Object.prototype.hasOwnProperty.call(childEnv, key)) fail(`Prohibited child environment variable retained: ${key}`);
  childEnv.PREVIEW_APP_ROOT = root;
  childEnv.DB_NAME = expectedDatabase;
  childEnv.RELEASE_BRANCH = expectedBranch;
  childEnv.ALLOW_PRODUCTION_MUTATION = 'false';
  childEnv.ENABLE_CUSTOMER_MERGE_EXECUTION = 'false';
  childEnv.NODE_ENV = 'production';
  return Object.freeze(childEnv);
}

const childEnvironment = buildChildEnvironment();
const childEnvironmentKeys = Object.keys(childEnvironment).sort();
if (childEnvironmentKeys.length > inheritedKeys.length + 6) fail('Preview activation child environment exceeds the approved key limit');
if (childEnvironment.ALLOW_PRODUCTION_MUTATION !== 'false') fail('Child environment must force production mutation disabled');
if (childEnvironment.ENABLE_CUSTOMER_MERGE_EXECUTION !== 'false') fail('Child environment must force customer merge execution disabled');
if (childEnvironment.NODE_ENV !== 'production') fail('Child environment must force NODE_ENV=production');
if (childEnvironment.PREVIEW_APP_ROOT !== root) fail('Child environment application root mismatch');
if (childEnvironment.DB_NAME !== expectedDatabase) fail('Child environment database mismatch');
if (childEnvironment.RELEASE_BRANCH !== expectedBranch) fail('Child environment branch mismatch');

const completed = [];
for (const script of checks) {
  const result = spawnSync(process.execPath, [path.join(root, script)], { cwd: root, env: childEnvironment, stdio: 'inherit', timeout: childTimeoutMs, killSignal: 'SIGKILL', shell: false, windowsHide: true });
  if (result.error && result.error.code === 'ETIMEDOUT') fail(`${script} exceeded ${childTimeoutMs}ms`);
  if (result.error) fail(`${script} could not start: ${result.error.message}`);
  if (result.signal) fail(`${script} was interrupted by signal ${result.signal}`);
  if (result.status !== 0) fail(`${script} failed with status ${result.status}`);
  completed.push(script);
}

console.log(JSON.stringify({
  ok: true,
  check: 'preview-activation-preflight',
  application: 'talk2me-os2-preview',
  version: require('./package.json').version,
  applicationRoot: root,
  database: expectedDatabase,
  branch: expectedBranch,
  nodeVersion: process.versions.node,
  completed,
  orderedGovernanceChecksCompleted: completed.length,
  childProcessTimeoutMs: childTimeoutMs,
  childProcessKillSignal: 'SIGKILL',
  childProcessShellDisabled: true,
  childProcessWindowHidden: true,
  childEnvironmentSanitized: true,
  childEnvironmentFrozen: Object.isFrozen(childEnvironment),
  childEnvironmentAllowlistApplied: true,
  childEnvironmentKeyCount: childEnvironmentKeys.length,
  inheritedEnvironmentKeys: inheritedKeys,
  prohibitedEnvironmentKeys: prohibitedKeys,
  nodeOptionsInherited: false,
  nodePathInherited: false,
  bashEnvInherited: false,
  envStartupHookInherited: false,
  gitDirectoryOverrideInherited: false,
  gitWorkTreeOverrideInherited: false,
  npmPrefixOverrideInherited: false,
  npmUserConfigOverrideInherited: false,
  productionNodeEnvironmentForced: true,
  previewRootForced: true,
  previewDatabaseForced: true,
  releaseBranchForced: true,
  productionMutationDisabledInChildren: true,
  mergeExecutionDisabledInChildren: true,
  workspaceTopologyVerified: true,
  workspaceSourceIntegrityVerified: true,
  workspaceSourceIntegrityGovernanceVerified: true,
  workspaceTopologyGovernanceVerified: true,
  releaseSourceIntegrityGovernanceVerified: true,
  bootstrapGovernanceVerified: true,
  bootstrapRunnerGovernanceVerified: true,
  bootstrapEvidenceGovernanceVerified: true,
  migrationRunnerSecurityVerified: true,
  restoreTestGovernanceVerified: true,
  restoreTestIntegrationVerified: true,
  recoveryReadinessVerified: true,
  recoveryReleaseGateVerified: true,
  releaseEvidenceSecurityVerified: true,
  releaseManifestGovernanceVerified: true,
  databaseBackedVerificationExecuted: false,
  backupRuntimeExecuted: false,
  backupVerificationExecuted: false,
  restoreTestExecuted: false,
  migrationsExecuted: false,
  previewRestartExecuted: false,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
