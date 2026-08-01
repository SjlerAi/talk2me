'use strict';

const fs = require('fs');
const path = require('path');

const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;
const root = __dirname;

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'workspace-topology-verification', error: message, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  process.exit(1);
}
function requireNoFollowSupport() {
  if (typeof fs.constants.O_NOFOLLOW !== 'number' || typeof fs.constants.O_DIRECTORY !== 'number') fail('O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification');
}
function validateDirectory(directory, label, expectedOwner) {
  let pathStat;
  try { pathStat = fs.lstatSync(directory); } catch { fail(`${label} is missing: ${directory}`); }
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) fail(`${label} must be a real non-symlink directory: ${directory}`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) fail(`${label} must not be group or world writable: ${directory}`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) fail(`${label} owner differs from the preview application root: ${directory}`);
  if (fs.realpathSync.native(directory) !== directory) fail(`${label} path is not canonical: ${directory}`);
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isDirectory()) fail(`${label} descriptor is not a directory: ${directory}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) fail(`${label} changed during secure open: ${directory}`);
    if (process.platform !== 'win32' && (descriptorStat.mode & 0o022) !== 0) fail(`${label} descriptor is group or world writable: ${directory}`);
    if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) fail(`${label} descriptor owner differs from the preview application root: ${directory}`);
    return { uid: descriptorStat.uid, dev: descriptorStat.dev, ino: descriptorStat.ino };
  } finally { fs.closeSync(descriptor); }
}
function validateProtectedFile(file, label, expectedOwner, required, maxBytes) {
  let pathStat;
  try { pathStat = fs.lstatSync(file); } catch { if (!required) return false; fail(`${label} is missing: ${file}`); }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) fail(`${label} must be a regular non-symlink file: ${file}`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) fail(`${label} owner differs from the preview application root: ${file}`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) fail(`${label} must not be group or world writable: ${file}`);
  if (pathStat.nlink !== 1) fail(`${label} must not have additional hard links: ${file}`);
  if (pathStat.size > maxBytes) fail(`${label} exceeds the maximum permitted size: ${file}`);
  if (fs.realpathSync.native(file) !== file) fail(`${label} path is not canonical: ${file}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) fail(`${label} descriptor is not a regular file: ${file}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) fail(`${label} changed during secure open: ${file}`);
    if (descriptorStat.nlink !== 1) fail(`${label} descriptor has additional hard links: ${file}`);
    if (descriptorStat.size > maxBytes) fail(`${label} descriptor exceeds the maximum permitted size: ${file}`);
    if (process.platform !== 'win32' && (descriptorStat.mode & 0o022) !== 0) fail(`${label} descriptor is group or world writable: ${file}`);
    if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) fail(`${label} descriptor owner differs from the preview application root: ${file}`);
  } finally { fs.closeSync(descriptor); }
  return true;
}
function assertDirectoryIdentity(directory, identity, label) {
  const pathStat = fs.lstatSync(directory);
  if (pathStat.dev !== identity.dev || pathStat.ino !== identity.ino) fail(`${label} changed during topology verification`);
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (descriptorStat.dev !== identity.dev || descriptorStat.ino !== identity.ino) fail(`${label} descriptor identity changed during topology verification`);
  } finally { fs.closeSync(descriptor); }
}

requireNoFollowSupport();
const configuredRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
if (!configuredRoot) fail('PREVIEW_APP_ROOT is required');
if (!path.isAbsolute(configuredRoot)) fail('PREVIEW_APP_ROOT must be absolute');
if (path.normalize(configuredRoot) !== configuredRoot) fail('PREVIEW_APP_ROOT must be normalized');
if (configuredRoot !== root) fail(`PREVIEW_APP_ROOT must match the executing application root: ${root}`);
if (String(process.env.DB_NAME || '').trim() !== expectedDatabase) fail(`Workspace verification requires DB_NAME=${expectedDatabase}`);
const branch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
if (branch !== expectedBranch) fail(`Workspace verification requires the controlled branch: ${expectedBranch}`);
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor !== expectedNodeMajor) fail(`Workspace verification requires Node.js ${expectedNodeMajor}.x; found ${process.versions.node}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('Workspace verification refuses ALLOW_PRODUCTION_MUTATION=true');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('Workspace verification refuses ENABLE_CUSTOMER_MERGE_EXECUTION=true');

const rootIdentity = validateDirectory(root, 'Preview application root');
const migrationsDirectory = path.join(root, 'migrations');
const migrationsIdentity = validateDirectory(migrationsDirectory, 'Migrations directory', rootIdentity.uid);
const protectedFiles = [
  ['package.json', 'package.json', true, 1024 * 1024],
  ['package-lock.json', 'package-lock.json', false, 16 * 1024 * 1024],
  ['server.js', 'Preview server entrypoint', true, 4 * 1024 * 1024],
  ['MIGRATION_LEDGER_BOOTSTRAP.sql', 'Migration ledger bootstrap', true, 256 * 1024],
  ['migration-ledger-bootstrap-runner.js', 'Migration ledger bootstrap runner', true, 2 * 1024 * 1024],
  ['migration-ledger-bootstrap-evidence-verification.js', 'Migration ledger bootstrap evidence verifier', true, 2 * 1024 * 1024],
  ['migration-runner.js', 'Controlled migration runner', true, 2 * 1024 * 1024],
  ['workspace-topology-verification.js', 'Workspace topology verifier', true, 2 * 1024 * 1024],
  ['workspace-topology-governance-check.js', 'Workspace topology governance', true, 2 * 1024 * 1024],
  ['workspace-source-integrity.js', 'Workspace source-integrity verifier', true, 2 * 1024 * 1024],
  ['workspace-source-integrity-check.js', 'Workspace source-integrity governance', true, 2 * 1024 * 1024],
  ['preview-activation-preflight.js', 'Preview activation preflight', true, 2 * 1024 * 1024],
  ['preview-activation-governance-check.js', 'Preview activation governance', true, 2 * 1024 * 1024],
  ['readiness-check.js', 'Readiness check', true, 2 * 1024 * 1024],
  ['deployment-check.js', 'Deployment governance check', true, 2 * 1024 * 1024],
  ['uat-gate-check.js', 'UAT governance check', true, 2 * 1024 * 1024],
  ['release-evidence-security-check.js', 'Release evidence security governance', true, 2 * 1024 * 1024],
  ['release-source-integrity-verification.js', 'Release source-integrity verifier', true, 2 * 1024 * 1024],
  ['release-source-integrity-check.js', 'Release source-integrity governance', true, 2 * 1024 * 1024],
  ['release-candidate-gate.js', 'Release candidate gate', true, 4 * 1024 * 1024],
  ['release-manifest-verification.js', 'Release manifest verifier', true, 4 * 1024 * 1024],
  ['release-manifest-check.js', 'Release manifest governance', true, 2 * 1024 * 1024],
  ['PREVIEW_ACTIVATION_RUNBOOK.md', 'Preview activation runbook', true, 2 * 1024 * 1024],
  ['PREVIEW_DEPLOYMENT_RUNBOOK.md', 'Preview deployment runbook', true, 2 * 1024 * 1024],
  ['PREVIEW_UAT_RUNBOOK.md', 'Preview UAT runbook', true, 2 * 1024 * 1024],
  ['RELEASE_CANDIDATE_RUNBOOK.md', 'Release candidate runbook', true, 2 * 1024 * 1024],
  ['CI_AND_BUILD_EVIDENCE_RUNBOOK.md', 'CI and build evidence runbook', true, 2 * 1024 * 1024]
];

const protectedInventory = [];
let packageLockPresent = false;
for (const [relative, label, required, maxBytes] of protectedFiles) {
  const present = validateProtectedFile(path.join(root, relative), label, rootIdentity.uid, required, maxBytes);
  if (relative === 'package-lock.json') packageLockPresent = present;
  if (present) protectedInventory.push(relative);
}
const migrationDirectoryEntries = fs.readdirSync(migrationsDirectory, { withFileTypes: true });
for (const entry of migrationDirectoryEntries) {
  if (entry.name.startsWith('.')) fail(`Hidden entry is prohibited in migrations directory: ${entry.name}`);
  if (!entry.isFile()) fail(`Only regular migration files are permitted in migrations directory: ${entry.name}`);
  if (!/^\d+_.+\.sql$/.test(entry.name)) fail(`Unexpected file in migrations directory: ${entry.name}`);
}
const migrationNames = migrationDirectoryEntries.map(entry => entry.name).sort();
if (migrationNames.length < 25) fail(`Expected at least 25 migration files, found ${migrationNames.length}`);
if (!migrationNames.includes('20260801_025_merge_authorisation_restore_pin.sql')) fail('Migration 025 is missing from the protected workspace');
for (const name of migrationNames) validateProtectedFile(path.join(migrationsDirectory, name), `Migration ${name}`, rootIdentity.uid, true, 4 * 1024 * 1024);
assertDirectoryIdentity(root, rootIdentity, 'Preview application root');
assertDirectoryIdentity(migrationsDirectory, migrationsIdentity, 'Migrations directory');

console.log(JSON.stringify({
  ok: true,
  check: 'workspace-topology-verification',
  applicationRoot: root,
  database: expectedDatabase,
  branch: expectedBranch,
  nodeVersion: process.versions.node,
  nodeMajorVerified: expectedNodeMajor,
  migrationCount: migrationNames.length,
  protectedInventory,
  protectedInventoryCount: protectedInventory.length,
  packageLockPresent,
  migrationLedgerBootstrapPresent: protectedInventory.includes('MIGRATION_LEDGER_BOOTSTRAP.sql'),
  topologyVerifierSelfProtected: protectedInventory.includes('workspace-topology-verification.js'),
  topologyGovernanceProtected: protectedInventory.includes('workspace-topology-governance-check.js'),
  sourceIntegrityControlsProtected: protectedInventory.includes('workspace-source-integrity.js') && protectedInventory.includes('workspace-source-integrity-check.js'),
  activationGovernanceProtected: protectedInventory.includes('preview-activation-governance-check.js'),
  releaseGovernanceProtected: protectedInventory.includes('release-source-integrity-check.js') && protectedInventory.includes('release-manifest-check.js'),
  criticalMigrationControlsProtected: true,
  criticalReleaseControlsProtected: true,
  operationalRunbooksProtected: true,
  migrationDirectoryContainsOnlyOrderedSqlFiles: true,
  directoryNoFollowVerification: true,
  directoryDescriptorIdentityVerified: true,
  directoryIdentityReverifiedAfterInventory: true,
  protectedFileNoFollowVerification: true,
  protectedFileDescriptorIdentityVerified: true,
  protectedFileSizeLimitsEnforced: true,
  protectedFilesSymlinkFree: true,
  protectedFilesHardLinkFree: true,
  protectedPathsNotGroupWorldWritable: true,
  ownershipConsistent: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
