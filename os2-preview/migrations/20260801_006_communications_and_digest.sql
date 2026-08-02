-- Talk2Me OS2 integrated rebuild - preview-only migration
-- Target: kloka_talk2me only. Do not run against production.

CREATE TABLE IF NOT EXISTS os2_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_staff_id BIGINT UNSIGNED NOT NULL,
  sender_staff_id BIGINT UNSIGNED NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  work_item_id BIGINT UNSIGNED NULL,
  notification_type VARCHAR(80) NOT NULL,
  title VARCHAR(240) NOT NULL,
  message TEXT NULL,
  action_url VARCHAR(500) NULL,
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  delivery_channel ENUM('in_app','email','both') NOT NULL DEFAULT 'in_app',
  delivery_status ENUM('pending','sent','failed','suppressed') NOT NULL DEFAULT 'pending',
  read_at DATETIME NULL,
  archived_at DATETIME NULL,
  sent_at DATETIME NULL,
  failure_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_notification_recipient (recipient_staff_id, archived_at, read_at),
  KEY idx_os2_notification_customer (master_customer_id),
  KEY idx_os2_notification_status (delivery_status, created_at),
  CONSTRAINT fk_os2_notification_recipient FOREIGN KEY (recipient_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_notification_sender FOREIGN KEY (sender_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_notification_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_notification_work FOREIGN KEY (work_item_id) REFERENCES os2_work_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_broadcasts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(240) NOT NULL,
  message TEXT NOT NULL,
  audience_type ENUM('all','role','staff_list') NOT NULL DEFAULT 'all',
  audience_json JSON NULL,
  delivery_channel ENUM('in_app','email','both') NOT NULL DEFAULT 'in_app',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('draft','queued','sent','cancelled') NOT NULL DEFAULT 'draft',
  scheduled_at DATETIME NULL,
  sent_at DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_broadcast_status (status, scheduled_at),
  CONSTRAINT fk_os2_broadcast_creator FOREIGN KEY (created_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_digest_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  digest_type ENUM('staff_daily','owner_daily','manager_daily') NOT NULL,
  target_staff_id BIGINT UNSIGNED NOT NULL,
  digest_date DATE NOT NULL,
  payload_json JSON NOT NULL,
  delivery_channel ENUM('in_app','email','both') NOT NULL DEFAULT 'in_app',
  status ENUM('generated','sent','failed','suppressed') NOT NULL DEFAULT 'generated',
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  failure_reason VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_digest_once (digest_type, target_staff_id, digest_date),
  KEY idx_os2_digest_status (status, digest_date),
  CONSTRAINT fk_os2_digest_staff FOREIGN KEY (target_staff_id) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_email_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_email VARCHAR(254) NOT NULL,
  recipient_name VARCHAR(180) NULL,
  subject VARCHAR(240) NOT NULL,
  body_text MEDIUMTEXT NOT NULL,
  body_html MEDIUMTEXT NULL,
  related_entity_type VARCHAR(80) NULL,
  related_entity_id BIGINT UNSIGNED NULL,
  status ENUM('pending','processing','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  sent_at DATETIME NULL,
  failure_reason VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_email_queue_status (status, next_attempt_at, created_at),
  CONSTRAINT fk_os2_email_queue_creator FOREIGN KEY (created_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
