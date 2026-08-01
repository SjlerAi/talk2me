'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'workspace-source-integrity', error: message, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  process.exit(1);
}

function secureHash(relativePath, maxBytes, expectedOwner) {
  const file = path.join(root, relativePath);
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
    if (descriptorStat.size > maxBytes) fail(`Protected source descriptor exceeds the permitted size: ${relativePath}`);
    if (process.platform !== 'win32' && (descriptorStat.mode & 0o022) !== 0) fail(`Protected source descriptor is writable by group or world: ${relativePath}`);
    if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) fail(`Protected source descriptor owner mismatch: ${relativePath}`);
    const bytes = fs.readFileSync(descriptor);
    return { file: relativePath, bytes: descriptorStat.size, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } finally {
    fs.closeSync(descriptor);
  }
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
const owner = rootStat.uid;
const protectedFiles = [
  ['server.js', 4 * 1024 * 1024],
  ['package.json', 1024 * 1024],
  ['MIGRATION_LEDGER_BOOTSTRAP.sql', 256 * 1024],
  ['migration-ledger-bootstrap-runner.js', 2 * 1024 * 1024],
  ['migration-ledger-bootstrap-evidence-verification.js', 2 * 1024 * 1024],
  ['migration-runner.js', 2 * 1024 * 1024],
  ['workspace-topology-verification.js', 2 * 1024 * 1024],
  ['workspace-topology-governance-check.js', 2 * 1024 * 1024],
  ['workspace-source-integrity.js', 2 * 1024 * 1024],
  ['workspace-source-integrity-check.js', 2 * 1024 * 1024],
  ['preview-activation-preflight.js', 2 * 1024 * 1024],
  ['preview-activation-governance-check.js', 2 * 1024 * 1024],
  ['readiness-check.js', 2 * 1024 * 1024],
  ['deployment-check.js', 2 * 1024 * 1024],
  ['uat-gate-check.js', 2 * 1024 * 1024],
  ['release-evidence-security-check.js', 2 * 1024 * 1024],
  ['release-source-integrity-verification.js', 2 * 1024 * 1024],
  ['release-source-integrity-check.js', 2 * 1024 * 1024],
  ['release-candidate-gate.js', 4 * 1024 * 1024],
  ['release-manifest-verification.js', 4 * 1024 * 1024],
  ['release-manifest-check.js', 2 * 1024 * 1024],
  ['PREVIEW_ACTIVATION_RUNBOOK.md', 2 * 1024 * 1024],
  ['PREVIEW_DEPLOYMENT_RUNBOOK.md', 2 * 1024 * 1024],
  ['PREVIEW_UAT_RUNBOOK.md', 2 * 1024 * 1024],
  ['RELEASE_CANDIDATE_RUNBOOK.md', 2 * 1024 * 1024],
  ['CI_AND_BUILD_EVIDENCE_RUNBOOK.md', 2 * 1024 * 1024]
];

if (fs.existsSync(path.join(root, 'package-lock.json'))) protectedFiles.push(['package-lock.json', 16 * 1024 * 1024]);
const migrationDirectory = path.join(root, 'migrations');
const entries = fs.readdirSync(migrationDirectory, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !/^\d+_.+\.sql$/.test(entry.name)) fail(`Unexpected migrations directory entry: ${entry.name}`);
  protectedFiles.push([path.join('migrations', entry.name), 4 * 1024 * 1024]);
}
protectedFiles.sort((a, b) => a[0].localeCompare(b[0]));

const files = protectedFiles.map(([file, maxBytes]) => secureHash(file, maxBytes, owner));
const canonicalInventory = files.map(item => `${item.file}\0${item.bytes}\0${item.sha256}`).join('\n');
const inventorySha256 = crypto.createHash('sha256').update(canonicalInventory).digest('hex');

console.log(JSON.stringify({
  ok: true,
  check: 'workspace-source-integrity',
  application: 'talk2me-os2-preview',
  version: require('./package.json').version,
  applicationRoot: root,
  database: expectedDatabase,
  branch: expectedBranch,
  nodeVersion: process.versions.node,
  protectedFileCount: files.length,
  migrationCount: files.filter(item => item.file.startsWith('migrations/')).length,
  packageLockPresent: files.some(item => item.file === 'package-lock.json'),
  inventorySha256,
  files,
  selfProtected: files.some(item => item.file === 'workspace-source-integrity.js'),
  governanceProtected: files.some(item => item.file === 'workspace-source-integrity-check.js'),
  activationGovernanceProtected: files.some(item => item.file === 'preview-activation-governance-check.js'),
  releaseGovernanceProtected: files.some(item => item.file === 'release-manifest-check.js'),
  secureDescriptorReads: true,
  canonicalPathBinding: true,
  hardLinkRejection: true,
  ownershipConsistency: true,
  boundedReads: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
