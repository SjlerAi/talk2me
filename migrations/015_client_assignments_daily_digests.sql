-- Talk2Me CRM v1.17.0 - Client assignments and automated daily email digests

CREATE TABLE IF NOT EXISTS client_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id BIGINT UNSIGNED NOT NULL,
  account_number VARCHAR(100) NULL,
  assigned_staff_id BIGINT UNSIGNED NOT NULL,
  assigned_by BIGINT UNSIGNED NOT NULL,
  notes VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_client_assignments_client (client_id),
  KEY idx_client_assignments_account (account_number,is_active),
  KEY idx_client_assignments_staff (assigned_staff_id,is_active),
  CONSTRAINT fk_client_assignments_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_client_assignments_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_client_assignments_by FOREIGN KEY (assigned_by) REFERENCES staff_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_digest_preferences (
  staff_id BIGINT UNSIGNED NOT NULL,
  work_digest_enabled TINYINT(1) NOT NULL DEFAULT 1,
  client_digest_enabled TINYINT(1) NOT NULL DEFAULT 1,
  owner_digest_enabled TINYINT(1) NOT NULL DEFAULT 1,
  send_all_clear TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_id),
  CONSTRAINT fk_digest_preferences_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_email_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NULL,
  recipient_email VARCHAR(255) NOT NULL,
  email_type ENUM('staff_work','owner_daily','staff_clients') NOT NULL,
  digest_date DATE NOT NULL,
  scheduled_slot VARCHAR(20) NOT NULL,
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  message_id VARCHAR(255) NULL,
  error_message VARCHAR(500) NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_daily_email_once (recipient_email,email_type,digest_date,scheduled_slot),
  KEY idx_daily_email_status (status,digest_date),
  CONSTRAINT fk_daily_email_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO staff_digest_preferences (staff_id)
SELECT id FROM staff_users
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id);
