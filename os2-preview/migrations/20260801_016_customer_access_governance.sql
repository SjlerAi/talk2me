ALTER TABLE os2_customer_ownership
  ADD COLUMN access_scope VARCHAR(30) NOT NULL DEFAULT 'owner' AFTER ownership_reason,
  ADD COLUMN access_expires_at DATETIME NULL AFTER effective_from,
  ADD INDEX idx_os2_ownership_access (assigned_staff_id,is_current,access_expires_at);

CREATE TABLE os2_customer_access_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  access_level VARCHAR(30) NOT NULL DEFAULT 'read',
  reason VARCHAR(500) NOT NULL,
  granted_by BIGINT UNSIGNED NOT NULL,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  revoked_by BIGINT UNSIGNED NULL,
  revoke_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_customer_access_customer (master_customer_id,revoked_at,expires_at),
  KEY idx_os2_customer_access_staff (staff_id,revoked_at,expires_at),
  CONSTRAINT fk_os2_customer_access_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_customer_access_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_customer_access_granted_by FOREIGN KEY (granted_by) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_customer_access_revoked_by FOREIGN KEY (revoked_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE os2_customer_access_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  access_level VARCHAR(30) NULL,
  reason VARCHAR(500) NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  details_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_customer_access_history_customer (master_customer_id,created_at),
  KEY idx_os2_customer_access_history_staff (staff_id,created_at),
  CONSTRAINT fk_os2_customer_access_history_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_customer_access_history_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_customer_access_history_changed_by FOREIGN KEY (changed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;