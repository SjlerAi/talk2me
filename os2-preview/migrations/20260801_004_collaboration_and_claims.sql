-- Preview-only integrated rebuild migration.
-- Adds claims, calendar links, sticky-note sharing and customer ownership history.

CREATE TABLE IF NOT EXISTS os2_claim_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  current_owner_staff_id BIGINT UNSIGNED NULL,
  requested_owner_staff_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  decision_reason VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_claim_customer_status (master_customer_id,status),
  KEY idx_os2_claim_requester (requested_by,status),
  KEY idx_os2_claim_reviewer (reviewed_by,reviewed_at),
  CONSTRAINT fk_os2_claim_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_claim_requester FOREIGN KEY (requested_by) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_claim_current_owner FOREIGN KEY (current_owner_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_claim_requested_owner FOREIGN KEY (requested_owner_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_claim_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_claim_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  claim_request_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  note VARCHAR(1000) NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_claim_history_claim (claim_request_id,created_at),
  CONSTRAINT fk_os2_claim_history_claim FOREIGN KEY (claim_request_id) REFERENCES os2_claim_requests(id),
  CONSTRAINT fk_os2_claim_history_staff FOREIGN KEY (changed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_calendar_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(240) NOT NULL,
  description TEXT NULL,
  event_type VARCHAR(50) NOT NULL DEFAULT 'task',
  start_at DATETIME NOT NULL,
  end_at DATETIME NULL,
  all_day TINYINT(1) NOT NULL DEFAULT 0,
  assigned_staff_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  work_item_id BIGINT UNSIGNED NULL,
  location VARCHAR(255) NULL,
  recurrence_rule VARCHAR(500) NULL,
  status ENUM('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_calendar_staff_start (assigned_staff_id,start_at),
  KEY idx_os2_calendar_customer (master_customer_id,start_at),
  KEY idx_os2_calendar_work_item (work_item_id),
  CONSTRAINT fk_os2_calendar_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_calendar_creator FOREIGN KEY (created_by) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_calendar_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_calendar_work_item FOREIGN KEY (work_item_id) REFERENCES os2_work_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_sticky_note_shares (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sticky_note_id BIGINT UNSIGNED NOT NULL,
  shared_with_staff_id BIGINT UNSIGNED NOT NULL,
  shared_by BIGINT UNSIGNED NOT NULL,
  can_edit TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_sticky_share (sticky_note_id,shared_with_staff_id),
  KEY idx_os2_sticky_share_staff (shared_with_staff_id,created_at),
  CONSTRAINT fk_os2_sticky_share_note FOREIGN KEY (sticky_note_id) REFERENCES os2_sticky_notes(id),
  CONSTRAINT fk_os2_sticky_share_staff FOREIGN KEY (shared_with_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_os2_sticky_share_by FOREIGN KEY (shared_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
