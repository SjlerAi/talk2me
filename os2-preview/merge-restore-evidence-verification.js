'use strict';

const mysql = require('mysql2/promise');

const PREVIEW_DATABASE = 'kloka_talk2me';
const CONNECTION_TIMEOUT_MS = 10000;
const MAX_INVALID_ROWS = 100;

function required(name, maxLength = 255) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > maxLength || /[\u0000\r\n]/.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}
function validDate(value) { return value instanceof Date && Number.isFinite(value.getTime()); }

async function main() {
  const database = required('DB_NAME', 64);
  if (database !== PREVIEW_DATABASE) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  const host = required('DB_HOST', 255);
  const user = required('DB_USER', 128);
  const port = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_DB_PORT');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');

  const pool = mysql.createPool({
    host, port, user, password: process.env.DB_PASSWORD || '', database,
    connectionLimit: 2, connectTimeout: CONNECTION_TIMEOUT_MS, waitForConnections: true,
    queueLimit: 0, enableKeepAlive: false, namedPlaceholders: false,
    charset: 'utf8mb4', dateStrings: false
  });

  try {
    const [identityRows] = await pool.execute('SELECT DATABASE() AS database_name, @@session.autocommit AS autocommit_value');
    const identity = identityRows[0] || {};
    if (identity.database_name !== PREVIEW_DATABASE) throw new Error('DATABASE_IDENTITY_MISMATCH');
    if (Number(identity.autocommit_value) !== 1) throw new Error('AUTOCOMMIT_REQUIRED');
    await pool.query("SET SESSION time_zone = '+00:00'");
    const [timezoneRows] = await pool.execute('SELECT @@session.time_zone AS time_zone_value');
    if (!timezoneRows[0] || timezoneRows[0].time_zone_value !== '+00:00') throw new Error('UTC_SESSION_REQUIRED');

    const [rows] = await pool.execute(`
      SELECT
        a.id,a.status,a.backup_run_id,a.restore_test_id,a.requested_at,a.authorised_at,a.expires_at,a.revoked_at,a.consumed_at,
        b.status AS backup_status,b.backup_type,b.database_name,b.started_at AS backup_started_at,
        b.completed_at AS backup_completed_at,b.verified_at AS backup_verified_at,b.storage_path,b.file_name,
        b.checksum_sha256,b.file_size_bytes,b.table_count,b.row_count_estimate,b.failure_reason AS backup_failure_reason,
        rt.status AS restore_status,rt.backup_run_id AS restore_backup_run_id,rt.target_environment,
        rt.expected_database_name,rt.actual_database_name,rt.table_count AS restore_table_count,
        rt.verified_checks,rt.failed_checks,rt.evidence_json,rt.failure_reason AS restore_failure_reason,
        rt.started_at AS restore_started_at,rt.completed_at AS restore_completed_at,rt.reviewed_by
      FROM os2_customer_merge_execution_authorisations a
      LEFT JOIN os2_backup_runs b ON b.id=a.backup_run_id
      LEFT JOIN os2_restore_tests rt ON rt.id=a.restore_test_id
      WHERE a.restore_test_id IS NOT NULL OR a.backup_run_id IS NOT NULL
      ORDER BY a.id ASC
      LIMIT ?
    `, [MAX_INVALID_ROWS]);

    const invalid = [];
    for (const row of rows) {
      const reasons = [];
      if (!Number.isInteger(Number(row.backup_run_id)) || Number(row.backup_run_id) <= 0) reasons.push('backup_missing');
      if (!Number.isInteger(Number(row.restore_test_id)) || Number(row.restore_test_id) <= 0) reasons.push('restore_missing');
      if (Number(row.restore_backup_run_id) !== Number(row.backup_run_id)) reasons.push('restore_backup_mismatch');
      if (row.backup_status !== 'verified') reasons.push('backup_not_verified');
      if (!['database','full'].includes(row.backup_type)) reasons.push('backup_type_invalid');
      if (row.database_name !== PREVIEW_DATABASE) reasons.push('backup_database_invalid');
      if (!validDate(row.backup_started_at) || !validDate(row.backup_completed_at) || !validDate(row.backup_verified_at)) reasons.push('backup_timestamps_invalid');
      if (validDate(row.backup_started_at) && validDate(row.backup_completed_at) && row.backup_completed_at < row.backup_started_at) reasons.push('backup_time_order_invalid');
      if (validDate(row.backup_completed_at) && validDate(row.backup_verified_at) && row.backup_verified_at < row.backup_completed_at) reasons.push('backup_verification_order_invalid');
      if (typeof row.storage_path !== 'string' || !row.storage_path.trim() || row.storage_path.length > 1024) reasons.push('backup_storage_path_invalid');
      if (typeof row.file_name !== 'string' || !row.file_name.trim() || row.file_name.length > 255 || /[\\/\u0000\r\n]/.test(row.file_name)) reasons.push('backup_file_name_invalid');
      if (!/^[0-9a-f]{64}$/.test(String(row.checksum_sha256 || ''))) reasons.push('backup_checksum_invalid');
      if (!Number.isInteger(Number(row.file_size_bytes)) || Number(row.file_size_bytes) <= 0) reasons.push('backup_file_size_invalid');
      if (!Number.isInteger(Number(row.table_count)) || Number(row.table_count) < 50) reasons.push('backup_table_count_invalid');
      if (!Number.isInteger(Number(row.row_count_estimate)) || Number(row.row_count_estimate) < 0) reasons.push('backup_row_count_invalid');
      if (row.backup_failure_reason !== null && String(row.backup_failure_reason).trim()) reasons.push('backup_failure_reason_present');
      if (row.restore_status !== 'passed') reasons.push('restore_not_passed');
      if (row.target_environment !== 'isolated_preview_restore') reasons.push('restore_target_invalid');
      if (row.expected_database_name !== PREVIEW_DATABASE || row.actual_database_name !== PREVIEW_DATABASE) reasons.push('restore_database_invalid');
      if (!validDate(row.restore_started_at) || !validDate(row.restore_completed_at)) reasons.push('restore_timestamps_invalid');
      if (validDate(row.restore_started_at) && validDate(row.restore_completed_at) && row.restore_completed_at < row.restore_started_at) reasons.push('restore_time_order_invalid');
      if (validDate(row.backup_verified_at) && validDate(row.restore_started_at) && row.restore_started_at < row.backup_verified_at) reasons.push('restore_before_backup_verification');
      if (!Number.isInteger(Number(row.restore_table_count)) || Number(row.restore_table_count) < 50) reasons.push('restore_table_count_invalid');
      if (Number(row.restore_table_count) !== Number(row.table_count)) reasons.push('restore_table_count_mismatch');
      if (!Number.isInteger(Number(row.verified_checks)) || Number(row.verified_checks) <= 0) reasons.push('verified_checks_invalid');
      if (!Number.isInteger(Number(row.failed_checks)) || Number(row.failed_checks) !== 0) reasons.push('failed_checks_present');
      if (row.evidence_json === null || typeof row.evidence_json !== 'object') reasons.push('restore_evidence_json_missing');
      if (row.restore_failure_reason !== null && String(row.restore_failure_reason).trim()) reasons.push('restore_failure_reason_present');
      if (!Number.isInteger(Number(row.reviewed_by)) || Number(row.reviewed_by) <= 0) reasons.push('restore_reviewer_missing');
      if (row.status === 'authorised') {
        if (!validDate(row.authorised_at) || !validDate(row.expires_at)) reasons.push('authorisation_timestamps_invalid');
        if (validDate(row.restore_completed_at) && validDate(row.authorised_at) && row.restore_completed_at > row.authorised_at) reasons.push('restore_after_authorisation');
        if (validDate(row.authorised_at) && validDate(row.expires_at) && row.expires_at <= row.authorised_at) reasons.push('authorisation_expiry_invalid');
        if (row.revoked_at !== null || row.consumed_at !== null) reasons.push('authorisation_not_pristine');
      }
      if (reasons.length) invalid.push({ id: row.id, reasons });
    }

    if (invalid.length) throw new Error(`INVALID_PINNED_RESTORE_EVIDENCE:${JSON.stringify(invalid)}`);

    const [missingRows] = await pool.execute(`
      SELECT id FROM os2_customer_merge_execution_authorisations
      WHERE status='authorised' AND (backup_run_id IS NULL OR restore_test_id IS NULL)
      ORDER BY id ASC LIMIT ?
    `, [MAX_INVALID_ROWS]);
    if (missingRows.length) throw new Error(`AUTHORISED_WITHOUT_PINNED_RESTORE:${missingRows.map(row => row.id).join(',')}`);

    console.log(JSON.stringify({
      ok: true,
      check: 'merge-restore-evidence-verification',
      database,
      databaseIdentityVerified: true,
      autocommitVerified: true,
      utcSessionVerified: true,
      inspectedPinnedAuthorisations: rows.length,
      invalidAuthorisations: 0,
      authorisedWithoutPinnedRestore: 0,
      backupIdentityVerified: true,
      backupChecksumPolicyVerified: true,
      backupTimestampsVerified: true,
      backupInventoryCountsVerified: true,
      restoreIdentityVerified: true,
      restoreTimestampsVerified: true,
      restoreEvidenceJsonRequired: true,
      restoreReviewerRequired: true,
      authorisationOrderingVerified: true,
      productionMutationEnabled: false,
      mergeExecutionEnabled: false
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`MERGE RESTORE EVIDENCE VERIFICATION FAILED: ${error.message}`);
  process.exit(1);
});
