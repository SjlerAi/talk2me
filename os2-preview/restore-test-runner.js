'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const PREVIEW_DB = 'kloka_talk2me';
const RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild';
const TARGET_PREFIX = 'kloka_talk2me_restore_test_';
const IMPORT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024 * 1024;
const REQUIRED_TABLES = ['staff_users','customers','customer_accounts','mobile_lines','os2_schema_migrations','os2_backup_runs','os2_restore_tests'];

function required(name, max = 1024) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}
function validPort(value) {
  const port = Number(value || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT_INVALID');
  return port;
}
function validateTargetDatabase(name) {
  if (!new RegExp(`^${TARGET_PREFIX}[0-9]{8}_[0-9]{6}_[a-z0-9]{6}$`).test(name)) throw new Error('RESTORE_TARGET_NAME_INVALID');
  if (name === PREVIEW_DB || /prod|production/i.test(name)) throw new Error('RESTORE_TARGET_PROHIBITED');
  return name;
}
function secureFile(filePath, expectedSize, expectedChecksum) {
  const canonical = path.resolve(filePath);
  if (canonical !== filePath || fs.realpathSync.native(filePath) !== filePath) throw new Error('BACKUP_PATH_NOT_CANONICAL');
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('BACKUP_FILE_NOT_SECURE');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('BACKUP_FILE_NOT_PRIVATE');
  if (typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('O_NOFOLLOW_UNAVAILABLE');
  if (stat.size <= 1024 || stat.size > MAX_BACKUP_BYTES || stat.size !== expectedSize) throw new Error('BACKUP_FILE_SIZE_INVALID');
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) throw new Error('BACKUP_FILE_CHANGED_DURING_OPEN');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      bytes += read;
      if (bytes > MAX_BACKUP_BYTES) throw new Error('BACKUP_READ_LIMIT_EXCEEDED');
      hash.update(buffer.subarray(0, read));
    }
    if (bytes !== stat.size) throw new Error('BACKUP_READ_SIZE_MISMATCH');
    const digest = hash.digest('hex');
    const left = Buffer.from(digest, 'hex');
    const right = Buffer.from(expectedChecksum, 'hex');
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error('BACKUP_CHECKSUM_MISMATCH');
    return { size: bytes, checksum: digest, dev: stat.dev, ino: stat.ino };
  } finally { fs.closeSync(fd); }
}
function childEnvironment(password) {
  const env = {};
  for (const key of ['PATH','HOME','USER','LOGNAME','TMPDIR','LANG','LC_ALL','TZ']) if (process.env[key]) env[key] = process.env[key];
  env.MYSQL_PWD = password;
  env.LANG = env.LANG || 'C.UTF-8';
  env.TZ = 'UTC';
  return Object.freeze(env);
}
function importDump({ filePath, host, port, user, password, target }) {
  const binary = String(process.env.MYSQL_BIN || 'mysql').trim();
  if (!/^[A-Za-z0-9_./-]+$/.test(binary)) throw new Error('MYSQL_BIN_INVALID');
  const args = ['--protocol=TCP','--default-character-set=utf8mb4','--connect-timeout=10','--batch','--skip-column-names','-h',host,'-P',String(port),'-u',user,target];
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW });
    const child = spawn(binary, args, { env: childEnvironment(password), stdio: ['pipe','ignore','pipe'], shell: false, windowsHide: true });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), IMPORT_TIMEOUT_MS);
    input.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); child.kill('SIGKILL'); reject(error); } });
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8192); });
    input.pipe(child.stdin);
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (signal) return reject(new Error(`RESTORE_IMPORT_SIGNALLED:${signal}`));
      if (code !== 0) return reject(new Error(`RESTORE_IMPORT_FAILED:${code}:${stderr.slice(-1000)}`));
      resolve();
    });
  });
}
async function assertDatabase(connection, expected) {
  const [[row]] = await connection.execute('SELECT DATABASE() database_name, CONNECTION_ID() connection_id, @@session.autocommit autocommit_value');
  if (row.database_name !== expected || !Number.isInteger(Number(row.connection_id)) || Number(row.autocommit_value) !== 1) throw new Error('DATABASE_SESSION_IDENTITY_INVALID');
  await connection.query("SET SESSION time_zone = '+00:00'");
}
async function main() {
  if (required('DB_NAME', 128) !== PREVIEW_DB) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  if (required('RELEASE_BRANCH', 200) !== RELEASE_BRANCH) throw new Error('CONTROLLED_BRANCH_REQUIRED');
  if (process.env.ALLOW_PREVIEW_RESTORE_TEST !== 'true') throw new Error('RESTORE_TEST_NOT_ENABLED');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');

  const backupId = Number(process.argv[2] || process.env.BACKUP_ID);
  if (!Number.isInteger(backupId) || backupId <= 0) throw new Error('VALID_BACKUP_ID_REQUIRED');
  const host = required('DB_HOST', 255); const user = required('DB_USER', 128); const password = process.env.DB_PASSWORD || ''; const port = validPort(process.env.DB_PORT);
  const target = validateTargetDatabase(required('RESTORE_TARGET_DATABASE', 128));
  const reviewerId = Number(required('RESTORE_REVIEWER_ID', 32));
  if (!Number.isInteger(reviewerId) || reviewerId <= 0) throw new Error('RESTORE_REVIEWER_ID_INVALID');

  const preview = await mysql.createConnection({ host, port, user, password, database: PREVIEW_DB, connectTimeout: 10000, connectionLimit: 1, namedPlaceholders: false, enableKeepAlive: false, charset: 'utf8mb4' });
  let restoreId = null;
  let targetConnection = null;
  try {
    await assertDatabase(preview, PREVIEW_DB);
    const [backupRows] = await preview.execute('SELECT id,status,backup_type,database_name,storage_path,file_name,checksum_sha256,file_size_bytes,table_count,row_count_estimate,started_at,completed_at,verified_at,failure_reason FROM os2_backup_runs WHERE id=?', [backupId]);
    const backup = backupRows[0];
    if (!backup || backup.status !== 'verified' || !['database','full'].includes(backup.backup_type) || backup.database_name !== PREVIEW_DB) throw new Error('BACKUP_NOT_RECOVERY_ELIGIBLE');
    if (!/^[0-9a-f]{64}$/.test(String(backup.checksum_sha256 || '')) || Number(backup.file_size_bytes) <= 1024 || Number(backup.table_count) < 50 || backup.failure_reason) throw new Error('BACKUP_EVIDENCE_INCOMPLETE');
    const filePath = path.resolve(String(backup.storage_path || ''), String(backup.file_name || ''));
    if (path.dirname(filePath) !== path.resolve(String(backup.storage_path || ''))) throw new Error('BACKUP_PATH_ESCAPE_DETECTED');
    const fileEvidence = secureFile(filePath, Number(backup.file_size_bytes), backup.checksum_sha256);

    targetConnection = await mysql.createConnection({ host, port, user, password, database: target, connectTimeout: 10000, namedPlaceholders: false, enableKeepAlive: false, charset: 'utf8mb4' });
    await assertDatabase(targetConnection, target);
    const [[before]] = await targetConnection.execute('SELECT COUNT(*) table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [target]);
    if (Number(before.table_count) !== 0) throw new Error('RESTORE_TARGET_NOT_EMPTY');

    const [insert] = await preview.execute("INSERT INTO os2_restore_tests (backup_run_id,status,target_environment,expected_database_name,actual_database_name,started_at,created_by,reviewed_by,created_at,updated_at) VALUES (?,'running','isolated_preview_restore',?,?,UTC_TIMESTAMP(),?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())", [backupId,target,target,reviewerId,reviewerId]);
    restoreId = Number(insert.insertId);
    if (!Number.isInteger(restoreId) || restoreId <= 0) throw new Error('RESTORE_TEST_RECORD_NOT_CREATED');

    await importDump({ filePath, host, port, user, password, target });
    const [[counts]] = await targetConnection.execute('SELECT COUNT(*) table_count,COALESCE(SUM(TABLE_ROWS),0) row_count_estimate FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [target]);
    const [requiredRows] = await targetConnection.execute(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (${REQUIRED_TABLES.map(() => '?').join(',')})`, [target,...REQUIRED_TABLES]);
    const restored = new Set(requiredRows.map(row => row.TABLE_NAME));
    const missing = REQUIRED_TABLES.filter(name => !restored.has(name));
    const [migrationRows] = await targetConnection.execute('SELECT migration_name,checksum_sha256 FROM os2_schema_migrations ORDER BY id');
    const checks = {
      targetWasEmpty: true,
      databaseIdentityVerified: true,
      tableCountMatchesBackup: Number(counts.table_count) === Number(backup.table_count),
      requiredTablesPresent: missing.length === 0,
      migrationCountExact: migrationRows.length === 25,
      migrationChecksumsValid: migrationRows.every(row => /^[0-9a-f]{64}$/.test(String(row.checksum_sha256 || ''))),
      restoreTargetIsolated: target.startsWith(TARGET_PREFIX),
      backupChecksumReverified: fileEvidence.checksum === backup.checksum_sha256
    };
    const failedChecks = Object.entries(checks).filter(([,value]) => !value).map(([key]) => key);
    const evidence = { checks, missingTables: missing, backupId, restoreId, target, sourceDatabase: PREVIEW_DB, fileSize: fileEvidence.size, checksum: fileEvidence.checksum, tableCount: Number(counts.table_count), rowCountEstimate: Number(counts.row_count_estimate), migrationCount: migrationRows.length, workerId: `${os.hostname()}:${process.pid}`.slice(0,160) };
    await preview.execute("UPDATE os2_restore_tests SET status=?,table_count=?,verified_checks=?,failed_checks=?,evidence_json=?,failure_reason=?,completed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE id=? AND status='running'", [failedChecks.length ? 'failed' : 'passed',Number(counts.table_count),Object.keys(checks).length-failedChecks.length,failedChecks.length,JSON.stringify(evidence),failedChecks.length ? failedChecks.join(',').slice(0,1000) : null,restoreId]);
    if (failedChecks.length) throw new Error(`RESTORE_SEMANTIC_CHECKS_FAILED:${failedChecks.join(',')}`);
    console.log(JSON.stringify({ ok: true, check: 'isolated-restore-test', backupId, restoreId, sourceDatabase: PREVIEW_DB, targetDatabase: target, targetEnvironment: 'isolated_preview_restore', tableCount: Number(counts.table_count), migrationCount: migrationRows.length, verifiedChecks: Object.keys(checks).length, failedChecks: 0, backupChecksumReverified: true, targetDatabasePrecreated: true, targetDatabaseInitiallyEmpty: true, targetDatabaseDroppedAutomatically: false, productionMutationEnabled: false, mergeExecutionEnabled: false }, null, 2));
  } catch (error) {
    if (restoreId) await preview.execute("UPDATE os2_restore_tests SET status='failed',failure_reason=?,completed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE id=? AND status='running'", [String(error.message || error).slice(0,1000),restoreId]).catch(() => {});
    throw error;
  } finally {
    if (targetConnection) await targetConnection.end();
    await preview.end();
  }
}

main().catch(error => { console.error(`RESTORE TEST FAILED: ${error.message}`); process.exit(1); });
