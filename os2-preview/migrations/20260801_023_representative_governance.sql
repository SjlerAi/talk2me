CREATE TABLE os2_representative_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  representative_id BIGINT NOT NULL,
  master_customer_id BIGINT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason VARCHAR(1000) NULL,
  changed_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_representative_history_rep (representative_id,created_at),
  INDEX idx_representative_history_customer (master_customer_id,created_at),
  INDEX idx_representative_history_event (event_type,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE os2_authorised_representatives
  ADD INDEX idx_os2_representative_customer_status (master_customer_id,status,expires_at),
  ADD INDEX idx_os2_representative_mobile (mobile),
  ADD INDEX idx_os2_representative_email (email);
