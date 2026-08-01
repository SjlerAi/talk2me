'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const PREVIEW_DATABASE = 'kloka_talk2me';
const MIGRATION_LOCK_NAME = 'talk2me_os2_preview_migrations';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 10;
const MAX_MIGRATION_BYTES = 4 * 1024 * 1024;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function secureMigrationDirectory() {
  const pathStat = fs.lstatSync(MIGRATIONS_DIR);
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) throw new Error('MIGRATIONS_DIRECTORY_NOT_SECURE');
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) throw new Error('MIGRATIONS_DIRECTORY_WRITABLE_BY_GROUP_OR_WORLD');
  const canonical = fs.realpathSync.native(MIGRATIONS_DIR);
  if (canonical !== MIGRATIONS_DIR) throw new Error('MIGRATIONS_DIRECTORY_NOT_CANONICAL');
  if (typeof fs.constants.O_NOFOLLOW !== 'number' || typeof fs.constants.O_DIRECTORY !== 'number') throw new Error('SECURE_DIRECTORY_FLAGS_UNAVAILABLE');
  const descriptor = fs.openSync(MIGRATIONS_DIR, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isDirectory()) throw new Error('MIGRATIONS_DIRECTORY_DESCRIPTOR_INVALID');
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error('MIGRATIONS_DIRECTORY_CHANGED_DURING_OPEN');
    return { uid: descriptorStat.uid, dev: descriptorStat.dev, ino: descriptorStat.ino };
  } finally {
    fs.closeSync(descriptor);
  }
}

function migrationFiles() {
  const names = fs.readdirSync(MIGRATIONS_DIR);
  const sqlFiles = names.filter(name => name.toLowerCase().endsWith('.sql'));
  const valid = sqlFiles.filter(name => /^\d{8}_\d{3}_[a-z0-9_]+\.sql$/i.test(name)).sort();
  if (sqlFiles.length !== valid.length) throw new Error('INVALID_MIGRATION_FILENAME_PRESENT');
  if (valid.length < 25) throw new Error(`INSUFFICIENT_MIGRATION_COUNT:${valid.length}`);
  if (!valid.includes('20260801_025_merge_authorisation_restore_pin.sql')) throw new Error('MIGRATION_025_MISSING');
  if (new Set(valid).size !== valid.length) throw new Error('DUPLICATE_MIGRATION_FILENAME');
  return valid;
}

function readMigrationSecurely(name, expectedOwner) {
  if (path.basename(name) !== name) throw new Error(`INVALID_MIGRATION_BASENAME:${name}`);
  const file = path.join(MIGRATIONS_DIR, name);
  const pathStat = fs.lstatSync(file);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error(`MIGRATION_NOT_REGULAR_FILE:${name}`);
  if (pathStat.nlink !== 1) throw new Error(`MIGRATION_HARD_LINK_PROHIBITED:${name}`);
  if (Number.isInteger(expectedOwner) && pathStat.uid !== expectedOwner) throw new Error(`MIGRATION_OWNER_MISMATCH:${name}`);
  if (process.platform !== 'win32' && (pathStat.mode & 0o022) !== 0) throw new Error(`MIGRATION_WRITABLE_BY_GROUP_OR_WORLD:${name}`);
  if (pathStat.size > MAX_MIGRATION_BYTES) throw new Error(`MIGRATION_TOO_LARGE:${name}`);
  if (fs.realpathSync.native(file) !== file) throw new Error(`MIGRATION_PATH_NOT_CANONICAL:${name}`);
  if (typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error('SECURE_FILE_FLAGS_UNAVAILABLE');

  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile()) throw new Error(`MIGRATION_DESCRIPTOR_INVALID:${name}`);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) throw new Error(`MIGRATION_CHANGED_DURING_OPEN:${name}`);
    if (descriptorStat.nlink !== 1) throw new Error(`MIGRATION_DESCRIPTOR_HARD_LINK_PROHIBITED:${name}`);
    if (descriptorStat.size > MAX_MIGRATION_BYTES) throw new Error(`MIGRATION_DESCRIPTOR_TOO_LARGE:${name}`);
    if (Number.isInteger(expectedOwner) && descriptorStat.uid !== expectedOwner) throw new Error(`MIGRATION_DESCRIPTOR_OWNER_MISMATCH:${name}`);
    if (process.platform !== 'win32' && (descriptorStat.mode & 0o022) !== 0) throw new Error(`MIGRATION_DESCRIPTOR_WRITABLE_BY_GROUP_OR_WORLD:${name}`);
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

async function ensureLedger(connection) {
  await connection.execute(`CREATE TABLE IF NOT EXISTS os2_schema_migrations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    migration_name VARCHAR(255) NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    executed_by VARCHAR(190) NULL,
    execution_ms INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_os2_schema_migration_name (migration_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function acquireMigrationLock(connection) {
  const [identityRows] = await connection.execute('SELECT CONNECTION_ID() AS connection_id');
  const connectionId = Number(identityRows[0] && identityRows[0].connection_id);
  if (!Number.isInteger(connectionId) || connectionId <= 0) throw new Error('MIGRATION_CONNECTION_ID_UNAVAILABLE');
  const [rows] = await connection.execute('SELECT GET_LOCK(?, ?) AS acquired', [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS]);
  if (!rows[0] || Number(rows[0].acquired) !== 1) throw new Error('MIGRATION_ADVISORY_LOCK_NOT_ACQUIRED');
  const [ownerRows] = await connection.execute('SELECT IS_USED_LOCK(?) AS owner_connection_id', [MIGRATION_LOCK_NAME]);
  if (!ownerRows[0] || Number(ownerRows[0].owner_connection_id) !== connectionId) throw new Error('MIGRATION_ADVISORY_LOCK_OWNER_MISMATCH');
  return connectionId;
}

async function releaseMigrationLock(connection, expectedConnectionId) {
  try {
    const [ownerRows] = await connection.execute('SELECT IS_USED_LOCK(?) AS owner_connection_id', [MIGRATION_LOCK_NAME]);
    const ownerConnectionId = ownerRows[0] ? Number(ownerRows[0].owner_connection_id) : null;
    if (ownerConnectionId !== expectedConnectionId) throw new Error('MIGRATION_ADVISORY_LOCK_OWNERSHIP_LOST');
    const [releaseRows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [MIGRATION_LOCK_NAME]);
    if (!releaseRows[0] || Number(releaseRows[0].released) !== 1) throw new Error('MIGRATION_ADVISORY_LOCK_RELEASE_NOT_CONFIRMED');
  } catch (error) {
    console.error(`MIGRATION_ADVISORY_LOCK_RELEASE_FAILED:${error.message}`);
  }
}

function validateAppliedLedger(appliedRows, migrationSources) {
  if (appliedRows.length > migrationSources.length) throw new Error('MIGRATION_LEDGER_LONGER_THAN_SOURCE_INVENTORY');
  const seen = new Set();
  for (let index = 0; index < appliedRows.length; index += 1) {
    const row = appliedRows[index];
    const source = migrationSources[index];
    if (!row || typeof row.migration_name !== 'string') throw new Error(`MIGRATION_LEDGER_ROW_INVALID:${index}`);
    if (seen.has(row.migration_name)) throw new Error(`MIGRATION_LEDGER_DUPLICATE:${row.migration_name}`);
    seen.add(row.migration_name);
    if (!source || row.migration_name !== source.name) throw new Error(`MIGRATION_LEDGER_NOT_STRICT_PREFIX:${row.migration_name}`);
    if (!/^[0-9a-f]{64}$/i.test(String(row.checksum_sha256 || ''))) throw new Error(`MIGRATION_LEDGER_CHECKSUM_INVALID:${row.migration_name}`);
    if (row.checksum_sha256.toLowerCase() !== source.digest) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${row.migration_name}`);
  }
  return new Set(appliedRows.map(row => row.migration_name));
}

async function run() {
  const database = required('DB_NAME');
  if (database !== PREVIEW_DATABASE) throw new Error(`REFUSING_NON_PREVIEW_DATABASE:${database}`);
  if (String(process.env.ALLOW_PREVIEW_MIGRATIONS || '').toLowerCase() !== 'true') throw new Error('ALLOW_PREVIEW_MIGRATIONS_NOT_ENABLED');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');

  const directoryIdentity = secureMigrationDirectory();
  const files = migrationFiles();
  const migrationSources = files.map(name => {
    const sql = readMigrationSecurely(name, directoryIdentity.uid);
    return { name, sql, digest: checksum(sql) };
  });
  const after = fs.lstatSync(MIGRATIONS_DIR);
  if (after.dev !== directoryIdentity.dev || after.ino !== directoryIdentity.ino) throw new Error('MIGRATIONS_DIRECTORY_CHANGED_DURING_INVENTORY');

  const connection = await mysql.createConnection({
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  let lockAcquired = false;
  let lockConnectionId = null;
  try {
    lockConnectionId = await acquireMigrationLock(connection);
    lockAcquired = true;
    await ensureLedger(connection);
    const [appliedRows] = await connection.execute('SELECT migration_name, checksum_sha256 FROM os2_schema_migrations ORDER BY id ASC');
    const applied = validateAppliedLedger(appliedRows, migrationSources);
    let executed = 0;

    for (const migration of migrationSources) {
      if (applied.has(migration.name)) {
        console.log(`skip ${migration.name}`);
        continue;
      }
      const started = Date.now();
      await connection.query(migration.sql);
      await connection.execute(`INSERT INTO os2_schema_migrations
        (migration_name,checksum_sha256,executed_by,execution_ms)
        VALUES (:name,:checksum,:executedBy,:executionMs)`, {
        name: migration.name,
        checksum: migration.digest,
        executedBy: process.env.USER || process.env.USERNAME || 'preview-runner',
        executionMs: Date.now() - started
      });
      executed += 1;
      console.log(`applied ${migration.name}`);
    }

    console.log(JSON.stringify({
      ok: true,
      check: 'preview-migration-runner',
      database,
      migrationCount: migrationSources.length,
      previouslyApplied: applied.size,
      applied: executed,
      ledgerStrictPrefixVerified: true,
      advisoryLockUsed: true,
      advisoryLockOwnerVerified: true,
      secureMigrationReads: true,
      productionMutationEnabled: false,
      mergeExecutionEnabled: false
    }, null, 2));
  } finally {
    if (lockAcquired) await releaseMigrationLock(connection, lockConnectionId);
    await connection.end();
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
