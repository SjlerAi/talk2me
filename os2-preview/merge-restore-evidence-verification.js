'use strict';

const mysql = require('mysql2/promise');

async function main() {
  const database = String(process.env.DB_NAME || '');
  if (database !== 'kloka_talk2me') throw new Error('REFUSING_NON_PREVIEW_DATABASE');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database,
    connectionLimit: 2,
    namedPlaceholders: true,
    charset: 'utf8mb4'
  });

  try {
    const [rows] = await pool.execute(`
      SELECT
        a.id,
        a.status,
        a.backup_run_id,
        a.restore_test_id,
        a.authorised_at,
        b.status AS backup_status,
        b.backup_type,
        b.database_name,
        b.completed_at AS backup_completed_at,
        b.verified_at AS backup_verified_at,
        b.storage_path,
        b.file_name,
        b.checksum_sha256,
        rt.status AS restore_status,
        rt.backup_run_id AS restore_backup_run_id,
        rt.target_environment,
        rt.expected_database_name,
        rt.actual_database_name,
        rt.failed_checks,
        rt.completed_at AS restore_completed_at
      FROM os2_customer_merge_execution_authorisations a
      LEFT JOIN os2_backup_runs b ON b.id = a.backup_run_id
      LEFT JOIN os2_restore_tests rt ON rt.id = a.restore_test_id
      WHERE
        a.restore_test_id IS NULL
        OR b.id IS NULL
        OR rt.id IS NULL
        OR rt.backup_run_id <> a.backup_run_id
        OR b.status <> 'verified'
        OR b.backup_type NOT IN ('database','full')
        OR b.database_name <> 'kloka_talk2me'
        OR b.completed_at IS NULL
        OR b.verified_at IS NULL
        OR b.storage_path IS NULL
        OR b.file_name IS NULL
        OR b.checksum_sha256 IS NULL
        OR b.checksum_sha256 NOT REGEXP '^[0-9a-fA-F]{64}$'
        OR rt.status <> 'passed'
        OR rt.completed_at IS NULL
        OR rt.target_environment <> 'isolated_preview_restore'
        OR rt.expected_database_name <> 'kloka_talk2me'
        OR rt.actual_database_name <> 'kloka_talk2me'
        OR COALESCE(rt.failed_checks, 0) <> 0
        OR (a.authorised_at IS NOT NULL AND rt.completed_at > a.authorised_at)
      ORDER BY a.id
      LIMIT 100
    `);

    if (rows.length) {
      const ids = rows.map(row => row.id).join(', ');
      throw new Error(`INVALID_PINNED_RESTORE_EVIDENCE:${ids}`);
    }

    console.log(JSON.stringify({
      ok: true,
      check: 'merge-restore-evidence-verification',
      database,
      invalidAuthorisations: 0
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`MERGE RESTORE EVIDENCE VERIFICATION FAILED: ${error.message}`);
  process.exit(1);
});
