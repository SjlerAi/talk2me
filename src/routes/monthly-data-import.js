const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { parse } = require('../services/monthly-import-parser');

const router = express.Router();
const roles = new Set(['owner', 'manager', 'admin']);
const acceptedMimeTypes = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream'
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter(req, file, done) {
    const name = String(file.originalname || '').toLowerCase();
    const validExtension = name.endsWith('.xls') || name.endsWith('.xlsx');
    const validMime = acceptedMimeTypes.has(String(file.mimetype || '').toLowerCase());
    if (!validExtension || !validMime) return done(new Error('Only genuine .xls and .xlsx spreadsheet reports are accepted.'));
    return done(null, true);
  }
});

function managementOnly(req, res, next) {
  if (!roles.has(String(req.session.user?.role || '').toLowerCase())) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Management access is required.' });
  }
  next();
}
function text(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
async function ready() {
  const [rows] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('monthly_import_batches','monthly_import_rows')`);
  return new Set(rows.map(row => row.TABLE_NAME)).size === 2;
}
async function dashboard() {
  const [batches] = await db.query(`SELECT b.*,u.full_name imported_by_name FROM monthly_import_batches b LEFT JOIN staff_users u ON u.id=b.imported_by ORDER BY b.created_at DESC,b.id DESC LIMIT 100`);
  const [[summary]] = await db.query(`SELECT COUNT(*) batch_count,COALESCE(SUM(total_rows),0) rows_read,COALESCE(SUM(valid_rows),0) valid_rows,COALESCE(SUM(duplicate_rows),0) duplicate_rows,COALESCE(SUM(exception_rows),0) exception_rows FROM monthly_import_batches WHERE created_at>=DATE_FORMAT(CURDATE(),'%Y-%m-01')`);
  return { batches, summary };
}
async function render(req, res, extra = {}, status = 200) {
  const schemaReady = await ready();
  const data = schemaReady ? await dashboard() : { batches: [], summary: {} };
  return res.status(status).render('monthly-data-import', {
    title: 'Data Import Centre', schemaReady, batches: data.batches, summary: data.summary,
    selectedBatch: null, batchRows: [], notice: null, error: null, ...extra
  });
}

router.get('/backoffice/data-import', requireAuth, managementOnly, async (req, res, next) => {
  try { await render(req, res, { notice: text(req.query.notice, 300) }); } catch (error) { next(error); }
});
router.get('/backoffice/data-import/batches/:id', requireAuth, managementOnly, async (req, res, next) => {
  try {
    if (!await ready()) return res.redirect(`${res.locals.basePath}/backoffice/data-import`);
    const [[selectedBatch]] = await db.execute(`SELECT b.*,u.full_name imported_by_name FROM monthly_import_batches b LEFT JOIN staff_users u ON u.id=b.imported_by WHERE b.id=:id`, { id: req.params.id });
    if (!selectedBatch) return res.status(404).render('error', { title: 'Import not found', message: 'The requested import batch does not exist.' });
    const [batchRows] = await db.execute('SELECT * FROM monthly_import_rows WHERE batch_id=:id ORDER BY source_row_number,id', { id: req.params.id });
    await render(req, res, { selectedBatch, batchRows, notice: text(req.query.notice, 300) });
  } catch (error) { next(error); }
});
router.post('/backoffice/data-import/upload', requireAuth, managementOnly, upload.single('dealer_report'), async (req, res, next) => {
  try {
    if (!await ready()) throw new Error('Apply the reviewed one-off import SQL before uploading reports.');
    if (!req.file?.buffer) throw new Error('Select an .xls or .xlsx report.');
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const [[existing]] = await db.execute('SELECT id FROM monthly_import_batches WHERE file_hash=:fileHash LIMIT 1', { fileHash });
    if (existing) return res.redirect(`${res.locals.basePath}/backoffice/data-import/batches/${existing.id}?notice=${encodeURIComponent('This exact file was already uploaded and was not imported again.')}`);
    const parsed = parse(req.file.buffer, req.file.originalname);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [batch] = await connection.execute(`INSERT INTO monthly_import_batches (import_type,source_system,original_filename,file_hash,total_rows,status,imported_by) VALUES (:importType,:sourceSystem,:filename,:fileHash,:totalRows,'preview',:userId)`, {
        importType: parsed.importType, sourceSystem: parsed.sourceSystem, filename: text(req.file.originalname, 255), fileHash, totalRows: parsed.rows.length, userId: req.session.user.id
      });
      let valid = 0; let duplicates = 0; let exceptions = 0;
      for (const row of parsed.rows) {
        let duplicate = null;
        if (!row.isException) {
          [[duplicate]] = await connection.execute(`SELECT id FROM monthly_import_rows WHERE row_fingerprint=:fingerprint AND import_status IN ('staged','confirmed') LIMIT 1`, { fingerprint: row.rowFingerprint });
        }
        const importStatus = row.isException ? 'exception' : (duplicate ? 'duplicate' : 'staged');
        if (row.isException) exceptions += 1;
        else if (duplicate) duplicates += 1;
        else valid += 1;
        await connection.execute(`INSERT INTO monthly_import_rows (batch_id,source_row_number,row_fingerprint,import_status,phone_original,phone_normalised,account_number,customer_name,transaction_date,agent_code,deal_sheet_number,imei,order_number,mac_address,solution_id,sim_number,package_name,description,raw_data_json,warning_text) VALUES (:batchId,:sourceRow,:fingerprint,:status,:phoneOriginal,:phoneNormalised,:accountNumber,:customerName,:transactionDate,:agentCode,:dealSheet,:imei,:orderNumber,:macAddress,:solutionId,:simNumber,:packageName,:description,:rawJson,:warningText)`, {
          batchId: batch.insertId, sourceRow: row.sourceRowNumber, fingerprint: row.rowFingerprint, status: importStatus,
          phoneOriginal: row.phoneOriginal || null, phoneNormalised: row.phoneNormalised || null, accountNumber: row.accountNumber || null,
          customerName: row.customerName || null, transactionDate: row.transactionDate || null, agentCode: row.agentCode || null,
          dealSheet: row.dealSheetNumber || null, imei: row.imei || null, orderNumber: row.orderNumber || null,
          macAddress: row.macAddress || null, solutionId: row.solutionId || null, simNumber: row.simNumber || null,
          packageName: row.packageName || null, description: row.description || null, rawJson: JSON.stringify(row),
          warningText: row.warningText || (duplicate ? 'This transaction already exists in another import batch.' : null)
        });
      }
      await connection.execute('UPDATE monthly_import_batches SET valid_rows=:valid,duplicate_rows=:duplicates,exception_rows=:exceptions WHERE id=:id', { valid, duplicates, exceptions, id: batch.insertId });
      await connection.commit();
      return res.redirect(`${res.locals.basePath}/backoffice/data-import/batches/${batch.insertId}?notice=${encodeURIComponent('Report parsed successfully. Review the staged and exception rows before confirming.')}`);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) {
    try { await render(req, res, { error: error.message }, 400); } catch (renderError) { next(renderError); }
  }
});
router.post('/backoffice/data-import/batches/:id/confirm', requireAuth, managementOnly, async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[batch]] = await connection.execute('SELECT * FROM monthly_import_batches WHERE id=:id FOR UPDATE', { id: req.params.id });
    if (!batch || batch.status !== 'preview') throw new Error('Only a preview batch can be confirmed.');
    await connection.execute(`UPDATE monthly_import_rows SET import_status='confirmed' WHERE batch_id=:id AND import_status='staged'`, { id: batch.id });
    await connection.execute(`UPDATE monthly_import_batches SET status='confirmed',confirmed_by=:userId,confirmed_at=NOW() WHERE id=:id`, { userId: req.session.user.id, id: batch.id });
    await connection.commit();
    res.redirect(`${res.locals.basePath}/backoffice/data-import/batches/${batch.id}?notice=${encodeURIComponent('Batch confirmed as an audited import. Exception and duplicate rows remain unchanged for review.')}`);
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

module.exports = router;
