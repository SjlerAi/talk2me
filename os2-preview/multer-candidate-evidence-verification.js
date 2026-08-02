'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPECTED_KEYS = Object.freeze([
  'schemaVersion','check','ok','repository','branch','sourceCommit','application','applicationVersion',
  'currentMulter','candidateMulter','approvalPhrase','approvingOwner','approvedAt','generatedAt',
  'sourcePackageSha256','candidatePackageSha256','candidateLockSha256','sourceInventorySha256',
  'onlyMulterDependencyChanged','sourceManifestUnchanged','committedLockUnchanged','lifecycleScriptsExecuted',
  'sourceTreeNodeModulesCreated','dependencyAdoptionAuthorized','previewActivationAuthorized',
  'productionMutationEnabled','rollbackRequired','rollbackCompleted'
]);
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_JSON = 128 * 1024;
const MAX_FILE = 16 * 1024 * 1024;

function fail(code) { throw new Error(code); }
function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) fail(`INVALID_${name}`);
  return value;
}
function readRegular(file, maxBytes, label) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) fail(`${label}_PATH_INVALID`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail(`${label}_NOT_REGULAR_FILE`);
  if (stat.size <= 0 || stat.size > maxBytes) fail(`${label}_SIZE_INVALID`);
  return fs.readFileSync(file);
}
function parseCanonicalJson(bytes, label) {
  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').length !== bytes.length || text.includes('\r') || !text.endsWith('\n')) fail(`${label}_CANONICAL_JSON_REQUIRED`);
  let value;
  try { value = JSON.parse(text); } catch { fail(`${label}_INVALID_JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}_OBJECT_REQUIRED`);
  return value;
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function equalDigest(expected, actual, label) {
  if (!HEX64.test(expected) || !HEX64.test(actual)) fail(`${label}_DIGEST_FORMAT_INVALID`);
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))) fail(`${label}_DIGEST_MISMATCH`);
}
function exactKeys(value) {
  const keys = Object.keys(value);
  return keys.length === EXPECTED_KEYS.length && keys.every((key, index) => key === EXPECTED_KEYS[index]);
}
function validOwner(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function main() {
  const evidenceBytes = readRegular(required('MULTER_CANDIDATE_EVIDENCE_PATH'), MAX_JSON, 'EVIDENCE');
  const approvalBytes = readRegular(required('MULTER_GENERATION_APPROVAL_PATH'), MAX_JSON, 'APPROVAL');
  const sourcePackageBytes = readRegular(required('MULTER_SOURCE_PACKAGE_PATH'), MAX_JSON, 'SOURCE_PACKAGE');
  const candidatePackageBytes = readRegular(required('MULTER_CANDIDATE_PACKAGE_PATH'), MAX_JSON, 'CANDIDATE_PACKAGE');
  const candidateLockBytes = readRegular(required('MULTER_CANDIDATE_LOCK_PATH'), MAX_FILE, 'CANDIDATE_LOCK');
  const inventoryBytes = readRegular(required('MULTER_SOURCE_INVENTORY_PATH'), MAX_FILE, 'SOURCE_INVENTORY');

  const evidence = parseCanonicalJson(evidenceBytes, 'EVIDENCE');
  const approval = parseCanonicalJson(approvalBytes, 'APPROVAL');
  const sourcePackage = parseCanonicalJson(sourcePackageBytes, 'SOURCE_PACKAGE');
  const candidatePackage = parseCanonicalJson(candidatePackageBytes, 'CANDIDATE_PACKAGE');
  parseCanonicalJson(candidateLockBytes, 'CANDIDATE_LOCK');

  if (!exactKeys(evidence)) fail('EVIDENCE_KEYS_INVALID');
  if (evidence.schemaVersion !== 1 || evidence.check !== 'multer-2-candidate-evidence' || evidence.ok !== true) fail('EVIDENCE_IDENTITY_INVALID');
  if (evidence.repository !== 'SjlerAi/talk2me' || evidence.branch !== 'agent/talk2me-os2-integrated-rebuild') fail('SOURCE_LOCATION_INVALID');
  if (!HEX40.test(evidence.sourceCommit) || evidence.application !== 'talk2me-os2-preview' || evidence.applicationVersion !== '0.60.0') fail('SOURCE_IDENTITY_INVALID');
  if (evidence.currentMulter !== '^1.4.5-lts.1' || evidence.candidateMulter !== '2.2.0') fail('MULTER_VERSION_INVALID');
  if (evidence.approvalPhrase !== 'APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION' || !validOwner(evidence.approvingOwner)) fail('APPROVAL_IDENTITY_INVALID');
  if (!UTC_MS.test(evidence.approvedAt) || !UTC_MS.test(evidence.generatedAt)) fail('TIMESTAMP_FORMAT_INVALID');
  const approvedAt = Date.parse(evidence.approvedAt);
  const generatedAt = Date.parse(evidence.generatedAt);
  if (!Number.isFinite(approvedAt) || !Number.isFinite(generatedAt) || generatedAt < approvedAt || generatedAt - approvedAt > 24 * 60 * 60 * 1000) fail('APPROVAL_WINDOW_INVALID');

  if (approval.phrase !== evidence.approvalPhrase || approval.owner !== evidence.approvingOwner || approval.approvedAt !== evidence.approvedAt || approval.sourceCommit !== evidence.sourceCommit) fail('APPROVAL_BINDING_INVALID');
  if (approval.branch !== evidence.branch || approval.application !== evidence.application || approval.applicationVersion !== evidence.applicationVersion || approval.candidateMulter !== evidence.candidateMulter) fail('APPROVAL_SCOPE_INVALID');

  if (sourcePackage.name !== 'talk2me-os2-preview' || sourcePackage.version !== '0.60.0' || sourcePackage.dependencies.multer !== '^1.4.5-lts.1') fail('SOURCE_PACKAGE_INVALID');
  if (candidatePackage.name !== sourcePackage.name || candidatePackage.version !== sourcePackage.version || candidatePackage.dependencies.multer !== '2.2.0') fail('CANDIDATE_PACKAGE_INVALID');
  const sourceClone = JSON.parse(JSON.stringify(sourcePackage));
  const candidateClone = JSON.parse(JSON.stringify(candidatePackage));
  sourceClone.dependencies.multer = '2.2.0';
  if (JSON.stringify(sourceClone) !== JSON.stringify(candidateClone)) fail('CANDIDATE_PACKAGE_DIFF_INVALID');

  equalDigest(evidence.sourcePackageSha256, sha256(sourcePackageBytes), 'SOURCE_PACKAGE');
  equalDigest(evidence.candidatePackageSha256, sha256(candidatePackageBytes), 'CANDIDATE_PACKAGE');
  equalDigest(evidence.candidateLockSha256, sha256(candidateLockBytes), 'CANDIDATE_LOCK');
  equalDigest(evidence.sourceInventorySha256, sha256(inventoryBytes), 'SOURCE_INVENTORY');

  for (const key of ['onlyMulterDependencyChanged','sourceManifestUnchanged','committedLockUnchanged']) if (evidence[key] !== true) fail(`${key.toUpperCase()}_REQUIRED`);
  for (const key of ['lifecycleScriptsExecuted','sourceTreeNodeModulesCreated','dependencyAdoptionAuthorized','previewActivationAuthorized','productionMutationEnabled']) if (evidence[key] !== false) fail(`${key.toUpperCase()}_PROHIBITED`);
  if (typeof evidence.rollbackRequired !== 'boolean' || typeof evidence.rollbackCompleted !== 'boolean') fail('ROLLBACK_STATE_INVALID');
  if (evidence.rollbackRequired && !evidence.rollbackCompleted) fail('ROLLBACK_INCOMPLETE');

  console.log(JSON.stringify({
    ok: true,
    check: 'multer-candidate-evidence-verification',
    schemaVersion: evidence.schemaVersion,
    exactKeyCount: EXPECTED_KEYS.length,
    approvalBound: true,
    approvalWindowHours: 24,
    digestsVerified: 4,
    onlyMulterDependencyChanged: true,
    adoptionAuthorized: false,
    previewActivationAuthorized: false,
    productionMutationEnabled: false
  }, null, 2));
}

try { main(); } catch (error) {
  console.error(`MULTER CANDIDATE EVIDENCE VERIFICATION FAILED: ${error.message}`);
  process.exit(1);
}
