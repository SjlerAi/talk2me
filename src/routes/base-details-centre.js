'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { runMatching } = require('../services/monthly-import-matcher');
const { stageBaseDetailsBatch } = require('../services/base-details-stager');
const { audit } = require('../services/audit');

const router = express.Router();

async function schemaReady() {
  const [rows] = await db.query(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME IN ('mobile_base_current','mobile_base_snapshots','monthly_import_batches','monthly_import_matches','monthly_import_actions')
  `);
  return new Set(rows.map(row => row.TABLE_NAME)).size === 5;
}

async function loadCentre() {
  const [batches] = await db.query(`
    SELECT b.id,b.original_filename,b.file_hash,b.status,b.total_rows,b.valid_rows,b.duplicate_rows,b.exception_rows,
      b.created_at,b.confirmed_at,u.full_name imported_by_name,
      COUNT(m.id) reconciled_rows,
      COALESCE(SUM(m.classification='exact_match'),0) exact_matches,
      COALESCE(SUM(m.classification='possible_match'),0) possible_matches,
      COALESCE(SUM(m.classification='new_record'),0) new_records,
      COALESCE(SUM(m.classification='conflict'),0) conflicts,
      COALESCE(SUM(a.action_type='stage_base_existing_client'),0) existing_client,
      COALESCE(SUM(a.action_type='stage_base_existing_history'),0) existing_history,
      COALESCE(SUM(a.action_type='stage_base_new_service_existing_account'),0) new_service_existing_account,
      COALESCE(SUM(a.action_type='stage_base_new_service_new_account'),0) new_service_new_account,
      COALESCE(SUM(a.action_type='stage_base_account_alias_review'),0) account_alias_review,
      COALESCE(SUM(a.action_type='stage_base_account_conflict'),0) account_conflicts,
      (SELECT COUNT(*) FROM mobile_base_snapshots s WHERE s.batch_id=b.id) snapshot_rows
    FROM monthly_import_batches b
    LEFT JOIN staff_users u ON u.id=b.imported_by
    LEFT JOIN monthly_import_rows r ON r.batch_id=b.id AND r.import_status='confirmed'
    LEFT JOIN monthly_import_matches m ON m.import_row_id=r.id
    LEFT JOIN monthly_import_actions a ON a.import_row_id=r.id
    WHERE b.import_type='base_details' AND b.source_system='VODACOM_BASE'
    GROUP BY b.id
    ORDER BY b.created_at DESC,b.id DESC
  `);

  const [conflicts] = await db.query(`
    SELECT b.id batch_id,b.original_filename,r.source_row_number,r.phone_normalised,r.account_number,r.customer_name,
      m.classification,m.match_reason,m.candidate_json,a.action_type
    FROM monthly_import_batches b
    JOIN monthly_import_rows r ON r.batch_id=b.id
    JOIN monthly_import_matches m ON m.import_row_id=r.id
    JOIN monthly_import_actions a ON a.import_row_id=r.id
    WHERE b.import_type='base_details' AND b.source_system='VODACOM_BASE'
      AND a.action_type IN ('stage_base_account_conflict','stage_base_account_alias_review','stage_base_invalid_identity')
    ORDER BY b.created_at DESC,b.id DESC,r.source_row_number
    LIMIT 250
  `);
  return { batches, conflicts };
}

router.get('/backoffice/base-details', requireAuth, requireRole('owner','manager','admin'), async (req, res, next) => {
  try {
    const ready = await schemaReady();
    const data = ready ? await loadCentre() : { batches: [], conflicts: [] };
    return res.render('base-details-centre', {
      title: 'Base Details Centre', schemaReady: ready,
      batches: data.batches, conflicts: data.conflicts,
      notice: String(req.query.notice || '').slice(0, 500),
      error: String(req.query.error || '').slice(0, 700)
    });
  } catch (error) { next(error); }
});

router.post('/backoffice/base-details/:id/reconcile', requireAuth, requireRole('owner','manager'), async (req, res, next) => {
  try {
    if (!await schemaReady()) throw new Error('Apply the reviewed Base Details foundation SQL before reconciling.');
    const summary = await runMatching({ batchId: req.params.id });
    await audit(req, {
      actionType: 'base_details_reconciliation_run', entityType: 'monthly_import_batches', entityId: Number(req.params.id),
      description: `Base Details reconciliation analysed ${summary.total} confirmed rows without changing customer records.`,
      after: summary
    });
    return res.redirect(`${res.locals.basePath}/backoffice/base-details?notice=${encodeURIComponent(
      `Reconciliation complete: ${summary.total} rows; ${summary.exact_match} exact, ${summary.possible_match} possible/history, ${summary.new_record} new service stages, ${summary.conflict} conflicts.`
    )}`);
  } catch (error) {
    return res.redirect(`${res.locals.basePath}/backoffice/base-details?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/backoffice/base-details/:id/stage', requireAuth, requireRole('owner','manager'), async (req, res, next) => {
  try {
    if (!await schemaReady()) throw new Error('Apply the reviewed Base Details foundation SQL before staging.');
    const summary = await stageBaseDetailsBatch({ batchId: req.params.id, userId: req.session.user.id });
    return res.redirect(`${res.locals.basePath}/backoffice/base-details?notice=${encodeURIComponent(
      `Base Details staged safely: ${summary.total} current service rows and source snapshots. CRM customers/accounts were not created, merged, overwritten or deleted.`
    )}`);
  } catch (error) {
    return res.redirect(`${res.locals.basePath}/backoffice/base-details?error=${encodeURIComponent(error.message)}`);
  }
});

module.exports = router;
