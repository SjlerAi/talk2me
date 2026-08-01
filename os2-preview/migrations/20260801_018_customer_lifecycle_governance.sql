ALTER TABLE os2_master_customers
  ADD COLUMN archive_reason VARCHAR(1000) NULL AFTER archived_at,
  ADD COLUMN archived_by BIGINT NULL AFTER archive_reason,
  ADD COLUMN reactivated_at DATETIME NULL AFTER archived_by,
  ADD COLUMN reactivated_by BIGINT NULL AFTER reactivated_at,
  ADD INDEX idx_os2_master_customers_archive (archived_at, archived_by),
  ADD INDEX idx_os2_master_customers_status (status, archived_at);

CREATE TABLE os2_customer_lifecycle_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  reason VARCHAR(1000) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  changed_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_customer_lifecycle_customer (master_customer_id, created_at),
  INDEX idx_customer_lifecycle_event (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
