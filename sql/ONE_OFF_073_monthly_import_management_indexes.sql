-- Issue #73: filter-friendly indexes for Monthly Import Management.
-- Review and apply once through the approved production SQL workflow.
-- This file changes indexes only; it does not import, recreate, or modify CRM records.

CREATE INDEX IF NOT EXISTS ix_monthly_import_batches_created
  ON monthly_import_batches (created_at,id);
CREATE INDEX IF NOT EXISTS ix_monthly_import_batches_source_type
  ON monthly_import_batches (source_system,import_type,created_at);
CREATE INDEX IF NOT EXISTS ix_monthly_import_batches_filename
  ON monthly_import_batches (original_filename);
CREATE INDEX IF NOT EXISTS ix_monthly_import_rows_batch_customer
  ON monthly_import_rows (batch_id,customer_name);
CREATE INDEX IF NOT EXISTS ix_monthly_import_matches_domain_classification
  ON monthly_import_matches (match_domain,classification,review_status);
CREATE INDEX IF NOT EXISTS ix_monthly_import_actions_applied_approval
  ON monthly_import_actions (applied_status,approval_status,action_type);
