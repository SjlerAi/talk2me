-- Talk2Me OS2 preview migration 012
-- Approval action integrity, payload binding and one-time consumption controls.

ALTER TABLE os2_approval_requests
  ADD COLUMN action_key VARCHAR(100) NULL AFTER request_type,
  ADD COLUMN payload_hash CHAR(64) NULL AFTER request_payload,
  ADD COLUMN consumed_at DATETIME NULL AFTER application_result,
  ADD COLUMN consumed_by BIGINT UNSIGNED NULL AFTER consumed_at,
  ADD COLUMN consumed_for_entity_type VARCHAR(100) NULL AFTER consumed_by,
  ADD COLUMN consumed_for_entity_id BIGINT UNSIGNED NULL AFTER consumed_for_entity_type,
  ADD COLUMN consumption_result JSON NULL AFTER consumed_for_entity_id;

UPDATE os2_approval_requests
SET action_key = request_type
WHERE action_key IS NULL;

CREATE INDEX idx_os2_approval_action_status
  ON os2_approval_requests (action_key, status, master_customer_id);

CREATE INDEX idx_os2_approval_consumed
  ON os2_approval_requests (consumed_at, consumed_by);

CREATE TABLE os2_approval_consumption_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  approval_request_id BIGINT UNSIGNED NOT NULL,
  action_key VARCHAR(100) NOT NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  target_entity_type VARCHAR(100) NULL,
  target_entity_id BIGINT UNSIGNED NULL,
  payload_hash CHAR(64) NOT NULL,
  consumed_by BIGINT UNSIGNED NOT NULL,
  consumed_for_entity_type VARCHAR(100) NULL,
  consumed_for_entity_id BIGINT UNSIGNED NULL,
  result_json JSON NULL,
  consumed_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_approval_consumption_once (approval_request_id),
  KEY idx_os2_approval_consumption_customer (master_customer_id, consumed_at),
  CONSTRAINT fk_os2_approval_consumption_request
    FOREIGN KEY (approval_request_id) REFERENCES os2_approval_requests(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
