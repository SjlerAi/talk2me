ALTER TABLE os2_customer_merge_execution_authorisations
  ADD COLUMN restore_test_id BIGINT NULL AFTER backup_run_id,
  ADD INDEX idx_merge_execution_restore (restore_test_id);

UPDATE os2_customer_merge_execution_authorisations a
JOIN (
  SELECT rt.backup_run_id,MAX(rt.id) restore_test_id
  FROM os2_restore_tests rt
  WHERE rt.status='passed'
  GROUP BY rt.backup_run_id
) latest ON latest.backup_run_id=a.backup_run_id
SET a.restore_test_id=latest.restore_test_id
WHERE a.restore_test_id IS NULL;
