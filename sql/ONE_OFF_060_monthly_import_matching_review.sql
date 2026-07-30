-- Talk2Me Issue #60 - Monthly Import Matching and Management Review, Phase 2
-- REVIEWED ONE-OFF SQL ONLY. Back up production before applying this file manually.
-- Do not add this file to generic migrations and do not run npm run db:migrate.
-- Prerequisite: sql/ONE_OFF_057_monthly_data_import.sql has already been applied.

CREATE TABLE IF NOT EXISTS monthly_import_matches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_row_id BIGINT UNSIGNED NOT NULL,
  classification ENUM('exact_match','possible_match','new_record','conflict','already_applied','ignored') NOT NULL,
  match_domain ENUM('mobile','fixed') NOT NULL,
  confidence_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  proposed_client_id BIGINT UNSIGNED NULL,
  proposed_account_id BIGINT UNSIGNED NULL,
  proposed_fixed_account_id BIGINT UNSIGNED NULL,
  proposed_fixed_service_id BIGINT UNSIGNED NULL,
  match_reason VARCHAR(1000) NOT NULL,
  candidate_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (JSON_VALID(candidate_json)),
  review_status ENUM('pending','approved','rejected','deferred') NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_monthly_import_matches_row (import_row_id),
  KEY ix_monthly_import_matches_review (review_status,classification),
  KEY ix_monthly_import_matches_client (proposed_client_id),
  KEY ix_monthly_import_matches_account (proposed_account_id),
  KEY ix_monthly_import_matches_fixed_account (proposed_fixed_account_id),
  KEY ix_monthly_import_matches_fixed_service (proposed_fixed_service_id),
  CONSTRAINT fk_monthly_import_matches_row FOREIGN KEY (import_row_id) REFERENCES monthly_import_rows(id) ON DELETE CASCADE,
  CONSTRAINT fk_monthly_import_matches_client FOREIGN KEY (proposed_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_monthly_import_matches_account FOREIGN KEY (proposed_account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_monthly_import_matches_fixed_account FOREIGN KEY (proposed_fixed_account_id) REFERENCES fixed_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_monthly_import_matches_fixed_service FOREIGN KEY (proposed_fixed_service_id) REFERENCES fixed_services(id) ON DELETE SET NULL,
  CONSTRAINT fk_monthly_import_matches_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monthly_import_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_row_id BIGINT UNSIGNED NOT NULL,
  match_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(80) NOT NULL,
  target_entity_type VARCHAR(60) NOT NULL,
  target_entity_id BIGINT UNSIGNED NULL,
  before_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (before_json IS NULL OR JSON_VALID(before_json)),
  proposed_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (JSON_VALID(proposed_json)),
  approval_status ENUM('pending','approved','rejected','deferred') NOT NULL DEFAULT 'pending',
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  applied_status ENUM('not_applied','applied','failed') NOT NULL DEFAULT 'not_applied',
  applied_by BIGINT UNSIGNED NULL,
  applied_at DATETIME NULL,
  error_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_monthly_import_actions_match (match_id),
  UNIQUE KEY uq_monthly_import_actions_row (import_row_id),
  KEY ix_monthly_import_actions_approval (approval_status,applied_status),
  CONSTRAINT fk_monthly_import_actions_row FOREIGN KEY (import_row_id) REFERENCES monthly_import_rows(id) ON DELETE CASCADE,
  CONSTRAINT fk_monthly_import_actions_match FOREIGN KEY (match_id) REFERENCES monthly_import_matches(id) ON DELETE CASCADE,
  CONSTRAINT fk_monthly_import_actions_approver FOREIGN KEY (approved_by) REFERENCES staff_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_monthly_import_actions_applier FOREIGN KEY (applied_by) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Production application note:
-- 1. Back up the database and verify the Phase 1 tables exist.
-- 2. Import this file once through the approved cPanel/phpMyAdmin SQL workflow.
-- 3. Verify both tables and their foreign keys, then open Data Import Centre and run matching on one confirmed batch.
-- 4. Do not run generic migrations and do not modify the production .env.
--
-- Rollback guidance (destructive to Phase 2 review data; take another backup first):
--   DROP TABLE monthly_import_actions;
--   DROP TABLE monthly_import_matches;
-- These drops do not change clients, customer_accounts, fixed_accounts, or fixed_services.
