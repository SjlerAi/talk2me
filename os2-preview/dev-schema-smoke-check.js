'use strict';

const mysql = require('mysql2/promise');

const EXPECTED_DATABASE = 'kloka_talk2me';

const requiredSchema = {
  staff_users: ['id','full_name','username','email','role','password_hash','is_active'],
  app_sessions: ['session_id','session_data','expires_at','revoked_at','last_seen_at'],
  os2_login_attempts: ['identity_hash','ip_address','was_successful','attempted_at'],
  os2_master_customers: ['id','customer_type','display_name','responsible_person','primary_mobile','primary_email','town','status','archived_at'],
  os2_customer_accounts: ['id','master_customer_id','account_number','normalised_account_number','expected_line_count','archived_at'],
  os2_mobile_lines: ['id','master_customer_id','account_id','mobile_number','next_upgrade_date','line_status','archived_at'],
  os2_fixed_accounts: ['id','master_customer_id','account_id','fixed_account_number','archived_at'],
  os2_fixed_services: ['id','fixed_account_id','service_name','service_status','archived_at'],
  os2_customer_ownership: ['id','master_customer_id','assigned_staff_id','is_current','effective_from'],
  os2_customer_access_grants: ['id','master_customer_id','staff_id','revoked_at','expires_at'],
  os2_work_items: ['id','work_type','title','lifecycle_state','created_by','owner_staff_id','assigned_staff_id','master_customer_id','start_at','due_at','archived_at'],
  os2_work_item_history: ['id','work_item_id','from_state','to_state','changed_by','created_at'],
  os2_approval_requests: ['id','request_type','master_customer_id','request_payload','status','requested_by'],
  os2_audit_log: ['id','actor_staff_id','action_type','entity_type','entity_id','master_customer_id','description','created_at'],
  os2_customer_documents: ['id','master_customer_id','document_type','original_filename','storage_key','archived_at'],
  os2_customer_restrictions: ['id','master_customer_id','restriction_type','is_active'],
  os2_authorised_representatives: ['id','master_customer_id','full_name','revoked_at']
};

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

async function run() {
  const connection = await mysql.createConnection({
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME'),
    charset: 'utf8mb4',
    connectTimeout: 10000
  });

  try {
    const [[identity]] = await connection.query('SELECT DATABASE() AS database_name');
    if (!identity || identity.database_name !== EXPECTED_DATABASE) {
      throw new Error(`WRONG_DATABASE:${identity ? identity.database_name : 'unknown'}`);
    }

    const [rows] = await connection.execute(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `, [EXPECTED_DATABASE]);

    const actual = new Map();
    for (const row of rows) {
      if (!actual.has(row.TABLE_NAME)) actual.set(row.TABLE_NAME, new Set());
      actual.get(row.TABLE_NAME).add(row.COLUMN_NAME);
    }

    const missingTables = [];
    const missingColumns = [];
    for (const [table, columns] of Object.entries(requiredSchema)) {
      if (!actual.has(table)) {
        missingTables.push(table);
        continue;
      }
      for (const column of columns) {
        if (!actual.get(table).has(column)) missingColumns.push(`${table}.${column}`);
      }
    }

    const ok = missingTables.length === 0 && missingColumns.length === 0;
    console.log(JSON.stringify({
      ok,
      database: EXPECTED_DATABASE,
      checkedTables: Object.keys(requiredSchema).length,
      missingTables,
      missingColumns
    }, null, 2));
    if (!ok) process.exitCode = 2;
  } finally {
    await connection.end();
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
