'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function fail(message) { console.error(JSON.stringify({ ok: false, check: 'release-manifest-verification', error: message }, null, 2)); process.exit(1); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function validateReleaseText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is missing`);
  if (value !== value.trim()) fail(`${label} must not contain leading or trailing whitespace`);
  if (value.length > maxLength) fail(`${label} must not exceed ${maxLength} characters`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must not contain control characters`);
}
function validatePrivateDirectory(directory, label) {
  let stat;
  try { stat = fs.lstatSync(directory); } catch { fail(`${label} is missing: ${directory}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real non-symlink directory: ${directory}`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail(`${label} must not permit group or world access: ${directory}`);
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail(`${label} must be owned by the executing user: ${directory}`);
  if (fs.realpathSync.native(directory) !== directory) fail(`${label} path is not canonical: ${directory}`);
}
function readSecureRegularFile(file, options = {}) {
  const label = options.label || 'Protected file';
  const expectedMode = options.expectedMode;
  const maxBytes = options.maxBytes || 16 * 1024 * 1024;
  let pathStat;
  try { pathStat = fs.lstatSync(file); } catch { fail(`${label} is missing: ${file}`); }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) fail(`${label} must be a regular non-symlink file: ${file}`);
  if (pathStat.nlink !== 1) fail(`${label} must not have additional hard links: ${file}`);
  if (process.platform !== 'win32' && Number.isInteger(expectedMode) && (pathStat.mode & 0o777) !== expectedMode) fail(`${label} permissions must be ${expectedMode.toString(8).padStart(4, '0')}: ${file}`);
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && pathStat.uid !== process.getuid()) fail(`${label} must be owned by the executing user: ${file}`);
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
function verifyFrozenSource(root, inventorySha256) {
  const verifierTimeoutMs = 30000;
  const result = spawnSync(process.execPath, [path.join(root, 'release-source-integrity-verification.js')], {
    cwd: root,
    env: { ...process.env, PREVIEW_APP_ROOT: root, DB_NAME: 'kloka_talk2me', RELEASE_BRANCH: 'agent/talk2me-os2-integrated-rebuild', RELEASE_SOURCE_INVENTORY_SHA256: inventorySha256, ALLOW_PRODUCTION_MUTATION: 'false', ENABLE_CUSTOMER_MERGE_EXECUTION: 'false' },
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: verifierTimeoutMs, killSignal: 'SIGKILL', shell: false, windowsHide: true
  });
  if (result.error && result.error.code === 'ETIMEDOUT') fail(`Post-freeze source verifier exceeded ${verifierTimeoutMs}ms`);
  if (result.error) fail(`Post-freeze source verifier could not start: ${result.error.message}`);
  if (result.signal) fail(`Post-freeze source verifier was interrupted by signal ${result.signal}`);
  if (result.status !== 0) fail(`Post-freeze source verifier failed with status ${result.status}: ${String(result.stderr || '').trim()}`);
  let evidence;
  try { evidence = JSON.parse(String(result.stdout || '').trim()); } catch { fail('Post-freeze source verifier did not return valid JSON'); }
  if (evidence.ok !== true || evidence.exactApprovedInventoryMatched !== true) fail('Post-freeze source verifier did not confirm the approved inventory');
  if (String(evidence.inventorySha256 || '').toLowerCase() !== inventorySha256.toLowerCase()) fail('Post-freeze source verifier returned a different inventory digest');
  return evidence;
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
if (!manifestPath || !path.isAbsolute(manifestPath) || path.normalize(manifestPath) !== manifestPath) fail('RELEASE_MANIFEST_PATH must be an absolute normalized path');

const directory = path.dirname(manifestPath);
validatePrivateDirectory(directory, 'Release evidence directory');
const manifestPair = verifyChecksumPair(manifestPath, 'Release manifest', 4 * 1024 * 1024);
let manifest;
try { manifest = JSON.parse(manifestPair.data.toString('utf8')); } catch { fail('Release manifest is not valid JSON'); }

if (manifest.ok !== true) fail('Release manifest is not marked successful');
if (manifest.application !== 'talk2me-os2-preview') fail('Release manifest application identity is invalid');
if (manifest.version !== expectedPreviewVersion) fail(`Release manifest version must be ${expectedPreviewVersion}`);
if (manifest.branch !== expectedReleaseBranch || manifest.branch !== verifiedBranch) fail('Release manifest branch does not match the verified branch');
if (String(manifest.commitSha || '').toLowerCase() !== verifiedCommitSha.toLowerCase()) fail('Release manifest commit SHA does not match the verified commit SHA');
if (manifest.commitIdentityVerified !== true) fail('Release manifest commit identity is not verified');
validateReleaseText(manifest.approvedBy, 'Release manifest approver evidence', 160);
validateReleaseText(manifest.changeReference, 'Release manifest change reference', 240);
const generatedAtMs = Date.parse(String(manifest.generatedAt || ''));
if (!Number.isFinite(generatedAtMs)) fail('Release manifest generatedAt timestamp is invalid');
if (generatedAtMs > Date.now() + 5 * 60 * 1000) fail('Release manifest generatedAt timestamp is unreasonably in the future');
if (generatedAtMs < Date.now() - 30 * 24 * 60 * 60 * 1000) fail('Release manifest is older than the permitted 30-day verification window');
if (manifest.dependencyLockPresent !== true) fail('Release manifest does not confirm a committed dependency lock');
if (!/^[0-9a-f]{64}$/i.test(String(manifest.approvedSourceInventorySha256 || ''))) fail('Release manifest approved source inventory checksum is invalid');
if (manifest.releaseSourceIntegrityVerified !== true || manifest.releaseSourcePackageLockPresent !== true) fail('Release manifest source-integrity evidence is incomplete');
if (!Number.isInteger(manifest.releaseSourceProtectedFileCount) || manifest.releaseSourceProtectedFileCount < 25) fail('Release source protected-file count is invalid');
if (!Number.isInteger(manifest.releaseSourceMigrationCount) || manifest.releaseSourceMigrationCount < 25) fail('Release source migration count is invalid');
if (manifest.migrationLedgerBootstrapFile !== expectedBootstrapFile) fail('Release manifest migration-ledger bootstrap filename is invalid');
if (manifest.migrationLedgerBootstrapEvidenceVerified !== true || manifest.bootstrapEvidenceVerifiedBeforeReleaseFreeze !== true) fail('Release manifest bootstrap evidence verification is incomplete');
const bootstrapEvidencePath = String(manifest.migrationLedgerBootstrapEvidencePath || '');
if (!path.isAbsolute(bootstrapEvidencePath) || path.normalize(bootstrapEvidencePath) !== bootstrapEvidencePath) fail('Release manifest bootstrap evidence path is invalid');
if (bootstrapEvidencePath === manifestPath) fail('Bootstrap evidence path must differ from release manifest path');
validatePrivateDirectory(path.dirname(bootstrapEvidencePath), 'Bootstrap evidence directory');
if (!/^[0-9a-f]{64}$/i.test(String(manifest.migrationLedgerBootstrapEvidenceSha256 || '')) || !/^[0-9a-f]{64}$/i.test(String(manifest.migrationLedgerBootstrapEvidenceSidecarSha256 || ''))) fail('Release manifest bootstrap evidence checksums are invalid');
if (manifest.runtimeLedgerCreationDisabled !== true || manifest.migrationCompletionRequiresConfirmedLockRelease !== true || manifest.migrationConnectionClosedBeforeSuccess !== true) fail('Release manifest migration safety controls are incomplete');
if (manifest.productionMutationEnabled !== false || manifest.mergeExecutionEnabled !== false) fail('Release manifest execution safety flags are invalid');
if (!Array.isArray(manifest.failures) || manifest.failures.length !== 0) fail('Release manifest contains blocking failures');

const sourceEvidence = verifyFrozenSource(root, manifest.approvedSourceInventorySha256);
const packageBytes = readSecureRegularFile(path.join(root, 'package.json'), { label: 'Checked-out package.json', maxBytes: 1024 * 1024 });
if (sha256(packageBytes) !== String(manifest.packageJsonSha256).toLowerCase()) fail('Release manifest package.json checksum does not match the checked-out package.json');
const lockBytes = readSecureRegularFile(path.join(root, 'package-lock.json'), { label: 'Checked-out package-lock.json', maxBytes: 16 * 1024 * 1024 });
if (sha256(lockBytes) !== String(manifest.dependencyLockSha256).toLowerCase()) fail('Release manifest dependency-lock checksum does not match the checked-out package-lock.json');
const bootstrapBytes = readSecureRegularFile(path.join(root, expectedBootstrapFile), { label: 'Checked-out migration ledger bootstrap', maxBytes: 1024 * 1024 });
if (sha256(bootstrapBytes) !== String(manifest.migrationLedgerBootstrapSha256).toLowerCase()) fail('Release manifest migration-ledger bootstrap checksum does not match the checked-out source');

const bootstrapPair = verifyChecksumPair(bootstrapEvidencePath, 'Migration ledger bootstrap evidence', 4 * 1024 * 1024);
if (bootstrapPair.dataSha256 !== manifest.migrationLedgerBootstrapEvidenceSha256.toLowerCase()) fail('Bootstrap evidence file changed after release freeze');
if (bootstrapPair.sidecarSha256 !== manifest.migrationLedgerBootstrapEvidenceSidecarSha256.toLowerCase()) fail('Bootstrap evidence checksum sidecar changed after release freeze');
let bootstrapEvidence;
try { bootstrapEvidence = JSON.parse(bootstrapPair.data.toString('utf8')); } catch { fail('Bootstrap execution evidence is not valid JSON'); }
if (bootstrapEvidence.ok !== true || bootstrapEvidence.database !== 'kloka_talk2me' || bootstrapEvidence.bootstrapFile !== expectedBootstrapFile) fail('Bootstrap execution evidence identity is invalid');
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
  generatedAt: manifest.generatedAt,
  generatedAtValidated: true,
  releaseMetadataValidated: true,
  releaseSourceIntegrityReverifiedAfterFreeze: true,
  releaseSourceProtectedFileCount: sourceEvidence.protectedFileCount,
  releaseSourceMigrationCount: sourceEvidence.migrationCount,
  evidenceDirectoryCanonical: true,
  evidenceDirectoryPrivate: true,
  evidenceDirectoryOwnerVerified: true,
  bootstrapEvidenceDirectoryCanonical: true,
  bootstrapEvidenceDirectoryPrivate: true,
  bootstrapEvidenceDirectoryOwnerVerified: true,
  evidenceReadsUseNoFollow: true,
  evidenceDescriptorIdentityVerified: true,
  protectedFileOwnershipVerified: true,
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
