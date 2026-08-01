'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const expectedDatabase = 'kloka_talk2me';
const expectedBootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql';
const expectedBootstrapSha256 = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(__dirname, expectedBootstrapFile)))
  .digest('hex');

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    check: 'migration-ledger-bootstrap-evidence-verification',
    error: message,
    productionMutationEnabled: false,
    mergeExecutionEnabled: false
  }, null, 2));
  process.exit(1);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function secureRead(file, label, maxBytes) {
  if (!path.isAbsolute(file)) fail(`${label} path must be absolute`);
  if (path.normalize(file) !== file) fail(`${label} path must be normalized`);
  let pathStat;
  try { pathStat = fs.lstatSync(file); } catch { fail(`${label} is missing: ${file}`); }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  if (pathStat.nlink !== 1) fail(`${label} must not have additional hard links`);
  if (pathStat.size > maxBytes) fail(`${label} exceeds the maximum permitted size`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o077) !== 0) fail(`${label} must not permit group or world access`);
  if (fs.realpathSync.native(file) !== file) fail(`${label} path must be canonical`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW is required for bootstrap evidence verification');

  let descriptor;
  try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { fail(`Unable to securely open ${label}: ${error.message}`); }
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) fail(`${label} descriptor is not a regular file`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) fail(`${label} changed during secure open`);
    if (descriptorStat.nlink !== 1) fail(`${label} descriptor has additional hard links`);
    if (descriptorStat.size > maxBytes) fail(`${label} descriptor exceeds the maximum permitted size`);
    if (process.platform !== 'win32' && (descriptorStat.mode & 0o077) !== 0) fail(`${label} descriptor permits group or world access`);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

const evidencePath = String(process.env.MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH || '').trim();
if (!evidencePath) fail('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH is required');
const checksumPath = `${evidencePath}.sha256`;
const evidenceBytes = secureRead(evidencePath, 'Bootstrap evidence file', 1024 * 1024);
const checksumBytes = secureRead(checksumPath, 'Bootstrap evidence checksum file', 4096);
const checksumMatch = checksumBytes.toString('utf8').match(/^([0-9a-f]{64})  ([^\r\n]+)\r?\n$/i);
if (!checksumMatch) fail('Bootstrap evidence checksum file has an invalid format');
if (checksumMatch[2] !== path.basename(evidencePath)) fail('Bootstrap evidence checksum filename does not match evidence file');
const actualEvidenceSha256 = sha256(evidenceBytes);
if (!crypto.timingSafeEqual(Buffer.from(checksumMatch[1], 'hex'), Buffer.from(actualEvidenceSha256, 'hex'))) {
  fail('Bootstrap evidence checksum verification failed');
}

let evidence;
try { evidence = JSON.parse(evidenceBytes.toString('utf8')); }
catch { fail('Bootstrap evidence is not valid JSON'); }

if (evidence.ok !== true) fail('Bootstrap evidence is not marked successful');
if (evidence.database !== expectedDatabase) fail(`Bootstrap evidence database must be ${expectedDatabase}`);
if (evidence.bootstrapFile !== expectedBootstrapFile) fail('Bootstrap evidence file identity is invalid');
if (String(evidence.bootstrapSha256 || '').toLowerCase() !== expectedBootstrapSha256) fail('Bootstrap evidence source checksum does not match the checked-out bootstrap');
if (!/^[0-9a-f]{64}$/i.test(String(evidence.verifiedBackupSha256 || ''))) fail('Verified backup checksum evidence is invalid');
if (typeof evidence.verifiedBackupReference !== 'string' || !evidence.verifiedBackupReference.trim()) fail('Verified backup reference is missing');
if (typeof evidence.operator !== 'string' || !evidence.operator.trim()) fail('Bootstrap operator evidence is missing');
if (typeof evidence.changeReference !== 'string' || !evidence.changeReference.trim()) fail('Bootstrap change reference is missing');
if (evidence.preexistingLedgerTableCount !== 0) fail('Bootstrap evidence does not confirm the ledger table was absent');
if (evidence.createdLedgerTableCount !== 1) fail('Bootstrap evidence does not confirm exactly one ledger table was created');
if (evidence.ledgerSchemaVerified !== true) fail('Bootstrap evidence does not confirm ledger schema verification');
if (evidence.ledgerRowCount !== 0 || evidence.ledgerEmpty !== true) fail('Bootstrap evidence does not confirm an empty ledger');
if (evidence.advisoryLockUsed !== true || evidence.advisoryLockOwnerVerified !== true || evidence.advisoryLockReleased !== true) {
  fail('Bootstrap evidence does not confirm advisory lock lifecycle');
}
if (evidence.productionMutationEnabled !== false) fail('Bootstrap evidence must keep production mutation disabled');
if (evidence.mergeExecutionEnabled !== false) fail('Bootstrap evidence must keep customer-merge execution disabled');
const startedAt = Date.parse(String(evidence.startedAt || ''));
const completedAt = Date.parse(String(evidence.completedAt || ''));
if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) fail('Bootstrap evidence timestamps are invalid');
if (completedAt > Date.now() + 300000) fail('Bootstrap evidence completion timestamp is unreasonably in the future');

console.log(JSON.stringify({
  ok: true,
  check: 'migration-ledger-bootstrap-evidence-verification',
  evidencePath,
  evidenceSha256: actualEvidenceSha256,
  database: evidence.database,
  bootstrapFile: evidence.bootstrapFile,
  bootstrapMatchesWorkspace: true,
  verifiedBackupEvidencePresent: true,
  ledgerAbsentBeforeBootstrap: true,
  ledgerSchemaVerified: true,
  ledgerEmpty: true,
  advisoryLockLifecycleVerified: true,
  operator: evidence.operator,
  changeReference: evidence.changeReference,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false
}, null, 2));
