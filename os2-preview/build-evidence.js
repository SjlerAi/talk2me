'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = __dirname;
const evidenceDir = path.join(root, 'build-evidence');
const packageJson = require('./package.json');
const maxManifestFiles = 2000;
const maxManifestFileBytes = 16 * 1024 * 1024;
const maxManifestTotalBytes = 256 * 1024 * 1024;

function checksumBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function equalHex(left, right) {
  const a = Buffer.from(String(left).toLowerCase(), 'hex');
  const b = Buffer.from(String(right).toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function assertCanonicalDirectory(directory, label, expectedOwner, requirePrivate = false) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real non-symlink directory: ${directory}`);
  if (fs.realpathSync.native(directory) !== directory) throw new Error(`${label} path is not canonical: ${directory}`);
  if (process.platform !== 'win32') {
    if ((stat.mode & 0o022) !== 0) throw new Error(`${label} must not be writable by group or world: ${directory}`);
    if (requirePrivate && (stat.mode & 0o077) !== 0) throw new Error(`${label} must not permit group or world access: ${directory}`);
    if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) throw new Error(`${label} owner mismatch: ${directory}`);
  }
  if (typeof fs.constants.O_DIRECTORY !== 'number' || typeof fs.constants.O_NOFOLLOW !== 'number') {
    throw new Error('O_DIRECTORY and O_NOFOLLOW are required for build-evidence directory validation');
  }
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isDirectory()) throw new Error(`${label} descriptor is not a directory: ${directory}`);
    if (descriptorStat.dev !== stat.dev || descriptorStat.ino !== stat.ino) throw new Error(`${label} changed during secure open: ${directory}`);
    if (process.platform !== 'win32') {
      if ((descriptorStat.mode & 0o022) !== 0) throw new Error(`${label} descriptor is writable by group or world: ${directory}`);
      if (requirePrivate && (descriptorStat.mode & 0o077) !== 0) throw new Error(`${label} descriptor permits group or world access: ${directory}`);
      if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) throw new Error(`${label} descriptor owner mismatch: ${directory}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return stat;
}

function assertPrivateDirectory(directory) {
  assertCanonicalDirectory(directory, 'Evidence directory', currentUid(), true);
}

function atomicWrite(file, buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== null && descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`Evidence output is not a regular single-link file: ${file}`);
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) throw new Error(`Evidence output permissions must be 0600: ${file}`);
  if (Number.isInteger(currentUid()) && stat.uid !== currentUid()) throw new Error(`Evidence output owner mismatch: ${file}`);
  return checksumBuffer(bytes);
}

function readSecureFile(file, label, expectedOwner, maxBytes) {
  const pathStat = fs.lstatSync(file);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${file}`);
  if (pathStat.nlink !== 1) throw new Error(`${label} must not have additional hard links: ${file}`);
  if (pathStat.size > maxBytes) throw new Error(`${label} exceeds the permitted size: ${file}`);
  if (fs.realpathSync.native(file) !== file) throw new Error(`${label} path is not canonical: ${file}`);
  if (process.platform !== 'win32') {
    if ((pathStat.mode & 0o022) !== 0) throw new Error(`${label} is writable by group or world: ${file}`);
    if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) throw new Error(`${label} owner mismatch: ${file}`);
  }
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) throw new Error(`${label} descriptor is not a regular file: ${file}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error(`${label} changed during secure open: ${file}`);
    if (descriptorStat.nlink !== 1) throw new Error(`${label} descriptor has additional hard links: ${file}`);
    if (descriptorStat.size > maxBytes) throw new Error(`${label} descriptor exceeds the permitted size: ${file}`);
    if (process.platform !== 'win32') {
      if ((descriptorStat.mode & 0o022) !== 0) throw new Error(`${label} descriptor is writable by group or world: ${file}`);
      if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) throw new Error(`${label} descriptor owner mismatch: ${file}`);
    }
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== descriptorStat.size) throw new Error(`${label} byte count changed during secure read: ${file}`);
    return { bytes, stat: descriptorStat };
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifySidecar(file, sidecar, expectedName) {
  const owner = currentUid();
  const data = readSecureFile(file, 'Evidence file', owner, 32 * 1024 * 1024).bytes;
  const text = readSecureFile(sidecar, 'Evidence checksum', owner, 4096).bytes.toString('utf8');
  const match = text.match(/^([0-9a-f]{64})  ([^\r\n]+)\r?\n$/i);
  if (!match || match[2] !== expectedName) throw new Error(`Invalid checksum sidecar: ${sidecar}`);
  const actual = checksumBuffer(data);
  if (!equalHex(match[1], actual)) throw new Error(`Checksum verification failed: ${file}`);
  return actual;
}

function walk(directory, prefix, expectedOwner, state) {
  assertCanonicalDirectory(directory, 'Manifest source directory', expectedOwner, false);
  const before = fs.lstatSync(directory);
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    if (['node_modules', 'build-evidence', '.git'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
    if (entry.isSymbolicLink()) throw new Error(`Build evidence refuses symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...walk(absolute, relative, expectedOwner, state));
    else if (entry.isFile()) {
      state.fileCount += 1;
      if (state.fileCount > maxManifestFiles) throw new Error(`Build evidence file count exceeds ${maxManifestFiles}`);
      files.push({ absolute, relative });
    } else throw new Error(`Build evidence refuses unsupported filesystem entry: ${relative}`);
  }
  const after = fs.lstatSync(directory);
  if (after.dev !== before.dev || after.ino !== before.ino) throw new Error(`Manifest source directory changed during traversal: ${directory}`);
  return files;
}

function parseBooleanEnvironment(name) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false when provided`);
}

function runWorkspaceSourceIntegrity() {
  const verifierTimeoutMs = 30000;
  const result = spawnSync(process.execPath, [path.join(root, 'workspace-source-integrity.js')], {
    cwd: root,
    env: {
      ...process.env,
      PREVIEW_APP_ROOT: root,
      DB_NAME: 'kloka_talk2me',
      RELEASE_BRANCH: 'agent/talk2me-os2-integrated-rebuild',
      ALLOW_PRODUCTION_MUTATION: 'false',
      ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: verifierTimeoutMs,
    killSignal: 'SIGKILL',
    shell: false,
    windowsHide: true
  });
  if (result.error && result.error.code === 'ETIMEDOUT') throw new Error(`Workspace source integrity exceeded ${verifierTimeoutMs}ms`);
  if (result.error) throw new Error(`Workspace source integrity could not start: ${result.error.message}`);
  if (result.signal) throw new Error(`Workspace source integrity was interrupted by signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`Workspace source integrity failed with status ${result.status}: ${String(result.stderr || '').trim()}`);
  let parsed;
  try { parsed = JSON.parse(String(result.stdout || '').trim()); }
  catch { throw new Error('Workspace source integrity output is not valid JSON'); }
  if (parsed.ok !== true || !/^[0-9a-f]{64}$/i.test(String(parsed.inventorySha256 || ''))) throw new Error('Workspace source integrity output is incomplete');
  if (typeof parsed.packageLockPresent !== 'boolean') throw new Error('Workspace source integrity lock evidence is invalid');
  return parsed;
}

function main() {
  const expectedPreinstallDigest = String(process.env.EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 || '').trim().toLowerCase();
  const runningInActions = String(process.env.GITHUB_ACTIONS || '').toLowerCase() === 'true';
  if (runningInActions && !expectedPreinstallDigest) throw new Error('EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 is required in GitHub Actions');
  if (expectedPreinstallDigest && !/^[0-9a-f]{64}$/.test(expectedPreinstallDigest)) throw new Error('EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 must be a 64-character hexadecimal SHA-256');

  const rootStat = assertCanonicalDirectory(root, 'Application root', currentUid(), false);
  const owner = rootStat.uid;
  const workspaceSourceIntegrity = runWorkspaceSourceIntegrity();
  const postinstallDigest = String(workspaceSourceIntegrity.inventorySha256).toLowerCase();
  if (expectedPreinstallDigest && !equalHex(expectedPreinstallDigest, postinstallDigest)) throw new Error('Protected source inventory changed between pre-install verification and build-evidence generation');

  const lockExists = fs.existsSync(path.join(root, 'package-lock.json'));
  const workflowLockState = parseBooleanEnvironment('DEPENDENCY_LOCK_PRESENT');
  if (workspaceSourceIntegrity.packageLockPresent !== lockExists) throw new Error('Workspace source-integrity lock evidence does not match the filesystem');
  if (workflowLockState !== null && workflowLockState !== lockExists) throw new Error('DEPENDENCY_LOCK_PRESENT does not match the filesystem');

  if (fs.existsSync(evidenceDir)) {
    const existing = fs.lstatSync(evidenceDir);
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('Existing build-evidence path must be a real directory');
    if (process.platform !== 'win32' && existing.uid !== owner) throw new Error('Existing build-evidence directory owner mismatch');
    fs.rmSync(evidenceDir, { recursive: true, force: false });
  }
  fs.mkdirSync(evidenceDir, { recursive: false, mode: 0o700 });
  assertPrivateDirectory(evidenceDir);

  const traversalState = { fileCount: 0 };
  const files = walk(root, '', owner, traversalState)
    .filter(item => /\.(js|json|sql|md)$/.test(item.relative))
    .sort((a, b) => a.relative.localeCompare(b.relative));
  let manifestTotalBytes = 0;
  const manifest = files.map(item => {
    const secure = readSecureFile(item.absolute, 'Build evidence source', owner, maxManifestFileBytes);
    manifestTotalBytes += secure.bytes.length;
    if (manifestTotalBytes > maxManifestTotalBytes) throw new Error(`Build evidence source bytes exceed ${maxManifestTotalBytes}`);
    return { path: item.relative, bytes: secure.bytes.length, sha256: checksumBuffer(secure.bytes) };
  });
  assertCanonicalDirectory(root, 'Application root', owner, false);

  const dependencyLockPresent = lockExists;
  const evidence = {
    application: 'Talk2Me OS2 integrated rebuild',
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    commitSha: process.env.GITHUB_SHA || null,
    branch: process.env.GITHUB_REF_NAME || null,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    workflowRunNumber: process.env.GITHUB_RUN_NUMBER || null,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    dependencyLockPresent,
    dependencyAuditEligible: dependencyLockPresent,
    releaseCandidateEligible: dependencyLockPresent,
    dependencyLockStateVerifiedAgainstFilesystem: true,
    dependencyLockStateVerifiedAgainstSourceIntegrity: true,
    workspaceSourceIntegrityVerified: true,
    preinstallWorkspaceSourceInventorySha256: expectedPreinstallDigest || null,
    postinstallWorkspaceSourceInventorySha256: postinstallDigest,
    workspaceSourceIntegrityStableAcrossDependencyInstall: expectedPreinstallDigest ? true : null,
    workspaceSourceInventorySha256: postinstallDigest,
    workspaceSourceProtectedFileCount: workspaceSourceIntegrity.protectedFileCount,
    workspaceSourceMigrationCount: workspaceSourceIntegrity.migrationCount,
    workspaceSourcePackageLockPresent: workspaceSourceIntegrity.packageLockPresent,
    workspaceSourceIntegrity,
    fileCount: manifest.length,
    sourceBytes: manifestTotalBytes,
    manifestFileLimit: maxManifestFiles,
    manifestFileByteLimit: maxManifestFileBytes,
    manifestTotalByteLimit: maxManifestTotalBytes,
    secureManifestDescriptorReads: true,
    manifestDirectoryIdentityRechecked: true,
    migrationCount: manifest.filter(item => item.path.startsWith('migrations/') && item.path.endsWith('.sql')).length,
    routeFileCount: manifest.filter(item => item.path.endsWith('-routes.js')).length,
    checkFileCount: manifest.filter(item => item.path.endsWith('-check.js')).length,
    manifest
  };

  const sourceEvidencePath = path.join(evidenceDir, 'workspace-source-integrity.json');
  const sourceDigest = atomicWrite(sourceEvidencePath, JSON.stringify(workspaceSourceIntegrity, null, 2) + '\n');
  atomicWrite(path.join(evidenceDir, 'workspace-source-integrity.sha256'), `${sourceDigest}  workspace-source-integrity.json\n`);

  const jsonPath = path.join(evidenceDir, 'build-evidence.json');
  const buildDigest = atomicWrite(jsonPath, JSON.stringify(evidence, null, 2) + '\n');
  atomicWrite(path.join(evidenceDir, 'build-evidence.sha256'), `${buildDigest}  build-evidence.json\n`);

  const artifactManifest = {
    application: 'talk2me-os2-preview',
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    files: [
      { file: 'build-evidence.json', sha256: verifySidecar(jsonPath, path.join(evidenceDir, 'build-evidence.sha256'), 'build-evidence.json') },
      { file: 'workspace-source-integrity.json', sha256: verifySidecar(sourceEvidencePath, path.join(evidenceDir, 'workspace-source-integrity.sha256'), 'workspace-source-integrity.json') }
    ],
    privateDirectoryVerified: true,
    atomicPublicationVerified: true,
    checksumPairsVerified: true,
    secureManifestDescriptorReads: true,
    boundedManifestCollection: true,
    productionMutationEnabled: false,
    mergeExecutionEnabled: false
  };
  const artifactManifestPath = path.join(evidenceDir, 'artifact-manifest.json');
  const artifactManifestDigest = atomicWrite(artifactManifestPath, JSON.stringify(artifactManifest, null, 2) + '\n');
  atomicWrite(path.join(evidenceDir, 'artifact-manifest.sha256'), `${artifactManifestDigest}  artifact-manifest.json\n`);
  verifySidecar(artifactManifestPath, path.join(evidenceDir, 'artifact-manifest.sha256'), 'artifact-manifest.json');
  assertPrivateDirectory(evidenceDir);

  console.log(JSON.stringify({
    ok: true,
    version: evidence.version,
    files: evidence.fileCount,
    sourceBytes: evidence.sourceBytes,
    migrations: evidence.migrationCount,
    dependencyLockPresent: evidence.dependencyLockPresent,
    dependencyLockStateVerified: true,
    workspaceSourceIntegrityVerified: true,
    workspaceSourceIntegrityStableAcrossDependencyInstall: evidence.workspaceSourceIntegrityStableAcrossDependencyInstall,
    preinstallWorkspaceSourceInventorySha256: evidence.preinstallWorkspaceSourceInventorySha256,
    postinstallWorkspaceSourceInventorySha256: evidence.postinstallWorkspaceSourceInventorySha256,
    workspaceSourceEvidenceSha256: sourceDigest,
    buildEvidenceSha256: buildDigest,
    artifactManifestSha256: artifactManifestDigest,
    evidenceDirectoryPrivate: true,
    evidenceFilesAtomic: true,
    evidenceChecksumPairsVerified: true,
    secureManifestDescriptorReads: true,
    boundedManifestCollection: true
  }, null, 2));
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({ ok: false, check: 'build-evidence', error: error.message }, null, 2));
  process.exit(1);
}
