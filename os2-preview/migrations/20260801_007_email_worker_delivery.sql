-- Talk2Me OS2 preview-only migration
-- Target database: kloka_talk2me only.

ALTER TABLE os2_email_queue
  ADD COLUMN IF NOT EXISTS processing_started_at DATETIME NULL AFTER next_attempt_at,
  ADD COLUMN IF NOT EXISTS worker_id VARCHAR(120) NULL AFTER processing_started_at,
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255) NULL AFTER worker_id,
  ADD COLUMN IF NOT EXISTS sent_at DATETIME NULL AFTER provider_message_id,
  ADD INDEX IF NOT EXISTS idx_os2_email_worker_claim (status,next_attempt_at,attempts),
  ADD INDEX IF NOT EXISTS idx_os2_email_worker_stale (status,processing_started_at);

ALTER TABLE os2_notifications
  ADD COLUMN IF NOT EXISTS delivered_at DATETIME NULL AFTER delivery_status;
