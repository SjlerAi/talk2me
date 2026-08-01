ALTER TABLE os2_customer_merge_plans
  ADD COLUMN revalidated_at DATETIME NULL AFTER decision_reason,
  ADD COLUMN invalidated_at DATETIME NULL AFTER revalidated_at,
  ADD COLUMN invalidated_by BIGINT NULL AFTER invalidated_at,
  ADD COLUMN invalidation_reason VARCHAR(1000) NULL AFTER invalidated_by,
  ADD COLUMN current_snapshot_hash CHAR(64) NULL AFTER invalidation_reason,
  ADD INDEX idx_merge_plan_freshness (status, invalidated_at, revalidated_at);

ALTER TABLE os2_customer_merge_plan_history
  ADD INDEX idx_merge_plan_history_event (event_type, created_at);
