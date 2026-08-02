'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { TextDecoder } = require('util');

const root = __dirname;
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedApplication = 'talk2me-os2-preview';
const expectedVersion = '0.59.0';
const expectedNodeMajor = 20;
const expectedNpmMajor = 10;
const expectedRegistry = 'https://registry.npmjs.org/';
const maxPackageBytes = 1024 * 1024;
const maxLockBytes = 16 * 1024 * 1024;
const generationTimeoutMs = 10 * 60 * 1000;
const verifierTimeoutMs = 60 * 1000;
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const verifierPath = path.join(root, 'dependency-lock-verification.js');
const expectedDirectDependencies = Object.freeze({
  bcryptjs: '^2.4.3',
  express: '^4.19.2',
  multer: '^1.4.5-lts.1',
  mysql2: '^3.11.0',
  nodemailer: '^6.9.16',
  xlsx: '^0.18.5'
});

function fail(message) { throw new Error(message); }
function required(name, maxLength = 4096) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) fail(`INVALID_${name}`);
  return value;
}
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function exactObject(left, right) {
  if (!plainObject(left) || !plainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function secureRead(file, maxBytes, expectedOwner, label) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) fail(`${label}_PATH_INVALID`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label}_NOT_REGULAR_FILE`);
  if (stat.nlink !== 1) fail(`${label}_HARD_LINK_PROHIBITED`);
  if (stat.size <= 0 || stat.size > maxBytes) fail(`${label}_SIZE_INVALID`);
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) fail(`${label}_WRITABLE_BY_GROUP_OR_WORLD`);
  if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) fail(`${label}_OWNER_MISMATCH`);
  if (fs.realpathSync.native(file) !== file) fail(`${label}_PATH_NOT_CANONICAL`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW_UNAVAILABLE');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) fail(`${label}_DESCRIPTOR_NOT_REGULAR`);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`${label}_IDENTITY_CHANGED_DURING_OPEN`);
    if (opened.nlink !== 1 || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) fail(`${label}_METADATA_CHANGED_DURING_OPEN`);
    if (opened.uid !== stat.uid || opened.mode !== stat.mode) fail(`${label}_SECURITY_METADATA_CHANGED_DURING_OPEN`);
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== opened.size) fail(`${label}_READ_SIZE_MISMATCH`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(`${label}_INVALID_UTF8`); }
    if (text.charCodeAt(0) === 0xfeff) fail(`${label}_BOM_PROHIBITED`);
    if (text.includes('\u0000') || text.includes('\r') || !text.endsWith('\n')) fail(`${label}_CANONICAL_TEXT_REQUIRED`);
    return { bytes, text, sha256: sha256(bytes), stat: opened };
  } finally { fs.closeSync(fd); }
}
function secureDirectory(directory, label, expectedOwner, requirePrivate) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) fail(`${label}_PATH_INVALID`);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label}_NOT_SECURE_DIRECTORY`);
  if (fs.realpathSync.native(directory) !== directory) fail(`${label}_NOT_CANONICAL`);
  if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) fail(`${label}_OWNER_MISMATCH`);
  if (process.platform !== 'win32' && (stat.mode & (requirePrivate ? 0o077 : 0o022)) !== 0) fail(`${label}_PERMISSIONS_INVALID`);
  if (typeof fs.constants.O_DIRECTORY !== 'number' || typeof fs.constants.O_NOFOLLOW !== 'number') fail('SECURE_DIRECTORY_FLAGS_UNAVAILABLE');
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`${label}_IDENTITY_CHANGED_DURING_OPEN`);
    if (opened.uid !== stat.uid || opened.mode !== stat.mode || opened.mtimeMs !== stat.mtimeMs) fail(`${label}_METADATA_CHANGED_DURING_OPEN`);
    return { dev: opened.dev, ino: opened.ino, uid: opened.uid, mode: opened.mode, mtimeMs: opened.mtimeMs };
  } finally { fs.closeSync(fd); }
}
function validateExecutable(file, label) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) fail(`${label}_PATH_INVALID`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail(`${label}_NOT_SECURE_FILE`);
  if (fs.realpathSync.native(file) !== file) fail(`${label}_NOT_CANONICAL`);
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) fail(`${label}_WRITABLE_BY_GROUP_OR_WORLD`);
  if (process.platform !== 'win32' && (stat.mode & 0o111) === 0) fail(`${label}_NOT_EXECUTABLE`);
  return file;
}
function parseJson(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { fail(`${label}_INVALID_JSON`); }
  if (!plainObject(value)) fail(`${label}_ROOT_OBJECT_REQUIRED`);
  return value;
}
function publishExclusive(file, bytes, mode, expectedParentOwner) {
  const parent = path.dirname(file);
  secureDirectory(parent, 'EXCLUSIVE_WRITE_PARENT', expectedParentOwner, parent !== root);
  if (fs.existsSync(file)) fail(`REFUSING_TO_OVERWRITE:${file}`);
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`);
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(temporary, flags, mode);
  let linked = false;
  try {
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    fs.fsyncSync(fd);
    fs.fchmodSync(fd, mode);
  } finally { fs.closeSync(fd); }
  try {
    fs.linkSync(temporary, file);
    linked = true;
  } finally {
    try { fs.unlinkSync(temporary); } catch { if (!linked) throw new Error(`TEMPORARY_PUBLICATION_CLEANUP_FAILED:${temporary}`); }
  }
  const result = fs.lstatSync(file);
  if (!result.isFile() || result.isSymbolicLink() || result.nlink !== 1 || result.size !== bytes.length) fail(`EXCLUSIVE_WRITE_NOT_CONFIRMED:${file}`);
  if (process.platform !== 'win32' && (result.mode & 0o777) !== mode) fail(`EXCLUSIVE_WRITE_MODE_INVALID:${file}`);
  return { dev: result.dev, ino: result.ino, size: result.size, uid: result.uid, mode: result.mode };
}
function safeRemoveGeneratedLock(expectedDigest) {
  if (!fs.existsSync(lockPath)) return;
  try {
    const current = secureRead(lockPath, maxLockBytes, fs.lstatSync(root).uid, 'GENERATED_LOCK_ROLLBACK');
    if (current.sha256 === expectedDigest) fs.unlinkSync(lockPath);
  } catch { /* preserve unexpected files for manual review */ }
}
function sanitizedEnvironment(tempDirectory, npmBin, nodeBin) {
  return Object.freeze({
    PATH: [path.dirname(nodeBin), path.dirname(npmBin), '/usr/bin', '/bin'].join(path.delimiter),
    HOME: tempDirectory,
    TMPDIR: tempDirectory,
    TEMP: tempDirectory,
    TMP: tempDirectory,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    NODE_ENV: 'production',
    npm_config_registry: expectedRegistry,
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_package_lock: 'true',
    npm_config_lockfile_version: '3',
    npm_config_update_notifier: 'false',
    npm_config_cache: path.join(tempDirectory, 'npm-cache'),
    npm_config_userconfig: '/dev/null'
  });
}
function runBounded(command, args, options, timeoutMs, label) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', shell: false, windowsHide: true });
  if (result.error && result.error.code === 'ETIMEDOUT') fail(`${label}_TIMEOUT`);
  if (result.error) fail(`${label}_START_FAILED:${result.error.message}`);
  if (result.signal) fail(`${label}_SIGNALLED:${result.signal}`);
  if (result.status !== 0) fail(`${label}_FAILED:${result.status}:${String(result.stderr || '').slice(-2000)}`);
  return result;
}

async function main() {
  const configuredRoot = required('PREVIEW_APP_ROOT');
  if (configuredRoot !== root || !path.isAbsolute(configuredRoot) || path.normalize(configuredRoot) !== configuredRoot) fail('PREVIEW_APP_ROOT_MUST_MATCH');
  if (required('DB_NAME', 128) !== expectedDatabase) fail('DB_NAME_MISMATCH');
  if (required('RELEASE_BRANCH', 200) !== expectedBranch) fail('RELEASE_BRANCH_MISMATCH');
  if (process.env.ALLOW_DEPENDENCY_LOCK_GENERATION !== 'true') fail('DEPENDENCY_LOCK_GENERATION_NOT_ENABLED');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('MERGE_EXECUTION_FLAG_PROHIBITED');
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor !== expectedNodeMajor) fail(`NODE_MAJOR_MUST_BE_${expectedNodeMajor}`);
  if (fs.existsSync(lockPath)) fail('PACKAGE_LOCK_ALREADY_EXISTS');

  const rootIdentity = secureDirectory(root, 'APPLICATION_ROOT', null, false);
  const packageEvidence = secureRead(packagePath, maxPackageBytes, rootIdentity.uid, 'PACKAGE_JSON');
  const pkg = parseJson(packageEvidence.text, 'PACKAGE_JSON');
  if (pkg.name !== expectedApplication || pkg.version !== expectedVersion || pkg.private !== true || pkg.main !== 'server.js') fail('PACKAGE_IDENTITY_INVALID');
  if (!exactObject(pkg.dependencies, expectedDirectDependencies)) fail('PACKAGE_DEPENDENCIES_INVALID');
  for (const name of ['preinstall','install','postinstall','prepare','prepublish','prepublishOnly','prepack','postpack']) if (pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, name)) fail(`PACKAGE_LIFECYCLE_SCRIPT_PROHIBITED:${name}`);

  const npmBin = validateExecutable(required('NPM_BIN'), 'NPM_BIN');
  const nodeBin = validateExecutable(required('NODE_BIN'), 'NODE_BIN');
  if (fs.realpathSync.native(nodeBin) !== fs.realpathSync.native(process.execPath)) fail('NODE_BIN_PROCESS_MISMATCH');
  const tempRoot = required('DEPENDENCY_LOCK_TEMP_ROOT');
  if (tempRoot === root || tempRoot.startsWith(`${root}${path.sep}`) || /public_html/i.test(tempRoot)) fail('TEMP_ROOT_LOCATION_PROHIBITED');
  secureDirectory(tempRoot, 'TEMP_ROOT', rootIdentity.uid, true);
  const evidencePath = required('DEPENDENCY_LOCK_EVIDENCE_PATH');
  if (!path.isAbsolute(evidencePath) || path.normalize(evidencePath) !== evidencePath || evidencePath.startsWith(`${root}${path.sep}`) || /public_html/i.test(evidencePath)) fail('EVIDENCE_PATH_INVALID');
  if (path.extname(evidencePath) !== '.json') fail('EVIDENCE_PATH_EXTENSION_INVALID');
  if (fs.existsSync(evidencePath) || fs.existsSync(`${evidencePath}.sha256`)) fail('EVIDENCE_ALREADY_EXISTS');
  const evidenceParent = secureDirectory(path.dirname(evidencePath), 'EVIDENCE_PARENT', rootIdentity.uid, true);

  const temporaryDirectory = fs.mkdtempSync(path.join(tempRoot, 'talk2me-lock-'));
  fs.chmodSync(temporaryDirectory, 0o700);
  let publishedDigest = null;
  try {
    secureDirectory(temporaryDirectory, 'TEMP_WORKSPACE', rootIdentity.uid, true);
    const env = sanitizedEnvironment(temporaryDirectory, npmBin, nodeBin);
    const npmVersionResult = runBounded(npmBin, ['--version'], { cwd: temporaryDirectory, env }, 15000, 'NPM_VERSION');
    const npmVersion = String(npmVersionResult.stdout || '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(npmVersion) || Number.parseInt(npmVersion, 10) !== expectedNpmMajor) fail(`NPM_MAJOR_MUST_BE_${expectedNpmMajor}`);
    publishExclusive(path.join(temporaryDirectory, 'package.json'), packageEvidence.bytes, 0o600, rootIdentity.uid);

    const startedAt = new Date();
    const args = ['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund','--package-lock=true','--lockfile-version=3',`--registry=${expectedRegistry}`];
    runBounded(npmBin, args, { cwd: temporaryDirectory, env }, generationTimeoutMs, 'DEPENDENCY_LOCK_GENERATION');
    if (fs.existsSync(path.join(temporaryDirectory, 'node_modules'))) fail('NODE_MODULES_GENERATED_UNEXPECTEDLY');
    const candidatePath = path.join(temporaryDirectory, 'package-lock.json');
    const candidate = secureRead(candidatePath, maxLockBytes, rootIdentity.uid, 'GENERATED_PACKAGE_LOCK');
    const candidateJson = parseJson(candidate.text, 'GENERATED_PACKAGE_LOCK');
    if (candidateJson.name !== expectedApplication || candidateJson.version !== expectedVersion || candidateJson.lockfileVersion !== 3 || candidateJson.requires !== true) fail('GENERATED_LOCK_IDENTITY_INVALID');
    if (!plainObject(candidateJson.packages) || !plainObject(candidateJson.packages[''])) fail('GENERATED_LOCK_PACKAGES_INVALID');
    if (candidateJson.packages[''].name !== expectedApplication || candidateJson.packages[''].version !== expectedVersion) fail('GENERATED_LOCK_ROOT_INVALID');
    if (!exactObject(candidateJson.packages[''].dependencies, expectedDirectDependencies)) fail('GENERATED_LOCK_DEPENDENCIES_MISMATCH');

    const rootAfterGeneration = secureDirectory(root, 'APPLICATION_ROOT_POST_GENERATION', rootIdentity.uid, false);
    if (rootAfterGeneration.dev !== rootIdentity.dev || rootAfterGeneration.ino !== rootIdentity.ino) fail('APPLICATION_ROOT_IDENTITY_CHANGED');
    const packageAfterGeneration = secureRead(packagePath, maxPackageBytes, rootIdentity.uid, 'PACKAGE_JSON_POST_GENERATION');
    if (packageAfterGeneration.sha256 !== packageEvidence.sha256) fail('PACKAGE_JSON_CHANGED_DURING_GENERATION');
    publishExclusive(lockPath, candidate.bytes, 0o644, rootIdentity.uid);
    publishedDigest = candidate.sha256;

    const verifierEnv = Object.freeze({
      PATH: env.PATH,
      HOME: env.HOME,
      TMPDIR: env.TMPDIR,
      TEMP: env.TEMP,
      TMP: env.TMP,
      LANG: env.LANG,
      LC_ALL: env.LC_ALL,
      TZ: 'UTC',
      NODE_ENV: 'production',
      PREVIEW_APP_ROOT: root,
      DB_NAME: expectedDatabase,
      RELEASE_BRANCH: expectedBranch,
      ALLOW_PRODUCTION_MUTATION: 'false',
      ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'
    });
    const verifierResult = runBounded(nodeBin, [verifierPath], { cwd: root, env: verifierEnv }, verifierTimeoutMs, 'DEPENDENCY_LOCK_VERIFICATION');
    let verifierEvidence;
    try { verifierEvidence = JSON.parse(String(verifierResult.stdout || '').trim()); } catch { fail('DEPENDENCY_LOCK_VERIFIER_INVALID_JSON'); }
    if (verifierEvidence.ok !== true || verifierEvidence.packageLockPresent !== true || verifierEvidence.packageLockSha256 !== candidate.sha256 || verifierEvidence.lockfileVersion !== 3) fail('DEPENDENCY_LOCK_VERIFIER_EVIDENCE_INVALID');

    const finishedAt = new Date();
    const evidence = {
      ok: true,
      check: 'dependency-lock-generation',
      application: expectedApplication,
      version: expectedVersion,
      applicationRoot: root,
      database: expectedDatabase,
      branch: expectedBranch,
      nodeVersion: process.versions.node,
      npmVersion,
      registry: expectedRegistry,
      generatedAt: finishedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      packageJsonSha256: packageEvidence.sha256,
      packageLockSha256: candidate.sha256,
      packageLockBytes: candidate.bytes.length,
      packageLockVerifiedAfterPublication: true,
      packageJsonUnchangedDuringGeneration: true,
      packageLockPublishedAtomically: true,
      packageLockOverwriteAllowed: false,
      lifecycleScriptsExecuted: false,
      nodeModulesGenerated: false,
      registryPinned: true,
      fullParentEnvironmentInherited: false,
      generationTimeoutMs,
      verifierTimeoutMs,
      evidencePath,
      evidencePrivate: true,
      productionMutationEnabled: false,
      mergeExecutionEnabled: false
    };
    const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    const evidenceDigest = sha256(evidenceBytes);
    publishExclusive(evidencePath, evidenceBytes, 0o600, evidenceParent.uid);
    publishExclusive(`${evidencePath}.sha256`, Buffer.from(`${evidenceDigest}  ${path.basename(evidencePath)}\n`, 'utf8'), 0o600, evidenceParent.uid);
    console.log(JSON.stringify({ ...evidence, evidenceSha256: evidenceDigest }, null, 2));
  } catch (error) {
    if (publishedDigest) safeRemoveGeneratedLock(publishedDigest);
    throw error;
  } finally {
    try {
      const stat = fs.lstatSync(temporaryDirectory);
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === rootIdentity.uid && temporaryDirectory.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    } catch { /* retain unexpected workspace state for manual inspection */ }
  }
}

main().catch(error => { console.error(`DEPENDENCY LOCK GENERATION FAILED: ${error.message}`); process.exit(1); });
