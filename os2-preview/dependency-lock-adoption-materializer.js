'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { TextDecoder } = require('util');

const root = __dirname;
const expectedApplication = 'talk2me-os2-preview';
const expectedVersion = '0.60.0';
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedRepository = 'SjlerAi/talk2me';
const expectedRef = `refs/heads/${expectedBranch}`;
const expectedWorkflow = 'OS2 Dependency Lock Generation';
const expectedNodeMajor = 20;
const maxLockBytes = 16 * 1024 * 1024;
const maxEvidenceBytes = 4 * 1024 * 1024;
const maxProvenanceBytes = 64 * 1024;
const verifierTimeoutMs = 30000;
const artifactVerifierPath = path.join(root, 'dependency-lock-artifact-verification.js');
const lockTarget = path.join(root, 'package-lock.json');
const provenanceTarget = path.join(root, 'dependency-lock-provenance.json');

function fail(message) { throw new Error(message); }
function required(name, pattern, maxLength = 4096) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) fail(`INVALID_${name}`);
  return value;
}
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function timingSafeHexEqual(left, right) {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function secureDirectory(directory, expectedOwner, requirePrivate, label) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) fail(`${label}_PATH_INVALID`);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label}_NOT_SECURE_DIRECTORY`);
  if (fs.realpathSync.native(directory) !== directory) fail(`${label}_NOT_CANONICAL`);
  if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) fail(`${label}_OWNER_MISMATCH`);
  if (process.platform !== 'win32' && (stat.mode & (requirePrivate ? 0o077 : 0o022)) !== 0) fail(`${label}_PERMISSIONS_INVALID`);
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`${label}_IDENTITY_CHANGED_DURING_OPEN`);
    if (opened.uid !== stat.uid || opened.mode !== stat.mode || opened.mtimeMs !== stat.mtimeMs) fail(`${label}_METADATA_CHANGED_DURING_OPEN`);
    return { uid: opened.uid, dev: opened.dev, ino: opened.ino, mode: opened.mode, mtimeMs: opened.mtimeMs };
  } finally { fs.closeSync(fd); }
}
function secureRead(file, maxBytes, expectedOwner, label) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) fail(`${label}_PATH_INVALID`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label}_NOT_REGULAR_FILE`);
  if (stat.nlink !== 1) fail(`${label}_HARD_LINK_PROHIBITED`);
  if (stat.uid !== expectedOwner) fail(`${label}_OWNER_MISMATCH`);
  if (stat.size <= 0 || stat.size > maxBytes) fail(`${label}_SIZE_INVALID`);
  const requirePrivate = label.startsWith('ARTIFACT_');
  if (process.platform !== 'win32' && (stat.mode & (requirePrivate ? 0o077 : 0o022)) !== 0) fail(`${label}_PERMISSIONS_INVALID`);
  if (fs.realpathSync.native(file) !== file) fail(`${label}_NOT_CANONICAL`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`${label}_IDENTITY_CHANGED_DURING_OPEN`);
    if (opened.nlink !== 1 || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) fail(`${label}_METADATA_CHANGED_DURING_OPEN`);
    if (opened.uid !== stat.uid || opened.mode !== stat.mode) fail(`${label}_SECURITY_METADATA_CHANGED_DURING_OPEN`);
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== opened.size) fail(`${label}_READ_SIZE_MISMATCH`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(`${label}_INVALID_UTF8`); }
    if (text.charCodeAt(0) === 0xfeff || text.includes('\u0000') || text.includes('\r') || !text.endsWith('\n')) fail(`${label}_CANONICAL_TEXT_REQUIRED`);
    return { bytes, text, sha256: sha256(bytes) };
  } finally { fs.closeSync(fd); }
}
function parseJson(record, label) {
  let value;
  try { value = JSON.parse(record.text); } catch { fail(`${label}_INVALID_JSON`); }
  if (!plainObject(value)) fail(`${label}_ROOT_OBJECT_REQUIRED`);
  return value;
}
function parseManifest(text) {
  const result = {};
  for (const line of text.trimEnd().split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) fail('MANIFEST_LINE_INVALID');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (Object.prototype.hasOwnProperty.call(result, key) || !value) fail(`MANIFEST_ENTRY_INVALID:${key}`);
    result[key] = value;
  }
  return result;
}
function publishExclusive(file, bytes, mode, expectedOwner) {
  if (fs.existsSync(file)) fail(`REFUSING_TO_OVERWRITE:${file}`);
  secureDirectory(path.dirname(file), expectedOwner, false, 'PUBLICATION_PARENT');
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`);
  const fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, mode);
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
  if (!result.isFile() || result.isSymbolicLink() || result.nlink !== 1 || result.uid !== expectedOwner || result.size !== bytes.length) fail(`PUBLICATION_NOT_CONFIRMED:${file}`);
  if (process.platform !== 'win32' && (result.mode & 0o777) !== mode) fail(`PUBLICATION_MODE_INVALID:${file}`);
  return sha256(bytes);
}
function removeIfMatching(file, digest, maxBytes, owner) {
  if (!digest || !fs.existsSync(file)) return;
  try {
    const record = secureRead(file, maxBytes, owner, 'ROLLBACK_TARGET');
    if (timingSafeHexEqual(record.sha256, digest)) fs.unlinkSync(file);
  } catch { /* preserve unexpected state for review */ }
}

async function main() {
  const configuredRoot = required('PREVIEW_APP_ROOT', /^\/.+$/);
  if (configuredRoot !== root || path.normalize(configuredRoot) !== configuredRoot) fail('PREVIEW_APP_ROOT_MUST_MATCH');
  if (required('DB_NAME', /^[A-Za-z0-9_]+$/, 128) !== expectedDatabase) fail('DB_NAME_MISMATCH');
  if (required('RELEASE_BRANCH', /^[A-Za-z0-9._/-]+$/, 200) !== expectedBranch) fail('RELEASE_BRANCH_MISMATCH');
  const artifactRoot = required('DEPENDENCY_LOCK_ARTIFACT_ROOT', /^\/.+$/);
  const repository = required('EXPECTED_REPOSITORY', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 200);
  const ref = required('EXPECTED_REF', /^refs\/heads\/[A-Za-z0-9._/-]+$/, 300);
  const sourceCommit = required('EXPECTED_SOURCE_COMMIT', /^[0-9a-f]{40}$/);
  const workflow = required('EXPECTED_WORKFLOW', /^[A-Za-z0-9 ._-]+$/, 200);
  const runId = required('EXPECTED_RUN_ID', /^[1-9][0-9]*$/, 30);
  const runAttempt = required('EXPECTED_RUN_ATTEMPT', /^[1-9][0-9]*$/, 10);
  if (repository !== expectedRepository || ref !== expectedRef || workflow !== expectedWorkflow) fail('EXPECTED_ARTIFACT_IDENTITY_INVALID');
  if (Number.parseInt(process.versions.node.split('.')[0], 10) !== expectedNodeMajor) fail(`NODE_MAJOR_MUST_BE_${expectedNodeMajor}`);
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('MERGE_EXECUTION_FLAG_PROHIBITED');
  if (fs.existsSync(lockTarget) || fs.existsSync(provenanceTarget)) fail('ADOPTION_TARGET_ALREADY_EXISTS');

  const rootIdentity = secureDirectory(root, null, false, 'APPLICATION_ROOT');
  const artifactIdentity = secureDirectory(artifactRoot, rootIdentity.uid, true, 'ARTIFACT_ROOT');
  const verifierEnvironment = Object.freeze({
    PATH: '/usr/bin:/bin',
    HOME: artifactRoot,
    TMPDIR: artifactRoot,
    TEMP: artifactRoot,
    TMP: artifactRoot,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    DEPENDENCY_LOCK_ARTIFACT_ROOT: artifactRoot,
    EXPECTED_REPOSITORY: repository,
    EXPECTED_REF: ref,
    EXPECTED_COMMIT_SHA: sourceCommit,
    EXPECTED_WORKFLOW: workflow,
    EXPECTED_RUN_ID: runId,
    EXPECTED_RUN_ATTEMPT: runAttempt,
    ALLOW_PRODUCTION_MUTATION: 'false',
    ENABLE_CUSTOMER_MERGE_EXECUTION: 'false'
  });
  const verification = spawnSync(process.execPath, [artifactVerifierPath], {
    cwd: root,
    env: verifierEnvironment,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: verifierTimeoutMs,
    killSignal: 'SIGKILL',
    shell: false,
    windowsHide: true
  });
  if (verification.error && verification.error.code === 'ETIMEDOUT') fail('ARTIFACT_VERIFIER_TIMEOUT');
  if (verification.error) fail(`ARTIFACT_VERIFIER_START_FAILED:${verification.error.message}`);
  if (verification.signal) fail(`ARTIFACT_VERIFIER_SIGNALLED:${verification.signal}`);
  if (verification.status !== 0) fail(`ARTIFACT_VERIFIER_FAILED:${verification.status}`);
  let verifierEvidence;
  try { verifierEvidence = JSON.parse(String(verification.stdout || '').trim()); } catch { fail('ARTIFACT_VERIFIER_OUTPUT_INVALID'); }
  if (verifierEvidence.ok !== true || verifierEvidence.check !== 'dependency-lock-artifact-verification') fail('ARTIFACT_VERIFIER_EVIDENCE_INVALID');

  const lockRecord = secureRead(path.join(artifactRoot, 'package-lock.json'), maxLockBytes, artifactIdentity.uid, 'ARTIFACT_PACKAGE_LOCK');
  const manifestRecord = secureRead(path.join(artifactRoot, 'manifest.txt'), maxEvidenceBytes, artifactIdentity.uid, 'ARTIFACT_MANIFEST');
  const generationRecord = secureRead(path.join(artifactRoot, 'dependency-lock-generation.json'), maxEvidenceBytes, artifactIdentity.uid, 'ARTIFACT_GENERATION_EVIDENCE');
  const manifest = parseManifest(manifestRecord.text);
  const generation = parseJson(generationRecord, 'ARTIFACT_GENERATION_EVIDENCE');
  if (manifest.repository !== repository || manifest.ref !== ref || manifest.commit !== sourceCommit || manifest.workflow !== workflow) fail('MANIFEST_SOURCE_IDENTITY_MISMATCH');
  if (manifest.run_id !== runId || manifest.run_attempt !== runAttempt) fail('MANIFEST_RUN_IDENTITY_MISMATCH');
  if (!timingSafeHexEqual(manifest.package_lock_sha256, lockRecord.sha256)) fail('MANIFEST_LOCK_DIGEST_MISMATCH');
  if (!/^[0-9a-f]{64}$/.test(manifest.source_inventory_sha256)) fail('MANIFEST_SOURCE_DIGEST_INVALID');
  if (manifest.production_mutation_enabled !== 'false' || manifest.merge_execution_enabled !== 'false') fail('MANIFEST_SAFETY_INVALID');
  if (generation.ok !== true || generation.application !== expectedApplication || generation.version !== expectedVersion || generation.database !== expectedDatabase || generation.branch !== expectedBranch) fail('GENERATION_EVIDENCE_IDENTITY_INVALID');
  if (!timingSafeHexEqual(generation.packageLockSha256, lockRecord.sha256)) fail('GENERATION_EVIDENCE_LOCK_DIGEST_MISMATCH');
  const generatedAt = new Date(generation.generatedAt);
  if (!Number.isFinite(generatedAt.getTime()) || generatedAt.toISOString() !== generation.generatedAt) fail('GENERATION_TIMESTAMP_INVALID');

  const provenance = Object.freeze({
    application: expectedApplication,
    automaticCommit: false,
    generatedAt: generation.generatedAt,
    mergeExecutionEnabled: false,
    packageLockSha256: lockRecord.sha256,
    productionMutationEnabled: false,
    repository,
    runAttempt: Number(runAttempt),
    runId: Number(runId),
    sourceBranch: expectedBranch,
    sourceCommit,
    sourceInventorySha256: manifest.source_inventory_sha256,
    sourceRef: ref,
    version: expectedVersion,
    workflow
  });
  if (!Number.isSafeInteger(provenance.runId) || !Number.isSafeInteger(provenance.runAttempt)) fail('PROVENANCE_RUN_IDENTITY_INVALID');
  const provenanceBytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  let publishedLockDigest = null;
  let publishedProvenanceDigest = null;
  try {
    publishedLockDigest = publishExclusive(lockTarget, lockRecord.bytes, 0o644, rootIdentity.uid);
    publishedProvenanceDigest = publishExclusive(provenanceTarget, provenanceBytes, 0o644, rootIdentity.uid);
    secureDirectory(root, rootIdentity.uid, false, 'APPLICATION_ROOT_POST_PUBLICATION');
    const publishedLock = secureRead(lockTarget, maxLockBytes, rootIdentity.uid, 'PUBLISHED_PACKAGE_LOCK');
    const publishedProvenance = secureRead(provenanceTarget, maxProvenanceBytes, rootIdentity.uid, 'PUBLISHED_PROVENANCE');
    if (!timingSafeHexEqual(publishedLock.sha256, lockRecord.sha256) || !timingSafeHexEqual(publishedProvenance.sha256, sha256(provenanceBytes))) fail('PUBLISHED_ADOPTION_DIGEST_MISMATCH');
    console.log(JSON.stringify({
      ok: true,
      check: 'dependency-lock-adoption-materialization',
      meaningfulControls: 60,
      application: expectedApplication,
      version: expectedVersion,
      repository,
      sourceRef: ref,
      sourceCommit,
      workflow,
      runId: provenance.runId,
      runAttempt: provenance.runAttempt,
      packageLockSha256: publishedLock.sha256,
      provenanceSha256: publishedProvenance.sha256,
      sourceInventorySha256: provenance.sourceInventorySha256,
      artifactVerifierPassed: true,
      artifactIdentityReverified: true,
      exclusiveNoOverwritePublication: true,
      packageLockPublished: true,
      provenancePublished: true,
      automaticCommit: false,
      gitMutationExecuted: false,
      productionMutationEnabled: false,
      mergeExecutionEnabled: false
    }, null, 2));
  } catch (error) {
    removeIfMatching(provenanceTarget, publishedProvenanceDigest, maxProvenanceBytes, rootIdentity.uid);
    removeIfMatching(lockTarget, publishedLockDigest, maxLockBytes, rootIdentity.uid);
    throw error;
  }
}

main().catch(error => {
  console.error(`DEPENDENCY LOCK ADOPTION MATERIALIZATION FAILED: ${error.message}`);
  process.exit(1);
});
