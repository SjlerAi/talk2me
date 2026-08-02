SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE staff_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(160) NOT NULL,
  username VARCHAR(100) NOT NULL,
  email VARCHAR(254) NULL,
  role ENUM('owner','manager','staff') NOT NULL DEFAULT 'staff',
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_username (username),
  UNIQUE KEY uq_staff_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_type ENUM('individual','business') NOT NULL DEFAULT 'individual',
  display_name VARCHAR(200) NOT NULL,
  responsible_person VARCHAR(200) NULL,
  primary_mobile VARCHAR(30) NULL,
  primary_email VARCHAR(254) NULL,
  town VARCHAR(150) NULL,
  id_number VARCHAR(30) NULL,
  status ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
  short_note TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_customers_name (display_name),
  KEY ix_customers_mobile (primary_mobile),
  KEY ix_customers_email (primary_email),
  CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by) REFERENCES staff_users(id),
  CONSTRAINT fk_customers_updated_by FOREIGN KEY (updated_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  account_number VARCHAR(100) NOT NULL,
  normalised_account_number VARCHAR(100) NOT NULL,
  account_type ENUM('individual','business') NOT NULL DEFAULT 'individual',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  expected_line_count INT UNSIGNED NULL,
  status ENUM('active','inactive','closed') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_number (normalised_account_number),
  KEY ix_accounts_customer (customer_id),
  CONSTRAINT fk_accounts_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mobile_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  mobile_number VARCHAR(30) NOT NULL,
  package_name VARCHAR(200) NULL,
  handset VARCHAR(200) NULL,
  sim_number VARCHAR(100) NULL,
  imei VARCHAR(100) NULL,
  next_upgrade_date DATE NULL,
  cancellation_date DATE NULL,
  monthly_invoice_amount DECIMAL(12,2) NULL,
  status ENUM('active','inactive','cancelled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mobile_number (mobile_number),
  KEY ix_mobile_customer (customer_id),
  KEY ix_mobile_account (account_id),
  CONSTRAINT fk_mobile_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_mobile_account FOREIGN KEY (account_id) REFERENCES customer_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_contacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  mobile VARCHAR(30) NULL,
  email VARCHAR(254) NULL,
  relationship_type VARCHAR(100) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_contacts_customer (customer_id),
  CONSTRAINT fk_contacts_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_ownership (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  assigned_staff_id BIGINT UNSIGNED NOT NULL,
  ownership_reason VARCHAR(200) NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ownership_customer_current (customer_id,is_current),
  KEY ix_ownership_staff_current (assigned_staff_id,is_current),
  CONSTRAINT fk_ownership_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_ownership_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_ownership_created_by FOREIGN KEY (created_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_staff_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  description VARCHAR(1000) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_customer_time (customer_id,created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_staff_id) REFERENCES staff_users(id),
  CONSTRAINT fk_audit_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
