'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const repositoryRoot = path.resolve(root, '..');
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'workspace-source-integrity', error: message, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  process.exit(1);
}
function secureHash(relativePath, maxBytes, expectedOwner) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.includes('\u0000')) fail(`Protected source path is invalid: ${relativePath}`);
  const file = path.resolve(root, relativePath);
  if (file !== repositoryRoot && !file.startsWith(`${repositoryRoot}${path.sep}`)) fail(`Protected source escapes the repository root: ${relativePath}`);
  let pathStat;
  try { pathStat = fs.lstatSync(file); } catch { fail(`Protected source is missing: ${relativePath}`); }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) fail(`Protected source must be a regular non-symlink file: ${relativePath}`);
  if (pathStat.nlink !== 1) fail(`Protected source must not have additional hard links: ${relativePath}`);
  if (pathStat.size > maxBytes) fail(`Protected source exceeds the permitted size: ${relativePath}`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) fail(`Protected source is writable by group or world: ${relativePath}`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) fail(`Protected source owner mismatch: ${relativePath}`);
  if (fs.realpathSync.native(file) !== file) fail(`Protected source path is not canonical: ${relativePath}`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW is required for workspace source integrity');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) fail(`Protected source descriptor is not a regular file: ${relativePath}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) fail(`Protected source changed during secure open: ${relativePath}`);
    if (descriptorStat.nlink !== 1) fail(`Protected source descriptor has additional hard links: ${relativePath}`);
    if (descriptorStat.size !== pathStat.size || descriptorStat.mtimeMs !== pathStat.mtimeMs) fail(`Protected source metadata changed during secure open: ${relativePath}`);
    if (descriptorStat.size > maxBytes) fail(`Protected source descriptor exceeds the permitted size: ${relativePath}`);
    if (process.platform !== 'win32' && (descriptorStat.mode & 0o022) !== 0) fail(`Protected source descriptor is writable by group or world: ${relativePath}`);
    if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) fail(`Protected source descriptor owner mismatch: ${relativePath}`);
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== descriptorStat.size) fail(`Protected source byte count changed during read: ${relativePath}`);
    return { file: relativePath, bytes: descriptorStat.size, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } finally { fs.closeSync(descriptor); }
}

const configuredRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
if (configuredRoot !== root) fail(`PREVIEW_APP_ROOT must match ${root}`);
if (String(process.env.DB_NAME || '').trim() !== expectedDatabase) fail(`DB_NAME must be ${expectedDatabase}`);
const branch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
if (branch !== expectedBranch) fail(`Release branch must be ${expectedBranch}`);
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor !== expectedNodeMajor) fail(`Node.js ${expectedNodeMajor}.x is required`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('ALLOW_PRODUCTION_MUTATION=true is prohibited');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('ENABLE_CUSTOMER_MERGE_EXECUTION=true is prohibited');

const rootStat = fs.lstatSync(root);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('Workspace root must be a real directory');
const repositoryStat = fs.lstatSync(repositoryRoot);
if (!repositoryStat.isDirectory() || repositoryStat.isSymbolicLink()) fail('Repository root must be a real directory');
if (repositoryStat.uid !== rootStat.uid) fail('Repository and application roots must share an owner');
const owner = rootStat.uid;
const protectedFiles = [
  ['../.github/workflows/os2-preview-ci.yml', 1024 * 1024],
  ['../.github/workflows/os2-dependency-lock-generation.yml', 1024 * 1024],
  ['server.js', 4 * 1024 * 1024],
  ['package.json', 1024 * 1024], ['package-lock.json', 16 * 1024 * 1024],
  ['dependency-lock-verification.js', 2 * 1024 * 1024], ['dependency-lock-governance-check.js', 2 * 1024 * 1024],
  ['dependency-lock-generator.js', 2 * 1024 * 1024], ['dependency-lock-generator-check.js', 2 * 1024 * 1024],
  ['dependency-lock-workflow-check.js', 2 * 1024 * 1024],
  ['dependency-lock-artifact-verification.js', 2 * 1024 * 1024], ['dependency-lock-artifact-check.js', 2 * 1024 * 1024],
  ['DEPENDENCY_LOCK_GENERATION_RUNBOOK.md', 2 * 1024 * 1024],
  ['DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md', 2 * 1024 * 1024],
  ['DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md', 2 * 1024 * 1024],
  ['MIGRATION_LEDGER_BOOTSTRAP.sql', 256 * 1024], ['migration-ledger-bootstrap-runner.js', 2 * 1024 * 1024],
  ['migration-ledger-bootstrap-evidence-verification.js', 2 * 1024 * 1024], ['migration-runner.js', 2 * 1024 * 1024],
  ['backup-runner.js', 2 * 1024 * 1024], ['backup-verification.js', 2 * 1024 * 1024],
  ['restore-test-runner.js', 2 * 1024 * 1024], ['restore-test-governance-check.js', 2 * 1024 * 1024],
  ['restore-test-integration-check.js', 2 * 1024 * 1024], ['recovery-readiness-check.js', 2 * 1024 * 1024],
  ['recovery-release-gate.js', 2 * 1024 * 1024],
  ['workspace-topology-verification.js', 2 * 1024 * 1024], ['workspace-topology-governance-check.js', 2 * 1024 * 1024],
  ['workspace-source-integrity.js', 2 * 1024 * 1024], ['workspace-source-integrity-check.js', 2 * 1024 * 1024],
  ['preview-activation-preflight.js', 2 * 1024 * 1024], ['preview-activation-governance-check.js', 2 * 1024 * 1024],
  ['readiness-check.js', 2 * 1024 * 1024], ['deployment-check.js', 2 * 1024 * 1024], ['uat-gate-check.js', 2 * 1024 * 1024],
  ['build-evidence.js', 2 * 1024 * 1024], ['ci-governance-check.js', 2 * 1024 * 1024], ['release-evidence-security-check.js', 2 * 1024 * 1024],
  ['release-source-integrity-verification.js', 2 * 1024 * 1024], ['release-source-integrity-check.js', 2 * 1024 * 1024],
  ['release-candidate-gate.js', 4 * 1024 * 1024], ['release-manifest-verification.js', 4 * 1024 * 1024], ['release-manifest-check.js', 2 * 1024 * 1024],
  ['BACKUP_AND_RECOVERY_RUNBOOK.md', 2 * 1024 * 1024], ['PREVIEW_ACTIVATION_RUNBOOK.md', 2 * 1024 * 1024],
  ['PREVIEW_DEPLOYMENT_RUNBOOK.md', 2 * 1024 * 1024], ['PREVIEW_UAT_RUNBOOK.md', 2 * 1024 * 1024],
  ['RELEASE_CANDIDATE_RUNBOOK.md', 2 * 1024 * 1024], ['CI_AND_BUILD_EVIDENCE_RUNBOOK.md', 2 * 1024 * 1024]
];
const migrationDirectory = path.join(root, 'migrations');
const entries = fs.readdirSync(migrationDirectory, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !/^\d+_.+\.sql$/.test(entry.name)) fail(`Unexpected migrations directory entry: ${entry.name}`);
  protectedFiles.push([path.join('migrations', entry.name), 4 * 1024 * 1024]);
}
protectedFiles.sort((a, b) => a[0].localeCompare(b[0]));
const names = protectedFiles.map(item => item[0]);
if (new Set(names).size !== names.length) fail('Protected source inventory contains duplicate paths');
const files = protectedFiles.map(([file, maxBytes]) => secureHash(file, maxBytes, owner));
const canonicalInventory = files.map(item => `${item.file}\0${item.bytes}\0${item.sha256}`).join('\n');
const inventorySha256 = crypto.createHash('sha256').update(canonicalInventory).digest('hex');

console.log(JSON.stringify({
  ok: true, check: 'workspace-source-integrity', application: 'talk2me-os2-preview', version: require('./package.json').version,
  applicationRoot: root, repositoryRoot, database: expectedDatabase, branch: expectedBranch, nodeVersion: process.versions.node,
  protectedFileCount: files.length, migrationCount: files.filter(item => item.file.startsWith('migrations/')).length,
  packageLockPresent: true, inventorySha256, files,
  selfProtected: files.some(item => item.file === 'workspace-source-integrity.js'),
  governanceProtected: files.some(item => item.file === 'workspace-source-integrity-check.js'),
  dependencyLockVerifierProtected: files.some(item => item.file === 'dependency-lock-verification.js'),
  dependencyLockGovernanceProtected: files.some(item => item.file === 'dependency-lock-governance-check.js'),
  dependencyLockGeneratorProtected: files.some(item => item.file === 'dependency-lock-generator.js'),
  dependencyLockGeneratorGovernanceProtected: files.some(item => item.file === 'dependency-lock-generator-check.js'),
  dependencyLockWorkflowGovernanceProtected: files.some(item => item.file === 'dependency-lock-workflow-check.js'),
  dependencyLockArtifactVerifierProtected: files.some(item => item.file === 'dependency-lock-artifact-verification.js'),
  dependencyLockArtifactGovernanceProtected: files.some(item => item.file === 'dependency-lock-artifact-check.js'),
  dependencyLockGenerationRunbookProtected: files.some(item => item.file === 'DEPENDENCY_LOCK_GENERATION_RUNBOOK.md'),
  dependencyLockWorkflowRunbookProtected: files.some(item => item.file === 'DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md'),
  dependencyLockArtifactRunbookProtected: files.some(item => item.file === 'DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md'),
  dependencyLockWorkflowProtected: files.some(item => item.file === '../.github/workflows/os2-dependency-lock-generation.yml'),
  activationGovernanceProtected: files.some(item => item.file === 'preview-activation-governance-check.js'),
  ciWorkflowProtected: files.some(item => item.file === '../.github/workflows/os2-preview-ci.yml'),
  ciEvidenceControlsProtected: files.some(item => item.file === 'build-evidence.js') && files.some(item => item.file === 'ci-governance-check.js'),
  releaseGovernanceProtected: files.some(item => item.file === 'release-manifest-check.js'),
  backupRunnerProtected: files.some(item => item.file === 'backup-runner.js'),
  backupVerificationProtected: files.some(item => item.file === 'backup-verification.js'),
  restoreRunnerProtected: files.some(item => item.file === 'restore-test-runner.js'),
  restoreGovernanceProtected: files.some(item => item.file === 'restore-test-governance-check.js'),
  restoreIntegrationProtected: files.some(item => item.file === 'restore-test-integration-check.js'),
  recoveryReadinessProtected: files.some(item => item.file === 'recovery-readiness-check.js'),
  recoveryReleaseGateProtected: files.some(item => item.file === 'recovery-release-gate.js'),
  recoveryRunbookProtected: files.some(item => item.file === 'BACKUP_AND_RECOVERY_RUNBOOK.md'),
  repositoryRootContainmentRequired: true,
  parentWorkflowPathsResolvedCanonically: true,
  repositoryApplicationOwnerConsistency: true,
  duplicatePathsRejected: true, secureDescriptorReads: true, pathAndDescriptorMetadataBound: true,
  exactReadByteCountRequired: true, canonicalPathBinding: true, hardLinkRejection: true,
  ownershipConsistency: true, boundedReads: true, productionMutationEnabled: false, mergeExecutionEnabled: false
}, null, 2));
