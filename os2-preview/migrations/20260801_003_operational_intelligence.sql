-- Talk2Me OS2 preview-only operational intelligence migration
-- Apply only to kloka_talk2me preview database.

CREATE TABLE os2_opportunities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NULL,
  opportunity_type VARCHAR(80) NOT NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NULL,
  value_estimate DECIMAL(12,2) NULL,
  probability_percent TINYINT UNSIGNED NULL,
  stage ENUM('identified','qualified','proposal','negotiation','won','lost','archived') NOT NULL DEFAULT 'identified',
  assigned_staff_id BIGINT UNSIGNED NOT NULL,
  source VARCHAR(120) NULL,
  expected_close_date DATE NULL,
  won_at DATETIME NULL,
  lost_at DATETIME NULL,
  loss_reason VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_os2_opportunity_customer (master_customer_id, stage),
  KEY idx_os2_opportunity_staff (assigned_staff_id, stage, expected_close_date),
  CONSTRAINT fk_os2_opportunity_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE os2_opportunity_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  from_stage VARCHAR(40) NULL,
  to_stage VARCHAR(40) NOT NULL,
  note TEXT NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_os2_opportunity_history (opportunity_id, created_at),
  CONSTRAINT fk_os2_opportunity_history FOREIGN KEY (opportunity_id) REFERENCES os2_opportunities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE os2_attendance_corrections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attendance_session_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  requested_clock_in DATETIME NULL,
  requested_clock_out DATETIME NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_at DATETIME NOT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_reason VARCHAR(1000) NULL,
  original_clock_in DATETIME NULL,
  original_clock_out DATETIME NULL,
  applied_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_os2_attendance_correction_status (status, requested_at),
  KEY idx_os2_attendance_correction_staff (staff_id, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE os2_report_exports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_type VARCHAR(100) NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  filter_json JSON NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  export_format ENUM('json','csv') NOT NULL DEFAULT 'json',
  file_name VARCHAR(255) NULL,
  file_hash CHAR(64) NULL,
  generated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_os2_report_exports (report_type, generated_at),
  KEY idx_os2_report_exports_user (requested_by, generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
