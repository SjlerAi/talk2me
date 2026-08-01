'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PREVIEW_DB = 'kloka_talk2me';

function hashFile(filePath) {
  return new Promise((resolve,reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error',reject);
    stream.on('data',chunk => hash.update(chunk));
    stream.on('end',() => resolve(hash.digest('hex')));
  });
}

async function main() {
  if (String(process.env.DB_NAME || '') !== PREVIEW_DB) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  const backupId = Number(process.argv[2] || process.env.BACKUP_ID);
  if (!Number.isInteger(backupId) || backupId <= 0) throw new Error('VALID_BACKUP_ID_REQUIRED');
  const pool = mysql.createPool({
    host:process.env.DB_HOST, port:Number(process.env.DB_PORT || 3306), user:process.env.DB_USER,
    password:process.env.DB_PASSWORD || '', database:PREVIEW_DB, connectionLimit:2, namedPlaceholders:true
  });
  try {
    const [[record]] = await pool.execute('SELECT * FROM os2_backup_runs WHERE id=:id', { id:backupId });
    if (!record) throw new Error('BACKUP_NOT_FOUND');
    if (record.status !== 'completed' && record.status !== 'verified') throw new Error('BACKUP_NOT_COMPLETED');
    const filePath = path.resolve(String(record.storage_path || ''), String(record.file_name || ''));
    if (!fs.existsSync(filePath)) throw new Error('BACKUP_FILE_MISSING');
    const stat = fs.statSync(filePath);
    const checksum = await hashFile(filePath);
    const firstBytes = fs.readFileSync(filePath, { encoding:'utf8', flag:'r' }).slice(0,4096);
    const checks = {
      fileExists:true,
      nonEmpty:stat.size > 1024,
      checksumMatches:checksum === record.checksum_sha256,
      containsSqlHeader:/MySQL|MariaDB|CREATE TABLE|SET /i.test(firstBytes)
    };
    const passed = Object.values(checks).every(Boolean);
    await pool.execute(`UPDATE os2_backup_runs SET status=:status,verified_at=NOW(),metadata_json=:metadata,updated_at=NOW()
      WHERE id=:id`, { id:backupId, status:passed ? 'verified' : 'failed', metadata:JSON.stringify({ verification:checks,verifiedChecksum:checksum }) });
    await pool.execute(`INSERT INTO os2_operational_checks(check_type,status,metric_value,metric_unit,details_json,checked_at,worker_id)
      VALUES('backup_file_verification',:status,:size,'bytes',:details,NOW(),:worker)`, {
      status:passed ? 'passed' : 'failed', size:stat.size, details:JSON.stringify({ backupId,checks }), worker:`backup-verification:${process.pid}`
    });
    if (!passed) throw new Error('BACKUP_VERIFICATION_FAILED');
    console.log(JSON.stringify({ ok:true, backupId, filePath, size:stat.size, checksum, checks }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`BACKUP VERIFICATION FAILED: ${error.message}`);
  process.exit(1);
});
