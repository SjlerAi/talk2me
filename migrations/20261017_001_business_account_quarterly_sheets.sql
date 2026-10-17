-- Talk2Me UI-UAT: quarterly business account workbook snapshots.
-- Additive only. Never modifies existing clients, upgrade dates, account assignments or CRM history.
-- The UAT upload module can initialise the same tables on first use.
-- Keep archived files and rows; no destructive migration/cleanup.

CREATE TABLE IF NOT EXISTS business_account_sheet_previews (
  id CHAR(36) NOT NULL PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  sheet_json MEDIUMTEXT NOT NULL,
  file_data MEDIUMBLOB NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  KEY idx_basp_account (account_id,uploaded_by,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_account_sheet_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  file_data MEDIUMBLOB NOT NULL,
  sheet_name VARCHAR(160) NULL,
  headers_json TEXT NULL,
  line_count INT UNSIGNED NOT NULL,
  matched_count INT UNSIGNED NOT NULL DEFAULT 0,
  unmatched_count INT UNSIGNED NOT NULL DEFAULT 0,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  restored_from_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_basv_account_version (account_id,version_no),
  KEY idx_basv_active (account_id,is_current,uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_account_sheet_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  version_id BIGINT UNSIGNED NOT NULL,
  source_row INT UNSIGNED NOT NULL,
  phone_original VARCHAR(45) NOT NULL,
  phone_normalised VARCHAR(20) NOT NULL,
  package_name VARCHAR(255) NOT NULL,
  upgrade_date_sheet DATE NULL,
  end_date_sheet DATE NULL,
  usage_text VARCHAR(500) NULL,
  current_cost DECIMAL(14,2) NULL,
  matched_client_id BIGINT UNSIGNED NULL,
  match_status ENUM('matched','not_found','ambiguous') NOT NULL DEFAULT 'not_found',
  raw_json TEXT NULL,
  UNIQUE KEY uq_basl_version_row (version_id,source_row),
  KEY idx_basl_number (phone_normalised),
  KEY idx_basl_version (version_id),
  CONSTRAINT fk_basl_version
    FOREIGN KEY (version_id) REFERENCES business_account_sheet_versions(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
