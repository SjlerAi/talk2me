'use strict';

const mysql = require('mysql2/promise');

const PREVIEW_DATABASE = 'kloka_talk2me';
const EXPECTED_MIGRATION_COUNT = 25;
const CONNECTION_TIMEOUT_MS = 10000;
const QUERY_LIMIT = 20;

const REQUIRED_TABLES = [
  'os2_master_customers','os2_customer_lifecycle_history','os2_customer_duplicate_cases','os2_customer_duplicate_history',
  'os2_customer_merge_plans','os2_customer_merge_plan_history','os2_customer_merge_execution_authorisations',
  'os2_customer_merge_execution_authorisation_history','os2_customer_accounts','os2_account_history','os2_mobile_lines',
  'os2_fixed_accounts','os2_fixed_services','os2_customer_ownership','os2_customer_access_grants','os2_customer_access_history',
  'os2_customer_access_events','os2_customer_restrictions','os2_restriction_history','os2_authorised_representatives',
  'os2_representative_history','os2_customer_documents','os2_work_items','os2_work_item_history','os2_approval_requests',
  'os2_approval_consumption_history','os2_audit_log','os2_import_batches','os2_import_rows','os2_opportunities',
  'os2_attendance_corrections','os2_notifications','os2_email_queue','os2_broadcasts','os2_digest_runs','os2_calendar_events',
  'os2_customer_claims','os2_sticky_notes','os2_sticky_note_shares','os2_service_change_history','os2_security_events',
  'os2_login_attempts','os2_customer_consents','os2_data_subject_requests','os2_data_exports','os2_retention_policies',
  'os2_retention_reviews','os2_export_access_log','os2_backup_runs','os2_restore_tests','os2_operational_checks','os2_schema_migrations'
];

const REQUIRED_COLUMNS = {
  os2_master_customers:['id','display_name','primary_mobile','primary_email','status','archived_at','archive_reason','archived_by','reactivated_at','reactivated_by'],
  os2_customer_lifecycle_history:['id','master_customer_id','event_type','reason','before_json','after_json','changed_by','created_at'],
  os2_customer_duplicate_cases:['id','primary_customer_id','candidate_customer_id','match_basis','match_score','evidence_json','status','proposed_survivor_customer_id','created_by','reviewed_by','reviewed_at'],
  os2_customer_duplicate_history:['id','duplicate_case_id','event_type','from_status','to_status','reason','changed_by','created_at'],
  os2_customer_merge_plans:['id','duplicate_case_id','survivor_customer_id','source_customer_id','status','plan_json','plan_hash','blocker_count','conflict_count','prepared_by','approved_by','approved_at','current_snapshot_hash','revalidated_at','invalidated_at','executed_at'],
  os2_customer_merge_plan_history:['id','merge_plan_id','event_type','from_status','to_status','reason','changed_by','created_at'],
  os2_customer_merge_execution_authorisations:['id','merge_plan_id','plan_hash','snapshot_hash','backup_run_id','restore_test_id','change_reference','status','requested_by','requested_at','authorised_by','authorised_at','expires_at','revoked_by','revoked_at','revocation_reason','consumed_at','consumed_by'],
  os2_customer_merge_execution_authorisation_history:['id','authorisation_id','event_type','from_status','to_status','reason','details_json','changed_by','created_at'],
  os2_customer_accounts:['id','master_customer_id','account_number','normalised_account_number','account_status','is_primary','archived_at','archive_reason','archived_by'],
  os2_account_history:['id','account_id','master_customer_id','event_type','reason','changed_by','created_at'],
  os2_customer_ownership:['id','master_customer_id','assigned_staff_id','is_current','access_scope','access_expires_at'],
  os2_customer_access_grants:['id','master_customer_id','staff_id','access_level','reason','granted_by','granted_at','expires_at','revoked_at','revoked_by','revoke_reason'],
  os2_customer_access_history:['id','master_customer_id','staff_id','event_type','access_level','reason','changed_by','created_at'],
  os2_customer_access_events:['id','staff_id','master_customer_id','event_type','access_source','access_level','query_text','result_count','request_id','ip_address','details_json','created_at'],
  os2_authorised_representatives:['id','master_customer_id','full_name','relationship_type','mobile','email','permissions_json','verification_method','evidence_document_id','expires_at','status','revoked_at','revoked_by','revoke_reason','created_by','updated_by','created_at','updated_at'],
  os2_representative_history:['id','representative_id','master_customer_id','event_type','reason','before_json','after_json','changed_by','created_at'],
  os2_mobile_lines:['id','master_customer_id','mobile_number','contract_months','next_upgrade_date','line_status','cancellation_date','cancellation_reason','archived_at'],
  os2_fixed_services:['id','fixed_account_id','service_name','mac_address','solution_id','order_number','service_status','cancellation_date','cancellation_reason','archived_at'],
  os2_work_items:['id','work_type','title','lifecycle_state','assigned_staff_id','master_customer_id','due_at','archived_at'],
  os2_customer_restrictions:['id','restriction_type','restriction_value','restriction_numeric_value','is_active','revoked_at','revoked_by','revoke_reason'],
  os2_restriction_history:['id','restriction_id','master_customer_id','event_type','changed_by','created_at'],
  os2_approval_requests:['id','request_type','action_key','master_customer_id','request_payload','payload_hash','integrity_version','invalidated_at','invalidated_by','invalidation_reason','status','consumed_at','consumed_by','consumed_for_entity_type','consumed_for_entity_id'],
  os2_approval_consumption_history:['id','approval_request_id','action_key','payload_hash','consumed_by','consumed_at'],
  os2_email_queue:['id','recipient_email','status','attempts','next_attempt_at','worker_id','smtp_message_id'],
  os2_customer_claims:['id','master_customer_id','requested_owner_staff_id','status','reviewed_by'],
  os2_security_events:['id','event_type','severity','staff_id','request_id','ip_address','details_json','created_at'],
  os2_login_attempts:['id','identity_hash','ip_address','was_successful','attempted_at'],
  os2_data_exports:['id','master_customer_id','data_subject_request_id','export_format','status','worker_id','claimed_at','attempts','storage_path','sha256_checksum','row_count','file_count','total_bytes','generated_at','expires_at'],
  os2_export_access_log:['id','data_export_id','accessed_by','access_type','request_id','ip_address','user_agent','details_json','created_at'],
  os2_backup_runs:['id','backup_type','status','database_name','storage_path','file_name','checksum_sha256','file_size_bytes','table_count','row_count_estimate','verified_at'],
  os2_restore_tests:['id','backup_run_id','status','target_environment','expected_database_name','verified_checks','failed_checks'],
  os2_operational_checks:['id','check_type','status','metric_value','metric_unit','details_json','checked_at'],
  os2_schema_migrations:['id','migration_name','checksum_sha256','executed_at','executed_by','execution_ms'],
  app_sessions:['session_id','expires_at','last_seen_at','ip_address','user_agent','revoked_at','revoked_reason']
};

function required(name, maxLength = 255) {
  const value = String(process.env[name] || '').trim();
  if (!value || value.length > maxLength || /[\u0000\r\n]/.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}
function assertZero(rows, label, formatter = row => row.id) {
  if (rows.length) throw new Error(`${label}:${rows.map(formatter).join(',')}`);
}
function assertLowerHex(value, label) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ''))) throw new Error(label);
}

async function main() {
  const dbName = required('DB_NAME', 64);
  if (dbName !== PREVIEW_DATABASE) throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  const host = required('DB_HOST', 255);
  const user = required('DB_USER', 128);
  const port = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_DB_PORT');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') throw new Error('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') throw new Error('MERGE_EXECUTION_FLAG_PROHIBITED');

  const pool = mysql.createPool({
    host, port, user, password: process.env.DB_PASSWORD || '', database: dbName,
    connectionLimit: 2, connectTimeout: CONNECTION_TIMEOUT_MS, waitForConnections: true,
    queueLimit: 0, enableKeepAlive: false, namedPlaceholders: false, charset: 'utf8mb4', dateStrings: false
  });

  try {
    const [identityRows] = await pool.execute('SELECT DATABASE() AS database_name, @@session.autocommit AS autocommit_value');
    const identity = identityRows[0] || {};
    if (identity.database_name !== PREVIEW_DATABASE) throw new Error('DATABASE_IDENTITY_MISMATCH');
    if (Number(identity.autocommit_value) !== 1) throw new Error('AUTOCOMMIT_REQUIRED');
    await pool.query("SET SESSION time_zone = '+00:00'");
    const [timezoneRows] = await pool.execute('SELECT @@session.time_zone AS time_zone_value');
    if (!timezoneRows[0] || timezoneRows[0].time_zone_value !== '+00:00') throw new Error('UTC_SESSION_REQUIRED');

    const [tables] = await pool.execute('SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [dbName]);
    const tableMap = new Map(tables.map(row => [row.TABLE_NAME, row]));
    const missingTables = REQUIRED_TABLES.filter(table => !tableMap.has(table));
    if (missingTables.length) throw new Error(`MISSING_TABLES:${missingTables.join(',')}`);
    for (const table of REQUIRED_TABLES) {
      const row = tableMap.get(table);
      if (String(row.ENGINE || '').toUpperCase() !== 'INNODB') throw new Error(`INVALID_TABLE_ENGINE:${table}`);
      if (row.TABLE_COLLATION !== 'utf8mb4_unicode_ci') throw new Error(`INVALID_TABLE_COLLATION:${table}`);
    }

    for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
      const [columns] = await pool.execute('SELECT COLUMN_NAME,ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [dbName, table]);
      const names = columns.map(row => row.COLUMN_NAME);
      const missing = requiredColumns.filter(column => !names.includes(column));
      if (missing.length) throw new Error(`MISSING_COLUMNS:${table}:${missing.join(',')}`);
      if (new Set(names).size !== names.length) throw new Error(`DUPLICATE_COLUMN_METADATA:${table}`);
    }

    const [ledgerRows] = await pool.execute('SELECT id,migration_name,checksum_sha256,executed_at,executed_by,execution_ms FROM os2_schema_migrations ORDER BY id ASC');
    if (ledgerRows.length !== EXPECTED_MIGRATION_COUNT) throw new Error(`MIGRATION_COUNT_MISMATCH:${ledgerRows.length}`);
    let previousId = 0;
    const seenNames = new Set();
    for (let index = 0; index < ledgerRows.length; index += 1) {
      const row = ledgerRows[index];
      const expectedSequence = String(index + 1).padStart(3, '0');
      const expectedPrefix = `20260801_${expectedSequence}_`;
      if (!Number.isInteger(Number(row.id)) || Number(row.id) <= previousId) throw new Error(`MIGRATION_LEDGER_ID_INVALID:${index}`);
      previousId = Number(row.id);
      if (typeof row.migration_name !== 'string' || !row.migration_name.startsWith(expectedPrefix) || !row.migration_name.endsWith('.sql')) throw new Error(`MIGRATION_NAME_SEQUENCE_INVALID:${row.migration_name}`);
      if (seenNames.has(row.migration_name)) throw new Error(`DUPLICATE_MIGRATION_NAME:${row.migration_name}`);
      seenNames.add(row.migration_name);
      assertLowerHex(row.checksum_sha256, `MIGRATION_CHECKSUM_INVALID:${row.migration_name}`);
      if (!(row.executed_at instanceof Date) || !Number.isFinite(row.executed_at.getTime())) throw new Error(`MIGRATION_EXECUTED_AT_INVALID:${row.migration_name}`);
      if (row.executed_by !== null && (typeof row.executed_by !== 'string' || !row.executed_by.trim() || row.executed_by.length > 190)) throw new Error(`MIGRATION_EXECUTED_BY_INVALID:${row.migration_name}`);
      if (!Number.isInteger(Number(row.execution_ms)) || Number(row.execution_ms) < 0) throw new Error(`MIGRATION_EXECUTION_MS_INVALID:${row.migration_name}`);
    }
    if (!seenNames.has('20260801_025_merge_authorisation_restore_pin.sql')) throw new Error('RESTORE_PIN_MIGRATION_NOT_APPLIED');

    const checks = [
      ['DUPLICATE_ACTIVE_ACCOUNT_NUMBERS', 'SELECT normalised_account_number AS value FROM os2_customer_accounts WHERE archived_at IS NULL AND normalised_account_number IS NOT NULL GROUP BY normalised_account_number HAVING COUNT(*)>1 LIMIT ?', row => row.value],
      ['MULTIPLE_PRIMARY_ACCOUNTS', 'SELECT master_customer_id AS value FROM os2_customer_accounts WHERE archived_at IS NULL AND is_primary=1 GROUP BY master_customer_id HAVING COUNT(*)>1 LIMIT ?', row => row.value],
      ['DUPLICATE_ACTIVE_MOBILES', 'SELECT mobile_number AS value FROM os2_mobile_lines WHERE archived_at IS NULL AND mobile_number IS NOT NULL GROUP BY mobile_number HAVING COUNT(*)>1 LIMIT ?', row => row.value],
      ['DUPLICATE_ACTIVE_ACCESS_GRANTS', 'SELECT CONCAT(master_customer_id,\':\',staff_id) AS value FROM os2_customer_access_grants WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP()) GROUP BY master_customer_id,staff_id HAVING COUNT(*)>1 LIMIT ?', row => row.value],
      ['ARCHIVED_CUSTOMERS_WITH_ACTIVE_OWNERSHIP', 'SELECT mc.id AS value FROM os2_master_customers mc JOIN os2_customer_ownership o ON o.master_customer_id=mc.id AND o.is_current=1 WHERE mc.archived_at IS NOT NULL LIMIT ?', row => row.value],
      ['INVALID_DUPLICATE_PAIRS', 'SELECT id AS value FROM os2_customer_duplicate_cases WHERE primary_customer_id>=candidate_customer_id LIMIT ?', row => row.value],
      ['INVALID_MERGE_PLANS', "SELECT id AS value FROM os2_customer_merge_plans WHERE survivor_customer_id=source_customer_id OR plan_hash NOT REGEXP '^[0-9a-f]{64}$' OR executed_at IS NOT NULL LIMIT ?", row => row.value],
      ['INVALID_MERGE_AUTHORISATIONS', "SELECT id AS value FROM os2_customer_merge_execution_authorisations WHERE plan_hash NOT REGEXP '^[0-9a-f]{64}$' OR snapshot_hash NOT REGEXP '^[0-9a-f]{64}$' OR restore_test_id IS NULL OR (status='authorised' AND (authorised_at IS NULL OR expires_at IS NULL)) OR consumed_at IS NOT NULL LIMIT ?", row => row.value],
      ['INVALID_REPRESENTATIVE_PERMISSIONS', 'SELECT id AS value FROM os2_authorised_representatives WHERE JSON_VALID(permissions_json)=0 LIMIT ?', row => row.value],
      ['EXPIRED_ACTIVE_REPRESENTATIVES', "SELECT id AS value FROM os2_authorised_representatives WHERE status='active' AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at<=UTC_TIMESTAMP() LIMIT ?", row => row.value],
      ['UNSAFE_OPEN_APPROVALS', "SELECT id AS value FROM os2_approval_requests WHERE consumed_at IS NULL AND status IN ('pending','deferred','approved') AND (integrity_version<>2 OR invalidated_at IS NOT NULL OR payload_hash IS NULL OR payload_hash NOT REGEXP '^[0-9a-f]{64}$') LIMIT ?", row => row.value],
      ['INVALIDATED_APPROVALS_STILL_OPEN', "SELECT id AS value FROM os2_approval_requests WHERE invalidated_at IS NOT NULL AND status IN ('pending','deferred','approved') LIMIT ?", row => row.value],
      ['ORPHAN_ACCOUNTS', 'SELECT a.id AS value FROM os2_customer_accounts a LEFT JOIN os2_master_customers c ON c.id=a.master_customer_id WHERE c.id IS NULL LIMIT ?', row => row.value],
      ['ORPHAN_MOBILE_LINES', 'SELECT m.id AS value FROM os2_mobile_lines m LEFT JOIN os2_master_customers c ON c.id=m.master_customer_id WHERE c.id IS NULL LIMIT ?', row => row.value],
      ['ORPHAN_WORK_ITEMS', 'SELECT w.id AS value FROM os2_work_items w LEFT JOIN os2_master_customers c ON c.id=w.master_customer_id WHERE w.master_customer_id IS NOT NULL AND c.id IS NULL LIMIT ?', row => row.value],
      ['NEGATIVE_IMPORT_COUNTS', 'SELECT id AS value FROM os2_import_batches WHERE COALESCE(total_rows,0)<0 OR COALESCE(processed_rows,0)<0 OR COALESCE(failed_rows,0)<0 LIMIT ?', row => row.value],
      ['INVALID_EXPORT_CHECKSUMS', "SELECT id AS value FROM os2_data_exports WHERE sha256_checksum IS NOT NULL AND sha256_checksum NOT REGEXP '^[0-9a-f]{64}$' LIMIT ?", row => row.value],
      ['VERIFIED_BACKUPS_WITHOUT_CHECKSUM', "SELECT id AS value FROM os2_backup_runs WHERE status='verified' AND (checksum_sha256 IS NULL OR checksum_sha256 NOT REGEXP '^[0-9a-f]{64}$' OR verified_at IS NULL) LIMIT ?", row => row.value]
    ];

    const zeroDefectChecks = {};
    for (const [label, sql, formatter] of checks) {
      const [rows] = await pool.execute(sql, [QUERY_LIMIT]);
      assertZero(rows, label, formatter);
      zeroDefectChecks[label] = 0;
    }

    console.log(JSON.stringify({
      ok: true,
      check: 'schema-verification',
      database: dbName,
      databaseIdentityVerified: true,
      autocommitVerified: true,
      utcSessionVerified: true,
      requiredTables: REQUIRED_TABLES.length,
      verifiedColumnGroups: Object.keys(REQUIRED_COLUMNS).length,
      tableEnginesVerified: REQUIRED_TABLES.length,
      tableCollationsVerified: REQUIRED_TABLES.length,
      appliedMigrations: ledgerRows.length,
      exactMigrationCountVerified: true,
      migrationLedgerColumnNamesCorrected: true,
      restorePinMigrationApplied: true,
      migrationLedgerSequenceVerified: true,
      migrationLedgerChecksumsVerified: true,
      migrationExecutionMetadataVerified: true,
      zeroDefectChecks,
      zeroDefectCheckCount: Object.keys(zeroDefectChecks).length,
      productionMutationEnabled: false,
      mergeExecutionEnabled: false
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`SCHEMA VERIFICATION FAILED: ${error.message}`);
  process.exit(1);
});
