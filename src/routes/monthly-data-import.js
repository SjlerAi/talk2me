const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { parse } = require('../services/monthly-import-parser');
const { runMatching } = require('../services/monthly-import-matcher');
const {
  autoApproveDeterministicMatches,
  previewFinalisation,
  finaliseMonthlyImport
} = require('../services/monthly-import-finaliser');
const {
  ConflictReviewValidationError,
  hydrateConflictCandidates,
  requireValidSelection
} = require('../services/monthly-import-conflict-review');
const { audit } = require('../services/audit');

const router = express.Router();
const roles = new Set(['owner', 'manager', 'admin']);
const finaliserRoles = new Set(['owner', 'manager']);
const acceptedMimeTypes = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream'
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 10 },
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
function managerOwnerOnly(req, res, next) {
  if (!finaliserRoles.has(String(req.session.user?.role || '').toLowerCase())) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Manager or owner confirmation is required to finalise a Monthly Import.' });
  }
  next();
}
function text(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function panelQuery(req) { return String(req.query.panel || '') === '1' ? '&panel=1' : ''; }
function activeTab(value) {
  const selected = String(value || 'overview').toLowerCase();
  return ['overview', 'upload', 'history', 'review'].includes(selected) ? selected : 'overview';
}
async function ready() {
  const [rows] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('monthly_import_batches','monthly_import_rows')`);
  return new Set(rows.map(row => row.TABLE_NAME)).size === 2;
}
async function matchingReady() {
  const [rows] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('monthly_import_matches','monthly_import_actions')`);
  return new Set(rows.map(row => row.TABLE_NAME)).size === 2;
}
async function dashboard(hasMatchingSchema) {
  const matchCount = hasMatchingSchema
    ? `(SELECT COUNT(*) FROM monthly_import_rows r JOIN monthly_import_matches m ON m.import_row_id=r.id WHERE r.batch_id=b.id)`
    : '0';
  const [batches] = await db.query(`SELECT b.*,u.full_name imported_by_name,${matchCount} match_count FROM monthly_import_batches b LEFT JOIN staff_users u ON u.id=b.imported_by ORDER BY b.created_at DESC,b.id DESC LIMIT 100`);
  const [[summary]] = await db.query(`SELECT COUNT(*) batch_count,COALESCE(SUM(total_rows),0) rows_read,COALESCE(SUM(valid_rows),0) valid_rows,COALESCE(SUM(duplicate_rows),0) duplicate_rows,COALESCE(SUM(exception_rows),0) exception_rows FROM monthly_import_batches WHERE created_at>=DATE_FORMAT(CURDATE(),'%Y-%m-01')`);
  let exceptions = [];
  let conflicts = [];
  let workflow = {
    uploaded: Number(summary.batch_count || 0), readyToProcess: 0, conflicts: 0,
    exceptions: Number(summary.exception_rows || 0), finalised: 0, failed: 0,
    approvedReady: 0, proposedNew: 0, unresolved: 0, excluded: 0,
    mobileUpdates: 0, fixedUpdates: 0, provisionalMobile: 0, fixedCreates: 0
  };
  const [[pending]] = await db.query(hasMatchingSchema ? `
    SELECT COUNT(*) ready_to_process FROM monthly_import_batches b
    WHERE b.status='preview'
       OR (b.status='confirmed' AND EXISTS (
         SELECT 1 FROM monthly_import_rows r
         LEFT JOIN monthly_import_matches m ON m.import_row_id=r.id
         WHERE r.batch_id=b.id AND r.import_status='confirmed' AND m.id IS NULL
       ))
  ` : `
    SELECT COUNT(*) ready_to_process
    FROM monthly_import_batches
    WHERE status IN ('preview','confirmed')
  `);
  workflow.readyToProcess = Number(pending.ready_to_process || 0);
  [exceptions] = await db.query(`
    SELECT r.*,b.original_filename,b.import_type
    FROM monthly_import_rows r
    JOIN monthly_import_batches b ON b.id=r.batch_id
    WHERE r.import_status='exception'
    ORDER BY b.created_at DESC,r.source_row_number
    LIMIT 100
  `);
  if (hasMatchingSchema) {
    const finalisation = await previewFinalisation();
    workflow = {
      ...workflow,
      finalised: finalisation.finalised,
      failed: finalisation.failed,
      approvedReady: finalisation.approved_ready,
      proposedNew: finalisation.proposed_new,
      unresolved: finalisation.unresolved,
      excluded: finalisation.excluded,
      mobileUpdates: finalisation.mobile_updates,
      fixedUpdates: finalisation.fixed_updates,
      provisionalMobile: finalisation.provisional_mobile,
      fixedCreates: finalisation.fixed_creates
    };
    [conflicts] = await db.query(`
      SELECT m.*,r.batch_id,r.source_row_number,r.phone_original,r.phone_normalised,r.account_number,
        r.customer_name,r.transaction_date,r.order_number,r.solution_id,r.mac_address,r.sim_number,r.package_name,
        a.action_type,a.target_entity_type,a.target_entity_id,a.approval_status,a.applied_status,
        b.original_filename
      FROM monthly_import_matches m
      JOIN monthly_import_rows r ON r.id=m.import_row_id
      JOIN monthly_import_batches b ON b.id=r.batch_id
      JOIN monthly_import_actions a ON a.match_id=m.id
      WHERE a.applied_status='not_applied'
        AND a.approval_status='pending'
        AND m.review_status='pending'
        AND (m.classification='conflict' OR a.action_type='create_fixed_account_and_service')
      ORDER BY FIELD(m.review_status,'pending','deferred','rejected','approved'),b.created_at DESC,r.source_row_number
      LIMIT 100
    `);
    conflicts = await hydrateConflictCandidates(db, conflicts);
    workflow.conflicts = conflicts.filter(row => row.classification === 'conflict').length;
  }
  return { batches, summary, workflow, exceptions, conflicts };
}
async function render(req, res, extra = {}, status = 200) {
  const schemaReady = await ready();
  const matchingSchemaReady = schemaReady ? await matchingReady() : false;
  const data = schemaReady
    ? await dashboard(matchingSchemaReady)
    : { batches: [], summary: {}, workflow: {}, exceptions: [], conflicts: [] };
  return res.status(status).render('monthly-data-import', {
    title: 'Data Import Centre', schemaReady, matchingSchemaReady,
    batches: data.batches, summary: data.summary, workflow: data.workflow,
    exceptions: data.exceptions, conflicts: data.conflicts, selectedBatch: null, batchRows: [],
    reviewRows: [], reviewSummary: {}, reviewFilter: 'all', reviewMode: false,
    activeTab: activeTab(extra.activeTab || req.query.tab),
    notice: null, error: null, formatDate: value => {
      if (!value) return '-';
      const date = new Date(`${String(value).slice(0, 10)}T12:00:00+02:00`);
      return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
    }, ...extra
  });
}

router.get('/backoffice/data-import', requireAuth, managementOnly, async (req, res, next) => {
  try {
    await render(req, res, {
      activeTab: activeTab(req.query.tab),
      notice: text(req.query.notice, 300),
      error: text(req.query.error, 500)
    });
  } catch (error) { next(error); }
});
router.get('/backoffice/data-import/batches/:id', requireAuth, managementOnly, async (req, res, next) => {
  try {
    if (!await ready()) return res.redirect(`${res.locals.basePath}/backoffice/data-import?tab=overview${panelQuery(req)}`);
    const [[selectedBatch]] = await db.execute(`SELECT b.*,u.full_name imported_by_name FROM monthly_import_batches b LEFT JOIN staff_users u ON u.id=b.imported_by WHERE b.id=:id`, { id: req.params.id });
    if (!selectedBatch) return res.status(404).render('error', { title: 'Import not found', message: 'The requested import batch does not exist.' });
    const [batchRows] = await db.execute('SELECT * FROM monthly_import_rows WHERE batch_id=:id ORDER BY source_row_number,id', { id: req.params.id });
    await render(req, res, { activeTab: 'history', selectedBatch, batchRows, notice: text(req.query.notice, 300) });
  } catch (error) { next(error); }
});
router.get('/backoffice/data-import/batches/:id/review', requireAuth, managementOnly, async (req, res, next) => {
  try {
    if (!await ready()) return res.redirect(`${res.locals.basePath}/backoffice/data-import?tab=overview${panelQuery(req)}`);
    const [[selectedBatch]] = await db.execute(`SELECT b.*,u.full_name imported_by_name FROM monthly_import_batches b LEFT JOIN staff_users u ON u.id=b.imported_by WHERE b.id=:id`, { id: req.params.id });
    if (!selectedBatch) return res.status(404).render('error', { title: 'Import not found', message: 'The requested import batch does not exist.' });
    const reviewFilter = ['all', 'exact', 'conflict', 'new', 'approved', 'rejected', 'deferred'].includes(String(req.query.filter || 'all')) ? String(req.query.filter || 'all') : 'all';
    let condition = '';
    if (reviewFilter === 'exact') condition = `AND m.classification='exact_match'`;
    if (reviewFilter === 'conflict') condition = `AND m.classification='conflict'`;
    if (reviewFilter === 'new') condition = `AND m.classification='new_record'`;
    if (['approved', 'rejected', 'deferred'].includes(reviewFilter)) condition = `AND m.review_status=:reviewFilter`;
    const params = { id: req.params.id, reviewFilter };
    let reviewRows = [];
    let reviewSummary = {};
    if (await matchingReady()) {
      [[reviewSummary]] = await db.execute(`
        SELECT COUNT(*) total,
          SUM(m.classification='exact_match') exact_matches,
          SUM(m.classification='conflict') conflicts,
          SUM(m.classification='new_record') new_records,
          SUM(m.match_domain='mobile' AND m.classification='exact_match') mobile_exact,
          SUM(m.match_domain='mobile' AND m.classification='conflict') mobile_conflicts,
          SUM(m.match_domain='mobile' AND m.classification='new_record') mobile_new,
          SUM(m.match_domain='fixed' AND m.classification='exact_match') fixed_exact,
          SUM(m.review_status='pending') pending,
          SUM(m.review_status='approved') approved,
          SUM(m.review_status='rejected') rejected,
          SUM(m.review_status='deferred') deferred
        FROM monthly_import_matches m
        JOIN monthly_import_rows r ON r.id=m.import_row_id
        WHERE r.batch_id=:id
      `, params);
      [reviewRows] = await db.execute(`
        SELECT m.*,r.source_row_number,r.phone_original,r.phone_normalised,r.account_number,r.customer_name,
          r.transaction_date,r.order_number,r.solution_id,r.mac_address,r.sim_number,r.package_name,r.description,
          a.action_type,a.target_entity_type,a.target_entity_id,a.approval_status,a.applied_status,
          c.client_name proposed_client_name,ca.account_number proposed_account_number,ca.display_name proposed_account_name,
          fa.customer_name proposed_fixed_account_name,fs.service_title proposed_service_title,fs.branch_name proposed_service_branch,
          reviewer.full_name reviewed_by_name
        FROM monthly_import_matches m
        JOIN monthly_import_rows r ON r.id=m.import_row_id
        LEFT JOIN monthly_import_actions a ON a.match_id=m.id
        LEFT JOIN clients c ON c.id=m.proposed_client_id
        LEFT JOIN customer_accounts ca ON ca.id=m.proposed_account_id
        LEFT JOIN fixed_accounts fa ON fa.id=m.proposed_fixed_account_id
        LEFT JOIN fixed_services fs ON fs.id=m.proposed_fixed_service_id
        LEFT JOIN staff_users reviewer ON reviewer.id=m.reviewed_by
        WHERE r.batch_id=:id ${condition}
        ORDER BY FIELD(m.review_status,'pending','deferred','rejected','approved'),
          FIELD(m.classification,'conflict','new_record','possible_match','exact_match'),r.source_row_number,m.id
      `, params);
      const conflictRows = reviewRows
        .filter(row => row.classification === 'conflict')
        .map(row => ({ ...row, original_filename: selectedBatch.original_filename }));
      const hydratedConflicts = new Map(
        (await hydrateConflictCandidates(db, conflictRows)).map(row => [Number(row.id), row])
      );
      reviewRows = reviewRows.map(row => hydratedConflicts.get(Number(row.id)) || { ...row, selection: null });
    }
    await render(req, res, {
      activeTab: 'review', selectedBatch, reviewRows, reviewSummary, reviewFilter, reviewMode: true,
      notice: text(req.query.notice, 300)
    });
  } catch (error) { next(error); }
});
router.post('/backoffice/data-import/upload', requireAuth, managementOnly, upload.fields([
  { name: 'dealer_reports', maxCount: 10 },
  { name: 'dealer_report', maxCount: 1 }
]), async (req, res, next) => {
  try {
    if (!await ready()) throw new Error('Apply the reviewed one-off import SQL before uploading reports.');
    const files = [...(req.files?.dealer_reports || []), ...(req.files?.dealer_report || [])];
    if (!files.length) throw new Error('Select one or more .xls or .xlsx reports.');
    const prepared = files.map(file => ({
      file,
      fileHash: crypto.createHash('sha256').update(file.buffer).digest('hex'),
      parsed: parse(file.buffer, file.originalname)
    }));
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      let uploaded = 0;
      let skipped = 0;
      let totalRows = 0;
      for (const item of prepared) {
        const [[existing]] = await connection.execute(
          'SELECT id FROM monthly_import_batches WHERE file_hash=:fileHash LIMIT 1 FOR UPDATE',
          { fileHash: item.fileHash }
        );
        if (existing) {
          skipped += 1;
          continue;
        }
        const { parsed, file, fileHash } = item;
        const [batch] = await connection.execute(`
          INSERT INTO monthly_import_batches
            (import_type,source_system,original_filename,file_hash,total_rows,valid_rows,duplicate_rows,
             exception_rows,status,imported_by,confirmed_by,confirmed_at)
          VALUES
            (:importType,:sourceSystem,:filename,:fileHash,:totalRows,0,0,0,'confirmed',:userId,:userId,NOW())
        `, {
          importType: parsed.importType, sourceSystem: parsed.sourceSystem,
          filename: text(file.originalname, 255), fileHash,
          totalRows: parsed.rows.length, userId: req.session.user.id
        });
        let valid = 0; let duplicates = 0; let exceptions = 0;
        for (const row of parsed.rows) {
          let duplicate = null;
          if (!row.isException) {
            [[duplicate]] = await connection.execute(`
              SELECT id FROM monthly_import_rows
              WHERE row_fingerprint=:fingerprint AND import_status IN ('staged','confirmed')
              LIMIT 1
            `, { fingerprint: row.rowFingerprint });
          }
          const importStatus = row.isException ? 'exception' : (duplicate ? 'duplicate' : 'confirmed');
          if (row.isException) exceptions += 1;
          else if (duplicate) duplicates += 1;
          else valid += 1;
          await connection.execute(`
            INSERT INTO monthly_import_rows
              (batch_id,source_row_number,row_fingerprint,import_status,phone_original,phone_normalised,
               account_number,customer_name,transaction_date,agent_code,deal_sheet_number,imei,order_number,
               mac_address,solution_id,sim_number,package_name,description,raw_data_json,warning_text)
            VALUES
              (:batchId,:sourceRow,:fingerprint,:status,:phoneOriginal,:phoneNormalised,:accountNumber,
               :customerName,:transactionDate,:agentCode,:dealSheet,:imei,:orderNumber,:macAddress,
               :solutionId,:simNumber,:packageName,:description,:rawJson,:warningText)
          `, {
            batchId: batch.insertId, sourceRow: row.sourceRowNumber, fingerprint: row.rowFingerprint, status: importStatus,
            phoneOriginal: row.phoneOriginal || null, phoneNormalised: row.phoneNormalised || null, accountNumber: row.accountNumber || null,
            customerName: row.customerName || null, transactionDate: row.transactionDate || null, agentCode: row.agentCode || null,
            dealSheet: row.dealSheetNumber || null, imei: row.imei || null, orderNumber: row.orderNumber || null,
            macAddress: row.macAddress || null, solutionId: row.solutionId || null, simNumber: row.simNumber || null,
            packageName: row.packageName || null, description: row.description || null, rawJson: JSON.stringify(row),
            warningText: row.warningText || (duplicate ? 'This transaction already exists in another import batch.' : null)
          });
        }
        await connection.execute(`
          UPDATE monthly_import_batches
          SET valid_rows=:valid,duplicate_rows=:duplicates,exception_rows=:exceptions
          WHERE id=:id
        `, { valid, duplicates, exceptions, id: batch.insertId });
        uploaded += 1;
        totalRows += parsed.rows.length;
      }
      await connection.commit();
      const notice = uploaded
        ? `${uploaded} report(s) uploaded and confirmed (${totalRows} rows). ${skipped ? `${skipped} exact duplicate file(s) skipped. ` : ''}Select Process Monthly Import when all files are ready.`
        : 'Every selected file was already uploaded; no duplicate batches were created.';
      return res.redirect(`${res.locals.basePath}/backoffice/data-import?notice=${encodeURIComponent(notice)}${panelQuery(req)}`);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) {
    try { await render(req, res, { activeTab: 'upload', error: error.message }, 400); } catch (renderError) { next(renderError); }
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
    res.redirect(`${res.locals.basePath}/backoffice/data-import/batches/${batch.id}?notice=${encodeURIComponent('Batch confirmed as an audited import. Exception and duplicate rows remain unchanged for review.')}${panelQuery(req)}`);
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});
router.post('/backoffice/data-import/batches/:id/match', requireAuth, managementOnly, async (req, res, next) => {
  try {
    if (!await matchingReady()) throw new Error('Apply the reviewed Phase 2 one-off SQL before running matching.');
    const summary = await runMatching({ batchId: req.params.id });
    await audit(req, {
      actionType: 'monthly_import_matching_run', entityType: 'monthly_import_batches', entityId: Number(req.params.id),
      description: `Matching analysed ${summary.total} confirmed import rows.`, after: summary
    });
    return res.redirect(`${res.locals.basePath}/backoffice/data-import/batches/${req.params.id}/review?notice=${encodeURIComponent(`Matching completed for ${summary.total} confirmed rows without changing live customer records.`)}${panelQuery(req)}`);
  } catch (error) { next(error); }
});

router.post('/backoffice/data-import/process', requireAuth, managementOnly, async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    if (!await matchingReady()) throw new Error('Apply the reviewed matching one-off SQL before processing the Monthly Import.');
    await connection.beginTransaction();
    const [previewBatches] = await connection.execute(`
      SELECT id FROM monthly_import_batches WHERE status='preview' FOR UPDATE
    `);
    if (previewBatches.length) {
      await connection.execute(`
        UPDATE monthly_import_rows r
        JOIN monthly_import_batches b ON b.id=r.batch_id
        SET r.import_status='confirmed'
        WHERE b.status='preview' AND r.import_status='staged'
      `);
      await connection.execute(`
        UPDATE monthly_import_batches
        SET status='confirmed',confirmed_by=:userId,confirmed_at=NOW()
        WHERE status='preview'
      `, { userId: req.session.user.id });
    }
    await connection.commit();
    const summary = await runMatching();
    const context = {
      userId: req.session.user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    };
    const autoApproved = await autoApproveDeterministicMatches(context);
    await audit(req, {
      actionType: 'monthly_import_processed',
      entityType: 'monthly_import_batches',
      entityId: null,
      description: `Monthly Import processed ${summary.total} eligible rows and auto-approved ${autoApproved} deterministic exact matches.`,
      after: { ...summary, autoApproved, confirmedLegacyBatches: previewBatches.length }
    });
    return res.redirect(`${res.locals.basePath}/backoffice/data-import?notice=${encodeURIComponent(
      `Monthly Import processed ${summary.total} rows. ${autoApproved} deterministic exact match(es) were approved; conflicts remain for review.`
    )}${panelQuery(req)}`);
  } catch (error) {
    if (connection) await connection.rollback();
    try { await render(req, res, { activeTab: 'overview', error: error.message }, 400); } catch (renderError) { next(renderError); }
  } finally {
    connection.release();
  }
});

router.post('/backoffice/data-import/finalise', requireAuth, managerOwnerOnly, async (req, res, next) => {
  try {
    if (String(req.body.confirm_finalise || '') !== 'yes') {
      throw new Error('Confirm that you reviewed the preview before finalising.');
    }
    const result = await finaliseMonthlyImport({
      userId: req.session.user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    return res.redirect(`${res.locals.basePath}/backoffice/data-import?notice=${encodeURIComponent(
      result.applied
        ? `Monthly Import finalised successfully. ${result.applied} action(s) were applied transactionally.`
        : 'Monthly Import was already finalised. No duplicate records or updates were created.'
    )}${panelQuery(req)}`);
  } catch (error) {
    try { await render(req, res, { activeTab: 'overview', error: error.message }, 400); } catch (renderError) { next(renderError); }
  }
});

router.post('/backoffice/data-import/batches/:batchId/matches/:matchId/decision', requireAuth, managementOnly, async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const decision = String(req.body.decision || '').toLowerCase();
    const statusByDecision = { approve: 'approved', reject: 'rejected', defer: 'deferred' };
    if (!statusByDecision[decision]) throw new ConflictReviewValidationError('Choose approve, exclude or defer.');
    await connection.beginTransaction();
    let [[match]] = await connection.execute(`
      SELECT m.*,r.batch_id,r.source_row_number,r.phone_original,r.phone_normalised,r.account_number,
        r.customer_name,r.transaction_date,r.order_number,r.solution_id,r.mac_address,r.sim_number,
        r.package_name,b.original_filename
      FROM monthly_import_matches m
      JOIN monthly_import_rows r ON r.id=m.import_row_id
      JOIN monthly_import_batches b ON b.id=r.batch_id
      WHERE m.id=:matchId AND r.batch_id=:batchId FOR UPDATE
    `, { matchId: req.params.matchId, batchId: req.params.batchId });
    if (!match) throw new ConflictReviewValidationError('This conflict no longer exists. Run Process Monthly Import again.');
    const [[action]] = await connection.execute(`
      SELECT * FROM monthly_import_actions WHERE match_id=:matchId FOR UPDATE
    `, { matchId: match.id });
    if (!action) throw new ConflictReviewValidationError('The proposed action is missing. Run Process Monthly Import again.');
    if (action.applied_status !== 'not_applied') {
      throw new ConflictReviewValidationError('This conflict action has already been applied and cannot be changed.');
    }
    if (match.review_status !== 'pending' || action.approval_status !== 'pending') {
      throw new ConflictReviewValidationError('Another manager already resolved this conflict. Refresh Monthly Import.');
    }

    let selectedCandidate = null;
    let selection = null;
    if (decision === 'approve') {
      [match] = await hydrateConflictCandidates(connection, [match]);
      selection = match.selection;
      selectedCandidate = requireValidSelection(selection, req.body);
      const tableByTarget = {
        clients: 'clients',
        customer_accounts: 'customer_accounts',
        fixed_accounts: 'fixed_accounts',
        fixed_services: 'fixed_services'
      };
      const table = tableByTarget[selection.targetType];
      if (!table) throw new ConflictReviewValidationError('This candidate type cannot be approved. Run Process Monthly Import again.');
      const [[lockedCandidate]] = await connection.execute(
        `SELECT id FROM ${table} WHERE id=:id FOR UPDATE`,
        { id: selectedCandidate.id }
      );
      if (!lockedCandidate) {
        throw new ConflictReviewValidationError('The selected candidate no longer exists. Run Process Monthly Import again.');
      }
      [match] = await hydrateConflictCandidates(connection, [match]);
      selection = match.selection;
      selectedCandidate = requireValidSelection(selection, req.body);
    }

    const before = {
      reviewStatus: match.review_status, proposedClientId: match.proposed_client_id,
      proposedAccountId: match.proposed_account_id, proposedFixedAccountId: match.proposed_fixed_account_id,
      proposedFixedServiceId: match.proposed_fixed_service_id, reviewNotes: match.review_notes,
      action: {
        approvalStatus: action.approval_status, appliedStatus: action.applied_status,
        targetEntityType: action.target_entity_type, targetEntityId: action.target_entity_id
      }
    };
    const reviewStatus = statusByDecision[decision];
    const notes = text(req.body.review_notes, 2000) || null;
    const selected = {
      clientId: selection?.targetType === 'clients' ? selectedCandidate.id : null,
      accountId: selection?.targetType === 'customer_accounts' ? selectedCandidate.id : null,
      fixedAccountId: selection?.targetType === 'fixed_accounts' ? selectedCandidate.id : null,
      fixedServiceId: selection?.targetType === 'fixed_services' ? selectedCandidate.id : null
    };
    if (selected.fixedServiceId && selectedCandidate.live.fixed_account_id) {
      selected.fixedAccountId = Number(selectedCandidate.live.fixed_account_id);
    }
    await connection.execute(`
      UPDATE monthly_import_matches SET review_status=:reviewStatus,reviewed_by=:userId,reviewed_at=NOW(),review_notes=:notes,
        proposed_client_id=COALESCE(:clientId,proposed_client_id),
        proposed_account_id=COALESCE(:accountId,proposed_account_id),
        proposed_fixed_account_id=COALESCE(:fixedAccountId,proposed_fixed_account_id),
        proposed_fixed_service_id=COALESCE(:fixedServiceId,proposed_fixed_service_id)
      WHERE id=:matchId
    `, { reviewStatus, userId: req.session.user.id, notes, matchId: match.id, ...selected });
    const targetType = selectedCandidate ? selection.targetType : action.target_entity_type;
    const targetId = selectedCandidate ? selectedCandidate.id : action.target_entity_id;
    await connection.execute(`
      UPDATE monthly_import_actions SET approval_status=:reviewStatus,approved_by=:userId,approved_at=NOW(),
        target_entity_type=:targetType,target_entity_id=:targetId,applied_status='not_applied',
        applied_by=NULL,applied_at=NULL,error_text=NULL
      WHERE match_id=:matchId
    `, { reviewStatus, userId: req.session.user.id, targetType, targetId, matchId: match.id });
    const after = {
      reviewStatus, ...selected, reviewNotes: notes,
      selectedCandidate: selectedCandidate ? {
        id: selectedCandidate.id,
        kind: selectedCandidate.kind,
        title: selectedCandidate.title,
        matchedFields: selectedCandidate.evidence.map(item => item.field)
      } : null,
      action: {
        approvalStatus: reviewStatus, appliedStatus: 'not_applied',
        targetEntityType: targetType, targetEntityId: targetId
      }
    };
    await connection.execute(`
      INSERT INTO audit_log
        (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent)
      VALUES (:userId,:actionType,'monthly_import_matches',:matchId,:description,:beforeJson,:afterJson,:ip,:userAgent)
    `, {
      userId: req.session.user.id, actionType: `monthly_import_match_${reviewStatus}`, matchId: match.id,
      description: `Monthly import match #${match.id} ${reviewStatus}; no live customer records were changed.`,
      beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after),
      ip: String(req.ip || '').slice(0, 64), userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
    await connection.commit();
    if (req.body.return_to === 'monthly') {
      const success = selectedCandidate
        ? `${selectedCandidate.title} selected for this imported row. The other record was not changed.`
        : `Imported row ${reviewStatus}. No live customer record was modified.`;
      return res.redirect(`${res.locals.basePath}/backoffice/data-import?notice=${encodeURIComponent(success)}${panelQuery(req)}#exceptions`);
    }
    return res.redirect(`${res.locals.basePath}/backoffice/data-import/batches/${req.params.batchId}/review?filter=${encodeURIComponent(req.body.return_filter || 'all')}&notice=${encodeURIComponent(`Match ${reviewStatus}. No live record was modified.`)}${panelQuery(req)}`);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ConflictReviewValidationError) {
      return res.redirect(`${res.locals.basePath}/backoffice/data-import?error=${encodeURIComponent(error.message)}${panelQuery(req)}#exceptions`);
    }
    next(error);
  } finally {
    connection.release();
  }
});

module.exports = router;
