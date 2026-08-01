'use strict';

const mysql = require('mysql2/promise');

const REQUIRED_TABLES = [
  'os2_master_customers','os2_customer_accounts','os2_mobile_lines','os2_fixed_accounts','os2_fixed_services',
  'os2_customer_ownership','os2_customer_restrictions','os2_authorised_representatives','os2_customer_documents',
  'os2_work_items','os2_work_item_history','os2_approval_requests','os2_audit_log','os2_import_batches',
  'os2_import_rows','os2_opportunities','os2_attendance_corrections','os2_notifications','os2_email_queue',
  'os2_broadcasts','os2_digest_runs','os2_calendar_events','os2_customer_claims','os2_sticky_notes',
  'os2_sticky_note_shares','os2_service_change_history','os2_security_events','os2_login_attempts',
  'os2_customer_consents','os2_data_subject_requests','os2_data_exports','os2_retention_policies','os2_retention_reviews',
  'os2_schema_migrations'
];

const REQUIRED_COLUMNS = {
  os2_master_customers: ['id','display_name','primary_mobile','primary_email','status','archived_at'],
  os2_customer_accounts: ['id','master_customer_id','account_number','normalised_account_number','archived_at'],
  os2_mobile_lines: ['id','master_customer_id','mobile_number','contract_months','next_upgrade_date','archived_at'],
  os2_fixed_services: ['id','fixed_account_id','service_name','mac_address','solution_id','order_number','archived_at'],
  os2_work_items: ['id','work_type','title','lifecycle_state','assigned_staff_id','master_customer_id','due_at','archived_at'],
  os2_email_queue: ['id','recipient_email','status','attempts','next_attempt_at','worker_id','smtp_message_id'],
  os2_customer_claims: ['id','master_customer_id','requested_owner_staff_id','status','reviewed_by'],
  os2_security_events: ['id','event_type','severity','staff_id','request_id','ip_address','details_json','created_at'],
  os2_login_attempts: ['id','identity_hash','ip_address','was_successful','attempted_at'],
  os2_customer_consents: ['id','master_customer_id','consent_type','consent_status','recorded_by'],
  os2_data_subject_requests: ['id','master_customer_id','request_type','status','request_reference','due_at','reviewed_by'],
  os2_data_exports: ['id','master_customer_id','data_subject_request_id','status','content_sha256','expires_at'],
  os2_retention_policies: ['id','entity_type','retention_days','action_type','is_active'],
  os2_retention_reviews: ['id','retention_policy_id','entity_type','entity_id','status','reviewed_by'],
  app_sessions: ['session_id','expires_at','last_seen_at','ip_address','user_agent','revoked_at','revoked_reason']
};

function fail(message) {
  console.error(`SCHEMA VERIFICATION FAILED: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const dbName = String(process.env.DB_NAME || '');
  if (dbName !== 'kloka_talk2me') throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    connectionLimit: 2,
    namedPlaceholders: true,
    charset: 'utf8mb4'
  });

  try {
    const [tables] = await pool.execute(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema`, { schema: dbName });
    const tableSet = new Set(tables.map(row => row.TABLE_NAME));
    for (const table of REQUIRED_TABLES) if (!tableSet.has(table)) fail(`missing table ${table}`);

    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const [columns] = await pool.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table`, { schema: dbName, table });
      const columnSet = new Set(columns.map(row => row.COLUMN_NAME));
      for (const column of required) if (!columnSet.has(column)) fail(`missing column ${table}.${column}`);
    }

    const [migrationRows] = await pool.execute('SELECT migration_name,checksum,applied_at FROM os2_schema_migrations ORDER BY migration_name');
    if (migrationRows.length < 9) fail(`expected at least 9 applied migrations, found ${migrationRows.length}`);

    const [duplicateAccounts] = await pool.execute(`SELECT normalised_account_number,COUNT(*) total FROM os2_customer_accounts WHERE archived_at IS NULL AND normalised_account_number IS NOT NULL GROUP BY normalised_account_number HAVING COUNT(*)>1 LIMIT 20`);
    const [duplicateMobiles] = await pool.execute(`SELECT mobile_number,COUNT(*) total FROM os2_mobile_lines WHERE archived_at IS NULL AND mobile_number IS NOT NULL GROUP BY mobile_number HAVING COUNT(*)>1 LIMIT 20`);
    if (duplicateAccounts.length) fail(`duplicate active normalised account numbers detected: ${duplicateAccounts.map(x => x.normalised_account_number).join(', ')}`);
    if (duplicateMobiles.length) fail(`duplicate active mobile numbers detected: ${duplicateMobiles.map(x => x.mobile_number).join(', ')}`);

    if (!process.exitCode) {
      console.log(JSON.stringify({
        ok: true,
        database: dbName,
        requiredTables: REQUIRED_TABLES.length,
        verifiedColumnGroups: Object.keys(REQUIRED_COLUMNS).length,
        appliedMigrations: migrationRows.length,
        duplicateAccounts: 0,
        duplicateMobiles: 0
      }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`SCHEMA VERIFICATION FAILED: ${error.message}`);
  process.exit(1);
});
