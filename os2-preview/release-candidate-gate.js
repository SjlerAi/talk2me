'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = __dirname;
const failures = [];
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedDatabase = 'kloka_talk2me';
const bootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql';
const restorePinMigration = '20260801_025_merge_authorisation_restore_pin.sql';

function fail(message) { failures.push(message); }
function exists(file) { return fs.existsSync(path.join(root, file)); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sha256Text(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function requireValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(`${name} is required`);
  return value;
}
function validatePrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Release manifest directory must be a regular non-symlink directory: ${directory}`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error(`Release manifest directory permissions must not allow group or world access: ${directory}`);
  if (fs.realpathSync.native(directory) !== directory) throw new Error(`Release manifest directory must resolve to its exact canonical path: ${directory}`);
}
function writePrivateTemp(file, value) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, value, 'utf8'); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
function removeIfPresent(file) {
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function publishEvidencePair(manifestPath, manifestText, checksumText) {
  const checksumPath = `${manifestPath}.sha256`;
  const directory = path.dirname(manifestPath);
  const nonce = `${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
  const manifestTemp = `${manifestPath}.${nonce}.tmp`;
  const checksumTemp = `${checksumPath}.${nonce}.tmp`;
  let manifestPublished = false;
  let checksumPublished = false;
  try {
    writePrivateTemp(manifestTemp, manifestText);
    writePrivateTemp(checksumTemp, checksumText);
    fs.linkSync(checksumTemp, checksumPath); checksumPublished = true;
    fs.linkSync(manifestTemp, manifestPath); manifestPublished = true;
    syncDirectory(directory);
  } catch (error) {
    if (manifestPublished) removeIfPresent(manifestPath);
    if (checksumPublished) removeIfPresent(checksumPath);
    syncDirectory(directory);
    throw error;
  } finally {
    removeIfPresent(manifestTemp);
    removeIfPresent(checksumTemp);
  }
}
function verifyBootstrapEvidence(evidencePath) {
  const result = spawnSync(process.execPath, [path.join(root, 'migration-ledger-bootstrap-evidence-verification.js')], {
    cwd: root,
    env: {
      ...process.env,
      DB_NAME: expectedDatabase,
      MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH: evidencePath,
      ALLOW_PRODUCTION_MUTATION: 'false',
      ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'
    },
    stdio: 'inherit'
  });
  if (result.error) throw new Error(`Bootstrap evidence verifier could not start: ${result.error.message}`);
  if (result.signal) throw new Error(`Bootstrap evidence verifier was interrupted by signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`Bootstrap evidence verifier failed with status ${result.status}`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseCommitSha = String(process.env.RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const explicitSha = String(process.env.RELEASE_COMMIT_SHA || '').trim();
const githubSha = String(process.env.GITHUB_SHA || '').trim();
const releaseBranch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
const approvedBy = requireValue('RELEASE_APPROVED_BY');
const changeReference = requireValue('RELEASE_CHANGE_REFERENCE');
const output = requireValue('RELEASE_MANIFEST_PATH');
const bootstrapEvidencePath = requireValue('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH');

if (pkg.name !== 'talk2me-os2-preview') fail(`Unexpected preview package name: ${pkg.name}`);
if (pkg.version !== '0.59.0') fail(`Unexpected preview package version: ${pkg.version}`);
if (!exists('package-lock.json')) fail('package-lock.json is required before release-candidate freeze');
if (!releaseCommitSha) fail('RELEASE_COMMIT_SHA or GITHUB_SHA is required');
else if (!/^[0-9a-f]{40}$/i.test(releaseCommitSha)) fail('Release commit SHA must be a full 40-character hexadecimal SHA');
if (explicitSha && githubSha && explicitSha.toLowerCase() !== githubSha.toLowerCase()) fail('RELEASE_COMMIT_SHA must match the exact GITHUB_SHA being validated');
if (!releaseBranch) fail('RELEASE_BRANCH or GITHUB_REF_NAME is required');
else if (releaseBranch !== expectedBranch) fail(`Unexpected release branch: ${releaseBranch}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('Release freeze refuses ALLOW_PRODUCTION_MUTATION=true');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('Release freeze refuses ENABLE_CUSTOMER_MERGE_EXECUTION=true');
if (!path.isAbsolute(output)) fail('RELEASE_MANIFEST_PATH must be absolute');
if (path.normalize(output) !== output) fail('RELEASE_MANIFEST_PATH must be normalized');
if (!path.isAbsolute(bootstrapEvidencePath)) fail('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH must be absolute');
if (path.normalize(bootstrapEvidencePath) !== bootstrapEvidencePath) fail('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH must be normalized');

const requiredFiles = [
  bootstrapFile, 'migration-ledger-bootstrap-evidence-verification.js', 'migration-ledger-bootstrap-evidence-check.js',
  'migration-runner-security-check.js', 'workspace-topology-governance-check.js', 'preview-activation-governance-check.js',
  'release-evidence-security-check.js', 'deployment-check.js', 'uat-gate-check.js', 'schema-verification.js',
  'preview-data-verification.js', 'merge-restore-evidence-verification.js', `migrations/${restorePinMigration}`
];
for (const file of requiredFiles) if (!exists(file)) fail(`Missing release dependency: ${file}`);

const requiredScripts = [
  'verify:migration-ledger-bootstrap-evidence','migrate:preview','verify:preview-data',
  'check:migration-ledger-bootstrap-evidence','check:migration-runner-security',
  'check:workspace-topology-governance','check:preview-activation-governance','check:release-evidence-security',
  'check:readiness','check:deployment','check:uat-gate'
];
for (const script of requiredScripts) if (!pkg.scripts || !pkg.scripts[script]) fail(`Missing package command: ${script}`);

let bootstrapEvidenceSha256 = null;
let bootstrapEvidenceSidecarSha256 = null;
if (bootstrapEvidencePath && path.isAbsolute(bootstrapEvidencePath) && path.normalize(bootstrapEvidencePath) === bootstrapEvidencePath) {
  try {
    verifyBootstrapEvidence(bootstrapEvidencePath);
    bootstrapEvidenceSha256 = sha256File(bootstrapEvidencePath);
    bootstrapEvidenceSidecarSha256 = sha256File(`${bootstrapEvidencePath}.sha256`);
  } catch (error) {
    fail(error.message);
  }
}

const migrationsDirectory = path.join(root, 'migrations');
const migrations = fs.readdirSync(migrationsDirectory).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
if (migrations.length < 25) fail(`Expected at least 25 migrations, found ${migrations.length}`);
if (!migrations.includes(restorePinMigration)) fail(`Missing required migration: ${restorePinMigration}`);

const forbiddenRuntimeCreate = fs.readdirSync(root)
  .filter(name => name === 'server.js' || name.endsWith('-routes.js'))
  .filter(name => /CREATE\s+TABLE/i.test(fs.readFileSync(path.join(root, name), 'utf8')));
if (forbiddenRuntimeCreate.length) fail(`Runtime CREATE TABLE found in: ${forbiddenRuntimeCreate.join(', ')}`);

if (output && path.isAbsolute(output) && path.normalize(output) === output) {
  const directory = path.dirname(output);
  try { validatePrivateDirectory(directory); } catch (error) { fail(error.message); }
  if (fs.existsSync(output)) fail(`Release manifest already exists: ${output}`);
  if (fs.existsSync(`${output}.sha256`)) fail(`Release manifest checksum already exists: ${output}.sha256`);
}

const manifest = {
  ok: failures.length === 0,
  application: pkg.name,
  version: pkg.version,
  packageJsonSha256: sha256File(path.join(root, 'package.json')),
  dependencyLockPresent: exists('package-lock.json'),
  dependencyLockSha256: exists('package-lock.json') ? sha256File(path.join(root, 'package-lock.json')) : null,
  commitSha: releaseCommitSha || null,
  branch: releaseBranch || null,
  commitIdentityVerified: Boolean(releaseCommitSha && /^[0-9a-f]{40}$/i.test(releaseCommitSha)),
  approvedBy: approvedBy || null,
  changeReference: changeReference || null,
  generatedAt: new Date().toISOString(),
  migrationLedgerBootstrapFile: bootstrapFile,
  migrationLedgerBootstrapSha256: sha256File(path.join(root, bootstrapFile)),
  migrationLedgerBootstrapEvidencePath: bootstrapEvidencePath || null,
  migrationLedgerBootstrapEvidenceSha256: bootstrapEvidenceSha256,
  migrationLedgerBootstrapEvidenceSidecarSha256: bootstrapEvidenceSidecarSha256,
  migrationLedgerBootstrapEvidenceVerified: Boolean(bootstrapEvidenceSha256 && bootstrapEvidenceSidecarSha256),
  bootstrapEvidenceVerifiedBeforeReleaseFreeze: Boolean(bootstrapEvidenceSha256 && bootstrapEvidenceSidecarSha256),
  runtimeLedgerCreationDisabled: true,
  migrationCount: migrations.length,
  migrationChecksums: migrations.map(file => ({ file, sha256: sha256File(path.join(migrationsDirectory, file)) })),
  restorePinMigration,
  previewDataVerificationRequired: true,
  previewDataVerificationOrder: ['schema-verification.js', 'merge-restore-evidence-verification.js'],
  migrationCompletionRequiresConfirmedLockRelease: true,
  migrationConnectionClosedBeforeSuccess: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  requiredFiles,
  requiredScripts,
  failures
};

if (failures.length === 0) {
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const digest = sha256Text(manifestText);
  try { publishEvidencePair(output, manifestText, `${digest}  ${path.basename(output)}\n`); }
  catch (error) { fail(`Release evidence publication failed: ${error.message}`); }
}

manifest.ok = failures.length === 0;
console.log(JSON.stringify(manifest, null, 2));
if (failures.length) process.exit(1);
