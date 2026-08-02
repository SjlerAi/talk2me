'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'release-manifest-verification', error: message }, null, 2));
  process.exit(1);
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function equalHex(left, right) {
  const a = Buffer.from(String(left).toLowerCase(), 'hex');
  const b = Buffer.from(String(right).toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validateReleaseText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is missing`);
  if (value !== value.trim()) fail(`${label} must not contain leading or trailing whitespace`);
  if (value.length > maxLength) fail(`${label} must not exceed ${maxLength} characters`);
  if (/[^\P{C}\t]/u.test(value) || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must not contain control characters`);
}
function validatePrivateDirectory(directory, label) {
  let stat;
  try { stat = fs.lstatSync(directory); } catch { fail(`${label} is missing: ${directory}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real non-symlink directory: ${directory}`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail(`${label} must not permit group or world access: ${directory}`);
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail(`${label} must be owned by the executing user: ${directory}`);
  if (fs.realpathSync.native(directory) !== directory) fail(`${label} path is not canonical: ${directory}`);
  if (typeof fs.constants.O_DIRECTORY !== 'number' || typeof fs.constants.O_NOFOLLOW !== 'number') fail('O_DIRECTORY and O_NOFOLLOW are required for secure release directory verification');
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isDirectory()) fail(`${label} descriptor is not a directory: ${directory}`);
    if (descriptorStat.dev !== stat.dev || descriptorStat.ino !== stat.ino) fail(`${label} changed during secure open: ${directory}`);
    return { dev: descriptorStat.dev, ino: descriptorStat.ino, uid: descriptorStat.uid };
  } finally { fs.closeSync(descriptor); }
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
    if (descriptorStat.size !== pathStat.size) fail(`${label} size changed during secure open: ${file}`);
    if (descriptorStat.size > maxBytes) fail(`${label} exceeds the maximum permitted size: ${file}`);
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== descriptorStat.size) fail(`${label} byte count changed during secure read: ${file}`);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
function verifyChecksumPair(file, label, maxBytes) {
  const data = readSecureRegularFile(file, { label, expectedMode: 0o600, maxBytes });
  const sidecar = readSecureRegularFile(`${file}.sha256`, { label: `${label} checksum`, expectedMode: 0o600, maxBytes: 4096 });
  const match = sidecar.toString('utf8').match(/^([0-9a-f]{64})  ([^\r\n]+)\r?\n$/i);
  if (!match || match[2] !== path.basename(file)) fail(`${label} checksum file has an invalid format`);
  const actual = sha256(data);
  if (!equalHex(match[1], actual)) fail(`${label} checksum verification failed`);
  return { data, dataSha256: actual, sidecarSha256: sha256(sidecar) };
}
function requireExactArray(actual, expected, label) {
  if (!Array.isArray(actual)) fail(`${label} must be an array`);
  if (actual.length !== expected.length) fail(`${label} length mismatch`);
  const unique = new Set(actual);
  if (unique.size !== actual.length) fail(`${label} must not contain duplicates`);
  for (let index = 0; index < expected.length; index += 1) if (actual[index] !== expected[index]) fail(`${label} order mismatch at index ${index}: expected ${expected[index]}`);
}
function validateCanonicalIso(value, label) {
  if (typeof value !== 'string' || !value) fail(`${label} is missing`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(`${label} timestamp is invalid`);
  if (new Date(parsed).toISOString() !== value) fail(`${label} must use canonical UTC ISO-8601 format`);
  return parsed;
}
function verifyFrozenSource(root, inventorySha256) {
  const verifierTimeoutMs = 30000;
  const allowedEnv = {};
  for (const key of ['PATH','HOME','USER','LOGNAME','TMPDIR','TEMP','TMP','LANG','LC_ALL','TZ','CI','GITHUB_ACTIONS']) if (typeof process.env[key] === 'string' && process.env[key]) allowedEnv[key] = process.env[key];
  Object.assign(allowedEnv, {
    PREVIEW_APP_ROOT: root,
    DB_NAME: 'kloka_talk2me',
    RELEASE_BRANCH: 'agent/talk2me-os2-integrated-rebuild',
    RELEASE_SOURCE_INVENTORY_SHA256: inventorySha256,
    ALLOW_PRODUCTION_MUTATION: 'false',
    ENABLE_CUSTOMER_MERGE_EXECUTION: 'false',
    NODE_ENV: 'production'
  });
  const result = spawnSync(process.execPath, [path.join(root, 'release-source-integrity-verification.js')], {
    cwd: root,
    env: Object.freeze(allowedEnv),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: verifierTimeoutMs,
    killSignal: 'SIGKILL',
    shell: false,
    windowsHide: true
  });
  if (result.error && result.error.code === 'ETIMEDOUT') fail(`Post-freeze source verifier exceeded ${verifierTimeoutMs}ms`);
  if (result.error) fail(`Post-freeze source verifier could not start: ${result.error.message}`);
  if (result.signal) fail(`Post-freeze source verifier was interrupted by signal ${result.signal}`);
  if (result.status !== 0) fail(`Post-freeze source verifier failed with status ${result.status}: ${String(result.stderr || '').trim()}`);
  let evidence;
  try { evidence = JSON.parse(String(result.stdout || '').trim()); } catch { fail('Post-freeze source verifier did not return valid JSON'); }
  if (evidence.ok !== true || evidence.exactApprovedInventoryMatched !== true) fail('Post-freeze source verifier did not confirm the approved inventory');
  if (String(evidence.inventorySha256 || '').toLowerCase() !== inventorySha256.toLowerCase()) fail('Post-freeze source verifier returned a different inventory digest');
  if (evidence.packageLockPresent !== true) fail('Post-freeze source verifier did not confirm the dependency lock');
  return evidence;
}

const root = __dirname;
const expectedPreviewVersion = '0.60.0';
const expectedApplication = 'talk2me-os2-preview';
const expectedReleaseBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedDatabase = 'kloka_talk2me';
const expectedBootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql';
const expectedRestorePinMigration = '20260801_025_merge_authorisation_restore_pin.sql';
const expectedPreviewDataOrder = ['schema-verification.js', 'merge-restore-evidence-verification.js'];
const expectedRequiredFiles = [expectedBootstrapFile,'migration-ledger-bootstrap-evidence-verification.js','migration-ledger-bootstrap-evidence-check.js','migration-runner-security-check.js','workspace-topology-governance-check.js','workspace-source-integrity.js','release-source-integrity-verification.js','release-source-integrity-check.js','preview-activation-governance-check.js','release-evidence-security-check.js','deployment-check.js','uat-gate-check.js','schema-verification.js','preview-data-verification.js','merge-restore-evidence-verification.js',`migrations/${expectedRestorePinMigration}`];
const expectedRequiredScripts = ['verify:migration-ledger-bootstrap-evidence','migrate:preview','verify:preview-data','check:migration-ledger-bootstrap-evidence','check:migration-runner-security','check:workspace-topology-governance','check:preview-activation-governance','check:release-evidence-security','check:readiness','check:deployment','check:uat-gate'];

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

if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('Release manifest root must be an object');
if (manifest.ok !== true) fail('Release manifest is not marked successful');
if (manifest.application !== expectedApplication) fail('Release manifest application identity is invalid');
if (manifest.version !== expectedPreviewVersion) fail(`Release manifest version must be ${expectedPreviewVersion}`);
if (manifest.branch !== expectedReleaseBranch || manifest.branch !== verifiedBranch) fail('Release manifest branch does not match the verified branch');
if (String(manifest.commitSha || '').toLowerCase() !== verifiedCommitSha.toLowerCase()) fail('Release manifest commit SHA does not match the verified commit SHA');
if (manifest.commitIdentityVerified !== true) fail('Release manifest commit identity is not verified');
validateReleaseText(manifest.approvedBy, 'Release manifest approver evidence', 160);
validateReleaseText(manifest.changeReference, 'Release manifest change reference', 240);
const generatedAtMs = validateCanonicalIso(manifest.generatedAt, 'Release manifest generatedAt');
if (generatedAtMs > Date.now() + 5 * 60 * 1000) fail('Release manifest generatedAt timestamp is unreasonably in the future');
if (generatedAtMs < Date.now() - 30 * 24 * 60 * 60 * 1000) fail('Release manifest is older than the permitted 30-day verification window');
if (manifest.dependencyLockPresent !== true) fail('Release manifest does not confirm a committed dependency lock');
for (const [name, value] of [['packageJsonSha256', manifest.packageJsonSha256],['dependencyLockSha256', manifest.dependencyLockSha256],['approvedSourceInventorySha256', manifest.approvedSourceInventorySha256],['migrationLedgerBootstrapSha256', manifest.migrationLedgerBootstrapSha256]]) if (!/^[0-9a-f]{64}$/i.test(String(value || ''))) fail(`Release manifest ${name} is invalid`);
if (manifest.releaseSourceIntegrityVerified !== true || manifest.releaseSourcePackageLockPresent !== true) fail('Release manifest source-integrity evidence is incomplete');
if (!Number.isInteger(manifest.releaseSourceProtectedFileCount) || manifest.releaseSourceProtectedFileCount < 25) fail('Release source protected-file count is invalid');
if (!Number.isInteger(manifest.releaseSourceMigrationCount) || manifest.releaseSourceMigrationCount < 25) fail('Release source migration count is invalid');
if (manifest.migrationLedgerBootstrapFile !== expectedBootstrapFile) fail('Release manifest migration-ledger bootstrap filename is invalid');
if (manifest.migrationLedgerBootstrapEvidenceVerified !== true || manifest.bootstrapEvidenceVerifiedBeforeReleaseFreeze !== true) fail('Release manifest bootstrap evidence verification is incomplete');
if (manifest.runtimeLedgerCreationDisabled !== true) fail('Release manifest must disable runtime ledger creation');
if (manifest.migrationCompletionRequiresConfirmedLockRelease !== true) fail('Release manifest must require confirmed migration lock release');
if (manifest.migrationConnectionClosedBeforeSuccess !== true) fail('Release manifest must require migration connection closure before success');
if (manifest.productionMutationEnabled !== false || manifest.mergeExecutionEnabled !== false) fail('Release manifest execution safety flags are invalid');
if (!Array.isArray(manifest.failures) || manifest.failures.length !== 0) fail('Release manifest contains blocking failures');
if (manifest.restorePinMigration !== expectedRestorePinMigration) fail('Release manifest restore-pin migration identity is invalid');
if (manifest.previewDataVerificationRequired !== true) fail('Release manifest must require preview data verification');
requireExactArray(manifest.previewDataVerificationOrder, expectedPreviewDataOrder, 'Preview data verification order');
requireExactArray(manifest.requiredFiles, expectedRequiredFiles, 'Required release files');
requireExactArray(manifest.requiredScripts, expectedRequiredScripts, 'Required package scripts');
if (!Number.isInteger(manifest.migrationCount) || manifest.migrationCount < 25) fail('Release manifest migrationCount is invalid');

const bootstrapEvidencePath = String(manifest.migrationLedgerBootstrapEvidencePath || '');
if (!path.isAbsolute(bootstrapEvidencePath) || path.normalize(bootstrapEvidencePath) !== bootstrapEvidencePath) fail('Release manifest bootstrap evidence path is invalid');
if (bootstrapEvidencePath === manifestPath || `${bootstrapEvidencePath}.sha256` === `${manifestPath}.sha256`) fail('Bootstrap evidence path must differ from release manifest path');
validatePrivateDirectory(path.dirname(bootstrapEvidencePath), 'Bootstrap evidence directory');
if (!/^[0-9a-f]{64}$/i.test(String(manifest.migrationLedgerBootstrapEvidenceSha256 || '')) || !/^[0-9a-f]{64}$/i.test(String(manifest.migrationLedgerBootstrapEvidenceSidecarSha256 || ''))) fail('Release manifest bootstrap evidence checksums are invalid');

const sourceEvidence = verifyFrozenSource(root, manifest.approvedSourceInventorySha256);
if (sourceEvidence.protectedFileCount !== manifest.releaseSourceProtectedFileCount) fail('Release source protected-file count changed after freeze');
if (sourceEvidence.migrationCount !== manifest.releaseSourceMigrationCount) fail('Release source migration count changed after freeze');

const packageBytes = readSecureRegularFile(path.join(root, 'package.json'), { label: 'Checked-out package.json', maxBytes: 1024 * 1024 });
let packageJson;
try { packageJson = JSON.parse(packageBytes.toString('utf8')); } catch { fail('Checked-out package.json is invalid JSON'); }
if (packageJson.name !== expectedApplication || packageJson.version !== expectedPreviewVersion) fail('Checked-out package identity differs from the release manifest contract');
if (!equalHex(sha256(packageBytes), manifest.packageJsonSha256)) fail('Release manifest package.json checksum does not match the checked-out package.json');
for (const script of expectedRequiredScripts) if (typeof packageJson.scripts?.[script] !== 'string' || !packageJson.scripts[script]) fail(`Checked-out package.json is missing required script: ${script}`);

const lockBytes = readSecureRegularFile(path.join(root, 'package-lock.json'), { label: 'Checked-out package-lock.json', maxBytes: 16 * 1024 * 1024 });
let lockJson;
try { lockJson = JSON.parse(lockBytes.toString('utf8')); } catch { fail('Checked-out package-lock.json is invalid JSON'); }
if (lockJson.name !== expectedApplication || lockJson.version !== expectedPreviewVersion) fail('Checked-out dependency lock identity differs from the package identity');
if (!Number.isInteger(lockJson.lockfileVersion) || lockJson.lockfileVersion < 2) fail('Checked-out dependency lockfileVersion is unsupported');
if (!equalHex(sha256(lockBytes), manifest.dependencyLockSha256)) fail('Release manifest dependency-lock checksum does not match the checked-out package-lock.json');

const bootstrapBytes = readSecureRegularFile(path.join(root, expectedBootstrapFile), { label: 'Checked-out migration ledger bootstrap', maxBytes: 1024 * 1024 });
if (!equalHex(sha256(bootstrapBytes), manifest.migrationLedgerBootstrapSha256)) fail('Release manifest migration-ledger bootstrap checksum does not match the checked-out source');

const bootstrapPair = verifyChecksumPair(bootstrapEvidencePath, 'Migration ledger bootstrap evidence', 4 * 1024 * 1024);
if (!equalHex(bootstrapPair.dataSha256, manifest.migrationLedgerBootstrapEvidenceSha256)) fail('Bootstrap evidence file changed after release freeze');
if (!equalHex(bootstrapPair.sidecarSha256, manifest.migrationLedgerBootstrapEvidenceSidecarSha256)) fail('Bootstrap evidence checksum sidecar changed after release freeze');
let bootstrapEvidence;
try { bootstrapEvidence = JSON.parse(bootstrapPair.data.toString('utf8')); } catch { fail('Bootstrap execution evidence is not valid JSON'); }
if (!bootstrapEvidence || typeof bootstrapEvidence !== 'object' || Array.isArray(bootstrapEvidence)) fail('Bootstrap execution evidence root must be an object');
if (bootstrapEvidence.ok !== true || bootstrapEvidence.check !== 'migration-ledger-bootstrap-runner') fail('Bootstrap execution evidence success identity is invalid');
if (bootstrapEvidence.database !== expectedDatabase || bootstrapEvidence.bootstrapFile !== expectedBootstrapFile) fail('Bootstrap execution evidence target identity is invalid');
if (!equalHex(bootstrapEvidence.bootstrapSha256, manifest.migrationLedgerBootstrapSha256)) fail('Bootstrap execution evidence is not bound to the frozen bootstrap source');
validateReleaseText(bootstrapEvidence.verifiedBackupReference, 'Verified backup reference', 240);
if (!/^[0-9a-f]{64}$/i.test(String(bootstrapEvidence.verifiedBackupSha256 || ''))) fail('Verified backup SHA-256 is invalid');
validateReleaseText(bootstrapEvidence.operator, 'Bootstrap operator', 160);
validateReleaseText(bootstrapEvidence.changeReference, 'Bootstrap change reference', 240);
if (bootstrapEvidence.preexistingLedgerTableCount !== 0 || bootstrapEvidence.createdLedgerTableCount !== 1) fail('Bootstrap execution evidence table counts are invalid');
if (bootstrapEvidence.ledgerSchemaVerified !== true || bootstrapEvidence.ledgerRowCount !== 0 || bootstrapEvidence.ledgerEmpty !== true) fail('Bootstrap execution evidence does not prove a verified empty ledger');
if (bootstrapEvidence.advisoryLockUsed !== true || bootstrapEvidence.advisoryLockOwnerVerified !== true || bootstrapEvidence.advisoryLockReleased !== true) fail('Bootstrap execution evidence advisory-lock lifecycle is incomplete');
const bootstrapStartedAt = validateCanonicalIso(bootstrapEvidence.startedAt, 'Bootstrap startedAt');
const bootstrapCompletedAt = validateCanonicalIso(bootstrapEvidence.completedAt, 'Bootstrap completedAt');
if (bootstrapCompletedAt < bootstrapStartedAt) fail('Bootstrap completion precedes bootstrap start');
if (bootstrapCompletedAt > generatedAtMs) fail('Release manifest was generated before bootstrap completion');
if (bootstrapEvidence.productionMutationEnabled !== false || bootstrapEvidence.mergeExecutionEnabled !== false) fail('Bootstrap execution evidence safety flags are invalid');

const migrationsDirectory = path.join(root, 'migrations');
const migrationDirectoryIdentity = validatePrivateDirectory(migrationsDirectory, 'Migrations directory');
const actualMigrations = fs.readdirSync(migrationsDirectory).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
const migrationDirectoryAfter = fs.lstatSync(migrationsDirectory);
if (migrationDirectoryAfter.dev !== migrationDirectoryIdentity.dev || migrationDirectoryAfter.ino !== migrationDirectoryIdentity.ino) fail('Migrations directory changed during release verification');
if (manifest.migrationCount !== actualMigrations.length) fail('Release manifest migrationCount does not match the workspace');
if (manifest.releaseSourceMigrationCount !== actualMigrations.length) fail('Release source migration count does not match the workspace');
if (!actualMigrations.includes(expectedRestorePinMigration)) fail('Required restore-pin migration is missing from the workspace');
if (!Array.isArray(manifest.migrationChecksums) || manifest.migrationChecksums.length !== actualMigrations.length) fail('Release manifest migration inventory does not match the workspace');
const seenMigrationFiles = new Set();
for (let index = 0; index < actualMigrations.length; index += 1) {
  const file = actualMigrations[index];
  const evidence = manifest.migrationChecksums[index];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail(`Release manifest migration evidence is invalid: ${file}`);
  if (evidence.file !== file) fail(`Release manifest migration order mismatch: ${file}`);
  if (seenMigrationFiles.has(evidence.file)) fail(`Release manifest contains duplicate migration evidence: ${file}`);
  seenMigrationFiles.add(evidence.file);
  if (!/^[0-9a-f]{64}$/i.test(String(evidence.sha256 || ''))) fail(`Release manifest migration checksum format is invalid: ${file}`);
  const bytes = readSecureRegularFile(path.join(migrationsDirectory, file), { label: 'Checked-out migration', maxBytes: 4 * 1024 * 1024 });
  if (!equalHex(sha256(bytes), evidence.sha256)) fail(`Release manifest migration checksum mismatch: ${file}`);
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
  canonicalGeneratedAtVerified: true,
  releaseMetadataValidated: true,
  exactRequiredFilesVerified: true,
  exactRequiredScriptsVerified: true,
  exactPreviewDataVerificationOrderVerified: true,
  exactRestorePinMigrationVerified: true,
  manifestMigrationCountVerified: true,
  releaseSourceCountsReconciled: true,
  releaseSourceIntegrityReverifiedAfterFreeze: true,
  releaseSourceChildEnvironmentSanitized: true,
  releaseSourceProtectedFileCount: sourceEvidence.protectedFileCount,
  releaseSourceMigrationCount: sourceEvidence.migrationCount,
  evidenceDirectoryDescriptorIdentityVerified: true,
  bootstrapEvidenceDirectoryDescriptorIdentityVerified: true,
  migrationsDirectoryDescriptorIdentityVerified: true,
  evidenceReadsUseNoFollow: true,
  evidenceDescriptorIdentityVerified: true,
  evidenceReadByteCountVerified: true,
  protectedFileOwnershipVerified: true,
  protectedFileSizeLimitsEnforced: true,
  packageIdentityMatchesManifest: true,
  requiredPackageScriptsVerified: true,
  dependencyLockIdentityMatchesPackage: true,
  dependencyLockVersionSupported: true,
  packageManifestMatchesWorkspace: true,
  dependencyLockMatchesWorkspace: true,
  migrationLedgerBootstrapMatchesWorkspace: true,
  bootstrapExecutionEvidenceMatchesFrozenManifest: true,
  bootstrapExecutionEvidenceMatchesWorkspace: true,
  bootstrapBackupEvidenceValidated: true,
  bootstrapOperatorEvidenceValidated: true,
  bootstrapChangeReferenceValidated: true,
  bootstrapTimelineValidated: true,
  bootstrapEvidenceVerifiedBeforeReleaseFreeze: true,
  migrationInventoryUnique: true,
  migrationInventoryMatchesWorkspace: true,
  migrationCount: actualMigrations.length,
  runtimeLedgerCreationDisabled: true,
  migrationCompletionRequiresConfirmedLockRelease: true,
  migrationConnectionClosedBeforeSuccess: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
