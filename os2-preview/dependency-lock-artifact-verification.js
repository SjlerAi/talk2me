'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');

const expectedApplication = 'talk2me-os2-preview';
const expectedVersion = '0.59.0';
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedRepository = 'SjlerAi/talk2me';
const expectedRef = `refs/heads/${expectedBranch}`;
const expectedWorkflow = 'OS2 Dependency Lock Generation';
const maxArtifactFileBytes = 16 * 1024 * 1024;
const requiredFiles = Object.freeze([
  'SHA256SUMS',
  'dependency-lock-artifact-governance.json',
  'dependency-lock-generation.json',
  'dependency-lock-generation.json.sha256',
  'dependency-lock-generator-governance.json',
  'dependency-lock-governance.json',
  'dependency-lock-verification.json',
  'dependency-lock-workflow-governance.json',
  'generator-result.json',
  'manifest.txt',
  'package-lock.json',
  'source-integrity-postinstall.json',
  'source-integrity-preinstall.json'
]);
const checksumFiles = Object.freeze(requiredFiles.filter(name => !['SHA256SUMS', 'dependency-lock-generation.json.sha256'].includes(name)));
const expectedDirectDependencies = Object.freeze({
  bcryptjs: '^2.4.3',
  express: '^4.19.2',
  multer: '^1.4.5-lts.1',
  mysql2: '^3.11.0',
  nodemailer: '^6.9.16',
  xlsx: '^0.18.5'
});

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'dependency-lock-artifact-verification', error: message, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  process.exit(1);
}
function requiredEnvironment(name, pattern, maxLength = 512) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) fail(`INVALID_${name}`);
  return value;
}
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function exactObject(left, right) {
  if (!plainObject(left) || !plainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
function timingSafeHexEqual(left, right) {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function secureDirectory(directory, expectedOwner) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) fail('ARTIFACT_DIRECTORY_PATH_INVALID');
  if (/public_html/i.test(directory)) fail('ARTIFACT_DIRECTORY_PUBLIC_PATH_PROHIBITED');
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('ARTIFACT_DIRECTORY_NOT_SECURE');
  if (fs.realpathSync.native(directory) !== directory) fail('ARTIFACT_DIRECTORY_NOT_CANONICAL');
  if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) fail('ARTIFACT_DIRECTORY_OWNER_MISMATCH');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('ARTIFACT_DIRECTORY_NOT_PRIVATE');
  if (typeof fs.constants.O_DIRECTORY !== 'number' || typeof fs.constants.O_NOFOLLOW !== 'number') fail('SECURE_DIRECTORY_FLAGS_UNAVAILABLE');
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail('ARTIFACT_DIRECTORY_IDENTITY_CHANGED');
    if (opened.uid !== stat.uid || opened.mode !== stat.mode || opened.mtimeMs !== stat.mtimeMs) fail('ARTIFACT_DIRECTORY_METADATA_CHANGED');
    return { uid: opened.uid, dev: opened.dev, ino: opened.ino, mode: opened.mode, mtimeMs: opened.mtimeMs };
  } finally { fs.closeSync(fd); }
}
function secureRead(root, name, expectedOwner, maxBytes = maxArtifactFileBytes) {
  if (!requiredFiles.includes(name) || path.basename(name) !== name || name.includes('/') || name.includes('\\')) fail(`ARTIFACT_FILENAME_INVALID:${name}`);
  const file = path.join(root, name);
  if (path.dirname(file) !== root) fail(`ARTIFACT_PATH_ESCAPE:${name}`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`ARTIFACT_FILE_NOT_REGULAR:${name}`);
  if (stat.nlink !== 1) fail(`ARTIFACT_FILE_HARD_LINK_PROHIBITED:${name}`);
  if (stat.uid !== expectedOwner) fail(`ARTIFACT_FILE_OWNER_MISMATCH:${name}`);
  if (stat.size <= 0 || stat.size > maxBytes) fail(`ARTIFACT_FILE_SIZE_INVALID:${name}`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail(`ARTIFACT_FILE_NOT_PRIVATE:${name}`);
  if (fs.realpathSync.native(file) !== file) fail(`ARTIFACT_FILE_NOT_CANONICAL:${name}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) fail(`ARTIFACT_DESCRIPTOR_NOT_REGULAR:${name}`);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`ARTIFACT_FILE_IDENTITY_CHANGED:${name}`);
    if (opened.nlink !== 1 || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) fail(`ARTIFACT_FILE_METADATA_CHANGED:${name}`);
    if (opened.uid !== stat.uid || opened.mode !== stat.mode) fail(`ARTIFACT_FILE_SECURITY_METADATA_CHANGED:${name}`);
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== opened.size) fail(`ARTIFACT_FILE_READ_SIZE_MISMATCH:${name}`);
    return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  } finally { fs.closeSync(fd); }
}
function decodeCanonicalText(record, name, requireFinalNewline = true) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(record.bytes); } catch { fail(`ARTIFACT_FILE_INVALID_UTF8:${name}`); }
  if (text.charCodeAt(0) === 0xfeff) fail(`ARTIFACT_FILE_BOM_PROHIBITED:${name}`);
  if (text.includes('\u0000')) fail(`ARTIFACT_FILE_NUL_PROHIBITED:${name}`);
  if (text.includes('\r')) fail(`ARTIFACT_FILE_CRLF_PROHIBITED:${name}`);
  if (requireFinalNewline && !text.endsWith('\n')) fail(`ARTIFACT_FILE_FINAL_NEWLINE_REQUIRED:${name}`);
  return text;
}
function parseJson(record, name) {
  const text = decodeCanonicalText(record, name);
  let value;
  try { value = JSON.parse(text); } catch { fail(`ARTIFACT_JSON_INVALID:${name}`); }
  if (!plainObject(value)) fail(`ARTIFACT_JSON_OBJECT_REQUIRED:${name}`);
  return value;
}
function parseManifest(text) {
  const expectedKeys = ['repository','ref','commit','workflow','run_id','run_attempt','source_inventory_sha256','package_lock_sha256','production_mutation_enabled','merge_execution_enabled'];
  const result = {};
  for (const line of text.trimEnd().split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) fail('ARTIFACT_MANIFEST_LINE_INVALID');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!expectedKeys.includes(key) || Object.prototype.hasOwnProperty.call(result, key)) fail(`ARTIFACT_MANIFEST_KEY_INVALID:${key}`);
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) fail(`ARTIFACT_MANIFEST_VALUE_INVALID:${key}`);
    result[key] = value;
  }
  if (Object.keys(result).sort().join('\n') !== [...expectedKeys].sort().join('\n')) fail('ARTIFACT_MANIFEST_KEYS_INCOMPLETE');
  return result;
}
function scanSecretKeys(value, location = 'root') {
  if (Array.isArray(value)) return value.forEach((entry, index) => scanSecretKeys(entry, `${location}[${index}]`));
  if (!plainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(password|token|secret|authorization|cookie|db_password|mysql_pwd)$/i.test(key)) fail(`ARTIFACT_SECRET_FIELD_PROHIBITED:${location}.${key}`);
    scanSecretKeys(entry, `${location}.${key}`);
  }
}

const artifactRoot = requiredEnvironment('DEPENDENCY_LOCK_ARTIFACT_ROOT', /^\/.+/, 4096);
const repository = requiredEnvironment('EXPECTED_REPOSITORY', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const ref = requiredEnvironment('EXPECTED_REF', /^refs\/heads\/[A-Za-z0-9._/-]+$/);
const commit = requiredEnvironment('EXPECTED_COMMIT_SHA', /^[0-9a-f]{40}$/);
const workflow = requiredEnvironment('EXPECTED_WORKFLOW', /^[A-Za-z0-9 ._-]+$/);
const runId = requiredEnvironment('EXPECTED_RUN_ID', /^[1-9][0-9]*$/);
const runAttempt = requiredEnvironment('EXPECTED_RUN_ATTEMPT', /^[1-9][0-9]*$/);
if (repository !== expectedRepository || ref !== expectedRef || workflow !== expectedWorkflow) fail('ARTIFACT_EXPECTED_IDENTITY_INVALID');
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('PRODUCTION_MUTATION_FLAG_PROHIBITED');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('MERGE_EXECUTION_FLAG_PROHIBITED');

const directory = secureDirectory(artifactRoot);
const entries = fs.readdirSync(artifactRoot, { withFileTypes: true });
if (entries.some(entry => !entry.isFile() || entry.name.startsWith('.'))) fail('ARTIFACT_DIRECTORY_ENTRY_INVALID');
const actualNames = entries.map(entry => entry.name).sort();
if (actualNames.join('\n') !== [...requiredFiles].sort().join('\n')) fail('ARTIFACT_FILE_SET_INVALID');
const records = Object.fromEntries(requiredFiles.map(name => [name, secureRead(artifactRoot, name, directory.uid, name === 'package-lock.json' ? maxArtifactFileBytes : 4 * 1024 * 1024)]));
secureDirectory(artifactRoot, directory.uid);

const sumsText = decodeCanonicalText(records.SHA256SUMS, 'SHA256SUMS');
const sumLines = sumsText.trimEnd().split('\n');
if (sumLines.length !== checksumFiles.length) fail('ARTIFACT_CHECKSUM_LINE_COUNT_INVALID');
const listed = new Set();
for (const line of sumLines) {
  const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
  if (!match) fail('ARTIFACT_CHECKSUM_LINE_INVALID');
  const [, digest, name] = match;
  if (!checksumFiles.includes(name) || listed.has(name)) fail(`ARTIFACT_CHECKSUM_FILENAME_INVALID:${name}`);
  if (!timingSafeHexEqual(digest, records[name].sha256)) fail(`ARTIFACT_CHECKSUM_MISMATCH:${name}`);
  listed.add(name);
}
if (listed.size !== checksumFiles.length) fail('ARTIFACT_CHECKSUM_COVERAGE_INCOMPLETE');

const sidecarText = decodeCanonicalText(records['dependency-lock-generation.json.sha256'], 'dependency-lock-generation.json.sha256');
const sidecarMatch = /^([0-9a-f]{64})  dependency-lock-generation\.json\n$/.exec(sidecarText);
if (!sidecarMatch || !timingSafeHexEqual(sidecarMatch[1], records['dependency-lock-generation.json'].sha256)) fail('ARTIFACT_GENERATION_SIDECAR_INVALID');

const packageLock = parseJson(records['package-lock.json'], 'package-lock.json');
if (packageLock.name !== expectedApplication || packageLock.version !== expectedVersion || packageLock.lockfileVersion !== 3 || packageLock.requires !== true) fail('ARTIFACT_PACKAGE_LOCK_IDENTITY_INVALID');
if (!plainObject(packageLock.packages) || !plainObject(packageLock.packages[''])) fail('ARTIFACT_PACKAGE_LOCK_ROOT_MISSING');
if (packageLock.packages[''].name !== expectedApplication || packageLock.packages[''].version !== expectedVersion) fail('ARTIFACT_PACKAGE_LOCK_ROOT_IDENTITY_INVALID');
if (!exactObject(packageLock.packages[''].dependencies, expectedDirectDependencies)) fail('ARTIFACT_PACKAGE_LOCK_DEPENDENCIES_INVALID');

const manifest = parseManifest(decodeCanonicalText(records['manifest.txt'], 'manifest.txt'));
if (manifest.repository !== repository || manifest.ref !== ref || manifest.commit !== commit || manifest.workflow !== workflow) fail('ARTIFACT_MANIFEST_SOURCE_IDENTITY_MISMATCH');
if (manifest.run_id !== runId || manifest.run_attempt !== runAttempt) fail('ARTIFACT_MANIFEST_RUN_IDENTITY_MISMATCH');
if (!/^[0-9a-f]{64}$/.test(manifest.source_inventory_sha256) || !/^[0-9a-f]{64}$/.test(manifest.package_lock_sha256)) fail('ARTIFACT_MANIFEST_DIGEST_INVALID');
if (manifest.production_mutation_enabled !== 'false' || manifest.merge_execution_enabled !== 'false') fail('ARTIFACT_MANIFEST_SAFETY_INVALID');
if (!timingSafeHexEqual(manifest.package_lock_sha256, records['package-lock.json'].sha256)) fail('ARTIFACT_MANIFEST_LOCK_DIGEST_MISMATCH');

const generation = parseJson(records['dependency-lock-generation.json'], 'dependency-lock-generation.json');
const generatorResult = parseJson(records['generator-result.json'], 'generator-result.json');
const lockVerification = parseJson(records['dependency-lock-verification.json'], 'dependency-lock-verification.json');
const lockGovernance = parseJson(records['dependency-lock-governance.json'], 'dependency-lock-governance.json');
const generatorGovernance = parseJson(records['dependency-lock-generator-governance.json'], 'dependency-lock-generator-governance.json');
const workflowGovernance = parseJson(records['dependency-lock-workflow-governance.json'], 'dependency-lock-workflow-governance.json');
const artifactGovernance = parseJson(records['dependency-lock-artifact-governance.json'], 'dependency-lock-artifact-governance.json');
const sourcePre = parseJson(records['source-integrity-preinstall.json'], 'source-integrity-preinstall.json');
const sourcePost = parseJson(records['source-integrity-postinstall.json'], 'source-integrity-postinstall.json');
for (const [name, value] of Object.entries({ generation, generatorResult, lockVerification, lockGovernance, generatorGovernance, workflowGovernance, artifactGovernance, sourcePre, sourcePost })) scanSecretKeys(value, name);

for (const value of [generation, generatorResult]) {
  if (value.ok !== true || value.check !== 'dependency-lock-generation' || value.application !== expectedApplication || value.version !== expectedVersion) fail('ARTIFACT_GENERATION_EVIDENCE_INVALID');
  if (value.database !== expectedDatabase || value.branch !== expectedBranch || !timingSafeHexEqual(value.packageLockSha256, records['package-lock.json'].sha256)) fail('ARTIFACT_GENERATION_IDENTITY_INVALID');
  if (value.productionMutationEnabled !== false || value.mergeExecutionEnabled !== false) fail('ARTIFACT_GENERATION_SAFETY_INVALID');
}
if (generation.packageLockVerifiedAfterPublication !== true || generation.lifecycleScriptsExecuted !== false || generation.nodeModulesGenerated !== false || generation.registryPinned !== true || generation.fullParentEnvironmentInherited !== false) fail('ARTIFACT_GENERATION_CONTROL_EVIDENCE_INVALID');
if (lockVerification.ok !== true || lockVerification.check !== 'dependency-lock-verification' || lockVerification.packageLockPresent !== true || !timingSafeHexEqual(lockVerification.packageLockSha256, records['package-lock.json'].sha256)) fail('ARTIFACT_LOCK_VERIFICATION_EVIDENCE_INVALID');
for (const [value, check] of [[lockGovernance,'dependency-lock-governance'],[generatorGovernance,'dependency-lock-generator-governance'],[workflowGovernance,'dependency-lock-workflow-governance'],[artifactGovernance,'dependency-lock-artifact-governance']]) {
  if (value.ok !== true || value.check !== check || value.meaningfulControls !== 60) fail(`ARTIFACT_GOVERNANCE_EVIDENCE_INVALID:${check}`);
}
for (const source of [sourcePre, sourcePost]) {
  if (source.ok !== true || source.check !== 'workspace-source-integrity' || source.packageLockPresent !== true || !/^[0-9a-f]{64}$/.test(String(source.inventorySha256 || ''))) fail('ARTIFACT_SOURCE_INTEGRITY_EVIDENCE_INVALID');
  if (source.productionMutationEnabled !== false || source.mergeExecutionEnabled !== false) fail('ARTIFACT_SOURCE_INTEGRITY_SAFETY_INVALID');
}
if (!timingSafeHexEqual(sourcePre.inventorySha256, sourcePost.inventorySha256) || !timingSafeHexEqual(sourcePre.inventorySha256, manifest.source_inventory_sha256)) fail('ARTIFACT_SOURCE_INVENTORY_CONTINUITY_INVALID');

console.log(JSON.stringify({
  ok: true,
  check: 'dependency-lock-artifact-verification',
  meaningfulControls: 60,
  artifactRoot,
  repository,
  ref,
  commit,
  workflow,
  runId,
  runAttempt,
  exactFileSetVerified: true,
  artifactDirectoryPrivate: true,
  artifactFilesPrivate: true,
  canonicalPathsVerified: true,
  descriptorIdentityVerified: true,
  singleLinkFilesVerified: true,
  exactChecksumCoverageVerified: true,
  constantTimeChecksumComparison: true,
  generationSidecarVerified: true,
  packageLockSha256: records['package-lock.json'].sha256,
  sourceInventorySha256: manifest.source_inventory_sha256,
  packageLockIdentityVerified: true,
  exactDirectDependenciesVerified: true,
  manifestIdentityVerified: true,
  generationEvidenceVerified: true,
  independentLockVerificationVerified: true,
  governanceEvidenceVerified: true,
  sourceInventoryContinuityVerified: true,
  secretFieldsRejected: true,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
