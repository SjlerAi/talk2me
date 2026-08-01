'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'release-manifest-verification', error: message }, null, 2));
  process.exit(1);
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function readSecureRegularFile(file, options = {}) {
  const label = options.label || 'Protected file';
  const expectedMode = options.expectedMode;
  const maxBytes = options.maxBytes || 16 * 1024 * 1024;
  let pathStat;
  try { pathStat = fs.lstatSync(file); } catch { fail(`${label} is missing: ${file}`); }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) fail(`${label} must be a regular non-symlink file: ${file}`);
  if (pathStat.nlink !== 1) fail(`${label} must not have additional hard links: ${file}`);
  if (process.platform !== 'win32' && Number.isInteger(expectedMode) && (pathStat.mode & 0o777) !== expectedMode) fail(`${label} permissions must be ${expectedMode.toString(8).padStart(4, '0')}: ${file}`);
  if (fs.realpathSync.native(file) !== file) fail(`${label} path is not canonical: ${file}`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW is required for secure release evidence verification');
  let descriptor;
  try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { fail(`Unable to securely open ${label.toLowerCase()}: ${file}: ${error.message}`); }
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) fail(`${label} descriptor is not a regular file: ${file}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) fail(`${label} changed between path validation and secure open: ${file}`);
    if (descriptorStat.nlink !== 1) fail(`${label} descriptor must not have additional hard links: ${file}`);
    if (descriptorStat.size > maxBytes) fail(`${label} exceeds the maximum permitted size: ${file}`);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}
function verifyChecksumPair(file, label, maxBytes) {
  const data = readSecureRegularFile(file, { label, expectedMode: 0o600, maxBytes });
  const sidecar = readSecureRegularFile(`${file}.sha256`, { label: `${label} checksum`, expectedMode: 0o600, maxBytes: 4096 });
  const match = sidecar.toString('utf8').match(/^([0-9a-f]{64})  ([^\r\n]+)\r?\n$/i);
  if (!match || match[2] !== path.basename(file)) fail(`${label} checksum file has an invalid format`);
  const actual = sha256(data);
  if (!crypto.timingSafeEqual(Buffer.from(match[1].toLowerCase(), 'hex'), Buffer.from(actual, 'hex'))) fail(`${label} checksum verification failed`);
  return { data, dataSha256: actual, sidecarSha256: sha256(sidecar) };
}

const root = __dirname;
const expectedPreviewVersion = '0.59.0';
const expectedReleaseBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedBootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql';
const verifiedCommitSha = String(process.env.RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const verifiedBranch = String(process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
const manifestPath = String(process.env.RELEASE_MANIFEST_PATH || '').trim();

if (!/^[0-9a-f]{40}$/i.test(verifiedCommitSha)) fail('Post-freeze verified commit SHA must be a full 40-character hexadecimal SHA');
if (verifiedBranch !== expectedReleaseBranch) fail(`Unexpected post-freeze release branch: ${verifiedBranch || 'missing'}`);
if (!manifestPath) fail('RELEASE_MANIFEST_PATH is required');
if (!path.isAbsolute(manifestPath)) fail('RELEASE_MANIFEST_PATH must be absolute');
if (path.normalize(manifestPath) !== manifestPath) fail('RELEASE_MANIFEST_PATH must be normalized');

const directory = path.dirname(manifestPath);
const directoryStat = fs.lstatSync(directory);
if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail(`Release evidence directory must be a real non-symlink directory: ${directory}`);
if (process.platform !== 'win32' && (directoryStat.mode & 0o077) !== 0) fail(`Release evidence directory must not permit group or world access: ${directory}`);
if (fs.realpathSync.native(directory) !== directory) fail(`Release evidence directory path is not canonical: ${directory}`);

const manifestPair = verifyChecksumPair(manifestPath, 'Release manifest', 4 * 1024 * 1024);
let manifest;
try { manifest = JSON.parse(manifestPair.data.toString('utf8')); } catch { fail('Release manifest is not valid JSON'); }

if (manifest.ok !== true) fail('Release manifest is not marked successful');
if (manifest.application !== 'talk2me-os2-preview') fail('Release manifest application identity is invalid');
if (manifest.version !== expectedPreviewVersion) fail(`Release manifest version must be ${expectedPreviewVersion}`);
if (manifest.branch !== expectedReleaseBranch || manifest.branch !== verifiedBranch) fail('Release manifest branch does not match the verified branch');
if (String(manifest.commitSha || '').toLowerCase() !== verifiedCommitSha.toLowerCase()) fail('Release manifest commit SHA does not match the verified commit SHA');
if (manifest.commitIdentityVerified !== true) fail('Release manifest commit identity is not verified');
if (typeof manifest.approvedBy !== 'string' || !manifest.approvedBy.trim()) fail('Release manifest approver evidence is missing');
if (typeof manifest.changeReference !== 'string' || !manifest.changeReference.trim()) fail('Release manifest change reference is missing');
if (manifest.dependencyLockPresent !== true) fail('Release manifest does not confirm a committed dependency lock');
if (manifest.migrationLedgerBootstrapFile !== expectedBootstrapFile) fail('Release manifest migration-ledger bootstrap filename is invalid');
if (manifest.migrationLedgerBootstrapEvidenceVerified !== true) fail('Release manifest does not confirm verified bootstrap execution evidence');
if (manifest.bootstrapEvidenceVerifiedBeforeReleaseFreeze !== true) fail('Bootstrap evidence was not verified before release freeze');
if (!path.isAbsolute(String(manifest.migrationLedgerBootstrapEvidencePath || ''))) fail('Release manifest bootstrap evidence path is invalid');
if (!/^[0-9a-f]{64}$/i.test(String(manifest.migrationLedgerBootstrapEvidenceSha256 || ''))) fail('Release manifest bootstrap evidence checksum is invalid');
if (!/^[0-9a-f]{64}$/i.test(String(manifest.migrationLedgerBootstrapEvidenceSidecarSha256 || ''))) fail('Release manifest bootstrap evidence sidecar checksum is invalid');
if (manifest.runtimeLedgerCreationDisabled !== true) fail('Runtime ledger creation must remain disabled');
if (manifest.migrationCompletionRequiresConfirmedLockRelease !== true) fail('Release manifest does not require confirmed migration lock release');
if (manifest.migrationConnectionClosedBeforeSuccess !== true) fail('Release manifest does not require database cleanup before migration success');
if (manifest.productionMutationEnabled !== false || manifest.mergeExecutionEnabled !== false) fail('Release manifest execution safety flags are invalid');
if (!Array.isArray(manifest.failures) || manifest.failures.length !== 0) fail('Release manifest contains blocking failures');

const packageBytes = readSecureRegularFile(path.join(root, 'package.json'), { label: 'Checked-out package.json', maxBytes: 1024 * 1024 });
if (sha256(packageBytes) !== String(manifest.packageJsonSha256).toLowerCase()) fail('Release manifest package.json checksum does not match the checked-out package.json');
const lockBytes = readSecureRegularFile(path.join(root, 'package-lock.json'), { label: 'Checked-out package-lock.json', maxBytes: 16 * 1024 * 1024 });
if (sha256(lockBytes) !== String(manifest.dependencyLockSha256).toLowerCase()) fail('Release manifest dependency-lock checksum does not match the checked-out package-lock.json');
const bootstrapBytes = readSecureRegularFile(path.join(root, expectedBootstrapFile), { label: 'Checked-out migration ledger bootstrap', maxBytes: 1024 * 1024 });
if (sha256(bootstrapBytes) !== String(manifest.migrationLedgerBootstrapSha256).toLowerCase()) fail('Release manifest migration-ledger bootstrap checksum does not match the checked-out source');

const bootstrapEvidencePath = manifest.migrationLedgerBootstrapEvidencePath;
const bootstrapPair = verifyChecksumPair(bootstrapEvidencePath, 'Migration ledger bootstrap evidence', 4 * 1024 * 1024);
if (bootstrapPair.dataSha256 !== manifest.migrationLedgerBootstrapEvidenceSha256.toLowerCase()) fail('Bootstrap evidence file changed after release freeze');
if (bootstrapPair.sidecarSha256 !== manifest.migrationLedgerBootstrapEvidenceSidecarSha256.toLowerCase()) fail('Bootstrap evidence checksum sidecar changed after release freeze');
let bootstrapEvidence;
try { bootstrapEvidence = JSON.parse(bootstrapPair.data.toString('utf8')); } catch { fail('Bootstrap execution evidence is not valid JSON'); }
if (bootstrapEvidence.ok !== true || bootstrapEvidence.database !== 'kloka_talk2me') fail('Bootstrap execution evidence identity is invalid');
if (bootstrapEvidence.bootstrapFile !== expectedBootstrapFile) fail('Bootstrap execution evidence filename is invalid');
if (bootstrapEvidence.bootstrapSha256 !== manifest.migrationLedgerBootstrapSha256.toLowerCase()) fail('Bootstrap execution evidence is not bound to the frozen bootstrap source');
if (bootstrapEvidence.preexistingLedgerTableCount !== 0 || bootstrapEvidence.createdLedgerTableCount !== 1) fail('Bootstrap execution evidence table counts are invalid');
if (bootstrapEvidence.ledgerSchemaVerified !== true || bootstrapEvidence.ledgerEmpty !== true) fail('Bootstrap execution evidence does not prove a verified empty ledger');
if (bootstrapEvidence.advisoryLockUsed !== true || bootstrapEvidence.advisoryLockOwnerVerified !== true || bootstrapEvidence.advisoryLockReleased !== true) fail('Bootstrap execution evidence advisory-lock lifecycle is incomplete');
if (bootstrapEvidence.productionMutationEnabled !== false || bootstrapEvidence.mergeExecutionEnabled !== false) fail('Bootstrap execution evidence safety flags are invalid');

const migrationsDirectory = path.join(root, 'migrations');
const actualMigrations = fs.readdirSync(migrationsDirectory).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
if (!Array.isArray(manifest.migrationChecksums) || manifest.migrationChecksums.length !== actualMigrations.length) fail('Release manifest migration inventory does not match the workspace');
for (let index = 0; index < actualMigrations.length; index += 1) {
  const file = actualMigrations[index];
  const evidence = manifest.migrationChecksums[index];
  if (!evidence || evidence.file !== file) fail(`Release manifest migration order mismatch: ${file}`);
  const bytes = readSecureRegularFile(path.join(migrationsDirectory, file), { label: 'Checked-out migration', maxBytes: 4 * 1024 * 1024 });
  if (sha256(bytes) !== String(evidence.sha256).toLowerCase()) fail(`Release manifest migration checksum mismatch: ${file}`);
}

console.log(JSON.stringify({
  ok: true,
  check: 'release-manifest-verification',
  manifestPath,
  manifestSha256: manifestPair.dataSha256,
  application: manifest.application,
  version: manifest.version,
  commitSha: manifest.commitSha,
  branch: manifest.branch,
  commitShaMatchesVerifiedCheckout: true,
  branchMatchesVerifiedCheckout: true,
  evidenceDirectoryCanonical: true,
  evidenceDirectoryPrivate: true,
  evidenceReadsUseNoFollow: true,
  evidenceDescriptorIdentityVerified: true,
  protectedFileSizeLimitsEnforced: true,
  packageManifestMatchesWorkspace: true,
  dependencyLockMatchesWorkspace: true,
  migrationLedgerBootstrapMatchesWorkspace: true,
  bootstrapExecutionEvidenceMatchesFrozenManifest: true,
  bootstrapExecutionEvidenceMatchesWorkspace: true,
  bootstrapEvidenceVerifiedBeforeReleaseFreeze: true,
  migrationInventoryMatchesWorkspace: true,
  migrationCount: actualMigrations.length,
  runtimeLedgerCreationDisabled: true,
  migrationCompletionRequiresConfirmedLockRelease: true,
  migrationConnectionClosedBeforeSuccess: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
