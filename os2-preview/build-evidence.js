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
    if (entry.isDirectory()) files.push(...walk(absolute, relative));
    else files.push({ absolute, relative });
  }
  return files;
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runWorkspaceSourceIntegrity() {
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
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw new Error(`Workspace source integrity could not start: ${result.error.message}`);
  if (result.signal) throw new Error(`Workspace source integrity was interrupted by signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`Workspace source integrity failed with status ${result.status}: ${String(result.stderr || '').trim()}`);
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch { throw new Error('Workspace source integrity output is not valid JSON'); }
  if (parsed.ok !== true || !/^[0-9a-f]{64}$/i.test(String(parsed.inventorySha256 || ''))) {
    throw new Error('Workspace source integrity output is incomplete');
  }
  return parsed;
}

function main() {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

  const workspaceSourceIntegrity = runWorkspaceSourceIntegrity();
  const files = walk(root)
    .filter(item => /\.(js|json|sql|md)$/.test(item.relative))
    .sort((a, b) => a.relative.localeCompare(b.relative));

  const manifest = files.map(item => ({
    path: item.relative,
    bytes: fs.statSync(item.absolute).size,
    sha256: checksum(item.absolute)
  }));

  const lockExists = fs.existsSync(path.join(root, 'package-lock.json'));
  const workflowLockState = String(process.env.DEPENDENCY_LOCK_PRESENT || '').toLowerCase();
  const dependencyLockPresent = workflowLockState === 'true'
    ? true
    : workflowLockState === 'false'
      ? false
      : lockExists;

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
    workspaceSourceIntegrityVerified: true,
    workspaceSourceInventorySha256: workspaceSourceIntegrity.inventorySha256,
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
    workspaceSourceIntegrityVerified: true,
    workspaceSourceInventorySha256: evidence.workspaceSourceInventorySha256,
    workspaceSourceEvidenceSha256: sourceEvidenceDigest,
    sha256: digest
  }, null, 2));
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({ ok: false, check: 'build-evidence', error: error.message }, null, 2));
  process.exit(1);
}
