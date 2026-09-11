-- Talk2Me Base Details master foundation
-- REVIEWED ONE-OFF SQL ONLY.
--
-- SAFETY BOUNDARY
-- 1. Back up the production database before applying this file.
-- 2. Do NOT run npm run db:migrate.
-- 3. This file is additive except for widening two existing ENUM definitions.
-- 4. This file does NOT import, update or delete customer data.
-- 5. Base Details rows remain staged/reconciled until a separately reviewed write phase is approved.

ALTER TABLE monthly_import_batches
  MODIFY import_type ENUM('activation','upgrade','fixed_base','base_details') NOT NULL,
  MODIFY source_system ENUM('B12','SIEBEL','FIXED_BASE','VODACOM_BASE') NOT NULL;

CREATE TABLE IF NOT EXISTS mobile_base_current (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id BIGINT UNSIGNED NULL,
  account_id BIGINT UNSIGNED NULL,
  source_batch_id BIGINT UNSIGNED NULL,
  source_row_id BIGINT UNSIGNED NULL,
  source_row_fingerprint CHAR(64) NOT NULL,

  business_unit VARCHAR(160) NULL,
  account_code VARCHAR(120) NOT NULL,
  account_code_core VARCHAR(120) NOT NULL,
  account_name VARCHAR(255) NULL,
  id_number VARCHAR(80) NULL,
  first_name VARCHAR(120) NULL,
  surname VARCHAR(120) NULL,
  msisdn_original VARCHAR(80) NULL,
  msisdn_normalised VARCHAR(20) NOT NULL,
  email_address VARCHAR(255) NULL,
  master_account_holder VARCHAR(40) NULL,

  subscription_revenue_excl_vat DECIMAL(18,4) NULL,
  customer_revenue_m3 DECIMAL(18,4) NULL,
  customer_revenue_m2 DECIMAL(18,4) NULL,
  customer_revenue_m1 DECIMAL(18,4) NULL,
  in_bundle_revenue DECIMAL(18,4) NULL,
  out_bundle_revenue DECIMAL(18,4) NULL,
  data_content_revenue DECIMAL(18,4) NULL,
  ave_subscription_revenue DECIMAL(18,4) NULL,
  net_subscription_revenue DECIMAL(18,4) NULL,

  connection_date DATE NULL,
  last_active_date DATE NULL,
  active_30_day VARCHAR(20) NULL,
  last_upgrade_date DATE NULL,
  device_manufacturer VARCHAR(180) NULL,
  device_name VARCHAR(255) NULL,
  price_plan_category VARCHAR(180) NULL,
  price_plan VARCHAR(255) NULL,
  tariff_name VARCHAR(255) NULL,
  cbu_segment VARCHAR(180) NULL,
  j4u_attached VARCHAR(40) NULL,
  account_in_arrears VARCHAR(40) NULL,
  contract_status VARCHAR(120) NULL,
  contract_period VARCHAR(120) NULL,
  voice_oob_usage VARCHAR(40) NULL,
  data_oob_usage VARCHAR(40) NULL,
  network_tenure_months INT NULL,
  contract_tenure_months INT NULL,
  base_dealer_name VARCHAR(255) NULL,
  sim_size_description VARCHAR(180) NULL,
  opt_out_indicator VARCHAR(40) NULL,
  churn_risk_ind VARCHAR(40) NULL,
  device_insurance VARCHAR(80) NULL,
  sim_insurance VARCHAR(80) NULL,
  icc_id VARCHAR(120) NULL,
  imsi VARCHAR(120) NULL,
  recommendation_1 TEXT NULL,
  recommendation_2 TEXT NULL,
  recommendation_3 TEXT NULL,
  recommendation_4 TEXT NULL,
  portfolio_score VARCHAR(120) NULL,
  lines_upgradable INT NULL,
  eligible_upgrade_date DATE NULL,
  eligible_upgrade_flag VARCHAR(40) NULL,
  upgrade_in_progress VARCHAR(40) NULL,
  data_usage_m1_mb DECIMAL(20,4) NULL,
  data_usage_m2_mb DECIMAL(20,4) NULL,
  data_usage_m3_mb DECIMAL(20,4) NULL,

  raw_data_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (JSON_VALID(raw_data_json)),
  source_captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_mobile_base_current_msisdn (msisdn_normalised),
  KEY ix_mobile_base_current_account_core (account_code_core),
  KEY ix_mobile_base_current_account (account_id),
  KEY ix_mobile_base_current_client (client_id),
  KEY ix_mobile_base_current_upgrade (eligible_upgrade_flag,eligible_upgrade_date),
  KEY ix_mobile_base_current_status (contract_status,active_30_day),
  KEY ix_mobile_base_current_iccid (icc_id),
  KEY ix_mobile_base_current_imsi (imsi),
  CONSTRAINT fk_mobile_base_current_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_base_current_account FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_base_current_batch FOREIGN KEY (source_batch_id) REFERENCES monthly_import_batches(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_base_current_row FOREIGN KEY (source_row_id) REFERENCES monthly_import_rows(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mobile_base_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mobile_base_current_id BIGINT UNSIGNED NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  import_row_id BIGINT UNSIGNED NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  row_fingerprint CHAR(64) NOT NULL,
  msisdn_original VARCHAR(80) NULL,
  msisdn_normalised VARCHAR(20) NOT NULL,
  account_code VARCHAR(120) NOT NULL,
  account_code_core VARCHAR(120) NOT NULL,
  raw_data_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (JSON_VALID(raw_data_json)),
  captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_mobile_base_snapshots_import_row (import_row_id),
  KEY ix_mobile_base_snapshots_phone_date (msisdn_normalised,captured_at),
  KEY ix_mobile_base_snapshots_account_date (account_code_core,captured_at),
  KEY ix_mobile_base_snapshots_batch (batch_id,source_row_number),
  CONSTRAINT fk_mobile_base_snapshots_current FOREIGN KEY (mobile_base_current_id) REFERENCES mobile_base_current(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_base_snapshots_batch FOREIGN KEY (batch_id) REFERENCES monthly_import_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mobile_base_snapshots_row FOREIGN KEY (import_row_id) REFERENCES monthly_import_rows(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mobile_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_row_id BIGINT UNSIGNED NULL,
  batch_id BIGINT UNSIGNED NULL,
  mobile_base_current_id BIGINT UNSIGNED NULL,
  client_id BIGINT UNSIGNED NULL,
  account_id BIGINT UNSIGNED NULL,
  staff_id BIGINT UNSIGNED NULL,
  event_type ENUM('activation','upgrade') NOT NULL,
  event_date DATE NULL,
  msisdn_original VARCHAR(80) NULL,
  msisdn_normalised VARCHAR(20) NULL,
  source_system VARCHAR(80) NULL,
  agent_code VARCHAR(120) NULL,
  imei VARCHAR(120) NULL,
  package_name VARCHAR(255) NULL,
  deal_sheet_number VARCHAR(120) NULL,
  description TEXT NULL,
  channel VARCHAR(120) NULL,
  commission_score VARCHAR(120) NULL,
  average_spend DECIMAL(18,4) NULL,
  source_row_fingerprint CHAR(64) NULL,
  raw_data_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (raw_data_json IS NULL OR JSON_VALID(raw_data_json)),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_mobile_events_import_row (import_row_id),
  KEY ix_mobile_events_phone_date (msisdn_normalised,event_date),
  KEY ix_mobile_events_client_date (client_id,event_date),
  KEY ix_mobile_events_account_date (account_id,event_date),
  KEY ix_mobile_events_staff_date (staff_id,event_date),
  KEY ix_mobile_events_type_date (event_type,event_date),
  CONSTRAINT fk_mobile_events_row FOREIGN KEY (import_row_id) REFERENCES monthly_import_rows(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_events_batch FOREIGN KEY (batch_id) REFERENCES monthly_import_batches(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_events_current FOREIGN KEY (mobile_base_current_id) REFERENCES mobile_base_current(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_events_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_events_account FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_mobile_events_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_external_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  source_system VARCHAR(80) NOT NULL,
  external_code VARCHAR(120) NOT NULL,
  external_code_normalised VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_external_code (source_system,external_code_normalised),
  KEY ix_staff_external_codes_staff (staff_id),
  CONSTRAINT fk_staff_external_codes_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed only codes explicitly supplied by the owner. Resolve staff by email so production IDs are not hard-coded.
INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','OLIVIERJ06','OLIVIERJ06' FROM staff_users WHERE LOWER(email)='jonathan@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;
INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','OLIVIERJ06_C3D','OLIVIERJ06_C3D' FROM staff_users WHERE LOWER(email)='jonathan@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;

INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','LATEA002','LATEA002' FROM staff_users WHERE LOWER(email)='annazel@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;
INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','LATEA002_C3D','LATEA002_C3D' FROM staff_users WHERE LOWER(email)='annazel@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;

INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','VONSB001','VONSB001' FROM staff_users WHERE LOWER(email)='sales3@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;
INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','VONSB001_C3D','VONSB001_C3D' FROM staff_users WHERE LOWER(email)='sales3@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;

INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','HETZV001','HETZV001' FROM staff_users WHERE LOWER(email)='sales4@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;
INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','HETZV001_C3D','HETZV001_C3D' FROM staff_users WHERE LOWER(email)='sales4@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;

INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','BOOYE004','BOOYE004' FROM staff_users WHERE LOWER(email)='sias@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;
INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised)
SELECT id,'SIEBEL','BOOYE004_C3D','BOOYE004_C3D' FROM staff_users WHERE LOWER(email)='sias@talk-online.co.za' LIMIT 1
ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id),external_code=VALUES(external_code),is_active=1;

-- Gerhard van der Westhuizen deliberately has no external code seed: no code was supplied.
-- LEROUXG02 / LEROUXG02_C3D deliberately remain unmapped until the owner confirms the person.
-- SADMIN deliberately remains a system/admin identity, not a salesperson mapping.

-- Verification queries (read-only):
-- SELECT COLUMN_TYPE FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='monthly_import_batches' AND COLUMN_NAME='import_type';
-- SELECT TABLE_NAME FROM information_schema.TABLES
--  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('mobile_base_current','mobile_base_snapshots','mobile_events','staff_external_codes');
-- SELECT source_system,external_code_normalised,staff_id FROM staff_external_codes ORDER BY staff_id,external_code_normalised;

-- Rollback note:
-- Do not drop these additive tables after they contain production evidence. A code rollback can safely leave them in place.
-- If this SQL is applied but NO Base Details/event data has ever been written, a separately reviewed rollback may drop
-- the four new tables and narrow the two ENUMs back to their previous definitions.