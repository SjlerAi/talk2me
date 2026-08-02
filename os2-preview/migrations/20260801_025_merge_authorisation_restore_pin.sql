ALTER TABLE os2_customer_merge_execution_authorisations
  ADD COLUMN restore_test_id BIGINT NULL AFTER backup_run_id,
  ADD INDEX idx_merge_execution_restore (restore_test_id);

UPDATE os2_customer_merge_execution_authorisations a
SET a.restore_test_id=(
  SELECT rt.id
  FROM os2_restore_tests rt
  WHERE rt.backup_run_id=a.backup_run_id
    AND rt.status='passed'
    AND rt.completed_at IS NOT NULL
    AND rt.target_environment='isolated_preview_restore'
    AND rt.expected_database_name='kloka_talk2me'
    AND rt.actual_database_name='kloka_talk2me'
    AND rt.failed_checks=0
    AND (a.authorised_at IS NULL OR rt.completed_at<=a.authorised_at)
  ORDER BY rt.completed_at DESC,rt.id DESC
  LIMIT 1
)
WHERE a.restore_test_id IS NULL;
