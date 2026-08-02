ALTER TABLE os2_customer_accounts
  ADD COLUMN account_status VARCHAR(30) NOT NULL DEFAULT 'active' AFTER account_type,
  ADD COLUMN archive_reason VARCHAR(1000) NULL AFTER archived_at,
  ADD COLUMN archived_by BIGINT NULL AFTER archive_reason,
  ADD INDEX idx_os2_accounts_customer_status (master_customer_id, account_status, archived_at),
  ADD INDEX idx_os2_accounts_archived_by (archived_by);

CREATE TABLE IF NOT EXISTS os2_account_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  account_id BIGINT NOT NULL,
  master_customer_id BIGINT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason VARCHAR(1000) NULL,
  changed_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_account_history_account (account_id, created_at),
  KEY idx_os2_account_history_customer (master_customer_id, created_at),
  KEY idx_os2_account_history_actor (changed_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;