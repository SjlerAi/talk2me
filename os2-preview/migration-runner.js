'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');

const ROOT = __dirname;
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const PREVIEW_DATABASE = 'kloka_talk2me';
const RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild';
const MIGRATION_LOCK_NAME = 'talk2me_os2_preview_migrations';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 10;
const VERIFIER_TIMEOUT_MS = 30000;
const CONNECTION_TIMEOUT_MS = 10000;
const MAX_MIGRATION_BYTES = 4 * 1024 * 1024;
const MAX_MIGRATION_COUNT = 250;
const EXPECTED_MIGRATION_DATE = '20260801';
const REQUIRED_RESTORE_PIN = '20260801_025_merge_authorisation_restore_pin.sql';
const BOOTSTRAP_EVIDENCE_VERIFIER = path.join(ROOT, 'migration-ledger-bootstrap-evidence-verification.js');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  if (/\u0000|[\r\n]/.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}
function checksum(content) { return crypto.createHash('sha256').update(content).digest('hex'); }
function validateBoundedText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label}_INVALID`);
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label}_INVALID`);
  return value;
}
function buildVerifierEnvironment(evidencePath) {
  const inherited = ['PATH','HOME','USER','LOGNAME','TMPDIR','TEMP','TMP','LANG','LC_ALL','TZ','CI','GITHUB_ACTIONS'];
  const env = {};
  for (const key of inherited) if (typeof process.env[key] === 'string' && process.env[key]) env[key] = process.env[key];
  env.PREVIEW_APP_ROOT = ROOT;
  env.DB_NAME = PREVIEW_DATABASE;
  env.RELEASE_BRANCH = RELEASE_BRANCH;
  env.MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH = evidencePath;
  env.ALLOW_PRODUCTION_MUTATION = 'false';
  env.ENABLE_CUSTOMER_MERGE_EXECUTION = 'false';
  env.NODE_ENV = 'production';
  return Object.freeze(env);
}
function verifyBootstrapEvidence() {
  const evidencePath = required('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH');
  if (!path.isAbsolute(evidencePath) || path.normalize(evidencePath) !== evidencePath) throw new Error('BOOTSTRAP_EVIDENCE_PATH_INVALID');
  const verifierEnv = buildVerifierEnvironment(evidencePath);
  const result = spawnSync(process.execPath, [BOOTSTRAP_EVIDENCE_VERIFIER], {
    cwd: ROOT,
    env: verifierEnv,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: VERIFIER_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    shell: false,
    windowsHide: true
  });
  if (result.error && result.error.code === 'ETIMEDOUT') throw new Error('BOOTSTRAP_EVIDENCE_VERIFIER_TIMEOUT');
  if (result.error) throw new Error(`BOOTSTRAP_EVIDENCE_VERIFIER_START_FAILED:${result.error.message}`);
  if (result.signal) throw new Error(`BOOTSTRAP_EVIDENCE_VERIFIER_SIGNALLED:${result.signal}`);
  if (result.status !== 0) throw new Error(`BOOTSTRAP_EVIDENCE_VERIFICATION_FAILED:${result.status}:${String(result.stderr || '').trim()}`);
  let evidence;
  try { evidence = JSON.parse(String(result.stdout || '').trim()); } catch { throw new Error('BOOTSTRAP_EVIDENCE_VERIFIER_INVALID_JSON'); }
  if (evidence.ok !== true || evidence.database !== PREVIEW_DATABASE || evidence.bootstrapMatchesWorkspace !== true || evidence.advisoryLockLifecycleVerified !== true) throw new Error('BOOTSTRAP_EVIDENCE_VERIFIER_INCOMPLETE');
  return { evidencePath, verifierEvidence: evidence };
}
function secureMigrationDirectory() {
  const pathStat = fs.lstatSync(MIGRATIONS_DIR);
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) throw new Error('MIGRATIONS_DIRECTORY_NOT_SECURE');
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) throw new Error('MIGRATIONS_DIRECTORY_WRITABLE_BY_GROUP_OR_WORLD');
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && pathStat.uid !== process.getuid()) throw new Error('MIGRATIONS_DIRECTORY_OWNER_MISMATCH');
  if (fs.realpathSync.native(MIGRATIONS_DIR) !== MIGRATIONS_DIR) throw new Error('MIGRATIONS_DIRECTORY_NOT_CANONICAL');
  if (typeof fs.constants.O_NOFOLLOW !== 'number' || typeof fs.constants.O_DIRECTORY !== 'number') throw new Error('SECURE_DIRECTORY_FLAGS_UNAVAILABLE');
  const descriptor = fs.openSync(MIGRATIONS_DIR, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isDirectory()) throw new Error('MIGRATIONS_DIRECTORY_DESCRIPTOR_INVALID');
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error('MIGRATIONS_DIRECTORY_CHANGED_DURING_OPEN');
    if (descriptorStat.mode !== pathStat.mode || descriptorStat.uid !== pathStat.uid) throw new Error('MIGRATIONS_DIRECTORY_METADATA_CHANGED_DURING_OPEN');
    return { uid: descriptorStat.uid, dev: descriptorStat.dev, ino: descriptorStat.ino, mode: descriptorStat.mode, mtimeMs: descriptorStat.mtimeMs };
  } finally { fs.closeSync(descriptor); }
}
function migrationFiles() {
  const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile())) throw new Error('UNSUPPORTED_MIGRATION_DIRECTORY_ENTRY');
  const names = entries.map(entry => entry.name);
  if (names.some(name => name.startsWith('.'))) throw new Error('HIDDEN_MIGRATION_FILE_PRESENT');
  const valid = names.filter(name => /^\d{8}_\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (names.length !== valid.length) throw new Error('INVALID_MIGRATION_FILENAME_PRESENT');
  if (valid.length < 25) throw new Error(`INSUFFICIENT_MIGRATION_COUNT:${valid.length}`);
  if (valid.length > MAX_MIGRATION_COUNT) throw new Error(`EXCESSIVE_MIGRATION_COUNT:${valid.length}`);
  if (!valid.includes(REQUIRED_RESTORE_PIN)) throw new Error('MIGRATION_025_MISSING');
  if (new Set(valid).size !== valid.length) throw new Error('DUPLICATE_MIGRATION_FILENAME');
  valid.forEach((name, index) => {
    const match = name.match(/^(\d{8})_(\d{3})_/);
    if (!match || match[1] !== EXPECTED_MIGRATION_DATE) throw new Error(`MIGRATION_DATE_INVALID:${name}`);
    if (Number(match[2]) !== index + 1) throw new Error(`MIGRATION_SEQUENCE_NOT_CONTIGUOUS:${name}`);
  });
  return valid;
}
function validateMigrationSql(name, sql) {
  if (!sql.length) throw new Error(`MIGRATION_EMPTY:${name}`);
  if (sql.charCodeAt(0) === 0xfeff) throw new Error(`MIGRATION_BOM_PROHIBITED:${name}`);
  if (sql.includes('\r')) throw new Error(`MIGRATION_CRLF_PROHIBITED:${name}`);
  if (!sql.endsWith('\n')) throw new Error(`MIGRATION_FINAL_NEWLINE_REQUIRED:${name}`);
  if (/\u0000/.test(sql)) throw new Error(`MIGRATION_NUL_PROHIBITED:${name}`);
  const upper = sql.toUpperCase();
  for (const token of ['CREATE DATABASE','DROP DATABASE','USE ','GRANT ','REVOKE ','LOAD DATA','INTO OUTFILE','INTO DUMPFILE','SET GLOBAL','RESET MASTER','SHUTDOWN']) {
    if (upper.includes(token)) throw new Error(`MIGRATION_PROHIBITED_TOKEN:${name}:${token}`);
  }
  if (/\bOS2_SCHEMA_MIGRATIONS\b/i.test(sql)) throw new Error(`MIGRATION_LEDGER_SELF_MUTATION_PROHIBITED:${name}`);
}
function readMigrationSecurely(name, expectedOwner) {
  if (path.basename(name) !== name) throw new Error(`INVALID_MIGRATION_BASENAME:${name}`);
  const file = path.join(MIGRATIONS_DIR, name);
  const pathStat = fs.lstatSync(file);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error(`MIGRATION_NOT_REGULAR_FILE:${name}`);
  if (pathStat.nlink !== 1) throw new Error(`MIGRATION_HARD_LINK_PROHIBITED:${name}`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) throw new Error(`MIGRATION_OWNER_MISMATCH:${name}`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) throw new Error(`MIGRATION_WRITABLE_BY_GROUP_OR_WORLD:${name}`);
  if (pathStat.size <= 0 || pathStat.size > MAX_MIGRATION_BYTES) throw new Error(`MIGRATION_SIZE_INVALID:${name}`);
  if (fs.realpathSync.native(file) !== file) throw new Error(`MIGRATION_PATH_NOT_CANONICAL:${name}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) throw new Error(`MIGRATION_DESCRIPTOR_INVALID:${name}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error(`MIGRATION_CHANGED_DURING_OPEN:${name}`);
    if (descriptorStat.nlink !== 1 || descriptorStat.size !== pathStat.size || descriptorStat.mtimeMs !== pathStat.mtimeMs) throw new Error(`MIGRATION_METADATA_CHANGED_DURING_OPEN:${name}`);
    if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) throw new Error(`MIGRATION_DESCRIPTOR_OWNER_MISMATCH:${name}`);
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== descriptorStat.size) throw new Error(`MIGRATION_READ_SIZE_MISMATCH:${name}`);
    const sql = bytes.toString('utf8');
    validateMigrationSql(name, sql);
    return sql;
  } finally { fs.closeSync(descriptor); }
}
async function verifySessionIdentity(connection) {
  const [rows] = await connection.execute('SELECT DATABASE() AS database_name, CONNECTION_ID() AS connection_id, @@session.autocommit AS autocommit_value, @@session.time_zone AS time_zone_value');
  const row = rows[0] || {};
  if (row.database_name !== PREVIEW_DATABASE) throw new Error('MIGRATION_DATABASE_IDENTITY_MISMATCH');
  const connectionId = Number(row.connection_id);
  if (!Number.isInteger(connectionId) || connectionId <= 0) throw new Error('MIGRATION_CONNECTION_ID_UNAVAILABLE');
  if (Number(row.autocommit_value) !== 1) throw new Error('MIGRATION_AUTOCOMMIT_REQUIRED');
  await connection.query("SET SESSION time_zone = '+00:00'");
  const [timezoneRows] = await connection.execute('SELECT @@session.time_zone AS time_zone_value');
  if (!timezoneRows[0] || timezoneRows[0].time_zone_value !== '+00:00') throw new Error('MIGRATION_UTC_SESSION_REQUIRED');
  return connectionId;
}
async function verifyLedgerSchema(connection) {
  const [tables] = await connection.execute("SELECT ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations'", [PREVIEW_DATABASE]);
  if (tables.length !== 1) throw new Error('MIGRATION_LEDGER_BOOTSTRAP_REQUIRED');
  if (String(tables[0].ENGINE || '').toUpperCase() !== 'INNODB') throw new Error('MIGRATION_LEDGER_ENGINE_INVALID');
  if (tables[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') throw new Error('MIGRATION_LEDGER_COLLATION_INVALID');
  const [columns] = await connection.execute("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations' ORDER BY ORDINAL_POSITION", [PREVIEW_DATABASE]);
  const expectedNames = ['id','migration_name','checksum_sha256','executed_at','executed_by','execution_ms'];
  if (columns.length !== expectedNames.length) throw new Error('MIGRATION_LEDGER_COLUMN_COUNT_INVALID');
  expectedNames.forEach((name,index) => { if (columns[index].COLUMN_NAME !== name) throw new Error(`MIGRATION_LEDGER_COLUMN_ORDER_INVALID:${name}`); });
  const [indexes] = await connection.execute("SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations' ORDER BY INDEX_NAME,SEQ_IN_INDEX", [PREVIEW_DATABASE]);
  if (!indexes.some(row => row.INDEX_NAME === 'PRIMARY' && row.COLUMN_NAME === 'id' && Number(row.NON_UNIQUE) === 0)) throw new Error('MIGRATION_LEDGER_PRIMARY_KEY_INVALID');
  if (!indexes.some(row => row.INDEX_NAME === 'uq_os2_schema_migration_name' && row.COLUMN_NAME === 'migration_name' && Number(row.NON_UNIQUE) === 0)) throw new Error('MIGRATION_LEDGER_UNIQUE_KEY_INVALID');
}
async function acquireMigrationLock(connection, expectedConnectionId) {
  const [rows] = await connection.execute('SELECT GET_LOCK(?, ?) AS acquired', [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS]);
  if (!rows[0] || Number(rows[0].acquired) !== 1) throw new Error('MIGRATION_ADVISORY_LOCK_NOT_ACQUIRED');
  const [ownerRows] = await connection.execute('SELECT IS_USED_LOCK(?) AS owner_connection_id', [MIGRATION_LOCK_NAME]);
  if (!ownerRows[0] || Number(ownerRows[0].owner_connection_id) !== expectedConnectionId) throw new Error('MIGRATION_ADVISORY_LOCK_OWNER_MISMATCH');
}
async function releaseMigrationLock(connection, expectedConnectionId) {
  const [ownerRows] = await connection.execute('SELECT IS_USED_LOCK(?) AS owner_connection_id', [MIGRATION_LOCK_NAME]);
  if (Number(ownerRows[0] && ownerRows[0].owner_connection_id) !== expectedConnectionId) throw new Error('MIGRATION_ADVISORY_LOCK_OWNERSHIP_LOST');
  const [releaseRows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [MIGRATION_LOCK_NAME]);
  if (!releaseRows[0] || Number(releaseRows[0].released) !== 1) throw new Error('MIGRATION_ADVISORY_LOCK_RELEASE_NOT_CONFIRMED');
  const [freeRows] = await connection.execute('SELECT IS_FREE_LOCK(?) AS is_free', [MIGRATION_LOCK_NAME]);
  if (!freeRows[0] || Number(freeRows[0].is_free) !== 1) throw new Error('MIGRATION_ADVISORY_LOCK_NOT_FREE_AFTER_RELEASE');
}
function validateAppliedLedger(appliedRows, migrationSources) {
  if (appliedRows.length > migrationSources.length) throw new Error('MIGRATION_LEDGER_LONGER_THAN_SOURCE_INVENTORY');
  const seenIds = new Set();
  const seenNames = new Set();
  let previousId = 0;
  for (let index = 0; index < appliedRows.length; index += 1) {
    const row = appliedRows[index];
    const source = migrationSources[index];
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= previousId || seenIds.has(id)) throw new Error(`MIGRATION_LEDGER_ID_INVALID:${index}`);
    previousId = id; seenIds.add(id);
    if (typeof row.migration_name !== 'string' || row.migration_name !== row.migration_name.trim()) throw new Error(`MIGRATION_LEDGER_ROW_INVALID:${index}`);
    if (seenNames.has(row.migration_name)) throw new Error(`MIGRATION_LEDGER_DUPLICATE:${row.migration_name}`);
    seenNames.add(row.migration_name);
    if (!source || row.migration_name !== source.name) throw new Error(`MIGRATION_LEDGER_NOT_STRICT_PREFIX:${row.migration_name}`);
    if (!/^[0-9a-f]{64}$/.test(String(row.checksum_sha256 || ''))) throw new Error(`MIGRATION_LEDGER_CHECKSUM_INVALID:${row.migration_name}`);
    if (row.checksum_sha256 !== source.digest) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${row.migration_name}`);
    if (!(row.executed_at instanceof Date) || !Number.isFinite(row.executed_at.getTime())) throw new Error(`MIGRATION_LEDGER_EXECUTED_AT_INVALID:${row.migration_name}`);
    if (row.executed_by !== null) validateBoundedText(row.executed_by, 'MIGRATION_LEDGER_EXECUTED_BY', 190);
    if (!Number.isInteger(Number(row.execution_ms)) || Number(row.execution_ms) < 0) throw new Error(`MIGRATION_LEDGER_EXECUTION_MS_INVALID:${row.migration_name}`);
  }
  return new Set(appliedRows.map(row => row.migration_name));
}
async function run() {
  const database = required('DB_NAME');
  if (database !== PREVIEW_DATABASE) throw new Error(`REFUSING_NON_PREVIEW_DATABASE:${database}`);
  if (String(process.env.RELEASE_BRANCH || '') !== RELEASE_BRANCH) throw new Error('RELEASE_BRANCH_MISMATCH');
  if (String(process.env.ALLOW_PREVIEW_MIGRATIONS || '').toLowerCase() !== 'true') throw new Error('ALLOW_PREVIEW_MIGRATIONS_NOT_ENABLED');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');
  const dbHost = validateBoundedText(required('DB_HOST'), 'DB_HOST', 255);
  const dbUser = validateBoundedText(required('DB_USER'), 'DB_USER', 128);
  const dbPort = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) throw new Error('DB_PORT_INVALID');
  const executedBy = validateBoundedText(String(process.env.MIGRATION_OPERATOR || process.env.USER || process.env.USERNAME || 'preview-runner').trim(), 'MIGRATION_OPERATOR', 190);

  const bootstrap = verifyBootstrapEvidence();
  const directoryIdentity = secureMigrationDirectory();
  const files = migrationFiles();
  const migrationSources = files.map(name => { const sql = readMigrationSecurely(name, directoryIdentity.uid); return { name, sql, digest: checksum(sql) }; });
  const after = fs.lstatSync(MIGRATIONS_DIR);
  if (after.dev !== directoryIdentity.dev || after.ino !== directoryIdentity.ino || after.mtimeMs !== directoryIdentity.mtimeMs) throw new Error('MIGRATIONS_DIRECTORY_CHANGED_DURING_INVENTORY');

  const connection = await mysql.createConnection({ host: dbHost, port: dbPort, user: dbUser, password: process.env.DB_PASSWORD || '', database, connectTimeout: CONNECTION_TIMEOUT_MS, multipleStatements: true, charset: 'utf8mb4', enableKeepAlive: false, namedPlaceholders: false, dateStrings: false });
  let lockAcquired = false;
  let connectionId = null;
  let advisoryLockReleased = false;
  let databaseConnectionClosed = false;
  let result = null;
  try {
    connectionId = await verifySessionIdentity(connection);
    await acquireMigrationLock(connection, connectionId);
    lockAcquired = true;
    await verifyLedgerSchema(connection);
    const [appliedRows] = await connection.execute('SELECT id,migration_name,checksum_sha256,executed_at,executed_by,execution_ms FROM os2_schema_migrations ORDER BY id ASC');
    const applied = validateAppliedLedger(appliedRows, migrationSources);
    let executed = 0;
    for (const migration of migrationSources) {
      if (applied.has(migration.name)) { console.log(`skip ${migration.name}`); continue; }
      const started = Date.now();
      await connection.query(migration.sql);
      const executionMs = Date.now() - started;
      const [insertResult] = await connection.execute('INSERT INTO os2_schema_migrations (migration_name,checksum_sha256,executed_by,execution_ms) VALUES (?,?,?,?)', [migration.name,migration.digest,executedBy,executionMs]);
      if (!insertResult || Number(insertResult.affectedRows) !== 1 || !Number.isInteger(Number(insertResult.insertId)) || Number(insertResult.insertId) <= 0) throw new Error(`MIGRATION_LEDGER_INSERT_NOT_CONFIRMED:${migration.name}`);
      executed += 1;
      console.log(`applied ${migration.name}`);
    }
    const [finalRows] = await connection.execute('SELECT id,migration_name,checksum_sha256,executed_at,executed_by,execution_ms FROM os2_schema_migrations ORDER BY id ASC');
    validateAppliedLedger(finalRows, migrationSources);
    if (finalRows.length !== migrationSources.length) throw new Error('MIGRATION_FINAL_LEDGER_INCOMPLETE');
    result = {
      ok: true, check: 'preview-migration-runner', database, branch: RELEASE_BRANCH,
      bootstrapEvidencePath: bootstrap.evidencePath, bootstrapEvidenceVerifiedBeforeDatabaseConnection: true,
      bootstrapEvidenceIdentityVerified: true, migrationCount: migrationSources.length,
      previouslyApplied: applied.size, applied: executed, finalLedgerCount: finalRows.length,
      ledgerBootstrapVerified: true, runtimeCreateTableUsed: false, ledgerStrictPrefixVerified: true,
      finalLedgerInventoryVerified: true, migrationSequenceContiguous: true, migrationSourcePolicyVerified: true,
      advisoryLockUsed: true, advisoryLockOwnerVerified: true, secureMigrationReads: true,
      databaseIdentityVerified: true, utcSessionVerified: true, autocommitVerified: true,
      verifierEnvironmentSanitized: true, verifierExecutionBounded: true,
      productionMutationEnabled: false, mergeExecutionEnabled: false
    };
  } finally {
    try {
      if (lockAcquired) { await releaseMigrationLock(connection, connectionId); advisoryLockReleased = true; }
    } finally {
      await connection.end();
      databaseConnectionClosed = true;
    }
  }
  if (!result || advisoryLockReleased !== true || databaseConnectionClosed !== true) throw new Error('MIGRATION_COMPLETION_EVIDENCE_INCOMPLETE');
  result.advisoryLockReleased = true;
  result.advisoryLockFreeAfterRelease = true;
  result.databaseConnectionClosedBeforeSuccess = true;
  console.log(JSON.stringify(result, null, 2));
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
