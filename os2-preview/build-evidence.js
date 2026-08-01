'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = __dirname;
const evidenceDir = path.join(root, 'build-evidence');
const packageJson = require('./package.json');

function walk(directory, prefix = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['node_modules', 'build-evidence', '.git'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
    if (entry.isSymbolicLink()) throw new Error(`Build evidence refuses symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...walk(absolute, relative));
    else if (entry.isFile()) files.push({ absolute, relative });
    else throw new Error(`Build evidence refuses unsupported filesystem entry: ${relative}`);
  }
  return files;
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function equalHex(left, right) {
  const a = Buffer.from(String(left).toLowerCase(), 'hex');
  const b = Buffer.from(String(right).toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  if (parsed.ok !== true || !/^[0-9a-f]{64}$/i.test(String(parsed.inventorySha256 || ''))) {
    throw new Error('Workspace source integrity output is incomplete');
  }
  if (typeof parsed.packageLockPresent !== 'boolean') throw new Error('Workspace source integrity lock evidence is invalid');
  return parsed;
}

function main() {
  const expectedPreinstallDigest = String(process.env.EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 || '').trim().toLowerCase();
  const runningInActions = String(process.env.GITHUB_ACTIONS || '').toLowerCase() === 'true';
  if (runningInActions && !expectedPreinstallDigest) {
    throw new Error('EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 is required in GitHub Actions');
  }
  if (expectedPreinstallDigest && !/^[0-9a-f]{64}$/.test(expectedPreinstallDigest)) {
    throw new Error('EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256 must be a 64-character hexadecimal SHA-256');
  }

  const workspaceSourceIntegrity = runWorkspaceSourceIntegrity();
  const postinstallDigest = String(workspaceSourceIntegrity.inventorySha256).toLowerCase();
  if (expectedPreinstallDigest && !equalHex(expectedPreinstallDigest, postinstallDigest)) {
    throw new Error('Protected source inventory changed between pre-install verification and build-evidence generation');
  }

  const lockExists = fs.existsSync(path.join(root, 'package-lock.json'));
  const workflowLockState = parseBooleanEnvironment('DEPENDENCY_LOCK_PRESENT');
  if (workspaceSourceIntegrity.packageLockPresent !== lockExists) {
    throw new Error('Workspace source-integrity lock evidence does not match the filesystem');
  }
  if (workflowLockState !== null && workflowLockState !== lockExists) {
    throw new Error('DEPENDENCY_LOCK_PRESENT does not match the filesystem');
  }

  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

  const files = walk(root)
    .filter(item => /\.(js|json|sql|md)$/.test(item.relative))
    .sort((a, b) => a.relative.localeCompare(b.relative));

  const manifest = files.map(item => {
    const stat = fs.lstatSync(item.absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error(`Build evidence requires a regular single-link file: ${item.relative}`);
    }
    return { path: item.relative, bytes: stat.size, sha256: checksum(item.absolute) };
  });

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
    migrationCount: manifest.filter(item => item.path.startsWith('migrations/') && item.path.endsWith('.sql')).length,
    routeFileCount: manifest.filter(item => item.path.endsWith('-routes.js')).length,
    checkFileCount: manifest.filter(item => item.path.endsWith('-check.js')).length,
    manifest
  };

  const sourceEvidencePath = path.join(evidenceDir, 'workspace-source-integrity.json');
  fs.writeFileSync(sourceEvidencePath, JSON.stringify(workspaceSourceIntegrity, null, 2) + '\n', { mode: 0o600 });
  const sourceEvidenceDigest = checksum(sourceEvidencePath);
  fs.writeFileSync(path.join(evidenceDir, 'workspace-source-integrity.sha256'), `${sourceEvidenceDigest}  workspace-source-integrity.json\n`, { mode: 0o600 });

  const jsonPath = path.join(evidenceDir, 'build-evidence.json');
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  const digest = checksum(jsonPath);
  fs.writeFileSync(path.join(evidenceDir, 'build-evidence.sha256'), `${digest}  build-evidence.json\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    version: evidence.version,
    files: evidence.fileCount,
    migrations: evidence.migrationCount,
    dependencyLockPresent: evidence.dependencyLockPresent,
    dependencyLockStateVerified: true,
    workspaceSourceIntegrityVerified: true,
    workspaceSourceIntegrityStableAcrossDependencyInstall: evidence.workspaceSourceIntegrityStableAcrossDependencyInstall,
    preinstallWorkspaceSourceInventorySha256: evidence.preinstallWorkspaceSourceInventorySha256,
    postinstallWorkspaceSourceInventorySha256: evidence.postinstallWorkspaceSourceInventorySha256,
    workspaceSourceEvidenceSha256: sourceEvidenceDigest,
    sha256: digest
  }, null, 2));
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({ ok: false, check: 'build-evidence', error: error.message }, null, 2));
  process.exit(1);
}
