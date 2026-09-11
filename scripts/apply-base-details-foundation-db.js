'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(APP_ROOT, '.env') });
const mysql = require('mysql2/promise');

const NEW_TABLES = ['mobile_base_current', 'mobile_base_snapshots', 'mobile_events', 'staff_external_codes'];
const ESSENTIAL_TABLES = ['clients', 'customer_accounts', 'monthly_import_batches', 'monthly_import_rows', 'staff_users'];
const COUNT_TABLES = ['clients', 'customer_accounts', 'monthly_import_batches', 'monthly_import_rows', 'staff_users'];
const EXPECTED_STAFF_CODES = new Map([
  ['OLIVIERJ06', 'jonathan@talk-online.co.za'],
  ['OLIVIERJ06_C3D', 'jonathan@talk-online.co.za'],
  ['LATEA002', 'annazel@talk-online.co.za'],
  ['LATEA002_C3D', 'annazel@talk-online.co.za'],
  ['VONSB001', 'sales3@talk-online.co.za'],
  ['VONSB001_C3D', 'sales3@talk-online.co.za'],
  ['HETZV001', 'sales4@talk-online.co.za'],
  ['HETZV001_C3D', 'sales4@talk-online.co.za'],
  ['BOOYE004', 'sias@talk-online.co.za'],
  ['BOOYE004_C3D', 'sias@talk-online.co.za']
]);

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Required host-side environment variable ${name} is missing.`);
  return value;
}

function assertSafeSqlPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!resolved.startsWith('/home/uent/.config/talk2me/db-ops/')) {
    throw new Error('SQL path is outside the private Talk2Me database operation directory.');
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`SQL file is missing: ${resolved}`);
  return resolved;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function tableNames(connection, names) {
  const placeholders = names.map(() => '?').join(',');
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME`,
    names
  );
  return rows.map(row => row.TABLE_NAME);
}

async function columnType(connection, column) {
  const [[row]] = await connection.execute(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='monthly_import_batches' AND COLUMN_NAME=? LIMIT 1`,
    [column]
  );
  return String(row?.COLUMN_TYPE || '');
}

async function counts(connection) {
  const result = {};
  for (const table of COUNT_TABLES) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    result[table] = Number(row.n || 0);
  }
  return result;
}

function sameCounts(before, after) {
  return COUNT_TABLES.every(table => Number(before[table]) === Number(after[table]));
}

function locateDumpBinary() {
  const probe = spawnSync('/bin/sh', ['-lc', 'command -v mariadb-dump || command -v mysqldump'], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error('Neither mariadb-dump nor mysqldump is available on the host.');
  const binary = String(probe.stdout || '').trim().split(/\r?\n/)[0];
  if (!binary || !fs.existsSync(binary)) throw new Error('Database dump binary could not be resolved.');
  return binary;
}

function createServerBackup(dbConfig, expectedCommit) {
  const backupDir = '/home/uent/database-backups/talk2me';
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupDir, 0o700);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const shortCommit = expectedCommit.slice(0, 12);
  const backupPath = path.join(backupDir, `${dbConfig.database}-before-base-details-${stamp}-${shortCommit}.sql`);
  const binary = locateDumpBinary();
  const fd = fs.openSync(backupPath, 'wx', 0o600);
  try {
    const args = [
      `--host=${dbConfig.host}`,
      `--port=${dbConfig.port}`,
      `--user=${dbConfig.user}`,
      '--single-transaction',
      '--quick',
      '--routines',
      '--triggers',
      '--events',
      '--hex-blob',
      '--default-character-set=utf8mb4',
      dbConfig.database
    ];
    const dump = spawnSync(binary, args, {
      env: { ...process.env, MYSQL_PWD: dbConfig.password },
      stdio: ['ignore', fd, 'pipe'],
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    });
    if (dump.status !== 0) throw new Error(`Server-side database backup failed with exit code ${dump.status}.`);
  } finally {
    fs.closeSync(fd);
  }

  const content = fs.readFileSync(backupPath);
  if (content.length < 100000) throw new Error('Server-side database backup is unexpectedly small; database changes were not attempted.');
  const text = content.toString('utf8');
  for (const table of ['clients', 'customer_accounts', 'monthly_import_batches', 'monthly_import_rows']) {
    if (!text.includes(`CREATE TABLE \`${table}\``)) throw new Error(`Server-side backup verification failed: ${table} definition is missing.`);
  }
  const hash = sha256(content);
  fs.writeFileSync(`${backupPath}.sha256`, `${hash}  ${path.basename(backupPath)}${os.EOL}`, { mode: 0o600 });
  return { path: backupPath, bytes: content.length, sha256: hash };
}

async function verifyStaffCodes(connection) {
  const [rows] = await connection.query(`
    SELECT sec.external_code_normalised,su.email
    FROM staff_external_codes sec
    JOIN staff_users su ON su.id=sec.staff_id
    WHERE sec.external_code_normalised IN (${[...EXPECTED_STAFF_CODES.keys()].map(() => '?').join(',')})
      AND sec.is_active=1
    ORDER BY sec.external_code_normalised
  `, [...EXPECTED_STAFF_CODES.keys()]);
  const seen = new Map(rows.map(row => [String(row.external_code_normalised), String(row.email || '').toLowerCase()]));
  for (const [code, email] of EXPECTED_STAFF_CODES) {
    if (seen.get(code) !== email) throw new Error(`Staff report identity verification failed for ${code}.`);
  }
  return rows.length;
}

async function verifyInstalled(connection) {
  const found = await tableNames(connection, NEW_TABLES);
  if (found.length !== NEW_TABLES.length) throw new Error(`Post-install verification found ${found.length}/${NEW_TABLES.length} Base Details tables.`);
  const importType = await columnType(connection, 'import_type');
  const sourceSystem = await columnType(connection, 'source_system');
  if (!importType.includes("'base_details'")) throw new Error('import_type enum does not contain base_details.');
  if (!sourceSystem.includes("'VODACOM_BASE'")) throw new Error('source_system enum does not contain VODACOM_BASE.');
  const emptyCounts = {};
  for (const table of ['mobile_base_current', 'mobile_base_snapshots', 'mobile_events']) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    emptyCounts[table] = Number(row.n || 0);
  }
  return { found, importType, sourceSystem, emptyCounts, staffCodeCount: await verifyStaffCodes(connection) };
}

async function main() {
  const [foundationArg, staffArg, expectedCommitArg] = process.argv.slice(2);
  const foundationSqlPath = assertSafeSqlPath(foundationArg);
  const staffSqlPath = assertSafeSqlPath(staffArg);
  const expectedCommit = String(expectedCommitArg || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('Expected release commit must be a full SHA.');

  const deployedMarkerPath = path.join(APP_ROOT, '.deployed_commit');
  const releaseManifestPath = path.join(APP_ROOT, '.talk2me-release.json');
  const deployedMarker = fs.existsSync(deployedMarkerPath) ? fs.readFileSync(deployedMarkerPath, 'utf8').trim() : '';
  const releaseManifest = fs.existsSync(releaseManifestPath) ? JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8')) : {};
  if (deployedMarker !== expectedCommit || String(releaseManifest.commit || '') !== expectedCommit) {
    throw new Error('Hosted application SHA does not match the authorised database-operation SHA.');
  }

  const dbConfig = {
    host: requiredEnv('DB_HOST'),
    port: Number(requiredEnv('DB_PORT')),
    database: requiredEnv('DB_NAME'),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    multipleStatements: true,
    charset: 'utf8mb4'
  };
  if (!Number.isInteger(dbConfig.port) || dbConfig.port < 1 || dbConfig.port > 65535) throw new Error('DB_PORT is invalid.');

  const connection = await mysql.createConnection(dbConfig);
  let backup;
  let mode = 'applied';
  try {
    const [[databaseRow]] = await connection.query('SELECT DATABASE() AS db');
    if (String(databaseRow.db || '') !== dbConfig.database) throw new Error('Connected database does not match DB_NAME.');

    const essentials = await tableNames(connection, ESSENTIAL_TABLES);
    if (essentials.length !== ESSENTIAL_TABLES.length) throw new Error(`Preflight failed: only ${essentials.length}/${ESSENTIAL_TABLES.length} essential Talk2Me tables are present.`);

    const beforeCounts = await counts(connection);
    const existingNewTables = await tableNames(connection, NEW_TABLES);
    const importTypeBefore = await columnType(connection, 'import_type');
    const sourceSystemBefore = await columnType(connection, 'source_system');
    const enumExpandedBefore = importTypeBefore.includes("'base_details'") || sourceSystemBefore.includes("'VODACOM_BASE'");
    const fullyInstalledBefore = existingNewTables.length === NEW_TABLES.length && importTypeBefore.includes("'base_details'") && sourceSystemBefore.includes("'VODACOM_BASE'");
    const cleanBefore = existingNewTables.length === 0 && !enumExpandedBefore;
    if (!cleanBefore && !fullyInstalledBefore) {
      throw new Error('Preflight found a partial Base Details schema state. Automatic continuation is blocked for manual review.');
    }

    backup = createServerBackup(dbConfig, expectedCommit);

    if (fullyInstalledBefore) {
      mode = 'already_installed_verified';
      const staffSql = fs.readFileSync(staffSqlPath, 'utf8');
      await connection.query(staffSql);
    } else {
      const foundationSql = fs.readFileSync(foundationSqlPath, 'utf8');
      const staffSql = fs.readFileSync(staffSqlPath, 'utf8');
      if (!foundationSql.includes('CREATE TABLE IF NOT EXISTS mobile_base_current') || !foundationSql.includes("'base_details'")) {
        throw new Error('Foundation SQL content guard failed.');
      }
      if (!staffSql.includes('COALESCE(NULLIF(TRIM(contact_number)')) throw new Error('Staff contact SQL content guard failed.');
      await connection.query(foundationSql);
      await connection.query(staffSql);
    }

    const afterCounts = await counts(connection);
    if (!sameCounts(beforeCounts, afterCounts)) throw new Error('Core Talk2Me row counts changed during the schema operation; stop and investigate.');
    const verification = await verifyInstalled(connection);
    if (mode === 'applied') {
      for (const [table, n] of Object.entries(verification.emptyCounts)) {
        if (n !== 0) throw new Error(`${table} is not empty immediately after foundation installation.`);
      }
    }

    const operation = {
      ok: true,
      mode,
      commit: expectedCommit,
      database: dbConfig.database,
      backup,
      beforeCounts,
      afterCounts,
      installedTables: verification.found,
      emptyNewDataTables: verification.emptyCounts,
      staffExternalCodesVerified: verification.staffCodeCount,
      completedAt: new Date().toISOString()
    };
    const recordPath = path.join(path.dirname(backup.path), `base-details-foundation-operation-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${expectedCommit.slice(0, 12)}.json`);
    fs.writeFileSync(recordPath, `${JSON.stringify(operation, null, 2)}${os.EOL}`, { mode: 0o600 });
    operation.operationRecord = recordPath;
    process.stdout.write(`${JSON.stringify(operation, null, 2)}${os.EOL}`);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`BASE_DETAILS_DB_OPERATION_FAILED: ${error.message}`);
  process.exitCode = 1;
});
