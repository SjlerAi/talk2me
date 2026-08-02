'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const PREVIEW_DB = 'kloka_talk2me';
const RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild';
const DUMP_TIMEOUT_MS = 15 * 60 * 1000;
const CONNECTION_TIMEOUT_MS = 10000;
const STDERR_LIMIT = 64 * 1024;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024 * 1024;

function required(name, maxLength = 1024) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  if (value.length > maxLength || /[\u0000\r\n]/.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}
function validatePort(value) {
  const port = Number(value || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT_INVALID');
  return port;
}
function secureDirectory(directory) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) throw new Error('BACKUP_DIRECTORY_MUST_BE_ABSOLUTE_AND_NORMALIZED');
  if (directory.includes('/public_html/') || directory.endsWith('/public_html')) throw new Error('BACKUP_DIRECTORY_MUST_NOT_BE_PUBLIC');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BACKUP_DIRECTORY_NOT_SECURE');
  if (fs.realpathSync.native(directory) !== directory) throw new Error('BACKUP_DIRECTORY_NOT_CANONICAL');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('BACKUP_DIRECTORY_MUST_BE_PRIVATE');
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('BACKUP_DIRECTORY_OWNER_MISMATCH');
  if (typeof fs.constants.O_NOFOLLOW !== 'number' || typeof fs.constants.O_DIRECTORY !== 'number') throw new Error('SECURE_DIRECTORY_FLAGS_UNAVAILABLE');
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error('BACKUP_DIRECTORY_CHANGED_DURING_OPEN');
    return { dev: opened.dev, ino: opened.ino, uid: opened.uid, mode: opened.mode, mtimeMs: opened.mtimeMs };
  } finally { fs.closeSync(fd); }
}
function ensureSafeConfiguration() {
  if (required('DB_NAME', 128) !== PREVIEW_DB) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  if (required('RELEASE_BRANCH', 255) !== RELEASE_BRANCH) throw new Error('RELEASE_BRANCH_MISMATCH');
  if (String(process.env.ALLOW_PREVIEW_BACKUPS || '').toLowerCase() !== 'true') throw new Error('PREVIEW_BACKUPS_NOT_ENABLED');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');
  return secureDirectory(required('BACKUP_PRIVATE_DIR', 2048));
}
function buildDumpEnvironment() {
  const env = {};
  for (const key of ['PATH','HOME','USER','LOGNAME','TMPDIR','TEMP','TMP','LANG','LC_ALL','TZ']) if (process.env[key]) env[key] = process.env[key];
  env.MYSQL_PWD = process.env.DB_PASSWORD || '';
  return Object.freeze(env);
}
function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW });
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function validateDumpBinary() {
  const binary = String(process.env.MYSQLDUMP_BIN || 'mysqldump').trim();
  if (!binary || /[\u0000\r\n]/.test(binary)) throw new Error('MYSQLDUMP_BIN_INVALID');
  if (binary.includes('/') && (!path.isAbsolute(binary) || path.normalize(binary) !== binary)) throw new Error('MYSQLDUMP_BIN_MUST_BE_CANONICAL');
  return binary;
}
function runDump(filePath, config) {
  const args = [
    '--single-transaction','--quick','--routines','--triggers','--events','--hex-blob','--set-gtid-purged=OFF',
    '--default-character-set=utf8mb4','--skip-comments','--skip-dump-date','--no-tablespaces',
    '-h', config.host, '-P', String(config.port), '-u', config.user, PREVIEW_DB
  ];
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const output = fs.createWriteStream(null, { fd, autoClose: true });
    const child = spawn(validateDumpBinary(), args, { env: buildDumpEnvironment(), stdio: ['ignore','pipe','pipe'], shell: false, windowsHide: true });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), DUMP_TIMEOUT_MS);
    child.stderr.on('data', chunk => { if (stderr.length < STDERR_LIMIT) stderr += String(chunk).slice(0, STDERR_LIMIT - stderr.length); });
    child.stdout.pipe(output);
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output.end();
      if (code !== 0) return reject(new Error(`MYSQLDUMP_FAILED_${code}:${stderr.slice(-2000)}`));
      resolve({ stderrBytes: Buffer.byteLength(stderr, 'utf8') });
    });
  });
}
async function verifyDatabaseIdentity(pool) {
  const [[row]] = await pool.execute('SELECT DATABASE() AS database_name, CONNECTION_ID() AS connection_id, @@session.time_zone AS time_zone_value');
  if (!row || row.database_name !== PREVIEW_DB) throw new Error('DATABASE_IDENTITY_MISMATCH');
  if (!Number.isInteger(Number(row.connection_id)) || Number(row.connection_id) <= 0) throw new Error('DATABASE_CONNECTION_ID_INVALID');
  await pool.query("SET SESSION time_zone = '+00:00'");
  const [[timezone]] = await pool.execute('SELECT @@session.time_zone AS time_zone_value');
  if (!timezone || timezone.time_zone_value !== '+00:00') throw new Error('UTC_SESSION_REQUIRED');
  return Number(row.connection_id);
}

async function main() {
  const backupDirIdentity = ensureSafeConfiguration();
  const backupDir = required('BACKUP_PRIVATE_DIR', 2048);
  const host = required('DB_HOST', 255);
  const user = required('DB_USER', 128);
  const port = validatePort(process.env.DB_PORT);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `talk2me-preview-${stamp}-${crypto.randomBytes(6).toString('hex')}.sql`;
  if (!/^talk2me-preview-[0-9TZ-]+-[0-9a-f]{12}\.sql$/.test(fileName)) throw new Error('BACKUP_FILENAME_INVALID');
  const filePath = path.join(backupDir, fileName);
  if (path.dirname(filePath) !== backupDir) throw new Error('BACKUP_PATH_ESCAPE_DETECTED');
  const workerId = `${os.hostname()}:${process.pid}`.slice(0, 160);
  const pool = mysql.createPool({ host, port, user, password: process.env.DB_PASSWORD || '', database: PREVIEW_DB, connectionLimit: 1, namedPlaceholders: false, charset: 'utf8mb4', connectTimeout: CONNECTION_TIMEOUT_MS, enableKeepAlive: false });
  let backupId;
  let fileCreated = false;
  try {
    const connectionId = await verifyDatabaseIdentity(pool);
    const [insert] = await pool.execute("INSERT INTO os2_backup_runs (backup_type,status,database_name,storage_path,file_name,worker_id,started_at,created_at,updated_at) VALUES ('database','running',?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())", [PREVIEW_DB, backupDir, fileName, workerId]);
    backupId = Number(insert.insertId);
    if (!Number.isInteger(backupId) || backupId <= 0 || Number(insert.affectedRows) !== 1) throw new Error('BACKUP_RECORD_INSERT_NOT_CONFIRMED');
    const [[stats]] = await pool.execute('SELECT COUNT(*) table_count,COALESCE(SUM(TABLE_ROWS),0) row_count_estimate FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [PREVIEW_DB]);
    const tableCount = Number(stats.table_count);
    const rowCountEstimate = Number(stats.row_count_estimate);
    if (!Number.isInteger(tableCount) || tableCount < 1) throw new Error('BACKUP_TABLE_COUNT_INVALID');
    if (!Number.isFinite(rowCountEstimate) || rowCountEstimate < 0) throw new Error('BACKUP_ROW_ESTIMATE_INVALID');
    await runDump(filePath, { host, port, user });
    fileCreated = true;
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('BACKUP_FILE_NOT_SECURE');
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('BACKUP_FILE_NOT_PRIVATE');
    if (process.platform !== 'win32' && stat.uid !== backupDirIdentity.uid) throw new Error('BACKUP_FILE_OWNER_MISMATCH');
    if (stat.size <= 1024 || stat.size > MAX_BACKUP_BYTES) throw new Error('BACKUP_FILE_SIZE_INVALID');
    if (fs.realpathSync.native(filePath) !== filePath) throw new Error('BACKUP_FILE_NOT_CANONICAL');
    const checksum = await sha256(filePath);
    if (!/^[0-9a-f]{64}$/.test(checksum)) throw new Error('BACKUP_CHECKSUM_INVALID');
    const [update] = await pool.execute("UPDATE os2_backup_runs SET status='completed',checksum_sha256=?,file_size_bytes=?,table_count=?,row_count_estimate=?,completed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP(),failure_reason=NULL WHERE id=? AND status='running'", [checksum, stat.size, tableCount, rowCountEstimate, backupId]);
    if (Number(update.affectedRows) !== 1) throw new Error('BACKUP_COMPLETION_UPDATE_NOT_CONFIRMED');
    console.log(JSON.stringify({ ok: true, check: 'preview-backup-generation', backupId, fileName, filePath, fileSize: stat.size, checksum, tableCount, rowCountEstimate, database: PREVIEW_DB, branch: RELEASE_BRANCH, databaseConnectionId: connectionId, directoryPrivate: true, filePrivate: true, dumpEnvironmentSanitized: true, dumpExecutionBounded: true, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  } catch (error) {
    if (backupId) await pool.execute("UPDATE os2_backup_runs SET status='failed',failure_reason=?,completed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE id=? AND status='running'", [String(error.message || error).slice(0, 1000), backupId]).catch(() => {});
    if (fileCreated || fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    throw error;
  } finally { await pool.end(); }
}

main().catch(error => { console.error(`BACKUP FAILED: ${error.message}`); process.exit(1); });
