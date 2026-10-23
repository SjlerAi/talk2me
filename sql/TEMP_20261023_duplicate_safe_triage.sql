-- Talk2Me UAT logical duplicate grouping and manual case queue.
-- Applied after verified pre-change full backup 2026-10-23.
-- This is NON-DESTRUCTIVE: never updates clients, mobile_base_current or assignments.
-- Private authenticated UAT review endpoint controls manual decisions.
CREATE TABLE IF NOT EXISTS temporary_duplicate_triage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_type ENUM('safe_line_group','manual_identity') NOT NULL,
  case_key VARCHAR(100) NOT NULL,
  account_id BIGINT UNSIGNED NULL,
  phone_normalised VARCHAR(20) NULL,
  client_ids_json LONGTEXT NOT NULL,
  reason_codes_json LONGTEXT NOT NULL,
  source_hash CHAR(64) NOT NULL,
  status ENUM('auto_grouped','pending','needs_correction','flagged','keep_separate') NOT NULL,
  review_notes TEXT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  classified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_case_type_key (case_type,case_key),
  KEY idx_case_status (case_type,status),
  KEY idx_phone_account (phone_normalised,account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historical line records are not deleted. Do not automatically issue
-- UPDATE clients SET is_active=0 from this ledger.
-- A physical duplicate archive requires isolated restore testing and separate review.
