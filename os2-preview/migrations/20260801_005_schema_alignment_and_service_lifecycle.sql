-- Talk2Me OS2 integrated rebuild - preview-only schema alignment and service lifecycle
-- Target: kloka_talk2me only. Never run against the production schema.

ALTER TABLE os2_master_customers
  ADD COLUMN IF NOT EXISTS short_note VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS status ENUM('active','prospect','inactive','archived') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;

ALTER TABLE os2_customer_accounts
  ADD COLUMN IF NOT EXISTS normalised_account_number VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS expected_line_count INT NULL,
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;

UPDATE os2_customer_accounts
   SET normalised_account_number=UPPER(REPLACE(REPLACE(account_number,' ',''),'-',''))
 WHERE normalised_account_number IS NULL OR normalised_account_number='';

ALTER TABLE os2_customer_contacts
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(180) NULL,
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS os2_mobile_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  mobile_number VARCHAR(40) NOT NULL,
  mobile_number_normalised VARCHAR(40) NULL,
  sim_number VARCHAR(100) NULL,
  imei VARCHAR(100) NULL,
  handset VARCHAR(200) NULL,
  package_name VARCHAR(200) NULL,
  contract_months SMALLINT UNSIGNED NOT NULL DEFAULT 36,
  previous_upgrade_date DATE NULL,
  next_upgrade_date DATE NULL,
  cancellation_date DATE NULL,
  monthly_amount DECIMAL(12,2) NULL,
  line_status ENUM('active','pending','suspended','cancelled','archived') NOT NULL DEFAULT 'active',
  assigned_staff_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_mobile_line_number (mobile_number),
  KEY idx_os2_mobile_line_customer (master_customer_id),
  KEY idx_os2_mobile_line_account (account_id),
  KEY idx_os2_mobile_line_upgrade (next_upgrade_date),
  CONSTRAINT fk_os2_mobile_line_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_mobile_line_account FOREIGN KEY (account_id) REFERENCES os2_customer_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE os2_fixed_accounts
  ADD COLUMN IF NOT EXISTS account_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS normalised_account_number VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS assigned_staff_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;

UPDATE os2_fixed_accounts
   SET normalised_account_number=UPPER(REPLACE(REPLACE(fixed_account_number,' ',''),'-',''))
 WHERE normalised_account_number IS NULL OR normalised_account_number='';

ALTER TABLE os2_fixed_services
  ADD COLUMN IF NOT EXISTS service_name VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS service_status ENUM('active','pending','suspended','cancelled','archived') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS assigned_staff_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS os2_customer_ownership (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  assigned_staff_id BIGINT UNSIGNED NOT NULL,
  ownership_reason VARCHAR(255) NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_ownership_customer_current (master_customer_id,is_current),
  KEY idx_os2_ownership_staff (assigned_staff_id),
  CONSTRAINT fk_os2_ownership_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_customer_restrictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  restriction_type VARCHAR(100) NOT NULL,
  restriction_value VARCHAR(255) NULL,
  verification_method VARCHAR(100) NULL,
  evidence_document_id BIGINT UNSIGNED NULL,
  effective_from DATETIME NULL,
  expires_at DATETIME NULL,
  notes TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_restriction_customer_active (master_customer_id,is_active),
  CONSTRAINT fk_os2_customer_restriction_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE os2_authorised_representatives
  ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS revoked_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS revoked_by BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS revoke_reason VARCHAR(1000) NULL;

CREATE TABLE IF NOT EXISTS os2_service_change_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  service_type ENUM('mobile','fixed') NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  change_type VARCHAR(80) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  approval_id BIGINT UNSIGNED NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_service_history_customer (master_customer_id,created_at),
  KEY idx_os2_service_history_service (service_type,service_id),
  CONSTRAINT fk_os2_service_history_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
