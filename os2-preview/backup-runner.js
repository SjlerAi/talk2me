'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const PREVIEW_DB = 'kloka_talk2me';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function ensureSafeConfiguration() {
  if (required('DB_NAME') !== PREVIEW_DB) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  if (process.env.ALLOW_PREVIEW_BACKUPS !== 'true') throw new Error('PREVIEW_BACKUPS_NOT_ENABLED');
  const backupDir = path.resolve(required('BACKUP_PRIVATE_DIR'));
  if (!path.isAbsolute(backupDir)) throw new Error('BACKUP_DIRECTORY_MUST_BE_ABSOLUTE');
  if (backupDir.includes('/public_html/') || backupDir.endsWith('/public_html')) throw new Error('BACKUP_DIRECTORY_MUST_NOT_BE_PUBLIC');
  return backupDir;
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function runDump(filePath) {
  const args = [
    '--single-transaction','--quick','--routines','--triggers','--events',
    '--default-character-set=utf8mb4',
    '-h', required('DB_HOST'),
    '-P', String(process.env.DB_PORT || 3306),
    '-u', required('DB_USER'),
    PREVIEW_DB
  ];
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { mode: 0o600 });
    const child = spawn(process.env.MYSQLDUMP_BIN || 'mysqldump', args, {
      env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' },
      stdio: ['ignore','pipe','pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 8000); });
    child.stdout.pipe(output);
    child.on('error', reject);
    child.on('close', code => {
      output.end();
      code === 0 ? resolve() : reject(new Error(`MYSQLDUMP_FAILED_${code}:${stderr.slice(-1000)}`));
    });
  });
}

async function main() {
  const backupDir = ensureSafeConfiguration();
  fs.mkdirSync(backupDir, { recursive:true, mode:0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const fileName = `talk2me-preview-${stamp}.sql`;
  const filePath = path.join(backupDir, fileName);
  const workerId = `${os.hostname()}:${process.pid}`.slice(0,160);
  const pool = mysql.createPool({
    host: required('DB_HOST'), port:Number(process.env.DB_PORT || 3306), user:required('DB_USER'),
    password:process.env.DB_PASSWORD || '', database:PREVIEW_DB, connectionLimit:2, namedPlaceholders:true
  });
  let backupId;
  try {
    const [insert] = await pool.execute(`INSERT INTO os2_backup_runs
      (backup_type,status,database_name,storage_path,file_name,worker_id,started_at,created_at,updated_at)
      VALUES('database','running',:db,:storage,:file,:worker,NOW(),NOW(),NOW())`, {
      db:PREVIEW_DB, storage:backupDir, file:fileName, worker:workerId
    });
    backupId = Number(insert.insertId);
    const [[stats]] = await pool.execute(`SELECT COUNT(*) table_count,COALESCE(SUM(TABLE_ROWS),0) row_count_estimate
      FROM information_schema.TABLES WHERE TABLE_SCHEMA=:db`, { db:PREVIEW_DB });
    await runDump(filePath);
    const checksum = await sha256(filePath);
    const fileSize = fs.statSync(filePath).size;
    await pool.execute(`UPDATE os2_backup_runs SET status='completed',checksum_sha256=:checksum,
      file_size_bytes=:size,table_count=:tables,row_count_estimate=:rows,completed_at=NOW(),updated_at=NOW()
      WHERE id=:id`, { id:backupId, checksum, size:fileSize, tables:Number(stats.table_count), rows:Number(stats.row_count_estimate) });
    console.log(JSON.stringify({ ok:true, backupId, fileName, fileSize, checksum, database:PREVIEW_DB }, null, 2));
  } catch (error) {
    if (backupId) await pool.execute(`UPDATE os2_backup_runs SET status='failed',failure_reason=:reason,completed_at=NOW(),updated_at=NOW() WHERE id=:id`, {
      id:backupId, reason:String(error.message || error).slice(0,1000)
    }).catch(() => {});
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force:true });
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`BACKUP FAILED: ${error.message}`);
  process.exit(1);
});
