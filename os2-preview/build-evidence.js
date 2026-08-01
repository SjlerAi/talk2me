'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = __dirname;
const evidenceDir = path.join(root, 'build-evidence');
const packageJson = require('./package.json');
const expectedRepository = 'SjlerAi/talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const maxEvidenceFiles = 2000;
const maxEvidenceFileBytes = 16 * 1024 * 1024;
const maxEvidenceTotalBytes = 256 * 1024 * 1024;

function checksumBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function equalHex(left, right) {
  const a = Buffer.from(String(left).toLowerCase(), 'hex');
  const b = Buffer.from(String(right).toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Evidence directory must be a real directory: ${directory}`);
  if (fs.realpathSync.native(directory) !== directory) throw new Error(`Evidence directory path is not canonical: ${directory}`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error(`Evidence directory must not permit group or world access: ${directory}`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`Evidence directory owner mismatch: ${directory}`);
}

function assertSafeExistingEvidencePath() {
  if (!fs.existsSync(evidenceDir)) return;
  const stat = fs.lstatSync(evidenceDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Existing build-evidence path must be a real directory');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Existing build-evidence directory owner mismatch');
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
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`Evidence output owner mismatch: ${file}`);
  return checksumBuffer(bytes);
}

function verifySidecar(file, sidecar, expectedName) {
  const data = fs.readFileSync(file);
  const text = fs.readFileSync(sidecar, 'utf8');
  const match = text.match(/^([0-9a-f]{64})  ([^\r\n]+)\r?\n$/i);
  if (!match || match[2] !== expectedName) throw new Error(`Invalid checksum sidecar: ${sidecar}`);
  const actual = checksumBuffer(data);
  if (!equalHex(match[1], actual)) throw new Error(`Checksum verification failed: ${file}`);
  return actual;
}

function secureReadFile(file, expectedOwner) {
  const pathStat = fs.lstatSync(file);
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1) throw new Error(`Build evidence requires a regular single-link file: ${file}`);
  if (pathStat.size > maxEvidenceFileBytes) throw new Error(`Build evidence file exceeds ${maxEvidenceFileBytes} bytes: ${file}`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) throw new Error(`Build evidence source is writable by group or world: ${file}`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) throw new Error(`Build evidence source owner mismatch: ${file}`);
  if (fs.realpathSync.native(file) !== file) throw new Error(`Build evidence source path is not canonical: ${file}`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('O_NOFOLLOW is required for build evidence');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile() || descriptorStat.nlink !== 1) throw new Error(`Build evidence descriptor is not a regular single-link file: ${file}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error(`Build evidence source changed during secure open: ${file}`);
    if (descriptorStat.size !== pathStat.size) throw new Error(`Build evidence source size changed during secure open: ${file}`);
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== descriptorStat.size) throw new Error(`Build evidence source byte count changed during read: ${file}`);
    return { bytes, stat: descriptorStat };
  } finally {
    fs.closeSync(descriptor);
  }
}

function walk(directory, prefix = '', state = { files: 0, bytes: 0 }, expectedOwner = null) {
  const pathStat = fs.lstatSync(directory);
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) throw new Error(`Build evidence directory must be a real directory: ${directory}`);
  if (fs.realpathSync.native(directory) !== directory) throw new Error(`Build evidence directory path is not canonical: ${directory}`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) throw new Error(`Build evidence directory is writable by group or world: ${directory}`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) throw new Error(`Build evidence directory owner mismatch: ${directory}`);
  if (typeof fs.constants.O_DIRECTORY !== 'number' || typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('O_DIRECTORY and O_NOFOLLOW are required for build evidence traversal');
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error(`Build evidence directory changed during secure open: ${directory}`);
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (['node_modules', 'build-evidence', '.git'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) throw new Error(`Build evidence refuses symbolic link: ${relative}`);
      if (entry.isDirectory()) files.push(...walk(absolute, relative, state, expectedOwner));
      else if (entry.isFile()) {
        state.files += 1;
        if (state.files > maxEvidenceFiles) throw new Error(`Build evidence exceeds ${maxEvidenceFiles} files`);
        const stat = fs.lstatSync(absolute);
        state.bytes += stat.size;
        if (state.bytes > maxEvidenceTotalBytes) throw new Error(`Build evidence exceeds ${maxEvidenceTotalBytes} total source bytes`);
        files.push({ absolute, relative });
      } else throw new Error(`Build evidence refuses unsupported filesystem entry: ${relative}`);
    }
    const afterStat = fs.fstatSync(descriptor);
    if (afterStat.dev !== descriptorStat.dev || afterStat.ino !== descriptorStat.ino) throw new Error(`Build evidence directory identity changed during traversal: ${directory}`);
    return files;
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseBooleanEnvironment(name) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false when provided`);
}

function validateCiIdentity() {
  const runningInActions = String(process.env.GITHUB_ACTIONS || '').toLowerCase() === 'true';
  const identity = {
    runningInActions,
    repository: String(process.env.GITHUB_REPOSITORY || '').trim(),
    commitSha: String(process.env.GITHUB_SHA || '').trim().toLowerCase(),
    branch: String(process.env.GITHUB_REF_NAME || '').trim(),
    ref: String(process.env.GITHUB_REF || '').trim(),
    workflow: String(process.env.GITHUB_WORKFLOW || '').trim(),
    workflowRef: String(process.env.GITHUB_WORKFLOW_REF || '').trim(),
    runId: String(process.env.GITHUB_RUN_ID || '').trim(),
    runNumber: String(process.env.GITHUB_RUN_NUMBER || '').trim(),
    runAttempt: String(process.env.GITHUB_RUN_ATTEMPT || '').trim(),
    actor: String(process.env.GITHUB_ACTOR || '').trim()
  };
  if (!runningInActions) return identity;
  if (identity.repository !== expectedRepository) throw new Error(`Unexpected GitHub repository identity: ${identity.repository || 'missing'}`);
  if (!/^[0-9a-f]{40}$/.test(identity.commitSha)) throw new Error('GITHUB_SHA must be a full 40-character hexadecimal commit SHA');
  if (identity.branch !== expectedBranch) throw new Error(`Unexpected GitHub branch identity: ${identity.branch || 'missing'}`);
  if (identity.ref !== `refs/heads/${expectedBranch}`) throw new Error(`Unexpected GitHub ref identity: ${identity.ref || 'missing'}`);
  if (!identity.workflow || identity.workflow.length > 160 || /[\u0000-\u001f\u007f]/.test(identity.workflow)) throw new Error('GITHUB_WORKFLOW identity is invalid');
  if (!identity.workflowRef.includes(`${expectedRepository}/.github/workflows/os2-preview-ci.yml@refs/heads/${expectedBranch}`)) throw new Error('GITHUB_WORKFLOW_REF does not identify the controlled preview workflow and branch');
  for (const [name, value] of [['GITHUB_RUN_ID', identity.runId], ['GITHUB_RUN_NUMBER', identity.runNumber], ['GITHUB_RUN_ATTEMPT', identity.runAttempt]]) {
    if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  }
  if (!identity.actor || identity.actor.length > 100 || /[\u0000-\u001f\u007f]/.test(identity.actor)) throw new Error('GITHUB_ACTOR identity is invalid');
  return identity;
}

function runWorkspaceSourceIntegrity() {
  const verifierTimeoutMs = 30000;
  const result = spawnSync(process.execPath, [path.join(root, 'workspace-source-integrity.js')], {
    cwd: root,
    env: {
      ...process.env,
      PREVIEW_APP_ROOT: root,
      DB_NAME: 'kloka_talk2me',
      RELEASE_BRANCH: expectedBranch,
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
  const ciIdentity = validateCiIdentity();
  const expectedPreinstallDigest = String(process.env.EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 || '').trim().toLowerCase();
  if (ciIdentity.runningInActions && !expectedPreinstallDigest) throw new Error('EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 is required in GitHub Actions');
  if (expectedPreinstallDigest && !/^[0-9a-f]{64}$/.test(expectedPreinstallDigest)) throw new Error('EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 must be a 64-character hexadecimal SHA-256');

  const workspaceSourceIntegrity = runWorkspaceSourceIntegrity();
  const postinstallDigest = String(workspaceSourceIntegrity.inventorySha256).toLowerCase();
  if (expectedPreinstallDigest && !equalHex(expectedPreinstallDigest, postinstallDigest)) throw new Error('Protected source inventory changed between pre-install verification and build-evidence generation');

  const lockExists = fs.existsSync(path.join(root, 'package-lock.json'));
  const workflowLockState = parseBooleanEnvironment('DEPENDENCY_LOCK_PRESENT');
  if (workspaceSourceIntegrity.packageLockPresent !== lockExists) throw new Error('Workspace source-integrity lock evidence does not match the filesystem');
  if (workflowLockState !== null && workflowLockState !== lockExists) throw new Error('DEPENDENCY_LOCK_PRESENT does not match the filesystem');

  assertSafeExistingEvidencePath();
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: false, mode: 0o700 });
  assertPrivateDirectory(evidenceDir);

  const rootOwner = fs.lstatSync(root).uid;
  const files = walk(root, '', { files: 0, bytes: 0 }, rootOwner).filter(item => /\.(js|json|sql|md|yml)$/.test(item.relative)).sort((a, b) => a.relative.localeCompare(b.relative));
  const manifest = files.map(item => {
    const read = secureReadFile(item.absolute, rootOwner);
    return { path: item.relative, bytes: read.stat.size, sha256: checksumBuffer(read.bytes) };
  });

  const generatedAt = new Date().toISOString();
  const dependencyLockPresent = lockExists;
  const evidence = {
    application: 'Talk2Me OS2 integrated rebuild',
    version: packageJson.version,
    generatedAt,
    commitSha: ciIdentity.commitSha || null,
    branch: ciIdentity.branch || null,
    repository: ciIdentity.repository || null,
    gitRef: ciIdentity.ref || null,
    workflow: ciIdentity.workflow || null,
    workflowRef: ciIdentity.workflowRef || null,
    workflowRunId: ciIdentity.runId || null,
    workflowRunNumber: ciIdentity.runNumber || null,
    workflowRunAttempt: ciIdentity.runAttempt || null,
    workflowActor: ciIdentity.actor || null,
    githubActionsIdentityVerified: ciIdentity.runningInActions ? true : null,
    exactRepositoryVerified: ciIdentity.runningInActions ? true : null,
    exactCommitShaVerified: ciIdentity.runningInActions ? true : null,
    exactBranchAndRefVerified: ciIdentity.runningInActions ? true : null,
    exactWorkflowRefVerified: ciIdentity.runningInActions ? true : null,
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
    generatedAt,
    repository: ciIdentity.repository || null,
    commitSha: ciIdentity.commitSha || null,
    branch: ciIdentity.branch || null,
    gitRef: ciIdentity.ref || null,
    workflowRef: ciIdentity.workflowRef || null,
    workflowRunId: ciIdentity.runId || null,
    workflowRunAttempt: ciIdentity.runAttempt || null,
    githubActionsIdentityVerified: ciIdentity.runningInActions ? true : null,
    sourceInventorySha256: postinstallDigest,
    files: [
      { file: 'build-evidence.json', sha256: verifySidecar(jsonPath, path.join(evidenceDir, 'build-evidence.sha256'), 'build-evidence.json') },
      { file: 'workspace-source-integrity.json', sha256: verifySidecar(sourceEvidencePath, path.join(evidenceDir, 'workspace-source-integrity.sha256'), 'workspace-source-integrity.json') }
    ],
    privateDirectoryVerified: true,
    atomicPublicationVerified: true,
    checksumPairsVerified: true,
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
    migrations: evidence.migrationCount,
    repository: evidence.repository,
    commitSha: evidence.commitSha,
    branch: evidence.branch,
    workflowRunId: evidence.workflowRunId,
    workflowRunAttempt: evidence.workflowRunAttempt,
    githubActionsIdentityVerified: evidence.githubActionsIdentityVerified,
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
    evidenceChecksumPairsVerified: true
  }, null, 2));
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({ ok: false, check: 'build-evidence', error: error.message }, null, 2));
  process.exit(1);
}
