-- Talk2Me UI UAT only: restore foreign keys skipped after phpMyAdmin stopped at legacy view DEFINER error.
-- Use only on the isolated UAT database after verifying CONSTRAINT_TYPE='FOREIGN KEY' count is 0.
-- This script is derived from the 11 Sep production dump deferred constraints plus the reviewed Base Details foundation.

ALTER TABLE audit_log
  ADD CONSTRAINT fk_audit_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE client_assignments
  ADD CONSTRAINT fk_client_assignments_by FOREIGN KEY (assigned_by) REFERENCES staff_users(id),
  ADD CONSTRAINT fk_client_assignments_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_client_assignments_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id);

ALTER TABLE customer_accounts
  ADD CONSTRAINT fk_customer_accounts_assigner FOREIGN KEY (assigned_by) REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_customer_accounts_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE daily_email_log
  ADD CONSTRAINT fk_daily_email_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE data_change_requests
  ADD CONSTRAINT fk_change_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_change_requester FOREIGN KEY (requested_by) REFERENCES staff_users(id),
  ADD CONSTRAINT fk_change_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE fixed_accounts
  ADD CONSTRAINT fk_fixed_accounts_client FOREIGN KEY (linked_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_fixed_accounts_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE fixed_services
  ADD CONSTRAINT fk_fixed_services_account FOREIGN KEY (fixed_account_id) REFERENCES fixed_accounts(id);

ALTER TABLE import_batches
  ADD CONSTRAINT fk_import_batches_staff FOREIGN KEY (imported_by) REFERENCES staff_users(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE inquiries
  ADD CONSTRAINT fk_inquiries_category FOREIGN KEY (category_id) REFERENCES inquiry_categories(id) ON UPDATE CASCADE,
  ADD CONSTRAINT fk_inquiries_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_inquiries_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_inquiries_workstation FOREIGN KEY (workstation_id) REFERENCES workstations(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE inquiry_notes
  ADD CONSTRAINT fk_notes_inquiry FOREIGN KEY (inquiry_id) REFERENCES inquiries(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_notes_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE monthly_import_actions
  ADD CONSTRAINT fk_monthly_import_actions_applier FOREIGN KEY (applied_by) REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_actions_approver FOREIGN KEY (approved_by) REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_actions_match FOREIGN KEY (match_id) REFERENCES monthly_import_matches(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_monthly_import_actions_row FOREIGN KEY (import_row_id) REFERENCES monthly_import_rows(id) ON DELETE CASCADE;

ALTER TABLE monthly_import_batches
  ADD CONSTRAINT fk_monthly_import_batches_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_batches_imported_by FOREIGN KEY (imported_by) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE monthly_import_matches
  ADD CONSTRAINT fk_monthly_import_matches_account FOREIGN KEY (proposed_account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_matches_client FOREIGN KEY (proposed_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_matches_fixed_account FOREIGN KEY (proposed_fixed_account_id) REFERENCES fixed_accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_matches_fixed_service FOREIGN KEY (proposed_fixed_service_id) REFERENCES fixed_services(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_matches_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_matches_row FOREIGN KEY (import_row_id) REFERENCES monthly_import_rows(id) ON DELETE CASCADE;

ALTER TABLE monthly_import_rows
  ADD CONSTRAINT fk_monthly_import_rows_account FOREIGN KEY (matched_account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_monthly_import_rows_batch FOREIGN KEY (batch_id) REFERENCES monthly_import_batches(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_monthly_import_rows_client FOREIGN KEY (matched_client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE staff_digest_preferences
  ADD CONSTRAINT fk_digest_preferences_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE;

ALTER TABLE staff_documents
  ADD CONSTRAINT fk_staff_documents_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_staff_documents_uploader FOREIGN KEY (uploaded_by) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE staff_login_sessions
  ADD CONSTRAINT fk_staff_login_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id);

ALTER TABLE staff_tasks
  ADD CONSTRAINT fk_staff_tasks_assigned FOREIGN KEY (assigned_to) REFERENCES staff_users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_staff_tasks_client FOREIGN KEY (related_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_staff_tasks_creator FOREIGN KEY (created_by) REFERENCES staff_users(id),
  ADD CONSTRAINT fk_staff_tasks_inquiry FOREIGN KEY (related_inquiry_id) REFERENCES inquiries(id) ON DELETE SET NULL;

ALTER TABLE staff_task_comments
  ADD CONSTRAINT fk_task_comments_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_task_comments_task FOREIGN KEY (task_id) REFERENCES staff_tasks(id) ON DELETE CASCADE;

ALTER TABLE workstations
  ADD CONSTRAINT fk_workstations_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE mobile_base_current
  ADD CONSTRAINT fk_mobile_base_current_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_base_current_account FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_base_current_batch FOREIGN KEY (source_batch_id) REFERENCES monthly_import_batches(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_base_current_row FOREIGN KEY (source_row_id) REFERENCES monthly_import_rows(id) ON DELETE SET NULL;

ALTER TABLE mobile_base_snapshots
  ADD CONSTRAINT fk_mobile_base_snapshots_current FOREIGN KEY (mobile_base_current_id) REFERENCES mobile_base_current(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_base_snapshots_batch FOREIGN KEY (batch_id) REFERENCES monthly_import_batches(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mobile_base_snapshots_row FOREIGN KEY (import_row_id) REFERENCES monthly_import_rows(id) ON DELETE RESTRICT;

ALTER TABLE mobile_events
  ADD CONSTRAINT fk_mobile_events_row FOREIGN KEY (import_row_id) REFERENCES monthly_import_rows(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_events_batch FOREIGN KEY (batch_id) REFERENCES monthly_import_batches(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_events_current FOREIGN KEY (mobile_base_current_id) REFERENCES mobile_base_current(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_events_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_events_account FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_mobile_events_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL;

ALTER TABLE staff_external_codes
  ADD CONSTRAINT fk_staff_external_codes_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE;

-- Verification:
-- SELECT COUNT(*) AS foreign_keys FROM information_schema.TABLE_CONSTRAINTS
-- WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='FOREIGN KEY';
