'use strict';

const mysql = require('mysql2/promise');

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
  app_sessions:['session_id','expires_at','last_seen_at','ip_address','user_agent','revoked_at','revoked_reason']
};

function fail(message) {
  console.error(`SCHEMA VERIFICATION FAILED: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const dbName = String(process.env.DB_NAME || '');
  if (dbName !== 'kloka_talk2me') throw new Error('REFUSING_NON_PREVIEW_DATABASE');
  const pool = mysql.createPool({
    host:process.env.DB_HOST, port:Number(process.env.DB_PORT || 3306), user:process.env.DB_USER,
    password:process.env.DB_PASSWORD || '', database:dbName, connectionLimit:2, namedPlaceholders:true, charset:'utf8mb4'
  });
  try {
    const [tables] = await pool.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema',{schema:dbName});
    const tableNames = new Set(tables.map(row => row.TABLE_NAME));
    for (const table of REQUIRED_TABLES) if (!tableNames.has(table)) fail(`missing table ${table}`);

    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const [columns] = await pool.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table',{schema:dbName,table});
      const names = new Set(columns.map(row => row.COLUMN_NAME));
      for (const column of required) if (!names.has(column)) fail(`missing column ${table}.${column}`);
    }

    const [migrations] = await pool.execute('SELECT migration_name,checksum,applied_at FROM os2_schema_migrations ORDER BY migration_name');
    if (migrations.length < 25) fail(`expected at least 25 applied migrations, found ${migrations.length}`);

    const [accounts] = await pool.execute('SELECT normalised_account_number,COUNT(*) total FROM os2_customer_accounts WHERE archived_at IS NULL AND normalised_account_number IS NOT NULL GROUP BY normalised_account_number HAVING COUNT(*)>1 LIMIT 20');
    const [primaryAccounts] = await pool.execute('SELECT master_customer_id,COUNT(*) total FROM os2_customer_accounts WHERE archived_at IS NULL AND is_primary=1 GROUP BY master_customer_id HAVING COUNT(*)>1 LIMIT 20');
    const [mobiles] = await pool.execute('SELECT mobile_number,COUNT(*) total FROM os2_mobile_lines WHERE archived_at IS NULL AND mobile_number IS NOT NULL GROUP BY mobile_number HAVING COUNT(*)>1 LIMIT 20');
    const [duplicateGrants] = await pool.execute("SELECT master_customer_id,staff_id,COUNT(*) total FROM os2_customer_access_grants WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW()) GROUP BY master_customer_id,staff_id HAVING COUNT(*)>1 LIMIT 20");
    const [archivedWithActiveOwnership] = await pool.execute('SELECT mc.id FROM os2_master_customers mc JOIN os2_customer_ownership o ON o.master_customer_id=mc.id AND o.is_current=1 WHERE mc.archived_at IS NOT NULL LIMIT 20');
    const [invalidDuplicatePairs] = await pool.execute('SELECT id FROM os2_customer_duplicate_cases WHERE primary_customer_id>=candidate_customer_id OR primary_customer_id=candidate_customer_id LIMIT 20');
    const [invalidMergePlans] = await pool.execute("SELECT id FROM os2_customer_merge_plans WHERE survivor_customer_id=source_customer_id OR plan_hash NOT REGEXP '^[0-9a-f]{64}$' OR executed_at IS NOT NULL LIMIT 20");
    const [invalidAuthorisations] = await pool.execute("SELECT id FROM os2_customer_merge_execution_authorisations WHERE plan_hash NOT REGEXP '^[0-9a-f]{64}$' OR snapshot_hash NOT REGEXP '^[0-9a-f]{64}$' OR restore_test_id IS NULL OR (status='authorised' AND (authorised_at IS NULL OR expires_at IS NULL)) OR consumed_at IS NOT NULL LIMIT 20");
    const [invalidRepresentativePermissions] = await pool.execute("SELECT id FROM os2_authorised_representatives WHERE JSON_VALID(permissions_json)=0 LIMIT 20");
    const [activeExpiredRepresentatives] = await pool.execute("SELECT id FROM os2_authorised_representatives WHERE status='active' AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at<=NOW() LIMIT 20");
    const [unsafeApprovals] = await pool.execute("SELECT id FROM os2_approval_requests WHERE consumed_at IS NULL AND status IN ('pending','deferred','approved') AND (integrity_version<>2 OR invalidated_at IS NOT NULL OR payload_hash IS NULL OR payload_hash NOT REGEXP '^[0-9a-f]{64}$') LIMIT 20");
    const [invalidatedApprovalsStillOpen] = await pool.execute("SELECT id FROM os2_approval_requests WHERE invalidated_at IS NOT NULL AND status IN ('pending','deferred','approved') LIMIT 20");

    if (accounts.length) fail(`duplicate active normalised account numbers detected: ${accounts.map(x=>x.normalised_account_number).join(', ')}`);
    if (primaryAccounts.length) fail(`customers with multiple primary accounts detected: ${primaryAccounts.map(x=>x.master_customer_id).join(', ')}`);
    if (mobiles.length) fail(`duplicate active mobile numbers detected: ${mobiles.map(x=>x.mobile_number).join(', ')}`);
    if (duplicateGrants.length) fail(`duplicate active customer access grants detected: ${duplicateGrants.map(x=>`${x.master_customer_id}:${x.staff_id}`).join(', ')}`);
    if (archivedWithActiveOwnership.length) fail(`archived customers with active ownership detected: ${archivedWithActiveOwnership.map(x=>x.id).join(', ')}`);
    if (invalidDuplicatePairs.length) fail(`invalid duplicate customer pair ordering detected: ${invalidDuplicatePairs.map(x=>x.id).join(', ')}`);
    if (invalidMergePlans.length) fail(`invalid or executed merge plans detected before merge execution release: ${invalidMergePlans.map(x=>x.id).join(', ')}`);
    if (invalidAuthorisations.length) fail(`invalid, unpinned or consumed merge execution authorisations detected before merge execution release: ${invalidAuthorisations.map(x=>x.id).join(', ')}`);
    if (invalidRepresentativePermissions.length) fail(`representatives with invalid permission JSON detected: ${invalidRepresentativePermissions.map(x=>x.id).join(', ')}`);
    if (activeExpiredRepresentatives.length) fail(`expired representatives still marked active: ${activeExpiredRepresentatives.map(x=>x.id).join(', ')}`);
    if (unsafeApprovals.length) fail(`open approvals without integrity version 2 and a valid payload hash: ${unsafeApprovals.map(x=>x.id).join(', ')}`);
    if (invalidatedApprovalsStillOpen.length) fail(`invalidated approvals still in an open or approved state: ${invalidatedApprovalsStillOpen.map(x=>x.id).join(', ')}`);

    if (!process.exitCode) console.log(JSON.stringify({
      ok:true,database:dbName,requiredTables:REQUIRED_TABLES.length,verifiedColumnGroups:Object.keys(REQUIRED_COLUMNS).length,
      appliedMigrations:migrations.length,duplicateAccounts:0,multiplePrimaryAccounts:0,duplicateMobiles:0,duplicateAccessGrants:0,
      archivedWithActiveOwnership:0,invalidDuplicatePairs:0,invalidMergePlans:0,invalidAuthorisations:0,
      invalidRepresentativePermissions:0,activeExpiredRepresentatives:0,unsafeApprovals:0,invalidatedApprovalsStillOpen:0
    },null,2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`SCHEMA VERIFICATION FAILED: ${error.message}`);
  process.exit(1);
});
