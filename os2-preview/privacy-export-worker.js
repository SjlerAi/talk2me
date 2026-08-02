'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PREVIEW_DB = 'kloka_talk2me';
const RELEASE_BRANCH = 'agent/talk2me-os2-integrated-rebuild';
const APP_ROOT = __dirname;
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MINUTES = 20;
const MAX_SECTION_ROWS = 10000;
const MAX_TOTAL_ROWS = 50000;
const MAX_EXPORT_FILES = 32;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const workerId = `privacy-export-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;

function controlledError(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function strictInteger(name, fallback, min, max) {
  const raw = String(process.env[name] == null ? fallback : process.env[name]).trim();
  if (!/^[0-9]+$/.test(raw)) throw controlledError(`INVALID_${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw controlledError(`INVALID_${name}`);
  return value;
}

function strictBoolean(name, fallback = false) {
  const raw = String(process.env[name] == null ? String(fallback) : process.env[name]).trim().toLowerCase();
  if (!['true', 'false'].includes(raw)) throw controlledError(`INVALID_${name}`);
  return raw === 'true';
}

function requiredEnvironment(name, pattern, maxLength = 4096) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) {
    throw controlledError(`INVALID_${name}`);
  }
  return value;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeSegment(value, fallback = 'export') {
  const raw = String(value == null ? '' : value).trim();
  const base = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 96) || fallback;
  const digest = crypto.createHash('sha256').update(raw || fallback).digest('hex').slice(0, 12);
  return `${base}-${digest}`;
}

function normaliseJson(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) throw controlledError('BINARY_VALUE_PROHIBITED');
  if (Array.isArray(value)) return value.map(normaliseJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normaliseJson(value[key])]));
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && !Number.isFinite(value)) throw controlledError('NONFINITE_NUMBER_PROHIBITED');
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(normaliseJson(value), null, 2)}\n`;
}

function csvCell(value) {
  if (value == null) return '';
  let text;
  if (value instanceof Date) text = value.toISOString();
  else if (Buffer.isBuffer(value)) throw controlledError('BINARY_VALUE_PROHIBITED');
  else if (typeof value === 'object') text = JSON.stringify(normaliseJson(value));
  else text = String(value);
  text = text.replace(/\r\n?/g, '\n');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows) {
  if (!Array.isArray(rows)) throw controlledError('CSV_ROWS_ARRAY_REQUIRED');
  const columns = [...new Set(rows.flatMap(row => Object.keys(row || {})))].sort();
  if (!columns.length) return '\n';
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map(column => csvCell(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}

function failureCode(error) {
  const candidate = String(error && (error.code || error.message) || 'EXPORT_GENERATION_FAILED').toUpperCase();
  return /^[A-Z0-9_]{3,100}$/.test(candidate) ? candidate : 'EXPORT_GENERATION_FAILED';
}

function loadConfiguration() {
  const database = requiredEnvironment('DB_NAME', /^[A-Za-z0-9_]+$/, 128);
  if (database !== PREVIEW_DB) throw controlledError('REFUSING_NON_PREVIEW_DATABASE');
  const branch = requiredEnvironment('RELEASE_BRANCH', /^[A-Za-z0-9._/-]+$/, 200);
  if (branch !== RELEASE_BRANCH) throw controlledError('REFUSING_UNCONTROLLED_RELEASE_BRANCH');
  if (!strictBoolean('PRIVACY_EXPORT_WORKER_ENABLED')) throw controlledError('PRIVACY_EXPORT_WORKER_DISABLED');
  if (strictBoolean('ALLOW_PRODUCTION_MUTATION')) throw controlledError('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (strictBoolean('ENABLE_CUSTOMER_MERGE_EXECUTION')) throw controlledError('MERGE_EXECUTION_FLAG_PROHIBITED');

  const rawExportRoot = String(process.env.PRIVACY_EXPORT_DIR || path.join(APP_ROOT, '..', 'private', 'privacy-exports')).trim();
  if (!path.isAbsolute(rawExportRoot) || path.normalize(rawExportRoot) !== rawExportRoot) throw controlledError('PRIVACY_EXPORT_DIR_MUST_BE_ABSOLUTE_NORMALIZED');
  const exportRoot = rawExportRoot;
  const lower = exportRoot.toLowerCase();
  if (lower.includes(`${path.sep}public_html${path.sep}`) || lower.endsWith(`${path.sep}public_html`)) throw controlledError('PRIVACY_EXPORT_DIR_PUBLIC_WEB_ROOT_PROHIBITED');
  if (isInside(path.resolve(APP_ROOT, '..', 'public'), exportRoot)) throw controlledError('PRIVACY_EXPORT_DIR_PUBLIC_ASSET_ROOT_PROHIBITED');
  if (isInside(APP_ROOT, exportRoot)) throw controlledError('PRIVACY_EXPORT_DIR_SOURCE_ROOT_PROHIBITED');

  return Object.freeze({
    database,
    branch,
    exportRoot,
    host: requiredEnvironment('DB_HOST', /^[^\s]+$/, 255),
    user: requiredEnvironment('DB_USER', /^[A-Za-z0-9_.@-]+$/, 128),
    password: String(process.env.DB_PASSWORD || ''),
    port: strictInteger('DB_PORT', 3306, 1, 65535),
    batchSize: strictInteger('PRIVACY_EXPORT_BATCH_SIZE', 3, 1, 10),
    intervalMs: strictInteger('PRIVACY_EXPORT_INTERVAL_MS', 30000, 10000, 3600000),
    runOnce: strictBoolean('PRIVACY_EXPORT_RUN_ONCE')
  });
}

function assertPreviewSafety() {
  return loadConfiguration();
}

async function secureDirectory(directory, options = {}) {
  const expectedOwner = options.expectedOwner;
  const create = options.create === true;
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) throw controlledError('EXPORT_DIRECTORY_PATH_INVALID');
  if (create) {
    try { await fsp.mkdir(directory, { recursive: options.recursive === true, mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await fsp.chmod(directory, 0o700);
  }
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw controlledError('EXPORT_DIRECTORY_NOT_SECURE');
  if (await fsp.realpath(directory) !== directory) throw controlledError('EXPORT_DIRECTORY_NOT_CANONICAL');
  if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) throw controlledError('EXPORT_DIRECTORY_OWNER_MISMATCH');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw controlledError('EXPORT_DIRECTORY_PERMISSIONS_INVALID');
  if (typeof fs.constants.O_NOFOLLOW !== 'number' || typeof fs.constants.O_DIRECTORY !== 'number') throw controlledError('SECURE_DIRECTORY_FLAGS_UNAVAILABLE');
  const handle = await fsp.open(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw controlledError('EXPORT_DIRECTORY_IDENTITY_CHANGED');
    if (opened.uid !== stat.uid || opened.mode !== stat.mode || opened.mtimeMs !== stat.mtimeMs) throw controlledError('EXPORT_DIRECTORY_METADATA_CHANGED');
    return { uid: opened.uid, dev: opened.dev, ino: opened.ino, mode: opened.mode };
  } finally { await handle.close(); }
}

async function prepareExportRoot(config) {
  const parent = path.dirname(config.exportRoot);
  const parentStat = await fsp.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw controlledError('EXPORT_ROOT_PARENT_INVALID');
  const identity = await secureDirectory(config.exportRoot, { create: true, recursive: false, expectedOwner: typeof process.getuid === 'function' ? process.getuid() : undefined });
  return identity;
}

async function writePrivateFile(directory, filename, text, expectedOwner) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(filename)) throw controlledError('EXPORT_FILENAME_INVALID');
  const filePath = path.join(directory, filename);
  if (path.dirname(filePath) !== directory) throw controlledError('EXPORT_FILE_PATH_ESCAPE');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= 0 || bytes.length > MAX_FILE_BYTES) throw controlledError('EXPORT_FILE_SIZE_INVALID');
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW;
  const handle = await fsp.open(filePath, flags, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(0o600);
  } finally { await handle.close(); }
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw controlledError('EXPORT_FILE_NOT_SECURE');
  if (Number.isInteger(expectedOwner) && stat.uid !== expectedOwner) throw controlledError('EXPORT_FILE_OWNER_MISMATCH');
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) throw controlledError('EXPORT_FILE_PERMISSIONS_INVALID');
  if (stat.size !== bytes.length || await fsp.realpath(filePath) !== filePath) throw controlledError('EXPORT_FILE_PUBLICATION_INVALID');
  const readHandle = await fsp.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = await readHandle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) throw controlledError('EXPORT_FILE_IDENTITY_CHANGED');
    const reread = await readHandle.readFile();
    if (reread.length !== bytes.length || !crypto.timingSafeEqual(crypto.createHash('sha256').update(reread).digest(), crypto.createHash('sha256').update(bytes).digest())) {
      throw controlledError('EXPORT_FILE_DIGEST_MISMATCH');
    }
  } finally { await readHandle.close(); }
  return { name: filename, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function syncDirectory(directory) {
  const handle = await fsp.open(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function removeOwnedOutput(directory, allowedParent) {
  if (!directory || !isInside(allowedParent, directory) || directory === allowedParent) return;
  try {
    const stat = await fsp.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    await fsp.rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Privacy export cleanup failed', failureCode(error));
  }
}

async function prepareConnection(connection, config) {
  await connection.query("SET time_zone='+00:00'");
  const [[identity]] = await connection.query('SELECT DATABASE() database_name, CONNECTION_ID() connection_id');
  if (!identity || identity.database_name !== PREVIEW_DB || !Number.isSafeInteger(Number(identity.connection_id))) throw controlledError('PREVIEW_DATABASE_IDENTITY_MISMATCH');
  if (config.database !== PREVIEW_DB) throw controlledError('PREVIEW_DATABASE_CONFIGURATION_MISMATCH');
}

async function claimExports(pool, config) {
  const connection = await pool.getConnection();
  try {
    await prepareConnection(connection, config);
    await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();
    await connection.execute(`
      UPDATE os2_data_exports
         SET status='expired',worker_id=NULL,claimed_at=NULL,failure_reason='EXPORT_EXPIRED',updated_at=NOW()
       WHERE status IN ('queued','processing') AND expires_at IS NOT NULL AND expires_at<=NOW()`);
    await connection.execute(`
      UPDATE os2_data_exports
         SET status='failed',worker_id=NULL,claimed_at=NULL,failure_reason='EXPORT_MAX_ATTEMPTS_EXCEEDED',updated_at=NOW()
       WHERE status='processing' AND claimed_at<NOW()-INTERVAL ${STALE_CLAIM_MINUTES} MINUTE AND attempts>=${MAX_ATTEMPTS}`);
    await connection.execute(`
      UPDATE os2_data_exports
         SET status='queued',worker_id=NULL,claimed_at=NULL,failure_reason='STALE_CLAIM_RESET',updated_at=NOW()
       WHERE status='processing' AND claimed_at<NOW()-INTERVAL ${STALE_CLAIM_MINUTES} MINUTE AND attempts<${MAX_ATTEMPTS}
         AND expires_at IS NOT NULL AND expires_at>NOW()`);
    const [rows] = await connection.execute(`
      SELECT e.id
        FROM os2_data_exports e
        JOIN os2_data_subject_requests r ON r.id=e.data_subject_request_id AND r.master_customer_id=e.master_customer_id
       WHERE e.status='queued' AND e.worker_id IS NULL AND e.claimed_at IS NULL
         AND e.attempts<${MAX_ATTEMPTS} AND e.expires_at IS NOT NULL AND e.expires_at>NOW()
         AND r.status IN ('approved','completed') AND r.request_type IN ('access','export')
       ORDER BY e.created_at,e.id LIMIT ${config.batchSize} FOR UPDATE`);
    const ids = rows.map(row => Number(row.id)).filter(id => Number.isSafeInteger(id) && id > 0);
    if (ids.length !== rows.length || new Set(ids).size !== ids.length) throw controlledError('EXPORT_CLAIM_IDENTITY_INVALID');
    for (const id of ids) {
      const [update] = await connection.execute(`
        UPDATE os2_data_exports
           SET status='processing',worker_id=:workerId,claimed_at=NOW(),attempts=attempts+1,
               failure_reason=NULL,updated_at=NOW()
         WHERE id=:id AND status='queued' AND worker_id IS NULL AND claimed_at IS NULL
           AND attempts<${MAX_ATTEMPTS} AND expires_at>NOW()`, { workerId, id });
      if (Number(update.affectedRows) !== 1) throw controlledError('EXPORT_CLAIM_STATE_CHANGED');
    }
    await connection.commit();
    return ids;
  } catch (error) {
    try { await connection.rollback(); } catch (rollbackError) { console.error('Privacy export claim rollback failed', failureCode(rollbackError)); }
    throw error;
  } finally { connection.release(); }
}

async function collectCustomerData(connection, customerId) {
  if (!Number.isSafeInteger(customerId) || customerId < 1) throw controlledError('EXPORT_CUSTOMER_ID_INVALID');
  const limit = MAX_SECTION_ROWS + 1;
  const queries = Object.freeze({
    customer: [`SELECT * FROM os2_master_customers WHERE id=:customerId LIMIT 2`, { customerId }],
    accounts: [`SELECT * FROM os2_customer_accounts WHERE master_customer_id=:customerId ORDER BY id LIMIT ${limit}`, { customerId }],
    contacts: [`SELECT * FROM os2_customer_contacts WHERE master_customer_id=:customerId ORDER BY id LIMIT ${limit}`, { customerId }],
    mobileLines: [`SELECT * FROM os2_mobile_lines WHERE master_customer_id=:customerId ORDER BY id LIMIT ${limit}`, { customerId }],
    fixedAccounts: [`SELECT * FROM os2_fixed_accounts WHERE master_customer_id=:customerId ORDER BY id LIMIT ${limit}`, { customerId }],
    fixedServices: [`SELECT fs.* FROM os2_fixed_services fs JOIN os2_fixed_accounts fa ON fa.id=fs.fixed_account_id WHERE fa.master_customer_id=:customerId ORDER BY fs.id LIMIT ${limit}`, { customerId }],
    representatives: [`SELECT * FROM os2_authorised_representatives WHERE master_customer_id=:customerId ORDER BY id LIMIT ${limit}`, { customerId }],
    consents: [`SELECT * FROM os2_customer_consents WHERE master_customer_id=:customerId ORDER BY created_at,id LIMIT ${limit}`, { customerId }],
    workItems: [`SELECT * FROM os2_work_items WHERE master_customer_id=:customerId ORDER BY created_at,id LIMIT ${limit}`, { customerId }],
    restrictions: [`SELECT * FROM os2_customer_restrictions WHERE master_customer_id=:customerId ORDER BY created_at,id LIMIT ${limit}`, { customerId }],
    documents: [`SELECT id,master_customer_id,document_type,original_filename,mime_type,file_size,sha256_hash,verification_status,created_by,created_at,archived_at FROM os2_customer_documents WHERE master_customer_id=:customerId ORDER BY created_at,id LIMIT ${limit}`, { customerId }],
    serviceHistory: [`SELECT * FROM os2_service_change_history WHERE master_customer_id=:customerId ORDER BY created_at,id LIMIT ${limit}`, { customerId }],
    audit: [`SELECT * FROM os2_audit_log WHERE master_customer_id=:customerId ORDER BY created_at,id LIMIT ${limit}`, { customerId }]
  });
  const data = {};
  let totalRows = 0;
  for (const [key, [sql, params]] of Object.entries(queries)) {
    const [rows] = await connection.execute(sql, params);
    if (!Array.isArray(rows)) throw controlledError('EXPORT_QUERY_RESULT_INVALID');
    if (key === 'customer') {
      if (rows.length !== 1) throw controlledError(rows.length ? 'EXPORT_CUSTOMER_DUPLICATE' : 'EXPORT_CUSTOMER_NOT_FOUND');
      data[key] = rows[0];
      totalRows += 1;
    } else {
      if (rows.length > MAX_SECTION_ROWS) throw controlledError('EXPORT_SECTION_ROW_LIMIT_EXCEEDED', { section: key });
      data[key] = rows;
      totalRows += rows.length;
    }
    if (totalRows > MAX_TOTAL_ROWS) throw controlledError('EXPORT_TOTAL_ROW_LIMIT_EXCEEDED');
  }
  return { data, rowCount: totalRows };
}

async function loadExportSnapshot(pool, config, exportId) {
  const connection = await pool.getConnection();
  try {
    await prepareConnection(connection, config);
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [[record]] = await connection.execute(`
      SELECT e.id,e.master_customer_id,e.data_subject_request_id,e.export_format,e.status,e.worker_id,
             e.attempts,e.expires_at,e.created_by,r.request_reference,r.status request_status,
             r.request_type,r.master_customer_id request_customer_id,mc.lifecycle_status customer_status
        FROM os2_data_exports e
        JOIN os2_data_subject_requests r ON r.id=e.data_subject_request_id
        JOIN os2_master_customers mc ON mc.id=e.master_customer_id
       WHERE e.id=:id AND e.status='processing' AND e.worker_id=:workerId
       LIMIT 1 FOR UPDATE`, { id: exportId, workerId });
    if (!record) {
      await connection.rollback();
      return null;
    }
    if (Number(record.request_customer_id) !== Number(record.master_customer_id)) throw controlledError('EXPORT_REQUEST_CUSTOMER_MISMATCH');
    if (!['approved', 'completed'].includes(record.request_status)) throw controlledError('PRIVACY_REQUEST_NOT_APPROVED');
    if (!['access', 'export'].includes(record.request_type)) throw controlledError('REQUEST_NOT_EXPORTABLE');
    if (!['json', 'csv_bundle'].includes(record.export_format)) throw controlledError('EXPORT_FORMAT_INVALID');
    if (!record.expires_at || new Date(record.expires_at).getTime() <= Date.now()) throw controlledError('EXPORT_EXPIRED');
    if (record.customer_status === 'archived') throw controlledError('EXPORT_CUSTOMER_ARCHIVED');
    const collected = await collectCustomerData(connection, Number(record.master_customer_id));
    await connection.commit();
    return { record, ...collected };
  } catch (error) {
    try { await connection.rollback(); } catch (rollbackError) { console.error('Privacy export snapshot rollback failed', failureCode(rollbackError)); }
    throw error;
  } finally { connection.release(); }
}

async function writeExport(config, rootIdentity, record, data, rowCount) {
  const requestDirectory = path.join(config.exportRoot, safeSegment(record.request_reference, `request-${record.data_subject_request_id}`));
  if (!isInside(config.exportRoot, requestDirectory) || requestDirectory === config.exportRoot) throw controlledError('EXPORT_REQUEST_DIRECTORY_ESCAPE');
  await secureDirectory(requestDirectory, { create: true, recursive: false, expectedOwner: rootIdentity.uid });
  const finalDirectory = path.join(requestDirectory, `export-${Number(record.id)}`);
  const temporaryDirectory = path.join(requestDirectory, `.export-${Number(record.id)}-${workerId}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  if (!isInside(requestDirectory, finalDirectory) || !isInside(requestDirectory, temporaryDirectory)) throw controlledError('EXPORT_OUTPUT_DIRECTORY_ESCAPE');
  try {
    await fsp.lstat(finalDirectory);
    throw controlledError('EXPORT_TARGET_ALREADY_EXISTS');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await secureDirectory(temporaryDirectory, { create: true, recursive: false, expectedOwner: rootIdentity.uid });
  const files = [];
  try {
    if (record.export_format === 'csv_bundle') {
      for (const [section, value] of Object.entries(data)) {
        const rows = Array.isArray(value) ? value : (value ? [value] : []);
        files.push({ ...(await writePrivateFile(temporaryDirectory, `${safeSegment(section, 'section')}.csv`, csv(rows), rootIdentity.uid)), section, rows: rows.length });
      }
    } else {
      const payload = {
        schemaVersion: 1,
        exportId: Number(record.id),
        requestReference: record.request_reference,
        requestType: record.request_type,
        masterCustomerId: Number(record.master_customer_id),
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(record.expires_at).toISOString(),
        format: record.export_format,
        rowCount,
        data
      };
      files.push({ ...(await writePrivateFile(temporaryDirectory, 'customer-data.json', canonicalJson(payload), rootIdentity.uid)), section: 'all', rows: rowCount });
    }
    if (files.length < 1 || files.length >= MAX_EXPORT_FILES) throw controlledError('EXPORT_FILE_COUNT_INVALID');
    const dataBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    if (dataBytes > MAX_EXPORT_BYTES) throw controlledError('EXPORT_TOTAL_BYTES_EXCEEDED');
    const manifest = {
      schemaVersion: 1,
      exportId: Number(record.id),
      requestReference: record.request_reference,
      requestType: record.request_type,
      masterCustomerId: Number(record.master_customer_id),
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(record.expires_at).toISOString(),
      format: record.export_format,
      rowCount,
      files: files.slice().sort((left, right) => left.name.localeCompare(right.name))
    };
    const manifestText = canonicalJson(manifest);
    const manifestDigest = crypto.createHash('sha256').update(manifestText, 'utf8').digest('hex');
    const manifestFile = await writePrivateFile(temporaryDirectory, 'manifest.json', manifestText, rootIdentity.uid);
    const fileCount = files.length + 1;
    const totalBytes = dataBytes + manifestFile.bytes;
    if (fileCount > MAX_EXPORT_FILES || totalBytes > MAX_EXPORT_BYTES) throw controlledError('EXPORT_ARTIFACT_LIMIT_EXCEEDED');
    await syncDirectory(temporaryDirectory);
    await fsp.rename(temporaryDirectory, finalDirectory);
    await syncDirectory(requestDirectory);
    await secureDirectory(finalDirectory, { expectedOwner: rootIdentity.uid });
    return { directory: finalDirectory, checksum: manifestDigest, totalBytes, fileCount, rowCount };
  } catch (error) {
    await removeOwnedOutput(temporaryDirectory, requestDirectory);
    throw error;
  }
}

async function markReady(pool, config, exportId, output) {
  const connection = await pool.getConnection();
  try {
    await prepareConnection(connection, config);
    const [update] = await connection.execute(`
      UPDATE os2_data_exports e
      JOIN os2_data_subject_requests r ON r.id=e.data_subject_request_id AND r.master_customer_id=e.master_customer_id
         SET e.status='ready',e.storage_reference=:storageReference,e.content_sha256=:checksum,
             e.row_count=:rowCount,e.file_count=:fileCount,e.total_bytes=:totalBytes,
             e.generated_at=NOW(),e.failure_reason=NULL,e.worker_id=NULL,e.claimed_at=NULL,e.updated_at=NOW()
       WHERE e.id=:id AND e.status='processing' AND e.worker_id=:workerId
         AND e.expires_at>NOW() AND r.status IN ('approved','completed') AND r.request_type IN ('access','export')`, {
      id: exportId,
      workerId,
      storageReference: output.directory,
      checksum: output.checksum,
      rowCount: output.rowCount,
      fileCount: output.fileCount,
      totalBytes: output.totalBytes
    });
    if (Number(update.affectedRows) !== 1) throw controlledError('EXPORT_READY_STATE_CHANGED');
  } finally { connection.release(); }
}

async function markFailure(pool, config, exportId, error) {
  const connection = await pool.getConnection();
  try {
    await prepareConnection(connection, config);
    await connection.execute(`
      UPDATE os2_data_exports
         SET status=CASE
               WHEN expires_at IS NULL OR expires_at<=NOW() THEN 'expired'
               WHEN attempts>=${MAX_ATTEMPTS} THEN 'failed'
               ELSE 'queued'
             END,
             failure_reason=:reason,worker_id=NULL,claimed_at=NULL,updated_at=NOW()
       WHERE id=:id AND status='processing' AND worker_id=:workerId`, {
      id: exportId, workerId, reason: failureCode(error)
    });
  } finally { connection.release(); }
}

async function processExport(pool, config, rootIdentity, exportId) {
  let output = null;
  try {
    const snapshot = await loadExportSnapshot(pool, config, exportId);
    if (!snapshot) return 'not_claimed';
    output = await writeExport(config, rootIdentity, snapshot.record, snapshot.data, snapshot.rowCount);
    await markReady(pool, config, exportId, output);
    return 'ready';
  } catch (error) {
    if (output && output.directory) await removeOwnedOutput(output.directory, config.exportRoot);
    await markFailure(pool, config, exportId, error);
    console.error('Privacy export failed', exportId, failureCode(error));
    return 'failed';
  }
}

async function runOnce(pool, config, rootIdentity) {
  const ids = await claimExports(pool, config);
  const results = [];
  for (const id of ids) results.push({ id, status: await processExport(pool, config, rootIdentity, id) });
  return results;
}

async function main() {
  const config = assertPreviewSafety();
  process.umask(0o077);
  const rootIdentity = await prepareExportRoot(config);
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 3,
    maxIdle: 3,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: false,
    connectTimeout: 10000,
    namedPlaceholders: true,
    charset: 'utf8mb4',
    timezone: 'Z'
  });
  let stopping = false;
  const stop = async signal => {
    if (stopping) return;
    stopping = true;
    console.log(`Privacy export worker stopping: ${signal}`);
    await pool.end();
  };
  process.once('SIGTERM', () => { stop('SIGTERM').catch(error => console.error(failureCode(error))); });
  process.once('SIGINT', () => { stop('SIGINT').catch(error => console.error(failureCode(error))); });
  try {
    do {
      const results = await runOnce(pool, config, rootIdentity);
      if (results.length) console.log(JSON.stringify({ workerId, processed: results }));
      if (config.runOnce || stopping) break;
      await new Promise(resolve => setTimeout(resolve, config.intervalMs));
    } while (!stopping);
  } finally {
    if (!stopping) await pool.end();
  }
}

if (require.main === module) main().catch(error => {
  console.error(`PRIVACY EXPORT WORKER FAILED: ${failureCode(error)}`);
  process.exit(1);
});

module.exports = {
  PREVIEW_DB,
  RELEASE_BRANCH,
  MAX_ATTEMPTS,
  MAX_SECTION_ROWS,
  MAX_TOTAL_ROWS,
  MAX_EXPORT_FILES,
  MAX_FILE_BYTES,
  MAX_EXPORT_BYTES,
  assertPreviewSafety,
  safeSegment,
  canonicalJson,
  csvCell,
  csv,
  failureCode,
  collectCustomerData,
  claimExports,
  writeExport,
  processExport,
  runOnce
};
