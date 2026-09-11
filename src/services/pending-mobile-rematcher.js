'use strict';

const db = require('../config/db');
const { loadReferenceData, mobileResult, upsertResult } = require('./monthly-import-matcher');

async function loadPendingMobileSummary(connection = db) {
  const [[row]] = await connection.query(`
    SELECT COUNT(*) pending_rows,
      COALESCE(SUM(a.action_type='create_mobile_record'),0) pending_new_customer_proposals,
      COALESCE(SUM(a.action_type='link_existing_mobile_base'),0) base_protected,
      COALESCE(SUM(m.classification='conflict'),0) conflicts
    FROM monthly_import_rows r
    JOIN monthly_import_batches b ON b.id=r.batch_id
    JOIN monthly_import_matches m ON m.import_row_id=r.id
    JOIN monthly_import_actions a ON a.import_row_id=r.id
    WHERE b.status='confirmed'
      AND b.import_type IN ('activation','upgrade')
      AND r.import_status='confirmed'
      AND m.review_status='pending'
      AND a.approval_status='pending'
      AND a.applied_status='not_applied'
  `);
  return {
    pendingRows: Number(row?.pending_rows || 0),
    pendingNewCustomerProposals: Number(row?.pending_new_customer_proposals || 0),
    baseProtected: Number(row?.base_protected || 0),
    conflicts: Number(row?.conflicts || 0)
  };
}

async function rematchPendingMobileImports() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [[base]] = await connection.query('SELECT COUNT(*) current_lines FROM mobile_base_current');
    if (Number(base?.current_lines || 0) < 1) {
      throw new Error('Stage the current Base Details mobile base before re-matching monthly imports.');
    }

    const [rows] = await connection.query(`
      SELECT r.*,b.import_type,b.original_filename,
        m.classification previous_classification,m.review_status,
        a.action_type previous_action_type,a.approval_status,a.applied_status
      FROM monthly_import_rows r
      JOIN monthly_import_batches b ON b.id=r.batch_id
      JOIN monthly_import_matches m ON m.import_row_id=r.id
      JOIN monthly_import_actions a ON a.import_row_id=r.id
      WHERE b.status='confirmed'
        AND b.import_type IN ('activation','upgrade')
        AND r.import_status='confirmed'
        AND m.review_status='pending'
        AND a.approval_status='pending'
        AND a.applied_status='not_applied'
      ORDER BY r.batch_id,r.id
      FOR UPDATE
    `);

    const references = await loadReferenceData(connection);
    const summary = {
      total: rows.length,
      changedAction: 0,
      protectedByBase: 0,
      previousNewCustomerProposals: 0,
      exactMatch: 0,
      possibleMatch: 0,
      newRecord: 0,
      conflict: 0
    };

    for (const row of rows) {
      if (row.previous_action_type === 'create_mobile_record') summary.previousNewCustomerProposals += 1;
      const result = mobileResult(row, references);
      await upsertResult(connection, row, result);
      if (String(row.previous_action_type || '') !== String(result.actionType || '')) summary.changedAction += 1;
      if (row.previous_action_type === 'create_mobile_record' && result.actionType === 'link_existing_mobile_base') {
        summary.protectedByBase += 1;
      }
      if (result.classification === 'exact_match') summary.exactMatch += 1;
      else if (result.classification === 'possible_match') summary.possibleMatch += 1;
      else if (result.classification === 'new_record') summary.newRecord += 1;
      else if (result.classification === 'conflict') summary.conflict += 1;
    }

    await connection.commit();
    return summary;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { loadPendingMobileSummary, rematchPendingMobileImports };
