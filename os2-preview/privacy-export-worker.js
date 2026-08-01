'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PREVIEW_DB = 'kloka_talk2me';
const workerId = `privacy-export-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const exportRoot = path.resolve(process.env.PRIVACY_EXPORT_DIR || path.join(__dirname, 'private-exports'));
const batchSize = Math.min(Math.max(Number(process.env.PRIVACY_EXPORT_BATCH_SIZE || 3), 1), 10);

function assertPreviewSafety() {
  if (String(process.env.DB_NAME || '') !== PREVIEW_DB) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  if (String(process.env.PRIVACY_EXPORT_WORKER_ENABLED || '').toLowerCase() !== 'true') throw new Error('PRIVACY_EXPORT_WORKER_DISABLED');
  if (!path.isAbsolute(exportRoot)) throw new Error('PRIVACY_EXPORT_DIR_MUST_BE_ABSOLUTE');
}
function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}
async function claimExports(pool) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`UPDATE os2_data_exports SET status='queued',worker_id=NULL,claimed_at=NULL,updated_at=NOW()
      WHERE status='processing' AND claimed_at<NOW()-INTERVAL 20 MINUTE`);
    const [rows] = await connection.execute(`SELECT id FROM os2_data_exports
      WHERE status='queued' AND expires_at>NOW() ORDER BY created_at,id LIMIT ${batchSize} FOR UPDATE`);
    const ids = rows.map(row => Number(row.id));
    if (ids.length) {
      await connection.execute(`UPDATE os2_data_exports SET status='processing',worker_id=:workerId,claimed_at=NOW(),
        attempts=attempts+1,updated_at=NOW() WHERE id IN (${ids.map(() => '?').join(',')})`, [workerId, ...ids]);
    }
    await connection.commit();
    return ids;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
async function collectCustomerData(connection, customerId) {
  const queries = {
    customer: ['SELECT * FROM os2_master_customers WHERE id=:customerId', { customerId }],
    accounts: ['SELECT * FROM os2_customer_accounts WHERE master_customer_id=:customerId ORDER BY id', { customerId }],
    mobileLines: ['SELECT * FROM os2_mobile_lines WHERE master_customer_id=:customerId ORDER BY id', { customerId }],
    fixedAccounts: ['SELECT * FROM os2_fixed_accounts WHERE master_customer_id=:customerId ORDER BY id', { customerId }],
    representatives: ['SELECT * FROM os2_authorised_representatives WHERE master_customer_id=:customerId ORDER BY id', { customerId }],
    consents: ['SELECT * FROM os2_customer_consents WHERE master_customer_id=:customerId ORDER BY created_at,id', { customerId }],
    workItems: ['SELECT * FROM os2_work_items WHERE master_customer_id=:customerId ORDER BY created_at,id', { customerId }],
    restrictions: ['SELECT * FROM os2_customer_restrictions WHERE master_customer_id=:customerId ORDER BY created_at,id', { customerId }],
    documents: [`SELECT id,master_customer_id,document_type,original_filename,mime_type,file_size_bytes,sha256_hash,
      status,uploaded_by,created_at,archived_at FROM os2_customer_documents WHERE master_customer_id=:customerId ORDER BY created_at,id`, { customerId }],
    serviceHistory: ['SELECT * FROM os2_service_change_history WHERE master_customer_id=:customerId ORDER BY created_at,id', { customerId }],
    audit: ['SELECT * FROM os2_audit_log WHERE master_customer_id=:customerId ORDER BY created_at,id', { customerId }]
  };
  const data = {};
  for (const [key, [sql, params]] of Object.entries(queries)) {
    const [rows] = await connection.execute(sql, params);
    data[key] = key === 'customer' ? (rows[0] || null) : rows;
  }
  return data;
}
function csv(rows) {
  if (!rows.length) return '';
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const escape = value => {
    if (value == null) return '';
    const text = value instanceof Date ? value.toISOString() : (typeof value === 'object' ? JSON.stringify(value) : String(value));
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\n');
}
async function writeExport(record, payload) {
  const directory = path.join(exportRoot, safeName(record.request_reference || `request-${record.data_subject_request_id}`), String(record.id));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const files = [];
  if (record.export_format === 'csv_bundle') {
    for (const [name, value] of Object.entries(payload.data)) {
      const rows = Array.isArray(value) ? value : (value ? [value] : []);
      const filePath = path.join(directory, `${safeName(name)}.csv`);
      await fs.writeFile(filePath, csv(rows), { encoding:'utf8', mode:0o600 });
      files.push(filePath);
    }
    const manifestPath = path.join(directory, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ ...payload, data:undefined, files:files.map(file => path.basename(file)) }, null, 2), { encoding:'utf8', mode:0o600 });
    files.push(manifestPath);
  } else {
    const filePath = path.join(directory, 'customer-data.json');
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), { encoding:'utf8', mode:0o600 });
    files.push(filePath);
  }
  const hash = crypto.createHash('sha256');
  let totalBytes = 0;
  for (const file of files.sort()) {
    const bytes = await fs.readFile(file);
    hash.update(path.basename(file));
    hash.update(bytes);
    totalBytes += bytes.length;
  }
  return { directory, checksum:hash.digest('hex'), totalBytes, fileCount:files.length };
}
async function processExport(pool, exportId) {
  const connection = await pool.getConnection();
  try {
    const [[record]] = await connection.execute(`SELECT e.*,r.request_reference,r.status request_status,r.request_type
      FROM os2_data_exports e JOIN os2_data_subject_requests r ON r.id=e.data_subject_request_id
      WHERE e.id=:id AND e.status='processing' AND e.worker_id=:workerId`, { id:exportId, workerId });
    if (!record) return;
    if (!['approved','completed'].includes(record.request_status)) throw new Error('PRIVACY_REQUEST_NOT_APPROVED');
    if (!['access','export'].includes(record.request_type)) throw new Error('REQUEST_NOT_EXPORTABLE');
    const data = await collectCustomerData(connection, Number(record.master_customer_id));
    const payload = {
      exportId:Number(record.id), requestReference:record.request_reference, generatedAt:new Date().toISOString(),
      expiresAt:record.expires_at, format:record.export_format, data
    };
    const output = await writeExport(record, payload);
    const rowCount = Object.values(data).reduce((total, value) => total + (Array.isArray(value) ? value.length : value ? 1 : 0), 0);
    await connection.execute(`UPDATE os2_data_exports SET status='ready',storage_path=:storagePath,sha256_checksum=:checksum,
      row_count=:rowCount,file_count=:fileCount,total_bytes=:totalBytes,generated_at=NOW(),failure_reason=NULL,updated_at=NOW()
      WHERE id=:id AND worker_id=:workerId`, {
      id:record.id,workerId,storagePath:output.directory,checksum:output.checksum,rowCount,fileCount:output.fileCount,totalBytes:output.totalBytes
    });
  } catch (error) {
    await connection.execute(`UPDATE os2_data_exports SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
      failure_reason=:reason,worker_id=NULL,claimed_at=NULL,updated_at=NOW() WHERE id=:id`, {
      id:exportId,reason:String(error.message || 'EXPORT_GENERATION_FAILED').slice(0,1000)
    });
  } finally {
    connection.release();
  }
}
async function runOnce(pool) {
  const ids = await claimExports(pool);
  for (const id of ids) await processExport(pool,id);
  return ids.length;
}
async function main() {
  assertPreviewSafety();
  await fs.mkdir(exportRoot, { recursive:true, mode:0o700 });
  const pool = mysql.createPool({
    host:process.env.DB_HOST,port:Number(process.env.DB_PORT || 3306),user:process.env.DB_USER,
    password:process.env.DB_PASSWORD || '',database:process.env.DB_NAME,connectionLimit:3,namedPlaceholders:true,charset:'utf8mb4'
  });
  const intervalMs = Math.max(Number(process.env.PRIVACY_EXPORT_INTERVAL_MS || 30000), 10000);
  const stop = async signal => { console.log(`Privacy export worker stopping: ${signal}`); await pool.end(); process.exit(0); };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  do {
    try { const processed = await runOnce(pool); if (processed) console.log(`Privacy export worker processed ${processed} export(s)`); }
    catch (error) { console.error('Privacy export worker cycle failed', error.code || error.message); }
    if (process.env.PRIVACY_EXPORT_RUN_ONCE === 'true') break;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (true);
  await pool.end();
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
module.exports = { assertPreviewSafety, safeName, csv, collectCustomerData, runOnce };
