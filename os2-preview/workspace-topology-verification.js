'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'workspace-topology-verification', error: message, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  process.exit(1);
}
function validateDirectory(directory, label, expectedOwner) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label}_NOT_SECURE_DIRECTORY`);
  if (fs.realpathSync.native(directory) !== directory) fail(`${label}_NOT_CANONICAL`);
  if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) fail(`${label}_OWNER_MISMATCH`);
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) fail(`${label}_WRITABLE_BY_GROUP_OR_WORLD`);
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`${label}_IDENTITY_CHANGED_DURING_OPEN`);
    if (opened.uid !== stat.uid || opened.mode !== stat.mode || opened.mtimeMs !== stat.mtimeMs) fail(`${label}_METADATA_CHANGED_DURING_OPEN`);
    return { uid: opened.uid, dev: opened.dev, ino: opened.ino, mode: opened.mode, mtimeMs: opened.mtimeMs };
  } finally { fs.closeSync(descriptor); }
}
function validateProtectedFile(file, label, expectedOwner, maxBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label}_NOT_REGULAR_FILE`);
  if (stat.nlink !== 1) fail(`${label}_HARD_LINK_PROHIBITED`);
  if (stat.uid !== expectedOwner) fail(`${label}_OWNER_MISMATCH`);
  if (stat.size <= 0 || stat.size > maxBytes) fail(`${label}_SIZE_INVALID`);
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) fail(`${label}_WRITABLE_BY_GROUP_OR_WORLD`);
  if (fs.realpathSync.native(file) !== file) fail(`${label}_NOT_CANONICAL`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`${label}_IDENTITY_CHANGED_DURING_OPEN`);
    if (opened.nlink !== 1 || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) fail(`${label}_METADATA_CHANGED_DURING_OPEN`);
    if (opened.uid !== stat.uid || opened.mode !== stat.mode) fail(`${label}_SECURITY_METADATA_CHANGED_DURING_OPEN`);
  } finally { fs.closeSync(descriptor); }
}
function assertDirectoryIdentity(directory, identity, label) {
  const stat = fs.lstatSync(directory);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino || stat.uid !== identity.uid || stat.mode !== identity.mode) fail(`${label}_IDENTITY_CHANGED_AFTER_INVENTORY`);
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== identity.dev || opened.ino !== identity.ino || opened.uid !== identity.uid || opened.mode !== identity.mode) fail(`${label}_DESCRIPTOR_IDENTITY_CHANGED_AFTER_INVENTORY`);
  } finally { fs.closeSync(descriptor); }
}

if (typeof fs.constants.O_NOFOLLOW !== 'number' || typeof fs.constants.O_DIRECTORY !== 'number') fail('O_NOFOLLOW and O_DIRECTORY are required for workspace topology verification');
const configuredRoot = String(process.env.PREVIEW_APP_ROOT || '').trim();
if (!configuredRoot) fail('PREVIEW_APP_ROOT is required');
if (!path.isAbsolute(configuredRoot) || path.normalize(configuredRoot) !== configuredRoot || configuredRoot !== root) fail('PREVIEW_APP_ROOT_MUST_MATCH');
if (String(process.env.DB_NAME || '').trim() !== expectedDatabase) fail(`DB_NAME_MUST_BE_${expectedDatabase}`);
const branch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
if (branch !== expectedBranch) fail(`RELEASE_BRANCH_MUST_BE_${expectedBranch}`);
if (Number.parseInt(process.versions.node.split('.')[0], 10) !== expectedNodeMajor) fail(`NODE_MAJOR_MUST_BE_${expectedNodeMajor}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('PRODUCTION_MUTATION_FLAG_PROHIBITED');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('MERGE_EXECUTION_FLAG_PROHIBITED');

const rootIdentity = validateDirectory(root, 'APPLICATION_ROOT');
const migrationsDirectory = path.join(root, 'migrations');
const migrationsIdentity = validateDirectory(migrationsDirectory, 'MIGRATIONS_DIRECTORY', rootIdentity.uid);
const protectedFiles = Object.freeze([
  ['package.json', 1024 * 1024],
  ['package-lock.json', 16 * 1024 * 1024],
  ['dependency-lock-provenance.json', 64 * 1024],
  ['server.js', 4 * 1024 * 1024],
  ['dependency-lock-verification.js', 2 * 1024 * 1024],
  ['dependency-lock-governance-check.js', 2 * 1024 * 1024],
  ['dependency-lock-generator.js', 2 * 1024 * 1024],
  ['dependency-lock-generator-check.js', 2 * 1024 * 1024],
  ['dependency-lock-workflow-check.js', 2 * 1024 * 1024],
  ['dependency-lock-artifact-verification.js', 2 * 1024 * 1024],
  ['dependency-lock-artifact-check.js', 2 * 1024 * 1024],
  ['dependency-lock-provenance-verification.js', 2 * 1024 * 1024],
  ['dependency-lock-adoption-materializer.js', 2 * 1024 * 1024],
  ['dependency-lock-adoption-check.js', 2 * 1024 * 1024],
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
  ['DEPENDENCY_LOCK_GENERATION_RUNBOOK.md', 2 * 1024 * 1024],
  ['DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md', 2 * 1024 * 1024],
  ['DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md', 2 * 1024 * 1024],
  ['DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md', 2 * 1024 * 1024],
  ['PREVIEW_ACTIVATION_RUNBOOK.md', 2 * 1024 * 1024],
  ['PREVIEW_DEPLOYMENT_RUNBOOK.md', 2 * 1024 * 1024],
  ['PREVIEW_UAT_RUNBOOK.md', 2 * 1024 * 1024],
  ['RELEASE_CANDIDATE_RUNBOOK.md', 2 * 1024 * 1024],
  ['CI_AND_BUILD_EVIDENCE_RUNBOOK.md', 2 * 1024 * 1024]
]);
const protectedInventory = [];
for (const [relative, maxBytes] of protectedFiles) {
  validateProtectedFile(path.join(root, relative), relative, rootIdentity.uid, maxBytes);
  protectedInventory.push(relative);
}

const entries = fs.readdirSync(migrationsDirectory, { withFileTypes: true });
for (const entry of entries) {
  if (entry.name.startsWith('.')) fail(`MIGRATION_HIDDEN_ENTRY_PROHIBITED:${entry.name}`);
  if (!entry.isFile()) fail(`MIGRATION_NON_FILE_ENTRY_PROHIBITED:${entry.name}`);
  if (!/^\d+_.+\.sql$/.test(entry.name)) fail(`MIGRATION_FILENAME_INVALID:${entry.name}`);
}
const migrationNames = entries.map(entry => entry.name).sort();
if (migrationNames.length !== 25) fail(`MIGRATION_COUNT_MUST_BE_25:${migrationNames.length}`);
if (new Set(migrationNames).size !== migrationNames.length) fail('MIGRATION_FILENAMES_DUPLICATE');
if (!migrationNames.includes('20260801_025_merge_authorisation_restore_pin.sql')) fail('MIGRATION_025_MISSING');
for (const name of migrationNames) validateProtectedFile(path.join(migrationsDirectory, name), `MIGRATION_${name}`, rootIdentity.uid, 4 * 1024 * 1024);

assertDirectoryIdentity(root, rootIdentity, 'APPLICATION_ROOT');
assertDirectoryIdentity(migrationsDirectory, migrationsIdentity, 'MIGRATIONS_DIRECTORY');

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
  packageLockPresent: protectedInventory.includes('package-lock.json'),
  dependencyLockProvenancePresent: protectedInventory.includes('dependency-lock-provenance.json'),
  dependencyLockAdoptionControlsProtected: protectedInventory.includes('dependency-lock-provenance-verification.js') && protectedInventory.includes('dependency-lock-adoption-materializer.js') && protectedInventory.includes('dependency-lock-adoption-check.js'),
  dependencyLockAdoptionRunbookProtected: protectedInventory.includes('DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md'),
  migrationLedgerBootstrapPresent: protectedInventory.includes('MIGRATION_LEDGER_BOOTSTRAP.sql'),
  topologyVerifierSelfProtected: protectedInventory.includes('workspace-topology-verification.js'),
  topologyGovernanceProtected: protectedInventory.includes('workspace-topology-governance-check.js'),
  sourceIntegrityControlsProtected: protectedInventory.includes('workspace-source-integrity.js') && protectedInventory.includes('workspace-source-integrity-check.js'),
  activationGovernanceProtected: protectedInventory.includes('preview-activation-governance-check.js'),
  releaseGovernanceProtected: protectedInventory.includes('release-source-integrity-check.js') && protectedInventory.includes('release-manifest-check.js'),
  criticalMigrationControlsProtected: true,
  criticalReleaseControlsProtected: true,
  operationalRunbooksProtected: true,
  exactMigrationCountRequired: true,
  migration025Required: true,
  migrationDirectoryContainsOnlyOrderedSqlFiles: true,
  directoryNoFollowVerification: true,
  directoryDescriptorIdentityVerified: true,
  directoryIdentityReverifiedAfterInventory: true,
  protectedFileNoFollowVerification: true,
  protectedFileDescriptorIdentityVerified: true,
  protectedFileMetadataStabilityRequired: true,
  protectedFileSizeLimitsEnforced: true,
  protectedFilesSymlinkFree: true,
  protectedFilesHardLinkFree: true,
  protectedPathsNotGroupWorldWritable: true,
  ownershipConsistent: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
