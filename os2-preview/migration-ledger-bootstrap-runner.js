'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const root = __dirname;
const bootstrapPath = path.join(root, 'MIGRATION_LEDGER_BOOTSTRAP.sql');
const expectedDatabase = 'kloka_talk2me';
const lockName = 'talk2me_os2_preview_migrations';
const maxBootstrapBytes = 1024 * 1024;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function secureReadBootstrap() {
  const pathStat = fs.lstatSync(bootstrapPath);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error('BOOTSTRAP_SOURCE_NOT_REGULAR_FILE');
  if (pathStat.nlink !== 1) throw new Error('BOOTSTRAP_SOURCE_HARD_LINK_PROHIBITED');
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) throw new Error('BOOTSTRAP_SOURCE_WRITABLE_BY_GROUP_OR_WORLD');
  if (pathStat.size > maxBootstrapBytes) throw new Error('BOOTSTRAP_SOURCE_TOO_LARGE');
  if (fs.realpathSync.native(bootstrapPath) !== bootstrapPath) throw new Error('BOOTSTRAP_SOURCE_NOT_CANONICAL');
  if (typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('O_NOFOLLOW_UNAVAILABLE');
  const descriptor = fs.openSync(bootstrapPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) throw new Error('BOOTSTRAP_DESCRIPTOR_NOT_REGULAR_FILE');
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error('BOOTSTRAP_SOURCE_CHANGED_DURING_OPEN');
    if (descriptorStat.nlink !== 1) throw new Error('BOOTSTRAP_DESCRIPTOR_HARD_LINK_PROHIBITED');
    if (descriptorStat.size > maxBootstrapBytes) throw new Error('BOOTSTRAP_DESCRIPTOR_TOO_LARGE');
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateBootstrapSql(sql) {
  const upper = sql.toUpperCase();
  const requiredMarkers = [
    'CREATE TABLE OS2_SCHEMA_MIGRATIONS',
    'PRIMARY KEY (ID)',
    'UNIQUE KEY UQ_OS2_SCHEMA_MIGRATION_NAME (MIGRATION_NAME)',
    'ENGINE=INNODB',
    'COLLATE=UTF8MB4_UNICODE_CI'
  ];
  for (const marker of requiredMarkers) if (!upper.includes(marker)) throw new Error(`BOOTSTRAP_SQL_MISSING_MARKER:${marker}`);
  const prohibited = ['DROP TABLE','ALTER TABLE','INSERT INTO','UPDATE ','DELETE FROM','CREATE TABLE IF NOT EXISTS'];
  for (const token of prohibited) if (upper.includes(token)) throw new Error(`BOOTSTRAP_SQL_PROHIBITED_TOKEN:${token}`);
  if ((upper.match(/CREATE TABLE/g) || []).length !== 1) throw new Error('BOOTSTRAP_SQL_MUST_CREATE_EXACTLY_ONE_TABLE');
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
  const [indexes] = await connection.execute(`SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations' ORDER BY INDEX_NAME,SEQ_IN_INDEX`, [expectedDatabase]);
  if (!indexes.some(row => row.INDEX_NAME === 'PRIMARY' && row.COLUMN_NAME === 'id' && Number(row.NON_UNIQUE) === 0)) throw new Error('BOOTSTRAP_POSTCHECK_PRIMARY_KEY_MISSING');
  if (!indexes.some(row => row.INDEX_NAME === 'uq_os2_schema_migration_name' && row.COLUMN_NAME === 'migration_name' && Number(row.NON_UNIQUE) === 0)) throw new Error('BOOTSTRAP_POSTCHECK_UNIQUE_KEY_MISSING');
}

async function run() {
  if (required('DB_NAME') !== expectedDatabase) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  if (String(process.env.ALLOW_MIGRATION_LEDGER_BOOTSTRAP || '').toLowerCase() !== 'true') throw new Error('ALLOW_MIGRATION_LEDGER_BOOTSTRAP_NOT_ENABLED');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');
  const backupReference = required('VERIFIED_BACKUP_REFERENCE');
  const backupSha256 = required('VERIFIED_BACKUP_SHA256');
  if (!/^[0-9a-f]{64}$/i.test(backupSha256)) throw new Error('VERIFIED_BACKUP_SHA256_INVALID');
  const operator = required('BOOTSTRAP_OPERATOR');
  const changeReference = required('BOOTSTRAP_CHANGE_REFERENCE');

  const sql = secureReadBootstrap();
  validateBootstrapSql(sql);
  const sourceSha256 = crypto.createHash('sha256').update(sql).digest('hex');
  const connection = await mysql.createConnection({
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: expectedDatabase,
    multipleStatements: false,
    charset: 'utf8mb4'
  });

  let connectionId = null;
  let lockAcquired = false;
  try {
    const [identityRows] = await connection.execute('SELECT CONNECTION_ID() AS connection_id');
    connectionId = Number(identityRows[0] && identityRows[0].connection_id);
    if (!Number.isInteger(connectionId) || connectionId <= 0) throw new Error('BOOTSTRAP_CONNECTION_ID_UNAVAILABLE');
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    if (!lockRows[0] || Number(lockRows[0].acquired) !== 1) throw new Error('BOOTSTRAP_ADVISORY_LOCK_NOT_ACQUIRED');
    lockAcquired = true;
    const [ownerRows] = await connection.execute('SELECT IS_USED_LOCK(?) AS owner_connection_id', [lockName]);
    if (!ownerRows[0] || Number(ownerRows[0].owner_connection_id) !== connectionId) throw new Error('BOOTSTRAP_ADVISORY_LOCK_OWNER_MISMATCH');
    const [existing] = await connection.execute(`SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='os2_schema_migrations'`, [expectedDatabase]);
    if (Number(existing[0].table_count) !== 0) throw new Error('BOOTSTRAP_REFUSES_EXISTING_LEDGER_TABLE');
    await connection.query(sql);
    await verifyLedgerSchema(connection);
    const [ledgerRows] = await connection.execute('SELECT COUNT(*) AS ledger_rows FROM os2_schema_migrations');
    if (Number(ledgerRows[0].ledger_rows) !== 0) throw new Error('BOOTSTRAP_LEDGER_NOT_EMPTY');
    console.log(JSON.stringify({
      ok: true,
      check: 'migration-ledger-bootstrap-runner',
      database: expectedDatabase,
      sourceSha256,
      backupReference,
      backupSha256: backupSha256.toLowerCase(),
      operator,
      changeReference,
      ledgerSchemaVerified: true,
      ledgerEmpty: true,
      advisoryLockOwnerVerified: true,
      productionMutationEnabled: false,
      mergeExecutionEnabled: false
    }, null, 2));
  } finally {
    if (lockAcquired) {
      try {
        const [ownerRows] = await connection.execute('SELECT IS_USED_LOCK(?) AS owner_connection_id', [lockName]);
        if (Number(ownerRows[0] && ownerRows[0].owner_connection_id) !== connectionId) throw new Error('BOOTSTRAP_ADVISORY_LOCK_OWNERSHIP_LOST');
        const [releaseRows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
        if (!releaseRows[0] || Number(releaseRows[0].released) !== 1) throw new Error('BOOTSTRAP_ADVISORY_LOCK_RELEASE_NOT_CONFIRMED');
      } catch (error) {
        console.error(error.message);
      }
    }
    await connection.end();
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
