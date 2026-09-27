-- Talk2Me CRM - Office Intelligence foundation
-- ADDITIVE ONLY: this migration creates new tables and does not alter or remove existing CRM data.

CREATE TABLE IF NOT EXISTS crm_usage_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  screen_key VARCHAR(120) NULL,
  route_path VARCHAR(255) NULL,
  module_name VARCHAR(120) NULL,
  entity_type VARCHAR(80) NULL,
  entity_id BIGINT UNSIGNED NULL,
  http_method VARCHAR(12) NULL,
  http_status SMALLINT UNSIGNED NULL,
  metadata_json JSON NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crm_usage_occurred (occurred_at),
  KEY idx_crm_usage_staff_date (staff_id,occurred_at),
  KEY idx_crm_usage_screen_date (screen_key,occurred_at),
  KEY idx_crm_usage_event_date (event_type,occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS office_intelligence_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requested_by BIGINT UNSIGNED NULL,
  request_source ENUM('backoffice','mobile','scheduled','email') NOT NULL DEFAULT 'backoffice',
  command_text VARCHAR(500) NULL,
  range_key VARCHAR(40) NOT NULL DEFAULT 'today',
  range_label VARCHAR(160) NULL,
  report_json JSON NULL,
  email_recipient VARCHAR(255) NULL,
  email_status ENUM('not_requested','pending','sent','failed') NOT NULL DEFAULT 'not_requested',
  email_error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_office_intel_runs_created (created_at),
  KEY idx_office_intel_runs_requester (requested_by,created_at),
  KEY idx_office_intel_runs_source (request_source,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS office_intelligence_config (
  id TINYINT UNSIGNED NOT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Johannesburg',
  report_hour TINYINT UNSIGNED NOT NULL DEFAULT 18,
  report_minute TINYINT UNSIGNED NOT NULL DEFAULT 0,
  scheduled_report_enabled TINYINT(1) NOT NULL DEFAULT 0,
  recipient_staff_id BIGINT UNSIGNED NULL,
  recipient_email VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO office_intelligence_config
  (id,timezone,report_hour,report_minute,scheduled_report_enabled)
VALUES (1,'Africa/Johannesburg',18,0,0)
ON DUPLICATE KEY UPDATE id=VALUES(id);
