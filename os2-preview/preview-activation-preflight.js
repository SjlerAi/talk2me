'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;
const database = String(process.env.DB_NAME || '').trim();
const branch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
const configuredRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    check: 'preview-activation-preflight',
    error: message,
    productionMutationEnabled: false,
    mergeExecutionEnabled: false
  }, null, 2));
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
  'release-source-integrity-check.js',
  'workspace-topology-governance-check.js',
  'migration-ledger-bootstrap-governance-check.js',
  'migration-ledger-bootstrap-runner-check.js',
  'migration-ledger-bootstrap-evidence-check.js',
  'migration-runner-security-check.js',
  'runtime-release-identity-check.js',
  'readiness-check.js',
  'deployment-check.js',
  'uat-gate-check.js',
  'release-evidence-security-check.js',
  'release-manifest-check.js'
];

const completed = [];
for (const script of checks) {
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: {
      ...process.env,
      PREVIEW_APP_ROOT: root,
      DB_NAME: expectedDatabase,
      RELEASE_BRANCH: expectedBranch,
      ALLOW_PRODUCTION_MUTATION: 'false',
      ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'
    },
    stdio: 'inherit'
  });
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
  workspaceTopologyVerified: true,
  workspaceSourceIntegrityVerified: true,
  workspaceSourceIntegrityGovernanceVerified: true,
  releaseSourceIntegrityGovernanceVerified: true,
  bootstrapGovernanceVerified: true,
  bootstrapRunnerGovernanceVerified: true,
  bootstrapEvidenceGovernanceVerified: true,
  migrationRunnerSecurityVerified: true,
  releaseEvidenceSecurityVerified: true,
  databaseBackedVerificationExecuted: false,
  migrationsExecuted: false,
  previewRestartExecuted: false,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
