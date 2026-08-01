'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fail(message) {
  console.error(JSON.stringify({ ok: false, check: 'release-manifest-verification', error: message }, null, 2));
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const expectedPreviewVersion = '0.59.0';
const manifestPath = String(process.env.RELEASE_MANIFEST_PATH || '').trim();
if (!manifestPath) fail('RELEASE_MANIFEST_PATH is required');
if (!path.isAbsolute(manifestPath)) fail('RELEASE_MANIFEST_PATH must be absolute');

const evidenceDirectory = path.dirname(manifestPath);
let directoryStat;
try {
  directoryStat = fs.lstatSync(evidenceDirectory);
} catch {
  fail(`Release evidence directory is missing: ${evidenceDirectory}`);
}
if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
  fail(`Release evidence directory must be a real non-symlink directory: ${evidenceDirectory}`);
}
if (process.platform !== 'win32' && (directoryStat.mode & 0o077) !== 0) {
  fail(`Release evidence directory must not permit group or world access: ${evidenceDirectory}`);
}
let canonicalDirectory;
try {
  canonicalDirectory = fs.realpathSync.native(evidenceDirectory);
} catch {
  fail(`Release evidence directory cannot be resolved canonically: ${evidenceDirectory}`);
}
if (canonicalDirectory !== evidenceDirectory) {
  fail(`Release evidence directory path is not canonical: ${evidenceDirectory}`);
}

const checksumPath = `${manifestPath}.sha256`;
for (const file of [manifestPath, checksumPath]) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    fail(`Required release evidence file is missing: ${file}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Release evidence must be a regular non-symlink file: ${file}`);
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) fail(`Release evidence permissions must be 0600: ${file}`);
  let canonicalFile;
  try {
    canonicalFile = fs.realpathSync.native(file);
  } catch {
    fail(`Release evidence file cannot be resolved canonically: ${file}`);
  }
  if (canonicalFile !== file) fail(`Release evidence file path is not canonical: ${file}`);
}

const manifestBytes = fs.readFileSync(manifestPath);
const checksumText = fs.readFileSync(checksumPath, 'utf8');
const checksumMatch = checksumText.match(/^([0-9a-f]{64})  ([^\r\n]+)\r?\n$/i);
if (!checksumMatch) fail('Release manifest checksum file has an invalid format');
if (checksumMatch[2] !== path.basename(manifestPath)) fail('Release manifest checksum filename does not match the manifest');

const expectedChecksum = checksumMatch[1].toLowerCase();
const actualChecksum = sha256(manifestBytes);
if (!crypto.timingSafeEqual(Buffer.from(expectedChecksum, 'hex'), Buffer.from(actualChecksum, 'hex'))) {
  fail('Release manifest checksum verification failed');
}

let manifest;
try {
  manifest = JSON.parse(manifestBytes.toString('utf8'));
} catch {
  fail('Release manifest is not valid JSON');
}

const requiredChecks = [
  'preview-data-verification.js',
  'merge-restore-pin-check.js',
  'merge-restore-evidence-verification.js',
  'customer-merge-execution-readiness-check.js',
  'schema-source-consistency-check.js'
];
const requiredScripts = [
  'verify:schema',
  'verify:preview-data',
  'verify:merge-restore-evidence',
  'check:merge-restore-pin',
  'check:customer-merge-execution-readiness'
];
const expectedPreviewDataOrder = [
  'schema-verification.js',
  'merge-restore-evidence-verification.js'
];

if (manifest.ok !== true) fail('Release manifest is not marked successful');
if (manifest.version !== expectedPreviewVersion) fail(`Release manifest version must be ${expectedPreviewVersion}`);
if (manifest.branch !== 'agent/talk2me-os2-integrated-rebuild') fail('Release manifest branch is not the controlled rebuild branch');
if (!/^[0-9a-f]{40}$/i.test(String(manifest.commitSha || ''))) fail('Release manifest commit SHA is invalid');
if (manifest.commitIdentityVerified !== true) fail('Release manifest commit identity is not verified');
if (manifest.dependencyLockPresent !== true) fail('Release manifest does not confirm a committed dependency lock');
if (!/^[0-9a-f]{64}$/i.test(String(manifest.dependencyLockSha256 || ''))) fail('Release manifest dependency-lock checksum is invalid');
if (manifest.restorePinMigration !== '20260801_025_merge_authorisation_restore_pin.sql') fail('Release manifest restore-pin migration is invalid');
if (manifest.previewDataVerificationRequired !== true) fail('Release manifest does not require preview data verification');
if (!Array.isArray(manifest.previewDataVerificationOrder) ||
    manifest.previewDataVerificationOrder.length !== expectedPreviewDataOrder.length ||
    expectedPreviewDataOrder.some((item, index) => manifest.previewDataVerificationOrder[index] !== item)) {
  fail('Release manifest preview data verification order is invalid');
}
if (manifest.mergeExecutionEnabled !== false) fail('Release manifest must keep customer-merge execution disabled');
if (!Array.isArray(manifest.failures) || manifest.failures.length !== 0) fail('Release manifest contains blocking failures');
if (!Array.isArray(manifest.migrationChecksums) || manifest.migrationChecksums.length < 25) fail('Release manifest migration evidence is incomplete');
if (!Array.isArray(manifest.requiredChecks) || requiredChecks.some(item => !manifest.requiredChecks.includes(item))) fail('Release manifest required-check inventory is incomplete');
if (!Array.isArray(manifest.requiredScripts) || requiredScripts.some(item => !manifest.requiredScripts.includes(item))) fail('Release manifest required-script inventory is incomplete');

console.log(JSON.stringify({
  ok: true,
  check: 'release-manifest-verification',
  manifestPath,
  evidenceDirectory,
  evidenceDirectoryCanonical: true,
  evidenceDirectoryPrivate: true,
  manifestSha256: actualChecksum,
  version: manifest.version,
  expectedPreviewVersion,
  commitSha: manifest.commitSha,
  branch: manifest.branch,
  migrationCount: manifest.migrationCount,
  previewDataVerificationRequired: manifest.previewDataVerificationRequired,
  previewDataVerificationOrder: manifest.previewDataVerificationOrder,
  mergeExecutionEnabled: manifest.mergeExecutionEnabled
}, null, 2));
