-- ViralCo direct source-of-truth account synchronisation (UAT only).
-- Additive, versioned, auditable. No destructive client migration.
CREATE TABLE IF NOT EXISTS viralco_import_previews (
  id CHAR(36) PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  file_data MEDIUMBLOB NOT NULL,
  expected_version_id BIGINT UNSIGNED NULL,
  expected_crm_digest CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  KEY idx_viralco_preview_account (account_id,uploaded_by,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS viralco_import_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  provider_account_number VARCHAR(80) NOT NULL,
  provider_company_name VARCHAR(180) NOT NULL,
  previous_account_name VARCHAR(180) NULL,
  filename VARCHAR(255) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  file_data MEDIUMBLOB NOT NULL,
  line_count INT UNSIGNED NOT NULL,
  matched_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_count INT UNSIGNED NOT NULL DEFAULT 0,
  review_count INT UNSIGNED NOT NULL DEFAULT 0,
  omitted_count INT UNSIGNED NOT NULL DEFAULT 0,
  published_by BIGINT UNSIGNED NOT NULL,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  name_approved_by BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_viralco_account_version (account_id,version_no),
  KEY idx_viralco_active (account_id,is_current,published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS viralco_import_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version_id BIGINT UNSIGNED NOT NULL,
  source_row INT UNSIGNED NOT NULL,
  msisdn_original VARCHAR(40) NOT NULL,
  phone_normalised VARCHAR(20) NOT NULL,
  subscriber_name VARCHAR(160) NULL,
  invoice_name VARCHAR(160) NULL,
  sponsored_account VARCHAR(120) NULL,
  activation_date DATE NULL,
  term_date DATE NULL,
  upgradable CHAR(1) NOT NULL,
  earliest_upgrade_date DATE NULL,
  last_upgrade_date DATE NULL,
  pack_code VARCHAR(80) NULL,
  pack_desc VARCHAR(180) NULL,
  avg_spend DECIMAL(14,2) NULL,
  loyalty_status VARCHAR(120) NULL,
  sim_number VARCHAR(80) NULL,
  dealer_id VARCHAR(80) NULL,
  line_status_code VARCHAR(30) NULL,
  matched_client_id BIGINT UNSIGNED NULL,
  sync_action ENUM('updated','unchanged','created','pending_new','conflict','ambiguous') NOT NULL,
  old_crm_json TEXT NULL,
  new_crm_json TEXT NULL,
  UNIQUE KEY uq_viralco_version_row (version_id,source_row),
  KEY idx_viralco_version (version_id),
  KEY idx_viralco_phone (phone_normalised),
  KEY idx_viralco_matched_client (matched_client_id),
  CONSTRAINT fk_viralco_import_version
    FOREIGN KEY (version_id) REFERENCES viralco_import_versions (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
