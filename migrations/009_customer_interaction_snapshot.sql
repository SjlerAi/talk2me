-- Talk2Me Phase 1.7 customer interaction snapshot
-- Import after the app files are uploaded.
-- Adds completion tracking and smarter status values for the customer snapshot.

ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL AFTER follow_up_at,
  ADD COLUMN IF NOT EXISTS completed_by BIGINT UNSIGNED NULL AFTER completed_at;

ALTER TABLE inquiries
  MODIFY status ENUM(
    'open',
    'resolved',
    'follow_up',
    'waiting_customer',
    'waiting_network',
    'waiting_supplier',
    'cancelled'
  ) NOT NULL DEFAULT 'resolved';

UPDATE inquiries
SET completed_at = COALESCE(completed_at, updated_at),
    completed_by = COALESCE(completed_by, staff_id)
WHERE status IN ('resolved','cancelled')
  AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inquiries_completed_at ON inquiries (completed_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_client_created ON inquiries (client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_email_created ON inquiries (email, created_at);
