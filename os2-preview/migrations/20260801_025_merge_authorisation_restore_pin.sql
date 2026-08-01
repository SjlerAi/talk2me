ALTER TABLE os2_customer_merge_execution_authorisations
  ADD COLUMN restore_test_id BIGINT NULL AFTER backup_run_id,
  ADD INDEX idx_merge_execution_restore (restore_test_id);

UPDATE os2_customer_merge_execution_authorisations a
SET a.restore_test_id=(
  SELECT rt.id
  FROM os2_restore_tests rt
  WHERE rt.backup_run_id=a.backup_run_id
    AND rt.status='passed'
  ORDER BY rt.completed_at DESC,rt.id DESC
  LIMIT 1
)
WHERE a.restore_test_id IS NULL;
