ALTER TABLE os2_customer_restrictions
  ADD COLUMN IF NOT EXISTS revoked_at DATETIME NULL AFTER is_active,
  ADD COLUMN IF NOT EXISTS revoked_by BIGINT UNSIGNED NULL AFTER revoked_at,
  ADD COLUMN IF NOT EXISTS revoke_reason VARCHAR(1000) NULL AFTER revoked_by,
  ADD COLUMN IF NOT EXISTS value_numeric DECIMAL(14,2) NULL AFTER restriction_value,
  ADD COLUMN IF NOT EXISTS source_reference VARCHAR(255) NULL AFTER verification_method,
  ADD INDEX IF NOT EXISTS idx_os2_restrictions_active_type (master_customer_id,is_active,restriction_type),
  ADD INDEX IF NOT EXISTS idx_os2_restrictions_revoked (revoked_at,revoked_by);

CREATE TABLE IF NOT EXISTS os2_restriction_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  restriction_id BIGINT UNSIGNED NOT NULL,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason VARCHAR(1000) NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_restriction_history_restriction (restriction_id,created_at),
  KEY idx_os2_restriction_history_customer (master_customer_id,created_at),
  CONSTRAINT fk_os2_restriction_history_restriction FOREIGN KEY (restriction_id) REFERENCES os2_customer_restrictions(id),
  CONSTRAINT fk_os2_restriction_history_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_restriction_history_staff FOREIGN KEY (changed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;