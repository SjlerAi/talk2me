'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(APP_ROOT, '.env') });

const mysql = require('mysql2/promise');
const db = require('../src/config/db');
const { loadPendingMobileSummary, rematchPendingMobileImports } = require('../src/services/pending-mobile-rematcher');
const { syncMobileEvents } = require('../src/services/mobile-event-ledger');

const GERDA_EMAIL = 'gerda@talk-online.co.za';
const GERDA_CODE = 'LEROUXG02_C3D';
const PROTECTED_COUNT_TABLES = ['clients', 'customer_accounts', 'mobile_base_current', 'mobile_base_snapshots'];

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Required host-side environment variable ${name} is missing.`);
  return value;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
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
  const backupPath = path.join(backupDir, `${dbConfig.database}-before-base-cleanup-${stamp}-${expectedCommit.slice(0, 12)}.sql`);
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
  if (content.length < 100000) throw new Error('Server-side database backup is unexpectedly small; cleanup was not attempted.');
  const text = content.toString('utf8');
  for (const table of ['clients', 'customer_accounts', 'monthly_import_rows', 'monthly_import_matches', 'monthly_import_actions', 'mobile_base_current', 'mobile_events', 'staff_external_codes']) {
    if (!text.includes(`CREATE TABLE \`${table}\``)) throw new Error(`Backup verification failed: ${table} definition is missing.`);
  }
  const hash = sha256(content);
  fs.writeFileSync(`${backupPath}.sha256`, `${hash}  ${path.basename(backupPath)}${os.EOL}`, { mode: 0o600 });
  return { path: backupPath, bytes: content.length, sha256: hash };
}

async function protectedCounts(connection = db) {
  const result = {};
  for (const table of PROTECTED_COUNT_TABLES) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    result[table] = Number(row.n || 0);
  }
  return result;
}

function assertSameProtectedCounts(before, after) {
  for (const table of PROTECTED_COUNT_TABLES) {
    if (Number(before[table]) !== Number(after[table])) {
      throw new Error(`Protected table ${table} changed row count during cleanup (${before[table]} -> ${after[table]}).`);
    }
  }
}

async function mapGerdaAlias() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [staffRows] = await connection.execute(`
      SELECT id,full_name,email,role,is_active
      FROM staff_users
      WHERE LOWER(email)=:email
      ORDER BY id
      FOR UPDATE
    `, { email: GERDA_EMAIL });
    if (staffRows.length !== 1) throw new Error(`Expected exactly one staff record for ${GERDA_EMAIL}; found ${staffRows.length}.`);
    const staff = staffRows[0];
    if (!staff.is_active) throw new Error('Gerda staff record is inactive; automatic alias mapping is blocked.');

    const [existing] = await connection.execute(`
      SELECT sec.id,sec.staff_id,sec.external_code_normalised,sec.is_active,su.full_name staff_name
      FROM staff_external_codes sec
      JOIN staff_users su ON su.id=sec.staff_id
      WHERE sec.external_code_normalised=:code
      ORDER BY sec.id
      FOR UPDATE
    `, { code: GERDA_CODE });
    const conflict = existing.find(row => Number(row.staff_id) !== Number(staff.id));
    if (conflict) throw new Error(`${GERDA_CODE} is already assigned to ${conflict.staff_name}; automatic reassignment is blocked.`);

    let codeId;
    let mode;
    if (existing.length) {
      codeId = Number(existing[0].id);
      mode = 'verified_or_reactivated';
      await connection.execute(`
        UPDATE staff_external_codes
        SET source_system='VODACOM_REPORTS',external_code=:code,external_code_normalised=:code,is_active=1
        WHERE id=:id
      `, { id: codeId, code: GERDA_CODE });
    } else {
      mode = 'created';
      const [created] = await connection.execute(`
        INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised,is_active)
        VALUES (:staffId,'VODACOM_REPORTS',:code,:code,1)
      `, { staffId: staff.id, code: GERDA_CODE });
      codeId = Number(created.insertId);
    }

    await connection.commit();
    return { codeId, mode, staffId: Number(staff.id), fullName: staff.full_name, email: staff.email, role: staff.role, code: GERDA_CODE };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function eventSummary(connection = db) {
  const [[row]] = await connection.query(`
    SELECT COUNT(*) events,
      COALESCE(SUM(event_type='activation'),0) activations,
      COALESCE(SUM(event_type='upgrade'),0) upgrades,
      COALESCE(SUM(staff_id IS NOT NULL),0) staff_matched,
      COALESCE(SUM(UPPER(COALESCE(agent_code,''))='SADMIN' AND staff_id IS NULL),0) system_events,
      COALESCE(SUM(agent_code IS NOT NULL AND staff_id IS NULL AND UPPER(agent_code)<>'SADMIN'),0) genuine_unmapped
    FROM mobile_events
  `);
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

async function verifyGerdaEvents(connection = db) {
  const [[row]] = await connection.execute(`
    SELECT COUNT(*) total,
      COALESCE(SUM(me.staff_id=su.id),0) correctly_linked
    FROM mobile_events me
    JOIN staff_users su ON LOWER(su.email)=:email
    WHERE UPPER(COALESCE(me.agent_code,''))=:code
  `, { email: GERDA_EMAIL, code: GERDA_CODE });
  return { total: Number(row?.total || 0), correctlyLinked: Number(row?.correctly_linked || 0) };
}

async function main() {
  const expectedCommit = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('Expected release commit must be a full SHA.');

  const deployedMarkerPath = path.join(APP_ROOT, '.deployed_commit');
  const releaseManifestPath = path.join(APP_ROOT, '.talk2me-release.json');
  const deployedMarker = fs.existsSync(deployedMarkerPath) ? fs.readFileSync(deployedMarkerPath, 'utf8').trim() : '';
  const releaseManifest = fs.existsSync(releaseManifestPath) ? JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8')) : {};
  if (deployedMarker !== expectedCommit || String(releaseManifest.commit || '') !== expectedCommit) {
    throw new Error('Hosted application SHA does not match the authorised cleanup-operation SHA.');
  }

  const dbConfig = {
    host: requiredEnv('DB_HOST'),
    port: Number(requiredEnv('DB_PORT')),
    database: requiredEnv('DB_NAME'),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD')
  };
  if (!Number.isInteger(dbConfig.port) || dbConfig.port < 1 || dbConfig.port > 65535) throw new Error('DB_PORT is invalid.');

  const verificationConnection = await mysql.createConnection({ ...dbConfig, charset: 'utf8mb4' });
  try {
    const [[databaseRow]] = await verificationConnection.query('SELECT DATABASE() AS db');
    if (String(databaseRow.db || '') !== dbConfig.database) throw new Error('Connected database does not match DB_NAME.');
  } finally {
    await verificationConnection.end();
  }

  const beforeProtected = await protectedCounts();
  if (beforeProtected.mobile_base_current < 1 || beforeProtected.mobile_base_snapshots < 1) {
    throw new Error('Current Base Details layer is empty; cleanup is blocked.');
  }
  const beforePending = await loadPendingMobileSummary();
  const beforeEvents = await eventSummary();
  const backup = createServerBackup(dbConfig, expectedCommit);

  const gerda = await mapGerdaAlias();
  const rematch = await rematchPendingMobileImports();
  const eventSync = await syncMobileEvents({ userId: null });

  const afterPending = await loadPendingMobileSummary();
  const afterEvents = await eventSummary();
  const gerdaEvents = await verifyGerdaEvents();
  const afterProtected = await protectedCounts();
  assertSameProtectedCounts(beforeProtected, afterProtected);

  if (gerdaEvents.total > 0 && gerdaEvents.correctlyLinked !== gerdaEvents.total) {
    throw new Error(`Gerda event verification failed: ${gerdaEvents.correctlyLinked}/${gerdaEvents.total} linked.`);
  }

  const operation = {
    ok: true,
    commit: expectedCommit,
    database: dbConfig.database,
    backup,
    gerda,
    pendingBefore: beforePending,
    rematch,
    pendingAfter: afterPending,
    eventsBefore: beforeEvents,
    eventSync,
    eventsAfter: afterEvents,
    gerdaEvents,
    protectedCountsBefore: beforeProtected,
    protectedCountsAfter: afterProtected,
    completedAt: new Date().toISOString()
  };

  const recordPath = path.join(
    path.dirname(backup.path),
    `base-details-live-cleanup-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${expectedCommit.slice(0, 12)}.json`
  );
  fs.writeFileSync(recordPath, `${JSON.stringify(operation, null, 2)}${os.EOL}`, { mode: 0o600 });
  operation.operationRecord = recordPath;
  process.stdout.write(`${JSON.stringify(operation, null, 2)}${os.EOL}`);
  await db.end();
}

main().catch(async error => {
  console.error(`BASE_DETAILS_LIVE_CLEANUP_FAILED: ${error.message}`);
  try { await db.end(); } catch {}
  process.exitCode = 1;
});
