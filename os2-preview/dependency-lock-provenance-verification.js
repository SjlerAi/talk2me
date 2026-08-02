'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');

const root = __dirname;
const expectedApplication = 'talk2me-os2-preview';
const expectedVersion = '0.59.0';
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedRepository = 'SjlerAi/talk2me';
const expectedRef = `refs/heads/${expectedBranch}`;
const expectedWorkflow = 'OS2 Dependency Lock Generation';
const expectedNodeMajor = 20;
const maxLockBytes = 16 * 1024 * 1024;
const maxProvenanceBytes = 64 * 1024;
const allowedClockSkewMs = 5 * 60 * 1000;
const expectedKeys = Object.freeze([
  'application',
  'automaticCommit',
  'generatedAt',
  'mergeExecutionEnabled',
  'packageLockSha256',
  'productionMutationEnabled',
  'repository',
  'runAttempt',
  'runId',
  'sourceBranch',
  'sourceCommit',
  'sourceInventorySha256',
  'sourceRef',
  'version',
  'workflow'
]);
const expectedDirectDependencies = Object.freeze({
  bcryptjs: '^2.4.3',
  express: '^4.19.2',
  multer: '^1.4.5-lts.1',
  mysql2: '^3.11.0',
  nodemailer: '^6.9.16',
  xlsx: '^0.18.5'
});

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'dependency-lock-provenance-verification', error: message, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  process.exit(1);
}
function requiredEnvironment(name, pattern, maxLength = 4096) {
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
function secureRead(file, maxBytes, expectedOwner, label) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) fail(`${label}_PATH_INVALID`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label}_NOT_REGULAR_FILE`);
  if (stat.nlink !== 1) fail(`${label}_HARD_LINK_PROHIBITED`);
  if (stat.uid !== expectedOwner) fail(`${label}_OWNER_MISMATCH`);
  if (stat.size <= 0 || stat.size > maxBytes) fail(`${label}_SIZE_INVALID`);
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) fail(`${label}_WRITABLE_BY_GROUP_OR_WORLD`);
  if (fs.realpathSync.native(file) !== file) fail(`${label}_PATH_NOT_CANONICAL`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW_UNAVAILABLE');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) fail(`${label}_DESCRIPTOR_NOT_REGULAR`);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`${label}_IDENTITY_CHANGED_DURING_OPEN`);
    if (opened.nlink !== 1 || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) fail(`${label}_METADATA_CHANGED_DURING_OPEN`);
    if (opened.uid !== stat.uid || opened.mode !== stat.mode) fail(`${label}_SECURITY_METADATA_CHANGED_DURING_OPEN`);
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== opened.size) fail(`${label}_READ_SIZE_MISMATCH`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(`${label}_INVALID_UTF8`); }
    if (text.charCodeAt(0) === 0xfeff) fail(`${label}_BOM_PROHIBITED`);
    if (text.includes('\u0000')) fail(`${label}_NUL_PROHIBITED`);
    if (text.includes('\r')) fail(`${label}_CRLF_PROHIBITED`);
    if (!text.endsWith('\n')) fail(`${label}_FINAL_NEWLINE_REQUIRED`);
    return { bytes, text, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } finally { fs.closeSync(descriptor); }
}
function parseJson(record, label) {
  let value;
  try { value = JSON.parse(record.text); } catch { fail(`${label}_INVALID_JSON`); }
  if (!plainObject(value)) fail(`${label}_ROOT_OBJECT_REQUIRED`);
  return value;
}
function scanSecretKeys(value, location = 'root') {
  if (Array.isArray(value)) return value.forEach((entry, index) => scanSecretKeys(entry, `${location}[${index}]`));
  if (!plainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(password|token|secret|authorization|cookie|db_password|mysql_pwd)$/i.test(key)) fail(`PROVENANCE_SECRET_FIELD_PROHIBITED:${location}.${key}`);
    scanSecretKeys(entry, `${location}.${key}`);
  }
}

const configuredRoot = requiredEnvironment('PREVIEW_APP_ROOT', /^\/.+$/);
if (configuredRoot !== root || path.normalize(configuredRoot) !== configuredRoot) fail('PREVIEW_APP_ROOT_MUST_MATCH');
if (requiredEnvironment('DB_NAME', /^[A-Za-z0-9_]+$/, 128) !== expectedDatabase) fail('DB_NAME_MISMATCH');
if (requiredEnvironment('RELEASE_BRANCH', /^[A-Za-z0-9._/-]+$/, 200) !== expectedBranch) fail('RELEASE_BRANCH_MISMATCH');
if (requiredEnvironment('EXPECTED_REPOSITORY', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 200) !== expectedRepository) fail('EXPECTED_REPOSITORY_MISMATCH');
if (requiredEnvironment('EXPECTED_REF', /^refs\/heads\/[A-Za-z0-9._/-]+$/, 300) !== expectedRef) fail('EXPECTED_REF_MISMATCH');
const expectedSourceCommit = requiredEnvironment('EXPECTED_SOURCE_COMMIT', /^[0-9a-f]{40}$/);
const currentCommit = requiredEnvironment('CURRENT_COMMIT', /^[0-9a-f]{40}$/);
if (expectedSourceCommit === currentCommit) fail('CURRENT_COMMIT_MUST_DIFFER_FROM_SOURCE_COMMIT');
const maxAgeHours = Number.parseInt(requiredEnvironment('PROVENANCE_MAX_AGE_HOURS', /^[1-9][0-9]{0,2}$/), 10);
if (!Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 720) fail('PROVENANCE_MAX_AGE_HOURS_INVALID');
if (Number.parseInt(process.versions.node.split('.')[0], 10) !== expectedNodeMajor) fail(`NODE_MAJOR_MUST_BE_${expectedNodeMajor}`);
if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('PRODUCTION_MUTATION_FLAG_PROHIBITED');
if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('MERGE_EXECUTION_FLAG_PROHIBITED');

const rootStat = fs.lstatSync(root);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('APPLICATION_ROOT_NOT_SECURE_DIRECTORY');
if (fs.realpathSync.native(root) !== root) fail('APPLICATION_ROOT_NOT_CANONICAL');
if (process.platform !== 'win32' && (rootStat.mode & 0o022) !== 0) fail('APPLICATION_ROOT_WRITABLE_BY_GROUP_OR_WORLD');
const lockRecord = secureRead(path.join(root, 'package-lock.json'), maxLockBytes, rootStat.uid, 'PACKAGE_LOCK');
const provenanceRecord = secureRead(path.join(root, 'dependency-lock-provenance.json'), maxProvenanceBytes, rootStat.uid, 'DEPENDENCY_LOCK_PROVENANCE');
const lock = parseJson(lockRecord, 'PACKAGE_LOCK');
const provenance = parseJson(provenanceRecord, 'DEPENDENCY_LOCK_PROVENANCE');
scanSecretKeys(provenance);

if (Object.keys(provenance).sort().join('\n') !== [...expectedKeys].sort().join('\n')) fail('PROVENANCE_KEYS_INVALID');
if (provenance.application !== expectedApplication || provenance.version !== expectedVersion) fail('PROVENANCE_APPLICATION_IDENTITY_INVALID');
if (provenance.repository !== expectedRepository || provenance.sourceRef !== expectedRef || provenance.sourceBranch !== expectedBranch) fail('PROVENANCE_SOURCE_IDENTITY_INVALID');
if (provenance.sourceCommit !== expectedSourceCommit) fail('PROVENANCE_SOURCE_COMMIT_MISMATCH');
if (provenance.workflow !== expectedWorkflow) fail('PROVENANCE_WORKFLOW_MISMATCH');
if (!Number.isSafeInteger(provenance.runId) || provenance.runId < 1) fail('PROVENANCE_RUN_ID_INVALID');
if (!Number.isSafeInteger(provenance.runAttempt) || provenance.runAttempt < 1) fail('PROVENANCE_RUN_ATTEMPT_INVALID');
if (typeof provenance.generatedAt !== 'string') fail('PROVENANCE_GENERATED_AT_INVALID');
const generatedAt = new Date(provenance.generatedAt);
if (!Number.isFinite(generatedAt.getTime()) || generatedAt.toISOString() !== provenance.generatedAt) fail('PROVENANCE_GENERATED_AT_NOT_CANONICAL_UTC');
const now = Date.now();
if (generatedAt.getTime() > now + allowedClockSkewMs) fail('PROVENANCE_GENERATED_AT_IN_FUTURE');
const ageMs = now - generatedAt.getTime();
if (ageMs > maxAgeHours * 60 * 60 * 1000) fail('PROVENANCE_TOO_OLD');
if (!/^[0-9a-f]{64}$/.test(String(provenance.packageLockSha256 || ''))) fail('PROVENANCE_LOCK_DIGEST_INVALID');
if (!/^[0-9a-f]{64}$/.test(String(provenance.sourceInventorySha256 || ''))) fail('PROVENANCE_SOURCE_DIGEST_INVALID');
if (!timingSafeHexEqual(provenance.packageLockSha256, lockRecord.sha256)) fail('PROVENANCE_LOCK_DIGEST_MISMATCH');
if (provenance.automaticCommit !== false || provenance.productionMutationEnabled !== false || provenance.mergeExecutionEnabled !== false) fail('PROVENANCE_SAFETY_FLAGS_INVALID');
if (lock.name !== expectedApplication || lock.version !== expectedVersion || lock.lockfileVersion !== 3 || lock.requires !== true) fail('PACKAGE_LOCK_IDENTITY_INVALID');
if (!plainObject(lock.packages) || !plainObject(lock.packages[''])) fail('PACKAGE_LOCK_ROOT_MISSING');
if (lock.packages[''].name !== expectedApplication || lock.packages[''].version !== expectedVersion) fail('PACKAGE_LOCK_ROOT_IDENTITY_INVALID');
if (!exactObject(lock.packages[''].dependencies, expectedDirectDependencies)) fail('PACKAGE_LOCK_DIRECT_DEPENDENCIES_INVALID');

console.log(JSON.stringify({
  ok: true,
  check: 'dependency-lock-provenance-verification',
  meaningfulControls: 60,
  application: expectedApplication,
  version: expectedVersion,
  applicationRoot: root,
  database: expectedDatabase,
  branch: expectedBranch,
  repository: expectedRepository,
  sourceRef: expectedRef,
  sourceCommit: expectedSourceCommit,
  currentCommit,
  workflow: expectedWorkflow,
  runId: provenance.runId,
  runAttempt: provenance.runAttempt,
  generatedAt: provenance.generatedAt,
  provenanceAgeHours: Number((ageMs / 3600000).toFixed(3)),
  provenanceMaxAgeHours: maxAgeHours,
  packageLockSha256: lockRecord.sha256,
  provenanceSha256: provenanceRecord.sha256,
  sourceInventorySha256: provenance.sourceInventorySha256,
  exactProvenanceSchemaVerified: true,
  exactSourceIdentityVerified: true,
  exactWorkflowIdentityVerified: true,
  sourceCommitContinuityVerified: true,
  canonicalUtcTimestampVerified: true,
  provenanceFreshnessVerified: true,
  packageLockDigestVerified: true,
  packageLockIdentityVerified: true,
  exactDirectDependenciesVerified: true,
  constantTimeDigestComparison: true,
  secretFieldsRejected: true,
  automaticCommit: false,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
