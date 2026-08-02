'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PREVIEW_DB = 'kloka_talk2me';
const RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild';
const MAX_BACKUP_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const CONNECTION_TIMEOUT_MS = 10000;

function required(name, maxLength = 1024) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > maxLength || /[\u0000\r\n]/.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}
function validatePort(value) {
  const port = Number(value || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT_INVALID');
  return port;
}
function secureRead(filePath, expectedOwner) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BACKUP_FILE_NOT_REGULAR');
  if (stat.nlink !== 1) throw new Error('BACKUP_HARD_LINK_PROHIBITED');
  if (stat.size <= 1024 || stat.size > MAX_BACKUP_BYTES) throw new Error('BACKUP_FILE_SIZE_INVALID');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('BACKUP_FILE_NOT_PRIVATE');
  if (process.platform !== 'win32' && Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) throw new Error('BACKUP_FILE_OWNER_MISMATCH');
  if (fs.realpathSync.native(filePath) !== filePath) throw new Error('BACKUP_FILE_NOT_CANONICAL');
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs || opened.nlink !== 1) throw new Error('BACKUP_FILE_CHANGED_DURING_OPEN');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesReadTotal = 0;
    let header = Buffer.alloc(0);
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytesReadTotal += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
      if (header.length < MAX_HEADER_BYTES) header = Buffer.concat([header, buffer.subarray(0, Math.min(bytesRead, MAX_HEADER_BYTES - header.length))]);
      if (bytesReadTotal > MAX_BACKUP_BYTES) throw new Error('BACKUP_FILE_EXCEEDS_LIMIT');
    }
    if (bytesReadTotal !== opened.size) throw new Error('BACKUP_READ_SIZE_MISMATCH');
    const after = fs.fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ino !== opened.ino) throw new Error('BACKUP_FILE_CHANGED_DURING_READ');
    return { checksum: hash.digest('hex'), size: bytesReadTotal, headerText: header.toString('utf8') };
  } finally { fs.closeSync(fd); }
}
async function verifyDatabaseIdentity(pool) {
  const [[row]] = await pool.execute('SELECT DATABASE() AS database_name, CONNECTION_ID() AS connection_id');
  if (!row || row.database_name !== PREVIEW_DB) throw new Error('DATABASE_IDENTITY_MISMATCH');
  if (!Number.isInteger(Number(row.connection_id)) || Number(row.connection_id) <= 0) throw new Error('DATABASE_CONNECTION_ID_INVALID');
  await pool.query("SET SESSION time_zone = '+00:00'");
}

async function main() {
  if (required('DB_NAME', 128) !== PREVIEW_DB) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  if (required('RELEASE_BRANCH', 255) !== RELEASE_BRANCH) throw new Error('RELEASE_BRANCH_MISMATCH');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');
  const backupId = Number(process.argv[2] || process.env.BACKUP_ID);
  if (!Number.isInteger(backupId) || backupId <= 0) throw new Error('VALID_BACKUP_ID_REQUIRED');
  const host = required('DB_HOST', 255);
  const user = required('DB_USER', 128);
  const port = validatePort(process.env.DB_PORT);
  const pool = mysql.createPool({ host, port, user, password: process.env.DB_PASSWORD || '', database: PREVIEW_DB, connectionLimit: 1, namedPlaceholders: false, charset: 'utf8mb4', connectTimeout: CONNECTION_TIMEOUT_MS, enableKeepAlive: false });
  try {
    await verifyDatabaseIdentity(pool);
    const [[record]] = await pool.execute('SELECT id,backup_type,status,database_name,storage_path,file_name,checksum_sha256,file_size_bytes,table_count,row_count_estimate,started_at,completed_at,verified_at,failure_reason FROM os2_backup_runs WHERE id=?', [backupId]);
    if (!record) throw new Error('BACKUP_NOT_FOUND');
    if (!['completed','verified'].includes(record.status)) throw new Error('BACKUP_NOT_COMPLETED');
    if (record.backup_type !== 'database' || record.database_name !== PREVIEW_DB) throw new Error('BACKUP_RECORD_IDENTITY_INVALID');
    if (!record.storage_path || !path.isAbsolute(record.storage_path) || path.normalize(record.storage_path) !== record.storage_path) throw new Error('BACKUP_STORAGE_PATH_INVALID');
    if (record.storage_path.includes('/public_html/') || record.storage_path.endsWith('/public_html')) throw new Error('BACKUP_STORAGE_PATH_PUBLIC');
    if (!/^talk2me-preview-[0-9TZ-]+-[0-9a-f]{12}\.sql$/.test(String(record.file_name || ''))) throw new Error('BACKUP_FILENAME_INVALID');
    const directoryStat = fs.lstatSync(record.storage_path);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('BACKUP_DIRECTORY_NOT_SECURE');
    if (process.platform !== 'win32' && (directoryStat.mode & 0o077) !== 0) throw new Error('BACKUP_DIRECTORY_NOT_PRIVATE');
    const filePath = path.join(record.storage_path, record.file_name);
    if (path.dirname(filePath) !== record.storage_path) throw new Error('BACKUP_PATH_ESCAPE_DETECTED');
    const observed = secureRead(filePath, directoryStat.uid);
    if (!/^[0-9a-f]{64}$/.test(String(record.checksum_sha256 || ''))) throw new Error('RECORDED_CHECKSUM_INVALID');
    if (!crypto.timingSafeEqual(Buffer.from(observed.checksum, 'hex'), Buffer.from(record.checksum_sha256, 'hex'))) throw new Error('BACKUP_CHECKSUM_MISMATCH');
    if (Number(record.file_size_bytes) !== observed.size) throw new Error('BACKUP_RECORDED_SIZE_MISMATCH');
    if (!Number.isInteger(Number(record.table_count)) || Number(record.table_count) < 1) throw new Error('BACKUP_TABLE_COUNT_INVALID');
    if (!Number.isFinite(Number(record.row_count_estimate)) || Number(record.row_count_estimate) < 0) throw new Error('BACKUP_ROW_ESTIMATE_INVALID');
    if (!record.started_at || !record.completed_at || new Date(record.completed_at) < new Date(record.started_at)) throw new Error('BACKUP_TIMELINE_INVALID');
    if (record.failure_reason) throw new Error('BACKUP_FAILURE_REASON_PRESENT');
    const headerChecks = {
      sqlMarkers: /CREATE TABLE|INSERT INTO|LOCK TABLES|SET /i.test(observed.headerText),
      previewDatabaseReference: observed.headerText.includes(PREVIEW_DB) || /CREATE TABLE/i.test(observed.headerText),
      noHtml: !/<html|<!doctype html/i.test(observed.headerText),
      noNul: !observed.headerText.includes('\u0000')
    };
    if (!Object.values(headerChecks).every(Boolean)) throw new Error('BACKUP_HEADER_VERIFICATION_FAILED');
    const metadata = { verification: { secureDescriptorRead: true, checksumMatches: true, sizeMatches: true, canonicalPath: true, privatePermissions: true, singleHardLink: true, headerChecks }, verifiedChecksum: observed.checksum, verifiedSize: observed.size, verifiedAt: new Date().toISOString() };
    const [update] = await pool.execute("UPDATE os2_backup_runs SET status='verified',verified_at=UTC_TIMESTAMP(),metadata_json=?,failure_reason=NULL,updated_at=UTC_TIMESTAMP() WHERE id=? AND status IN ('completed','verified')", [JSON.stringify(metadata), backupId]);
    if (Number(update.affectedRows) !== 1) throw new Error('BACKUP_VERIFICATION_UPDATE_NOT_CONFIRMED');
    const [operational] = await pool.execute("INSERT INTO os2_operational_checks(check_type,status,metric_value,metric_unit,details_json,checked_at,worker_id) VALUES ('backup_file_verification','passed',?,'bytes',?,UTC_TIMESTAMP(),?)", [observed.size, JSON.stringify({ backupId, checksum: observed.checksum, headerChecks }), `backup-verification:${process.pid}`]);
    if (Number(operational.affectedRows) !== 1) throw new Error('BACKUP_OPERATIONAL_EVIDENCE_NOT_CONFIRMED');
    console.log(JSON.stringify({ ok: true, check: 'preview-backup-verification', backupId, filePath, size: observed.size, checksum: observed.checksum, database: PREVIEW_DB, branch: RELEASE_BRANCH, secureDescriptorRead: true, checksumMatches: true, recordedSizeMatches: true, canonicalPathVerified: true, privatePermissionsVerified: true, hardLinkCountVerified: true, headerChecks, operationalEvidenceRecorded: true, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  } finally { await pool.end(); }
}

main().catch(error => { console.error(`BACKUP VERIFICATION FAILED: ${error.message}`); process.exit(1); });
