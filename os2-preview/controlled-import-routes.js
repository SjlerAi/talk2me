'use strict';

const express = require('express');
const crypto = require('crypto');
const { withTransaction, withSavepoint } = require('./core/transactions');
const { appendAudit, requestContext } = require('./core/audit');
const { requirePermission } = require('./core/permissions');

const LIMITS = Object.freeze({
  maxRows: 5000,
  chunkSize: 25,
  maxBatchBytes: 1500 * 1024,
  maxRowBytes: 64 * 1024,
  maxRowKeys: 64,
  maxJsonDepth: 8,
  maxJsonNodes: 1000,
  maxNotes: 5000
});
const allowedBatchTypes = new Set(['customer_services']);
const allowedExtensions = new Set(['.csv', '.json', '.xls', '.xlsx']);
const allowedDecisions = new Set(['approve', 'reject', 'override']);
const controlCharacters = /[\u0000-\u001f\u007f]/;
const prototypeKeys = new Set(['__proto__', 'constructor', 'prototype']);

function controlledError(code, statusCode = 400, details) {
  const error = new Error(code);
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function actorId(req) {
  const id = positiveId(req.user && req.user.id);
  if (!id) throw controlledError('AUTHENTICATED_STAFF_ID_REQUIRED', 401);
  return id;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanText(value, max = 255, allowNewlines = false) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (text.length > max) throw controlledError('IMPORT_TEXT_LIMIT_EXCEEDED', 400, { max });
  if (text.includes('\u0000')) throw controlledError('IMPORT_TEXT_NUL_PROHIBITED');
  if (!allowNewlines && controlCharacters.test(text)) throw controlledError('IMPORT_TEXT_CONTROL_CHARACTER_PROHIBITED');
  if (allowNewlines && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw controlledError('IMPORT_TEXT_CONTROL_CHARACTER_PROHIBITED');
  return text;
}

function cleanFilename(value) {
  const filename = cleanText(value, 255);
  if (!filename || filename === '.' || filename === '..') throw controlledError('IMPORT_FILENAME_REQUIRED');
  if (/[\\/]/.test(filename) || filename.startsWith('.')) throw controlledError('IMPORT_FILENAME_PATH_PROHIBITED');
  const dot = filename.lastIndexOf('.');
  const extension = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  if (!allowedExtensions.has(extension)) throw controlledError('IMPORT_FILENAME_EXTENSION_NOT_ALLOWED');
  return filename;
}

function normaliseAccount(value) {
  const account = String(value == null ? '' : value).trim().toUpperCase().replace(/[\s-]+/g, '');
  return /^[A-Z0-9]{3,80}$/.test(account) ? account : '';
}

function normalisePhone(value) {
  let phone = String(value == null ? '' : value).replace(/\D/g, '');
  if (phone.startsWith('27') && phone.length === 11) phone = `0${phone.slice(2)}`;
  return /^0\d{9}$/.test(phone) ? phone : '';
}

function normaliseEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || controlCharacters.test(email)) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normaliseDate(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

function normaliseMoney(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function assertSafeJson(value, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > LIMITS.maxJsonNodes) throw controlledError('IMPORT_ROW_JSON_COMPLEXITY_EXCEEDED');
  if (depth > LIMITS.maxJsonDepth) throw controlledError('IMPORT_ROW_JSON_DEPTH_EXCEEDED');
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw controlledError('IMPORT_ROW_NONFINITE_NUMBER_PROHIBITED');
    if (typeof value === 'string' && value.includes('\u0000')) throw controlledError('IMPORT_ROW_NUL_PROHIBITED');
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeJson(entry, state, depth + 1);
    return;
  }
  if (!isPlainObject(value)) throw controlledError('IMPORT_ROW_PLAIN_OBJECT_REQUIRED');
  const keys = Object.keys(value);
  if (keys.length > LIMITS.maxRowKeys) throw controlledError('IMPORT_ROW_KEY_LIMIT_EXCEEDED');
  for (const key of keys) {
    if (prototypeKeys.has(key)) throw controlledError('IMPORT_ROW_PROTOTYPE_KEY_PROHIBITED');
    if (!key || key.length > 120 || controlCharacters.test(key)) throw controlledError('IMPORT_ROW_KEY_INVALID');
    assertSafeJson(value[key], state, depth + 1);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function classifyRow(row) {
  if (!isPlainObject(row)) {
    return { payload: {}, classification: 'invalid', validationErrors: ['ROW_OBJECT_REQUIRED'] };
  }
  const accountNumber = normaliseAccount(row.account_number || row.accountNumber);
  const mobile = normalisePhone(row.mobile || row.cell_number || row.cellNumber);
  const displayName = cleanText(row.customer_name || row.client_name || row.displayName, 180);
  const rawEmail = row.email == null || row.email === '' ? null : String(row.email).trim();
  const email = normaliseEmail(rawEmail);
  const rawDate = row.next_upgrade_date || row.nextUpgradeDate;
  const nextUpgradeDate = normaliseDate(rawDate);
  const rawAmount = row.monthly_amount == null ? row.monthlyAmount : row.monthly_amount;
  const monthlyAmount = normaliseMoney(rawAmount);
  const customerType = String(row.customer_type || row.customerType || 'individual').trim().toLowerCase();
  const errors = [];
  if (!accountNumber) errors.push('ACCOUNT_NUMBER_INVALID_OR_REQUIRED');
  if (!displayName) errors.push('CUSTOMER_NAME_REQUIRED');
  if (!mobile) errors.push('MOBILE_INVALID_OR_REQUIRED');
  if (rawEmail && !email) errors.push('EMAIL_INVALID');
  if (rawDate && !nextUpgradeDate) errors.push('UPGRADE_DATE_INVALID');
  if (rawAmount != null && rawAmount !== '' && monthlyAmount == null) errors.push('MONTHLY_AMOUNT_INVALID');
  if (!['individual', 'business'].includes(customerType)) errors.push('CUSTOMER_TYPE_INVALID');
  return {
    payload: {
      accountNumber,
      mobile,
      displayName,
      email,
      town: cleanText(row.town || row.city_town, 120),
      packageName: cleanText(row.package_name || row.packageName, 180),
      handset: cleanText(row.handset, 180),
      nextUpgradeDate,
      monthlyAmount,
      customerType: ['individual', 'business'].includes(customerType) ? customerType : null
    },
    classification: errors.length ? 'invalid' : 'ambiguous',
    validationErrors: errors
  };
}

function prepareRows(rows) {
  const seenAccounts = new Map();
  let totalBytes = 0;
  return rows.map((row, index) => {
    assertSafeJson(row);
    const rawJson = stableStringify(row);
    const rowBytes = Buffer.byteLength(rawJson, 'utf8');
    if (rowBytes <= 0 || rowBytes > LIMITS.maxRowBytes) throw controlledError('IMPORT_ROW_SIZE_LIMIT_EXCEEDED', 413, { row: index + 1 });
    totalBytes += rowBytes;
    if (totalBytes > LIMITS.maxBatchBytes) throw controlledError('IMPORT_BATCH_SIZE_LIMIT_EXCEEDED', 413);
    const classified = classifyRow(row);
    let duplicateOf = null;
    if (classified.payload.accountNumber) {
      duplicateOf = seenAccounts.get(classified.payload.accountNumber) || null;
      if (!duplicateOf) seenAccounts.set(classified.payload.accountNumber, index + 1);
    }
    if (duplicateOf) {
      classified.classification = 'duplicate';
      classified.validationErrors.push('DUPLICATE_ACCOUNT_IN_BATCH');
    }
    return { sourceRowNumber: index + 1, rawJson, classified, duplicateOf };
  });
}

function sourceDigest(batchType, preparedRows) {
  const hash = crypto.createHash('sha256');
  hash.update(`${batchType}\n`, 'utf8');
  for (const row of preparedRows) hash.update(`${row.rawJson}\n`, 'utf8');
  return hash.digest('hex');
}

function publicError(error, fallback) {
  if (error && Number.isInteger(error.statusCode)) {
    return { status: error.statusCode, body: { ok: false, error: error.message, details: error.details } };
  }
  if (error && error.code === 'ER_DUP_ENTRY') return { status: 409, body: { ok: false, error: 'IMPORT_UNIQUE_CONFLICT' } };
  return { status: 500, body: { ok: false, error: fallback } };
}

function sendError(res, error, fallback) {
  const response = publicError(error, fallback);
  return res.status(response.status).json(response.body);
}

function finalisationErrorCode(error) {
  const candidate = String(error && (error.code || error.message) || 'IMPORT_ROW_FINALISATION_FAILED').toUpperCase();
  return /^[A-Z0-9_]{3,80}$/.test(candidate) ? candidate : 'IMPORT_ROW_FINALISATION_FAILED';
}

async function resolveMatch(connection, payload) {
  const [accountMatches] = await connection.execute(`
    SELECT ca.id account_id,ca.master_customer_id
      FROM os2_customer_accounts ca
      JOIN os2_master_customers mc ON mc.id=ca.master_customer_id
     WHERE ca.account_number_normalised=:account
       AND ca.is_active=1
       AND mc.lifecycle_status<>'archived'
     LIMIT 2 FOR UPDATE`, { account: payload.accountNumber });
  const [identityMatches] = await connection.execute(`
    SELECT DISTINCT mc.id master_customer_id
      FROM os2_master_customers mc
     WHERE mc.lifecycle_status<>'archived'
       AND (mc.primary_mobile_normalised=:mobile OR (:email IS NOT NULL AND LOWER(mc.primary_email)=:email))
     LIMIT 3 FOR UPDATE`, { mobile: payload.mobile, email: payload.email });
  if (accountMatches.length > 1) return { classification: 'ambiguous', strategy: 'duplicate_account_records', confidence: 0 };
  if (accountMatches.length === 1) {
    const account = accountMatches[0];
    const conflict = identityMatches.some(match => Number(match.master_customer_id) !== Number(account.master_customer_id));
    if (conflict) return { classification: 'ambiguous', strategy: 'account_identity_conflict', confidence: 0 };
    return {
      classification: 'safe_update', strategy: 'exact_account', confidence: 100,
      customerId: Number(account.master_customer_id), accountId: Number(account.account_id)
    };
  }
  if (identityMatches.length) return { classification: 'ambiguous', strategy: 'identity_match_without_account', confidence: 75 };
  return { classification: 'safe_create', strategy: 'no_existing_match', confidence: 100 };
}

async function validateOverrideTarget(connection, customerId, accountId) {
  const [[target]] = await connection.execute(`
    SELECT ca.id account_id,ca.master_customer_id
      FROM os2_customer_accounts ca
      JOIN os2_master_customers mc ON mc.id=ca.master_customer_id
     WHERE ca.id=:accountId AND ca.master_customer_id=:customerId
       AND ca.is_active=1 AND mc.lifecycle_status<>'archived'
     LIMIT 1 FOR UPDATE`, { customerId, accountId });
  if (!target) throw controlledError('IMPORT_OVERRIDE_TARGET_INVALID', 409);
}

async function finaliseCreate(connection, row, payload, batch, actor, context) {
  const [accounts] = await connection.execute('SELECT id FROM os2_customer_accounts WHERE account_number_normalised=:account LIMIT 1 FOR UPDATE', { account: payload.accountNumber });
  if (accounts.length) throw controlledError('IMPORT_ACCOUNT_COLLISION', 409);
  const [mobileServices] = await connection.execute('SELECT id FROM os2_mobile_services WHERE mobile_number_normalised=:mobile LIMIT 1 FOR UPDATE', { mobile: payload.mobile });
  if (mobileServices.length) throw controlledError('IMPORT_MOBILE_COLLISION', 409);
  const [identityMatches] = await connection.execute(`
    SELECT id FROM os2_master_customers
     WHERE lifecycle_status<>'archived'
       AND (primary_mobile_normalised=:mobile OR (:email IS NOT NULL AND LOWER(primary_email)=:email))
     LIMIT 1 FOR UPDATE`, { mobile: payload.mobile, email: payload.email });
  if (identityMatches.length) throw controlledError('IMPORT_IDENTITY_REVIEW_REQUIRED', 409);

  const [customerInsert] = await connection.execute(`
    INSERT INTO os2_master_customers
      (customer_type,display_name,primary_mobile,primary_mobile_normalised,primary_email,town,
       lifecycle_status,owner_staff_id,created_by,updated_by,created_at,updated_at)
    VALUES
      (:customerType,:displayName,:mobile,:mobile,:email,:town,'active',:owner,:actor,:actor,NOW(),NOW())`, {
    customerType: payload.customerType, displayName: payload.displayName, mobile: payload.mobile,
    email: payload.email, town: payload.town, owner: Number(batch.uploaded_by), actor
  });
  const customerId = Number(customerInsert.insertId);
  const [accountInsert] = await connection.execute(`
    INSERT INTO os2_customer_accounts
      (master_customer_id,account_number,account_number_normalised,account_name,account_type,
       is_primary,is_active,created_by,updated_by,created_at,updated_at)
    VALUES (:customerId,:account,:account,:displayName,'mobile',1,1,:actor,:actor,NOW(),NOW())`, {
    customerId, account: payload.accountNumber, displayName: payload.displayName, actor
  });
  const accountId = Number(accountInsert.insertId);
  const [serviceInsert] = await connection.execute(`
    INSERT INTO os2_mobile_services
      (master_customer_id,customer_account_id,mobile_number,mobile_number_normalised,handset,
       package_name,upgrade_date,monthly_amount,status,created_by,updated_by,created_at,updated_at)
    VALUES (:customerId,:accountId,:mobile,:mobile,:handset,:packageName,:upgradeDate,:monthlyAmount,
            'active',:actor,:actor,NOW(),NOW())`, {
    customerId, accountId, mobile: payload.mobile, handset: payload.handset,
    packageName: payload.packageName, upgradeDate: payload.nextUpgradeDate,
    monthlyAmount: payload.monthlyAmount, actor
  });
  await connection.execute(`
    INSERT INTO os2_customer_contacts
      (master_customer_id,contact_type,label,contact_value,contact_value_normalised,is_primary,is_active,created_by,created_at)
    VALUES (:customerId,'mobile','Primary mobile',:mobile,:mobile,1,1,:actor,NOW())`, { customerId, mobile: payload.mobile, actor });
  if (payload.email) {
    await connection.execute(`
      INSERT INTO os2_customer_contacts
        (master_customer_id,contact_type,label,contact_value,contact_value_normalised,is_primary,is_active,created_by,created_at)
      VALUES (:customerId,'email','Primary email',:email,:email,1,1,:actor,NOW())`, { customerId, email: payload.email, actor });
  }
  await connection.execute(`
    INSERT INTO os2_ownership_history
      (master_customer_id,previous_owner_staff_id,new_owner_staff_id,change_type,reason,changed_by,created_at)
    VALUES (:customerId,NULL,:owner,'import',:reason,:actor,NOW())`, {
    customerId, owner: Number(batch.uploaded_by), reason: `Import batch ${Number(batch.id)} row ${Number(row.source_row_number)}`, actor
  });
  await appendAudit(connection, {
    actorStaffId: actor, actionType: 'import_customer_created', entityType: 'os2_master_customers',
    entityId: customerId, masterCustomerId: customerId,
    description: `Created Master Customer from import batch ${Number(batch.id)} row ${Number(row.source_row_number)}`,
    after: { accountId, mobileServiceId: Number(serviceInsert.insertId), importBatchId: Number(batch.id), importRowId: Number(row.id) },
    requestContext: context
  });
  return { entityType: 'os2_master_customers', entityId: customerId, customerId, accountId };
}

async function finaliseUpdate(connection, row, payload, batch, actor, context) {
  const customerId = positiveId(row.matched_master_customer_id);
  const accountId = positiveId(row.matched_account_id);
  if (!customerId || !accountId) throw controlledError('IMPORT_UPDATE_TARGET_REQUIRED', 409);
  const [[account]] = await connection.execute(`
    SELECT ca.id,ca.master_customer_id
      FROM os2_customer_accounts ca
      JOIN os2_master_customers mc ON mc.id=ca.master_customer_id
     WHERE ca.id=:accountId AND ca.master_customer_id=:customerId
       AND ca.account_number_normalised=:account AND ca.is_active=1
       AND mc.lifecycle_status<>'archived'
     LIMIT 1 FOR UPDATE`, { accountId, customerId, account: payload.accountNumber });
  if (!account) throw controlledError('IMPORT_UPDATE_TARGET_CHANGED', 409);

  const [mobileMatches] = await connection.execute(`
    SELECT id,master_customer_id FROM os2_mobile_services
     WHERE mobile_number_normalised=:mobile LIMIT 2 FOR UPDATE`, { mobile: payload.mobile });
  if (mobileMatches.some(match => Number(match.master_customer_id) !== customerId)) throw controlledError('IMPORT_MOBILE_COLLISION', 409);

  await connection.execute(`
    UPDATE os2_master_customers
       SET primary_mobile=COALESCE(primary_mobile,:mobile),
           primary_mobile_normalised=COALESCE(primary_mobile_normalised,:mobile),
           primary_email=COALESCE(primary_email,:email),
           town=COALESCE(town,:town),updated_by=:actor,updated_at=NOW()
     WHERE id=:customerId`, { mobile: payload.mobile, email: payload.email, town: payload.town, actor, customerId });
  await connection.execute(`
    UPDATE os2_customer_accounts
       SET account_name=COALESCE(account_name,:displayName),updated_by=:actor,updated_at=NOW()
     WHERE id=:accountId`, { displayName: payload.displayName, actor, accountId });

  let serviceId;
  if (mobileMatches.length === 1) {
    serviceId = Number(mobileMatches[0].id);
    await connection.execute(`
      UPDATE os2_mobile_services
         SET customer_account_id=COALESCE(customer_account_id,:accountId),
             handset=COALESCE(handset,:handset),package_name=COALESCE(package_name,:packageName),
             upgrade_date=COALESCE(upgrade_date,:upgradeDate),monthly_amount=COALESCE(monthly_amount,:monthlyAmount),
             updated_by=:actor,updated_at=NOW()
       WHERE id=:serviceId AND master_customer_id=:customerId`, {
      accountId, handset: payload.handset, packageName: payload.packageName,
      upgradeDate: payload.nextUpgradeDate, monthlyAmount: payload.monthlyAmount,
      actor, serviceId, customerId
    });
  } else {
    const [serviceInsert] = await connection.execute(`
      INSERT INTO os2_mobile_services
        (master_customer_id,customer_account_id,mobile_number,mobile_number_normalised,handset,
         package_name,upgrade_date,monthly_amount,status,created_by,updated_by,created_at,updated_at)
      VALUES (:customerId,:accountId,:mobile,:mobile,:handset,:packageName,:upgradeDate,:monthlyAmount,
              'active',:actor,:actor,NOW(),NOW())`, {
      customerId, accountId, mobile: payload.mobile, handset: payload.handset,
      packageName: payload.packageName, upgradeDate: payload.nextUpgradeDate,
      monthlyAmount: payload.monthlyAmount, actor
    });
    serviceId = Number(serviceInsert.insertId);
  }
  await appendAudit(connection, {
    actorStaffId: actor, actionType: 'import_customer_updated', entityType: 'os2_customer_accounts',
    entityId: accountId, masterCustomerId: customerId,
    description: `Updated customer through import batch ${Number(batch.id)} row ${Number(row.source_row_number)}`,
    after: { mobileServiceId: serviceId, importBatchId: Number(batch.id), importRowId: Number(row.id) },
    requestContext: context
  });
  return { entityType: 'os2_customer_accounts', entityId: accountId, customerId, accountId };
}

module.exports = function createControlledImportRouter({ pool, requireAuth }) {
  if (!pool) throw new Error('CONTROLLED_IMPORT_POOL_REQUIRED');
  if (typeof requireAuth !== 'function') throw new Error('CONTROLLED_IMPORT_AUTH_MIDDLEWARE_REQUIRED');
  const router = express.Router();
  router.use('/api/os2/imports', requireAuth);

  router.get('/api/os2/imports', requirePermission('import.read'), async (req, res) => {
    try {
      const [rows] = await pool.execute(`
        SELECT b.id,b.batch_type,b.source_filename,b.source_sha256,b.status,b.total_rows,b.safe_rows,
               b.review_rows,b.rejected_rows,b.finalised_rows,b.error_rows,b.uploaded_by,b.approved_by,
               b.approved_at,b.completed_at,b.failure_message,b.created_at,b.updated_at,
               u.full_name uploaded_by_name,a.full_name approved_by_name
          FROM os2_import_batches b
          LEFT JOIN staff_users u ON u.id=b.uploaded_by
          LEFT JOIN staff_users a ON a.id=b.approved_by
         ORDER BY b.created_at DESC,b.id DESC LIMIT 100`);
      res.json({ ok: true, batches: rows });
    } catch (error) { sendError(res, error, 'IMPORT_LIST_FAILED'); }
  });

  router.post('/api/os2/imports/stage', requirePermission('import.upload'), async (req, res) => {
    try {
      const actor = actorId(req);
      if (!isPlainObject(req.body)) throw controlledError('IMPORT_BODY_OBJECT_REQUIRED');
      const rows = Array.isArray(req.body.rows) ? req.body.rows : null;
      if (!rows || rows.length < 1) throw controlledError('IMPORT_ROWS_REQUIRED');
      if (rows.length > LIMITS.maxRows) throw controlledError('IMPORT_ROW_LIMIT_EXCEEDED', 413, { maxRows: LIMITS.maxRows });
      const filename = cleanFilename(req.body.filename);
      const batchType = cleanText(req.body.batchType || 'customer_services', 80);
      if (!allowedBatchTypes.has(batchType)) throw controlledError('IMPORT_BATCH_TYPE_NOT_ALLOWED');
      const preparedRows = prepareRows(rows);
      const sourceHash = sourceDigest(batchType, preparedRows);
      const context = requestContext(req);

      const result = await withTransaction(pool, async connection => {
        const [[existing]] = await connection.execute('SELECT id,status FROM os2_import_batches WHERE source_sha256=:hash LIMIT 1 FOR UPDATE', { hash: sourceHash });
        if (existing) throw controlledError('IMPORT_FILE_ALREADY_STAGED', 409, { batchId: Number(existing.id), status: existing.status });
        const [batchInsert] = await connection.execute(`
          INSERT INTO os2_import_batches
            (batch_type,source_filename,source_sha256,status,total_rows,uploaded_by,created_at,updated_at)
          VALUES (:batchType,:filename,:hash,'analysing',:total,:actor,NOW(),NOW())`, {
          batchType, filename, hash: sourceHash, total: preparedRows.length, actor
        });
        const batchId = Number(batchInsert.insertId);
        const counts = { safe: 0, review: 0, rejected: 0 };

        for (let offset = 0; offset < preparedRows.length; offset += LIMITS.chunkSize) {
          const chunk = preparedRows.slice(offset, offset + LIMITS.chunkSize);
          await withSavepoint(connection, `import_chunk_${offset}`, async () => {
            for (const prepared of chunk) {
              const classified = prepared.classified;
              let classification = classified.classification;
              let match = { strategy: prepared.duplicateOf ? 'duplicate_account_in_batch' : null, confidence: null };
              if (classification === 'ambiguous') match = await resolveMatch(connection, classified.payload);
              if (classification === 'ambiguous') classification = match.classification;
              if (['safe_create', 'safe_update'].includes(classification)) counts.safe += 1;
              else if (classification === 'ambiguous') counts.review += 1;
              else counts.rejected += 1;

              await connection.execute(`
                INSERT INTO os2_import_rows
                  (batch_id,source_row_number,raw_payload,normalised_payload,classification,
                   match_strategy,matched_master_customer_id,matched_account_id,confidence_score,
                   validation_errors,review_decision,finalisation_status,created_at,updated_at)
                VALUES
                  (:batchId,:rowNumber,:rawPayload,:normalisedPayload,:classification,
                   :matchStrategy,:customerId,:accountId,:confidence,:errors,
                   'pending','pending',NOW(),NOW())`, {
                batchId, rowNumber: prepared.sourceRowNumber, rawPayload: prepared.rawJson,
                normalisedPayload: JSON.stringify(classified.payload), classification,
                matchStrategy: match.strategy || null, customerId: match.customerId || null,
                accountId: match.accountId || null, confidence: match.confidence,
                errors: classified.validationErrors.length ? JSON.stringify(classified.validationErrors) : null
              });
            }
          });
        }
        if (counts.safe + counts.review + counts.rejected !== preparedRows.length) throw new Error('IMPORT_COUNT_RECONCILIATION_FAILED');
        const [batchUpdate] = await connection.execute(`
          UPDATE os2_import_batches
             SET status='review',safe_rows=:safe,review_rows=:review,rejected_rows=:rejected,updated_at=NOW()
           WHERE id=:batchId AND status='analysing'`, { batchId, ...counts });
        if (Number(batchUpdate.affectedRows) !== 1) throw new Error('IMPORT_BATCH_STATE_TRANSITION_FAILED');
        await connection.execute(`
          INSERT INTO os2_import_events (batch_id,row_id,event_type,event_payload,actor_staff_id,created_at)
          VALUES (:batchId,NULL,'batch_staged',:payload,:actor,NOW())`, {
          batchId, payload: JSON.stringify({ safe: counts.safe, review: counts.review, rejected: counts.rejected, sourceSha256: sourceHash }), actor
        });
        await appendAudit(connection, {
          actorStaffId: actor, actionType: 'import_batch_staged', entityType: 'os2_import_batches',
          entityId: batchId, description: `Staged controlled import batch ${batchId}`,
          after: { filename, rowCount: preparedRows.length, ...counts, sourceSha256: sourceHash }, requestContext: context
        });
        return { batchId, ...counts, sourceSha256: sourceHash };
      }, { isolationLevel: 'SERIALIZABLE' });
      res.status(201).json({ ok: true, ...result });
    } catch (error) { sendError(res, error, 'IMPORT_STAGE_FAILED'); }
  });

  router.get('/api/os2/imports/:id', requirePermission('import.read'), async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) throw controlledError('INVALID_IMPORT_BATCH_ID');
      const [[batch]] = await pool.execute('SELECT * FROM os2_import_batches WHERE id=:id', { id });
      if (!batch) throw controlledError('IMPORT_BATCH_NOT_FOUND', 404);
      const [rows] = await pool.execute(`
        SELECT id,source_row_number,normalised_payload,classification,match_strategy,
               matched_master_customer_id,matched_account_id,confidence_score,validation_errors,
               review_notes,review_decision,reviewed_by,reviewed_at,finalisation_status,
               finalised_entity_type,finalised_entity_id,finalisation_error,created_at,updated_at
          FROM os2_import_rows WHERE batch_id=:id ORDER BY source_row_number`, { id });
      res.json({ ok: true, batch, rows });
    } catch (error) { sendError(res, error, 'IMPORT_DETAIL_FAILED'); }
  });

  router.get('/api/os2/imports/:id/events', requirePermission('import.read'), async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) throw controlledError('INVALID_IMPORT_BATCH_ID');
      const [events] = await pool.execute(`
        SELECT id,batch_id,row_id,event_type,event_payload,actor_staff_id,created_at
          FROM os2_import_events WHERE batch_id=:id ORDER BY id LIMIT 5000`, { id });
      res.json({ ok: true, events });
    } catch (error) { sendError(res, error, 'IMPORT_EVENT_LIST_FAILED'); }
  });

  router.post('/api/os2/imports/:batchId/rows/:rowId/review', requirePermission('import.review'), async (req, res) => {
    try {
      const actor = actorId(req);
      const batchId = positiveId(req.params.batchId);
      const rowId = positiveId(req.params.rowId);
      if (!batchId || !rowId || !isPlainObject(req.body)) throw controlledError('INVALID_REVIEW_REQUEST');
      const decision = allowedDecisions.has(req.body.decision) ? req.body.decision : null;
      if (!decision) throw controlledError('IMPORT_REVIEW_DECISION_INVALID');
      const notes = cleanText(req.body.notes, LIMITS.maxNotes, true);
      if (['reject', 'override'].includes(decision) && !notes) throw controlledError('IMPORT_REVIEW_NOTES_REQUIRED');
      const overrideCustomerId = positiveId(req.body.matchedMasterCustomerId);
      const overrideAccountId = positiveId(req.body.matchedAccountId);
      const context = requestContext(req);

      await withTransaction(pool, async connection => {
        const [[batch]] = await connection.execute('SELECT * FROM os2_import_batches WHERE id=:batchId LIMIT 1 FOR UPDATE', { batchId });
        if (!batch) throw controlledError('IMPORT_BATCH_NOT_FOUND', 404);
        if (batch.status !== 'review') throw controlledError('IMPORT_BATCH_NOT_REVIEWABLE', 409);
        const [[row]] = await connection.execute('SELECT * FROM os2_import_rows WHERE id=:rowId AND batch_id=:batchId LIMIT 1 FOR UPDATE', { rowId, batchId });
        if (!row) throw controlledError('IMPORT_ROW_NOT_FOUND', 404);
        if (row.finalisation_status !== 'pending') throw controlledError('IMPORT_ROW_ALREADY_FINALISED', 409);
        if (row.review_decision !== 'pending') throw controlledError('IMPORT_ROW_ALREADY_REVIEWED', 409);
        if (row.classification === 'ambiguous' && !['reject', 'override'].includes(decision)) throw controlledError('AMBIGUOUS_ROW_REQUIRES_OVERRIDE_OR_REJECT', 409);
        if (['invalid', 'duplicate'].includes(row.classification) && decision !== 'reject') throw controlledError('INVALID_OR_DUPLICATE_ROW_MUST_BE_REJECTED', 409);
        if (decision === 'override') {
          if (row.classification !== 'ambiguous' || !overrideCustomerId || !overrideAccountId) throw controlledError('IMPORT_OVERRIDE_TARGET_REQUIRED', 409);
          await validateOverrideTarget(connection, overrideCustomerId, overrideAccountId);
        }
        const [update] = await connection.execute(`
          UPDATE os2_import_rows
             SET review_decision=:decision,review_notes=:notes,reviewed_by=:actor,reviewed_at=NOW(),
                 matched_master_customer_id=CASE WHEN :decision='override' THEN :customerId ELSE matched_master_customer_id END,
                 matched_account_id=CASE WHEN :decision='override' THEN :accountId ELSE matched_account_id END,
                 match_strategy=CASE WHEN :decision='override' THEN 'manual_override' ELSE match_strategy END,
                 confidence_score=CASE WHEN :decision='override' THEN 100 ELSE confidence_score END,
                 updated_at=NOW()
           WHERE id=:rowId AND batch_id=:batchId AND review_decision='pending'`, {
          decision, notes, actor, customerId: overrideCustomerId, accountId: overrideAccountId, rowId, batchId
        });
        if (Number(update.affectedRows) !== 1) throw controlledError('IMPORT_REVIEW_STATE_CHANGED', 409);
        await connection.execute(`
          INSERT INTO os2_import_events (batch_id,row_id,event_type,event_payload,actor_staff_id,created_at)
          VALUES (:batchId,:rowId,'row_reviewed',:payload,:actor,NOW())`, {
          batchId, rowId, payload: JSON.stringify({ decision, overrideCustomerId, overrideAccountId }), actor
        });
        await appendAudit(connection, {
          actorStaffId: actor, actionType: 'import_row_reviewed', entityType: 'os2_import_rows',
          entityId: rowId, description: `Reviewed import batch ${batchId} row ${Number(row.source_row_number)}`,
          before: { decision: row.review_decision, customerId: row.matched_master_customer_id, accountId: row.matched_account_id },
          after: { decision, customerId: overrideCustomerId || row.matched_master_customer_id, accountId: overrideAccountId || row.matched_account_id },
          requestContext: context
        });
      }, { isolationLevel: 'SERIALIZABLE' });
      res.json({ ok: true });
    } catch (error) { sendError(res, error, 'IMPORT_REVIEW_FAILED'); }
  });

  router.post('/api/os2/imports/:id/approve', requirePermission('import.finalise'), async (req, res) => {
    try {
      const actor = actorId(req);
      const id = positiveId(req.params.id);
      if (!id) throw controlledError('INVALID_IMPORT_BATCH_ID');
      const context = requestContext(req);
      await withTransaction(pool, async connection => {
        const [[batch]] = await connection.execute('SELECT * FROM os2_import_batches WHERE id=:id LIMIT 1 FOR UPDATE', { id });
        if (!batch) throw controlledError('IMPORT_BATCH_NOT_FOUND', 404);
        if (batch.status !== 'review') throw controlledError('IMPORT_BATCH_NOT_REVIEWABLE', 409);
        if (Number(batch.uploaded_by) === actor) throw controlledError('SELF_APPROVAL_NOT_ALLOWED', 403);
        const [[summary]] = await connection.execute(`
          SELECT COUNT(*) total,
                 SUM(classification IN ('ambiguous','invalid','duplicate') AND review_decision='pending') unresolved_exceptions,
                 SUM(classification='ambiguous' AND review_decision NOT IN ('override','reject')) invalid_ambiguous_decisions,
                 SUM(classification IN ('invalid','duplicate') AND review_decision<>'reject') invalid_rejected_decisions,
                 SUM(review_decision='override' AND (matched_master_customer_id IS NULL OR matched_account_id IS NULL)) unresolved_overrides,
                 SUM(finalisation_status<>'pending') already_finalised
            FROM os2_import_rows WHERE batch_id=:id`, { id });
        if (Number(summary.total) !== Number(batch.total_rows)) throw controlledError('IMPORT_ROW_COUNT_MISMATCH', 409);
        if (Number(summary.unresolved_exceptions) > 0) throw controlledError('IMPORT_EXCEPTIONS_REQUIRE_DECISIONS', 409, { pending: Number(summary.unresolved_exceptions) });
        if (Number(summary.invalid_ambiguous_decisions) > 0 || Number(summary.invalid_rejected_decisions) > 0) throw controlledError('IMPORT_REVIEW_DECISIONS_INVALID', 409);
        if (Number(summary.unresolved_overrides) > 0) throw controlledError('IMPORT_OVERRIDE_TARGETS_UNRESOLVED', 409);
        if (Number(summary.already_finalised) > 0) throw controlledError('IMPORT_ROWS_ALREADY_FINALISED', 409);
        const [update] = await connection.execute(`
          UPDATE os2_import_batches
             SET status='approved',approved_by=:actor,approved_at=NOW(),updated_at=NOW()
           WHERE id=:id AND status='review'`, { id, actor });
        if (Number(update.affectedRows) !== 1) throw controlledError('IMPORT_APPROVAL_STATE_CHANGED', 409);
        await connection.execute(`
          INSERT INTO os2_import_events (batch_id,row_id,event_type,event_payload,actor_staff_id,created_at)
          VALUES (:id,NULL,'batch_approved',:payload,:actor,NOW())`, {
          id, payload: JSON.stringify({ approvedBy: actor, rowCount: Number(summary.total) }), actor
        });
        await appendAudit(connection, {
          actorStaffId: actor, actionType: 'import_batch_approved', entityType: 'os2_import_batches',
          entityId: id, description: `Approved controlled import batch ${id}`,
          before: { status: batch.status }, after: { status: 'approved', approvedBy: actor }, requestContext: context
        });
      }, { isolationLevel: 'SERIALIZABLE' });
      res.json({ ok: true });
    } catch (error) { sendError(res, error, 'IMPORT_APPROVAL_FAILED'); }
  });

  router.post('/api/os2/imports/:id/finalise', requirePermission('import.finalise'), async (req, res) => {
    try {
      const actor = actorId(req);
      const id = positiveId(req.params.id);
      if (!id || !isPlainObject(req.body)) throw controlledError('INVALID_IMPORT_FINALISATION_REQUEST');
      if (req.body.confirmation !== 'FINALISE_IMPORT_BATCH') throw controlledError('IMPORT_FINALISATION_CONFIRMATION_REQUIRED');
      const context = requestContext(req);
      const result = await withTransaction(pool, async connection => {
        const [[batch]] = await connection.execute('SELECT * FROM os2_import_batches WHERE id=:id LIMIT 1 FOR UPDATE', { id });
        if (!batch) throw controlledError('IMPORT_BATCH_NOT_FOUND', 404);
        if (!['approved', 'failed'].includes(batch.status)) throw controlledError('IMPORT_BATCH_NOT_APPROVED', 409);
        if (Number(batch.uploaded_by) === actor) throw controlledError('IMPORT_UPLOADER_CANNOT_FINALISE', 403);
        const retry = batch.status === 'failed';
        const [allRows] = await connection.execute('SELECT * FROM os2_import_rows WHERE batch_id=:id ORDER BY source_row_number FOR UPDATE', { id });
        if (allRows.length !== Number(batch.total_rows)) throw controlledError('IMPORT_ROW_COUNT_MISMATCH', 409);
        const processRows = allRows.filter(row => retry ? row.finalisation_status === 'failed' : row.finalisation_status === 'pending');
        if (!processRows.length) throw controlledError('IMPORT_NO_ROWS_AVAILABLE_FOR_FINALISATION', 409);
        const [stateUpdate] = await connection.execute(`
          UPDATE os2_import_batches SET status='finalising',failure_message=NULL,updated_at=NOW()
           WHERE id=:id AND status=:expectedStatus`, { id, expectedStatus: batch.status });
        if (Number(stateUpdate.affectedRows) !== 1) throw controlledError('IMPORT_FINALISATION_STATE_CHANGED', 409);

        for (let offset = 0; offset < processRows.length; offset += LIMITS.chunkSize) {
          const chunk = processRows.slice(offset, offset + LIMITS.chunkSize);
          for (const row of chunk) {
            try {
              await withSavepoint(connection, `finalise_row_${Number(row.id)}`, async () => {
                if (row.review_decision === 'reject' || ['invalid', 'duplicate'].includes(row.classification)) {
                  await connection.execute(`
                    UPDATE os2_import_rows
                       SET finalisation_status='skipped',finalised_entity_type=NULL,finalised_entity_id=NULL,
                           finalisation_error=NULL,updated_at=NOW()
                     WHERE id=:rowId`, { rowId: Number(row.id) });
                  await connection.execute(`
                    INSERT INTO os2_import_events (batch_id,row_id,event_type,event_payload,actor_staff_id,created_at)
                    VALUES (:batchId,:rowId,'row_skipped',:payload,:actor,NOW())`, {
                    batchId: id, rowId: Number(row.id), payload: JSON.stringify({ reason: row.review_decision === 'reject' ? 'review_rejected' : row.classification }), actor
                  });
                  return;
                }
                const payload = JSON.parse(row.normalised_payload || '{}');
                const finalised = row.classification === 'safe_create'
                  ? await finaliseCreate(connection, row, payload, { ...batch, id }, actor, context)
                  : await finaliseUpdate(connection, row, payload, { ...batch, id }, actor, context);
                await connection.execute(`
                  UPDATE os2_import_rows
                     SET finalisation_status='finalised',finalised_entity_type=:entityType,
                         finalised_entity_id=:entityId,finalisation_error=NULL,updated_at=NOW()
                   WHERE id=:rowId`, { entityType: finalised.entityType, entityId: finalised.entityId, rowId: Number(row.id) });
                await connection.execute(`
                  INSERT INTO os2_import_events (batch_id,row_id,event_type,event_payload,actor_staff_id,created_at)
                  VALUES (:batchId,:rowId,'row_finalised',:payload,:actor,NOW())`, {
                  batchId: id, rowId: Number(row.id), payload: JSON.stringify({ entityType: finalised.entityType, entityId: finalised.entityId }), actor
                });
              });
            } catch (rowError) {
              const code = finalisationErrorCode(rowError);
              await connection.execute(`
                UPDATE os2_import_rows
                   SET finalisation_status='failed',finalisation_error=:code,updated_at=NOW()
                 WHERE id=:rowId`, { code, rowId: Number(row.id) });
              await connection.execute(`
                INSERT INTO os2_import_events (batch_id,row_id,event_type,event_payload,actor_staff_id,created_at)
                VALUES (:batchId,:rowId,'row_finalisation_failed',:payload,:actor,NOW())`, {
                batchId: id, rowId: Number(row.id), payload: JSON.stringify({ errorCode: code }), actor
              });
            }
          }
        }

        const [[summary]] = await connection.execute(`
          SELECT SUM(finalisation_status='finalised') finalised_rows,
                 SUM(finalisation_status='failed') error_rows,
                 SUM(finalisation_status='skipped') skipped_rows,
                 SUM(finalisation_status='pending') pending_rows
            FROM os2_import_rows WHERE batch_id=:id`, { id });
        const finalisedRows = Number(summary.finalised_rows || 0);
        const errorRows = Number(summary.error_rows || 0);
        const skippedRows = Number(summary.skipped_rows || 0);
        const pendingRows = Number(summary.pending_rows || 0);
        if (finalisedRows + errorRows + skippedRows + pendingRows !== Number(batch.total_rows)) throw new Error('IMPORT_FINALISATION_COUNT_RECONCILIATION_FAILED');
        const finalStatus = errorRows > 0 ? 'failed' : 'completed';
        const [completeUpdate] = await connection.execute(`
          UPDATE os2_import_batches
             SET status=:status,finalised_rows=:finalisedRows,error_rows=:errorRows,
                 completed_at=CASE WHEN :status='completed' THEN NOW() ELSE NULL END,
                 failure_message=CASE WHEN :status='failed' THEN 'IMPORT_ROWS_FAILED' ELSE NULL END,
                 updated_at=NOW()
           WHERE id=:id AND status='finalising'`, { status: finalStatus, finalisedRows, errorRows, id });
        if (Number(completeUpdate.affectedRows) !== 1) throw new Error('IMPORT_FINALISATION_COMPLETION_STATE_FAILED');
        await connection.execute(`
          INSERT INTO os2_import_events (batch_id,row_id,event_type,event_payload,actor_staff_id,created_at)
          VALUES (:id,NULL,'batch_finalised',:payload,:actor,NOW())`, {
          id, payload: JSON.stringify({ status: finalStatus, finalisedRows, errorRows, skippedRows, pendingRows, retry }), actor
        });
        await appendAudit(connection, {
          actorStaffId: actor, actionType: 'import_batch_finalised', entityType: 'os2_import_batches',
          entityId: id, description: `Finalised controlled import batch ${id}`,
          before: { status: batch.status }, after: { status: finalStatus, finalisedRows, errorRows, skippedRows, pendingRows, retry },
          requestContext: context
        });
        return { status: finalStatus, finalisedRows, errorRows, skippedRows, pendingRows, retry };
      }, { isolationLevel: 'SERIALIZABLE' });
      res.status(result.status === 'completed' ? 200 : 409).json({ ok: result.status === 'completed', ...result });
    } catch (error) { sendError(res, error, 'IMPORT_FINALISATION_FAILED'); }
  });

  return router;
};

module.exports.LIMITS = LIMITS;
module.exports.classifyRow = classifyRow;
module.exports.normaliseAccount = normaliseAccount;
module.exports.normalisePhone = normalisePhone;
module.exports.normaliseEmail = normaliseEmail;
module.exports.normaliseDate = normaliseDate;
module.exports.normaliseMoney = normaliseMoney;
module.exports.prepareRows = prepareRows;
module.exports.sourceDigest = sourceDigest;
module.exports.stableStringify = stableStringify;
