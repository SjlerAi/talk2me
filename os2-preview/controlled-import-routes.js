'use strict';

const express = require('express');
const crypto = require('crypto');
const { withTransaction } = require('./core/transactions');
const { appendAudit } = require('./core/audit');
const { requirePermission } = require('./core/permissions');

function clean(value, max = 255) {
  const result = String(value == null ? '' : value).trim();
  return result ? result.slice(0, max) : null;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normaliseAccount(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
}

function normalisePhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('27') && phone.length === 11) phone = `0${phone.slice(2)}`;
  return phone;
}

function requestContext(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
  };
}

function classifyRow(row) {
  const accountNumber = normaliseAccount(row.account_number || row.accountNumber);
  const mobile = normalisePhone(row.mobile || row.cell_number || row.cellNumber);
  const displayName = clean(row.customer_name || row.client_name || row.displayName, 200);
  const errors = [];
  if (!accountNumber) errors.push('ACCOUNT_NUMBER_REQUIRED');
  if (!displayName) errors.push('CUSTOMER_NAME_REQUIRED');
  if (!mobile) errors.push('MOBILE_REQUIRED');
  return {
    payload: {
      accountNumber,
      mobile,
      displayName,
      email: clean(row.email, 254)?.toLowerCase() || null,
      town: clean(row.town || row.city_town, 150),
      packageName: clean(row.package_name || row.packageName, 200),
      handset: clean(row.handset, 200),
      nextUpgradeDate: clean(row.next_upgrade_date || row.nextUpgradeDate, 40),
      monthlyAmount: row.monthly_amount == null ? null : Number(row.monthly_amount)
    },
    classification: errors.length ? 'invalid' : 'ambiguous',
    validationErrors: errors
  };
}

module.exports = function createControlledImportRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use('/api/os2/imports', requireAuth);

  router.get('/api/os2/imports', requirePermission('import.read'), async (req, res) => {
    const [rows] = await pool.execute(`
      SELECT b.*, u.full_name uploaded_by_name, a.full_name approved_by_name
        FROM os2_import_batches b
        LEFT JOIN staff_users u ON u.id=b.uploaded_by
        LEFT JOIN staff_users a ON a.id=b.approved_by
       ORDER BY b.created_at DESC LIMIT 100`);
    res.json({ ok: true, batches: rows });
  });

  router.post('/api/os2/imports/stage', requirePermission('import.upload'), async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const filename = clean(req.body.filename, 255);
    const batchType = clean(req.body.batchType, 80) || 'customer_services';
    if (!filename || !rows.length) return res.status(400).json({ ok:false, error:'FILENAME_AND_ROWS_REQUIRED' });
    if (rows.length > 5000) return res.status(413).json({ ok:false, error:'IMPORT_ROW_LIMIT_EXCEEDED' });

    const sourceHash = crypto.createHash('sha256').update(JSON.stringify({ filename, rows })).digest('hex');
    try {
      const result = await withTransaction(pool, async connection => {
        const [[existing]] = await connection.execute('SELECT id,status FROM os2_import_batches WHERE source_sha256=:hash LIMIT 1 FOR UPDATE', { hash:sourceHash });
        if (existing) {
          const error = new Error('IMPORT_FILE_ALREADY_STAGED');
          error.statusCode = 409;
          error.details = existing;
          throw error;
        }
        const [batchInsert] = await connection.execute(`
          INSERT INTO os2_import_batches
            (batch_type,source_filename,source_sha256,status,total_rows,uploaded_by,created_at,updated_at)
          VALUES (:batchType,:filename,:hash,'analysing',:total,:actor,NOW(),NOW())`, {
          batchType, filename, hash:sourceHash, total:rows.length, actor:Number(req.user.id)
        });
        const batchId = Number(batchInsert.insertId);
        let safe = 0, review = 0, rejected = 0;

        for (let offset = 0; offset < rows.length; offset += 25) {
          const chunk = rows.slice(offset, offset + 25);
          const savepoint = `import_chunk_${offset}`;
          await connection.query(`SAVEPOINT ${savepoint}`);
          try {
            for (let index = 0; index < chunk.length; index += 1) {
              const sourceRow = offset + index + 1;
              const classified = classifyRow(chunk[index]);
              let classification = classified.classification;
              let matchStrategy = null;
              let matchedCustomerId = null;
              let matchedAccountId = null;
              let confidence = null;

              if (classification !== 'invalid') {
                const [matches] = await connection.execute(`
                  SELECT mc.id master_customer_id, ca.id account_id,
                         CASE
                           WHEN ca.normalised_account_number=:account THEN 100
                           WHEN mc.primary_mobile=:mobile THEN 90
                           WHEN LOWER(mc.primary_email)=LOWER(:email) AND :email IS NOT NULL THEN 75
                           ELSE 0
                         END confidence
                    FROM os2_master_customers mc
                    LEFT JOIN os2_customer_accounts ca ON ca.master_customer_id=mc.id AND ca.archived_at IS NULL
                   WHERE mc.archived_at IS NULL AND (
                         ca.normalised_account_number=:account OR mc.primary_mobile=:mobile OR
                         (:email IS NOT NULL AND LOWER(mc.primary_email)=LOWER(:email))
                   )
                   ORDER BY confidence DESC, mc.id LIMIT 3`, {
                  account:classified.payload.accountNumber,
                  mobile:classified.payload.mobile,
                  email:classified.payload.email
                });
                if (matches.length === 1 && Number(matches[0].confidence) >= 90) {
                  classification = 'safe_update';
                  matchStrategy = Number(matches[0].confidence) === 100 ? 'exact_account' : 'exact_mobile';
                  matchedCustomerId = Number(matches[0].master_customer_id);
                  matchedAccountId = positiveId(matches[0].account_id);
                  confidence = Number(matches[0].confidence);
                  safe += 1;
                } else if (matches.length === 0) {
                  classification = 'safe_create';
                  matchStrategy = 'no_existing_match';
                  confidence = 100;
                  safe += 1;
                } else {
                  classification = 'ambiguous';
                  matchStrategy = 'multiple_or_weak_matches';
                  confidence = matches.length ? Number(matches[0].confidence) : 0;
                  review += 1;
                }
              } else {
                rejected += 1;
              }

              await connection.execute(`
                INSERT INTO os2_import_rows
                  (batch_id,source_row_number,raw_payload,normalised_payload,classification,
                   match_strategy,matched_master_customer_id,matched_account_id,confidence_score,
                   validation_errors,review_decision,finalisation_status,created_at,updated_at)
                VALUES
                  (:batchId,:rowNumber,:rawPayload,:normalisedPayload,:classification,
                   :matchStrategy,:customerId,:accountId,:confidence,:errors,
                   'pending','pending',NOW(),NOW())`, {
                batchId, rowNumber:sourceRow,
                rawPayload:JSON.stringify(chunk[index]),
                normalisedPayload:JSON.stringify(classified.payload),
                classification, matchStrategy, customerId:matchedCustomerId,
                accountId:matchedAccountId, confidence,
                errors:classified.validationErrors.length ? JSON.stringify(classified.validationErrors) : null
              });
            }
            await connection.query(`RELEASE SAVEPOINT ${savepoint}`);
          } catch (error) {
            await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            throw error;
          }
        }

        await connection.execute(`
          UPDATE os2_import_batches
             SET status='review',safe_rows=:safe,review_rows=:review,rejected_rows=:rejected,updated_at=NOW()
           WHERE id=:batchId`, { batchId, safe, review, rejected });
        await appendAudit(connection, {
          actorStaffId:req.user.id,
          actionType:'import_batch_staged',
          entityType:'os2_import_batches',
          entityId:batchId,
          description:`Staged import ${filename} with ${rows.length} rows`,
          after:{ safe, review, rejected, source_sha256:sourceHash },
          requestContext:requestContext(req)
        });
        return { batchId, safe, review, rejected };
      });
      res.status(201).json({ ok:true, ...result });
    } catch (error) {
      res.status(error.statusCode || 500).json({ ok:false, error:error.statusCode ? error.message : 'IMPORT_STAGE_FAILED', details:error.details });
    }
  });

  router.get('/api/os2/imports/:id', requirePermission('import.read'), async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error:'INVALID_IMPORT_BATCH_ID' });
    const [[batch]] = await pool.execute('SELECT * FROM os2_import_batches WHERE id=:id', { id });
    if (!batch) return res.status(404).json({ ok:false, error:'IMPORT_BATCH_NOT_FOUND' });
    const [rows] = await pool.execute(`
      SELECT id,source_row_number,normalised_payload,classification,match_strategy,
             matched_master_customer_id,matched_account_id,confidence_score,validation_errors,
             review_notes,review_decision,finalisation_status,finalised_entity_type,
             finalised_entity_id,finalisation_error
        FROM os2_import_rows WHERE batch_id=:id ORDER BY source_row_number`, { id });
    res.json({ ok:true, batch, rows });
  });

  router.post('/api/os2/imports/:batchId/rows/:rowId/review', requirePermission('import.review'), async (req, res) => {
    const batchId = positiveId(req.params.batchId);
    const rowId = positiveId(req.params.rowId);
    const decision = ['approve','reject','override'].includes(req.body.decision) ? req.body.decision : null;
    if (!batchId || !rowId || !decision) return res.status(400).json({ ok:false, error:'INVALID_REVIEW_REQUEST' });
    await withTransaction(pool, async connection => {
      const [[row]] = await connection.execute('SELECT * FROM os2_import_rows WHERE id=:rowId AND batch_id=:batchId FOR UPDATE', { rowId, batchId });
      if (!row) throw Object.assign(new Error('IMPORT_ROW_NOT_FOUND'), { statusCode:404 });
      if (row.finalisation_status !== 'pending') throw Object.assign(new Error('IMPORT_ROW_ALREADY_FINALISED'), { statusCode:409 });
      await connection.execute(`
        UPDATE os2_import_rows
           SET review_decision=:decision,review_notes=:notes,reviewed_by=:actor,reviewed_at=NOW(),updated_at=NOW()
         WHERE id=:rowId`, { decision, notes:clean(req.body.notes, 5000), actor:Number(req.user.id), rowId });
      await connection.execute(`INSERT INTO os2_import_events (batch_id,row_id,event_type,event_payload,actor_staff_id,created_at) VALUES (:batchId,:rowId,'row_reviewed',:payload,:actor,NOW())`, {
        batchId, rowId, payload:JSON.stringify({ decision, notes:clean(req.body.notes, 5000) }), actor:Number(req.user.id)
      });
    });
    res.json({ ok:true });
  });

  router.post('/api/os2/imports/:id/approve', requirePermission('import.finalise'), async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error:'INVALID_IMPORT_BATCH_ID' });
    await withTransaction(pool, async connection => {
      const [[batch]] = await connection.execute('SELECT * FROM os2_import_batches WHERE id=:id FOR UPDATE', { id });
      if (!batch) throw Object.assign(new Error('IMPORT_BATCH_NOT_FOUND'), { statusCode:404 });
      if (!['review','approved'].includes(batch.status)) throw Object.assign(new Error('IMPORT_BATCH_NOT_REVIEWABLE'), { statusCode:409 });
      const [[pending]] = await connection.execute(`SELECT COUNT(*) total FROM os2_import_rows WHERE batch_id=:id AND classification IN ('ambiguous','invalid') AND review_decision='pending'`, { id });
      if (Number(pending.total) > 0) throw Object.assign(new Error('IMPORT_EXCEPTIONS_REQUIRE_DECISIONS'), { statusCode:409, details:{ pending:Number(pending.total) } });
      if (Number(batch.uploaded_by) === Number(req.user.id)) throw Object.assign(new Error('SELF_APPROVAL_NOT_ALLOWED'), { statusCode:403 });
      await connection.execute(`UPDATE os2_import_batches SET status='approved',approved_by=:actor,approved_at=NOW(),updated_at=NOW() WHERE id=:id`, { id, actor:Number(req.user.id) });
      await appendAudit(connection, {
        actorStaffId:req.user.id, actionType:'import_batch_approved', entityType:'os2_import_batches',
        entityId:id, description:`Approved import batch ${id}`, requestContext:requestContext(req)
      });
    }).then(() => res.json({ ok:true })).catch(error => res.status(error.statusCode || 500).json({ ok:false, error:error.statusCode ? error.message : 'IMPORT_APPROVAL_FAILED', details:error.details }));
  });

  return router;
};

module.exports.classifyRow = classifyRow;
module.exports.normaliseAccount = normaliseAccount;
module.exports.normalisePhone = normalisePhone;
