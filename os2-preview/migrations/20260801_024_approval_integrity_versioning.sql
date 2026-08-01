-- Talk2Me OS2 preview migration 024
-- Invalidates approvals created before canonical payload binding and requires integrity version 2.

ALTER TABLE os2_approval_requests
  ADD COLUMN integrity_version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER payload_hash,
  ADD COLUMN invalidated_at DATETIME NULL AFTER integrity_version,
  ADD COLUMN invalidation_reason VARCHAR(500) NULL AFTER invalidated_at,
  ADD INDEX idx_os2_approval_integrity (integrity_version, status, invalidated_at);

UPDATE os2_approval_requests
SET status='rejected',
    invalidated_at=NOW(),
    invalidation_reason='legacy_approval_missing_canonical_payload_hash',
    decision_reason=COALESCE(decision_reason,'Invalidated during approval integrity migration'),
    updated_at=NOW()
WHERE payload_hash IS NULL
  AND consumed_at IS NULL
  AND status IN ('pending','deferred','approved');

UPDATE os2_approval_requests
SET integrity_version=2
WHERE payload_hash REGEXP '^[0-9a-f]{64}$'
  AND invalidated_at IS NULL;
