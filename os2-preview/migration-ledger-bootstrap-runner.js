'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const root = __dirname;
const bootstrapFile = 'MIGRATION_LEDGER_BOOTSTRAP.sql';
const bootstrapPath = path.join(root, bootstrapFile);
const expectedDatabase = 'kloka_talk2me';
const lockName = 'talk2me_os2_preview_migrations';
const maxBootstrapBytes = 1024 * 1024;
const maxMetadataLength = 240;
const lockTimeoutSeconds = 10;
const connectTimeoutMs = 10000;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}
function validateText(value, label, maxLength = maxMetadataLength) {
  if (value !== value.trim()) throw new Error(`${label}_WHITESPACE_INVALID`);
  if (value.length > maxLength) throw new Error(`${label}_TOO_LONG`);
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label}_CONTROL_CHARACTERS_PROHIBITED`);
  return value;
}
function parsePort(value) {
  const port = Number(value || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT_INVALID');
  return port;
}
function secureReadBootstrap() {
  const pathStat = fs.lstatSync(bootstrapPath);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error('BOOTSTRAP_SOURCE_NOT_REGULAR_FILE');
  if (pathStat.nlink !== 1) throw new Error('BOOTSTRAP_SOURCE_HARD_LINK_PROHIBITED');
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) throw new Error('BOOTSTRAP_SOURCE_WRITABLE_BY_GROUP_OR_WORLD');
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && pathStat.uid !== process.getuid()) throw new Error('BOOTSTRAP_SOURCE_OWNER_MISMATCH');
  if (pathStat.size <= 0 || pathStat.size > maxBootstrapBytes) throw new Error('BOOTSTRAP_SOURCE_SIZE_INVALID');
  if (fs.realpathSync.native(bootstrapPath) !== bootstrapPath) throw new Error('BOOTSTRAP_SOURCE_NOT_CANONICAL');
  if (typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('O_NOFOLLOW_UNAVAILABLE');
  const descriptor = fs.openSync(bootstrapPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) throw new Error('BOOTSTRAP_DESCRIPTOR_NOT_REGULAR_FILE');
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error('BOOTSTRAP_SOURCE_CHANGED_DURING_OPEN');
    if (descriptorStat.nlink !== 1) throw new Error('BOOTSTRAP_DESCRIPTOR_HARD_LINK_PROHIBITED');
    if (descriptorStat.size !== pathStat.size) throw new Error('BOOTSTRAP_SOURCE_SIZE_CHANGED_DURING_OPEN');
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== descriptorStat.size) throw new Error('BOOTSTRAP_SOURCE_SHORT_READ');
    const afterStat = fs.fstatSync(descriptor);
    if (afterStat.size !== descriptorStat.size || afterStat.mtimeMs !== descriptorStat.mtimeMs) throw new Error('BOOTSTRAP_SOURCE_CHANGED_DURING_READ');
    return bytes.toString('utf8');
  } finally { fs.closeSync(descriptor); }
}
function validateBootstrapSql(sql) {
  if (sql.charCodeAt(0) === 0xfeff) throw new Error('BOOTSTRAP_SQL_BOM_PROHIBITED');
  if (/\r/.test(sql)) throw new Error('BOOTSTRAP_SQL_CRLF_PROHIBITED');
  if (!sql.endsWith('\n')) throw new Error('BOOTSTRAP_SQL_FINAL_NEWLINE_REQUIRED');
  if (/--|#|\/\*/.test(sql)) throw new Error('BOOTSTRAP_SQL_COMMENTS_PROHIBITED');
  if ((sql.match(/;/g) || []).length !== 1) throw new Error('BOOTSTRAP_SQL_MUST_CONTAIN_ONE_STATEMENT');
  const upper = sql.toUpperCase();
  const requiredMarkers = ['CREATE TABLE OS2_SCHEMA_MIGRATIONS','PRIMARY KEY (ID)','UNIQUE KEY UQ_OS2_SCHEMA_MIGRATION_NAME (MIGRATION_NAME)','ENGINE=INNODB','COLLATE=UTF8MB4_UNICODE_CI'];
  for (const marker of requiredMarkers) if (!upper.includes(marker)) throw new Error(`BOOTSTRAP_SQL_MISSING_MARKER:${marker}`);
  const prohibited = ['DROP ','ALTER ','INSERT ','UPDATE ','DELETE ','REPLACE ','TRUNCATE ','RENAME ','GRANT ','REVOKE ','CREATE DATABASE','USE ','CREATE TABLE IF NOT EXISTS','TEMPORARY','PROCEDURE','FUNCTION','TRIGGER','EVENT','LOAD DATA','OUTFILE','DUMPFILE'];
  for (const token of prohibited) if (upper.includes(token)) throw new Error(`BOOTSTRAP_SQL_PROHIBITED_TOKEN:${token}`);
  if ((upper.match(/CREATE TABLE/g) || []).length !== 1) throw new Error('BOOTSTRAP_SQL_MUST_CREATE_EXACTLY_ONE_TABLE');
  if (!/^CREATE TABLE OS2_SCHEMA_MIGRATIONS[\s\S]+;\n$/i.test(sql)) throw new Error('BOOTSTRAP_SQL_SHAPE_INVALID');
}
function validateEvidenceTarget(evidencePath) {
  if (!path.isAbsolute(evidencePath)) throw new Error('BOOTSTRAP_EVIDENCE_PATH_MUST_BE_ABSOLUTE');
  if (path.normalize(evidencePath) !== evidencePath) throw new Error('BOOTSTRAP_EVIDENCE_PATH_MUST_BE_NORMALIZED');
  if (path.extname(evidencePath) !== '.json') throw new Error('BOOTSTRAP_EVIDENCE_PATH_MUST_BE_JSON');
  const directory = path.dirname(evidencePath);
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('BOOTSTRAP_EVIDENCE_DIRECTORY_NOT_SECURE');
  if (process.platform !== 'win32' && (directoryStat.mode & 0o077) !== 0) throw new Error('BOOTSTRAP_EVIDENCE_DIRECTORY_NOT_PRIVATE');
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && directoryStat.uid !== process.getuid()) throw new Error('BOOTSTRAP_EVIDENCE_DIRECTORY_OWNER_MISMATCH');
  if (fs.realpathSync.native(directory) !== directory) throw new Error('BOOTSTRAP_EVIDENCE_DIRECTORY_NOT_CANONICAL');
  if (fs.existsSync(evidencePath) || fs.existsSync(`${evidencePath}.sha256`)) throw new Error('BOOTSTRAP_EVIDENCE_ALREADY_EXISTS');
  return directory;
}
function syncDirectory(directory) {
  if (typeof fs.constants.O_DIRECTORY !== 'number' || typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('SECURE_DIRECTORY_FLAGS_UNAVAILABLE');
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function writePrivateTemp(file, content) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, content, 'utf8'); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
function removeIfPresent(file) { try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
function publishEvidencePair(evidencePath, evidence) {
  const directory = validateEvidenceTarget(evidencePath);
  const checksumPath = `${evidencePath}.sha256`;
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const digest = crypto.createHash('sha256').update(evidenceText).digest('hex');
  const checksumText = `${digest}  ${path.basename(evidencePath)}\n`;
  const nonce = `${process.pid}-${crypto.randomBytes(16).toString('hex')}`;
  const evidenceTemp = `${evidencePath}.${nonce}.tmp`;
  const checksumTemp = `${checksumPath}.${nonce}.tmp`;
  let evidencePublished = false;
  let checksumPublished = false;
  try {
    writePrivateTemp(evidenceTemp, evidenceText);
    writePrivateTemp(checksumTemp, checksumText);
    fs.linkSync(checksumTemp, checksumPath); checksumPublished = true;
    fs.linkSync(evidenceTemp, evidencePath); evidencePublished = true;
    syncDirectory(directory);
  } catch (error) {
    if (evidencePublished) removeIfPresent(evidencePath);
    if (checksumPublished) removeIfPresent(checksumPath);
    syncDirectory(directory);
    throw error;
  } finally { removeIfPresent(evidenceTemp); removeIfPresent(checksumTemp); }
  return digest;
}
async function verifyLedgerSchema(connection) {
  const [tables] = await connection.execute(`SELECT ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations'`, [expectedDatabase]);
  if (tables.length !== 1) throw new Error('BOOTSTRAP_POSTCHECK_TABLE_MISSING');
  if (tables[0].ENGINE !== 'InnoDB') throw new Error('BOOTSTRAP_POSTCHECK_ENGINE_MISMATCH');
  if (tables[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') throw new Error('BOOTSTRAP_POSTCHECK_COLLATION_MISMATCH');
  const [columns] = await connection.execute(`SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations' ORDER BY ORDINAL_POSITION`, [expectedDatabase]);
  const expectedNames = ['id','migration_name','checksum_sha256','executed_at','executed_by','execution_ms'];
  if (columns.length !== expectedNames.length) throw new Error('BOOTSTRAP_POSTCHECK_COLUMN_COUNT_MISMATCH');
  expectedNames.forEach((name, index) => { if (columns[index].COLUMN_NAME !== name) throw new Error(`BOOTSTRAP_POSTCHECK_COLUMN_ORDER_MISMATCH:${name}`); });
  if (!/unsigned/i.test(columns[0].COLUMN_TYPE) || columns[0].EXTRA !== 'auto_increment') throw new Error('BOOTSTRAP_POSTCHECK_ID_DEFINITION_MISMATCH');
  if (columns[1].IS_NULLABLE !== 'NO' || columns[2].IS_NULLABLE !== 'NO') throw new Error('BOOTSTRAP_POSTCHECK_REQUIRED_COLUMNS_NULLABLE');
  const [indexes] = await connection.execute(`SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations' ORDER BY INDEX_NAME,SEQ_IN_INDEX`, [expectedDatabase]);
  if (!indexes.some(row => row.INDEX_NAME === 'PRIMARY' && row.COLUMN_NAME === 'id' && Number(row.NON_UNIQUE) === 0)) throw new Error('BOOTSTRAP_POSTCHECK_PRIMARY_KEY_MISSING');
  if (!indexes.some(row => row.INDEX_NAME === 'uq_os2_schema_migration_name' && row.COLUMN_NAME === 'migration_name' && Number(row.NON_UNIQUE) === 0)) throw new Error('BOOTSTRAP_POSTCHECK_UNIQUE_KEY_MISSING');
}
async function run() {
  const startedAt = new Date().toISOString();
  if (required('DB_NAME') !== expectedDatabase) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  if (String(process.env.ALLOW_MIGRATION_LEDGER_BOOTSTRAP || '').toLowerCase() !== 'true') throw new Error('ALLOW_MIGRATION_LEDGER_BOOTSTRAP_NOT_ENABLED');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');
  const verifiedBackupReference = validateText(required('VERIFIED_BACKUP_REFERENCE'), 'VERIFIED_BACKUP_REFERENCE');
  const verifiedBackupSha256 = required('VERIFIED_BACKUP_SHA256');
  if (!/^[0-9a-f]{64}$/i.test(verifiedBackupSha256)) throw new Error('VERIFIED_BACKUP_SHA256_INVALID');
  const operator = validateText(required('BOOTSTRAP_OPERATOR'), 'BOOTSTRAP_OPERATOR', 160);
  const changeReference = validateText(required('BOOTSTRAP_CHANGE_REFERENCE'), 'BOOTSTRAP_CHANGE_REFERENCE');
  const evidencePath = required('MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH');
  validateEvidenceTarget(evidencePath);
  const dbHost = validateText(required('DB_HOST'), 'DB_HOST', 255);
  const dbUser = validateText(required('DB_USER'), 'DB_USER', 128);
  const dbPort = parsePort(process.env.DB_PORT);
  if (dbHost.includes('/') || dbHost.includes('\\')) throw new Error('DB_HOST_PATH_PROHIBITED');

  const sql = secureReadBootstrap();
  validateBootstrapSql(sql);
  const bootstrapSha256 = crypto.createHash('sha256').update(sql).digest('hex');
  const connection = await mysql.createConnection({ host: dbHost, port: dbPort, user: dbUser, password: process.env.DB_PASSWORD || '', database: expectedDatabase, multipleStatements: false, charset: 'utf8mb4', connectTimeout: connectTimeoutMs, enableKeepAlive: false, namedPlaceholders: false });

  let connectionId = null;
  let lockAcquired = false;
  let advisoryLockOwnerVerified = false;
  let advisoryLockReleased = false;
  let ledgerSchemaVerified = false;
  let ledgerRowCount = null;
  let databaseIdentityVerified = false;
  let sessionSafetyVerified = false;
  try {
    const [identityRows] = await connection.execute('SELECT CONNECTION_ID() AS connection_id, DATABASE() AS database_name, @@session.autocommit AS autocommit_value');
    connectionId = Number(identityRows[0] && identityRows[0].connection_id);
    if (!Number.isInteger(connectionId) || connectionId <= 0) throw new Error('BOOTSTRAP_CONNECTION_ID_UNAVAILABLE');
    if (identityRows[0].database_name !== expectedDatabase) throw new Error('BOOTSTRAP_DATABASE_IDENTITY_MISMATCH');
    databaseIdentityVerified = true;
    if (Number(identityRows[0].autocommit_value) !== 1) throw new Error('BOOTSTRAP_AUTOCOMMIT_MUST_BE_ENABLED');
    await connection.execute("SET SESSION time_zone = '+00:00'");
    const [sessionRows] = await connection.execute('SELECT @@session.time_zone AS time_zone, @@session.sql_safe_updates AS safe_updates');
    if (sessionRows[0].time_zone !== '+00:00') throw new Error('BOOTSTRAP_SESSION_TIME_ZONE_MISMATCH');
    if (Number(sessionRows[0].safe_updates) !== 0) throw new Error('BOOTSTRAP_SESSION_SAFE_UPDATES_UNEXPECTED');
    sessionSafetyVerified = true;
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, ?) AS acquired', [lockName, lockTimeoutSeconds]);
    if (!lockRows[0] || Number(lockRows[0].acquired) !== 1) throw new Error('BOOTSTRAP_ADVISORY_LOCK_NOT_ACQUIRED');
    lockAcquired = true;
    const [ownerRows] = await connection.execute('SELECT IS_USED_LOCK(?) AS owner_connection_id', [lockName]);
    if (!ownerRows[0] || Number(ownerRows[0].owner_connection_id) !== connectionId) throw new Error('BOOTSTRAP_ADVISORY_LOCK_OWNER_MISMATCH');
    advisoryLockOwnerVerified = true;
    const [existing] = await connection.execute(`SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations'`, [expectedDatabase]);
    if (Number(existing[0].table_count) !== 0) throw new Error('BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE');
    await connection.query(sql);
    await verifyLedgerSchema(connection);
    ledgerSchemaVerified = true;
    const [ledgerRows] = await connection.execute('SELECT COUNT(*) AS ledger_rows FROM os2_schema_migrations');
    ledgerRowCount = Number(ledgerRows[0].ledger_rows);
    if (ledgerRowCount !== 0) throw new Error('BOOTSTRAP_LEDGER_NOT_EMPTY');
  } finally {
    if (lockAcquired) {
      const [ownerRows] = await connection.execute('SELECT IS_USED_LOCK(?) AS owner_connection_id', [lockName]);
      if (Number(ownerRows[0] && ownerRows[0].owner_connection_id) !== connectionId) throw new Error('BOOTSTRAP_ADVISORY_LOCK_OWNERSHIP_LOST');
      const [releaseRows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
      if (!releaseRows[0] || Number(releaseRows[0].released) !== 1) throw new Error('BOOTSTRAP_ADVISORY_LOCK_RELEASE_NOT_CONFIRMED');
      advisoryLockReleased = true;
      const [afterRows] = await connection.execute('SELECT IS_FREE_LOCK(?) AS is_free', [lockName]);
      if (!afterRows[0] || Number(afterRows[0].is_free) !== 1) throw new Error('BOOTSTRAP_ADVISORY_LOCK_NOT_FREE_AFTER_RELEASE');
    }
    await connection.end();
  }

  const completedAt = new Date().toISOString();
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error('BOOTSTRAP_TIMESTAMP_ORDER_INVALID');
  const evidence = {
    ok: true, check: 'migration-ledger-bootstrap-runner', database: expectedDatabase,
    bootstrapFile, bootstrapSha256, verifiedBackupReference, verifiedBackupSha256: verifiedBackupSha256.toLowerCase(),
    operator, changeReference, databaseIdentityVerified, sessionSafetyVerified,
    connectionIdRecorded: Number.isInteger(connectionId), advisoryLockName: lockName, advisoryLockTimeoutSeconds: lockTimeoutSeconds,
    preexistingLedgerTableCount: 0, createdLedgerTableCount: 1, ledgerSchemaVerified, ledgerRowCount,
    ledgerEmpty: ledgerRowCount === 0, advisoryLockUsed: lockAcquired, advisoryLockOwnerVerified, advisoryLockReleased,
    advisoryLockFreeAfterRelease: advisoryLockReleased, bootstrapSourceSecurelyRead: true, bootstrapSqlSingleStatementVerified: true,
    evidenceDirectoryPrivate: true, evidenceDirectoryOwnerVerified: true, evidencePathCanonical: true,
    startedAt, completedAt, productionMutationEnabled: false, mergeExecutionEnabled: false
  };
  if (!databaseIdentityVerified || !sessionSafetyVerified || !ledgerSchemaVerified || ledgerRowCount !== 0 || !advisoryLockOwnerVerified || !advisoryLockReleased) throw new Error('BOOTSTRAP_EVIDENCE_INCOMPLETE');
  const evidenceSha256 = publishEvidencePair(evidencePath, evidence);
  console.log(JSON.stringify({ ...evidence, evidencePath, evidenceSha256, privateAtomicEvidencePublished: true }, null, 2));
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
