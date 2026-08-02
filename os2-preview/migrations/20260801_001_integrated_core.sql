-- Talk2Me OS2 integrated rebuild - preview-only migration
-- Target: kloka_talk2me. Never run against production without a separate reviewed plan.

CREATE TABLE IF NOT EXISTS os2_master_customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_type ENUM('individual','business') NOT NULL,
  display_name VARCHAR(180) NOT NULL,
  responsible_person VARCHAR(180) NULL,
  primary_mobile VARCHAR(40) NULL,
  primary_mobile_normalised VARCHAR(40) NULL,
  primary_email VARCHAR(190) NULL,
  town VARCHAR(120) NULL,
  lifecycle_status ENUM('active','prospect','inactive','archived') NOT NULL DEFAULT 'active',
  owner_staff_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_master_customer_mobile (primary_mobile_normalised),
  KEY idx_master_customer_email (primary_email),
  KEY idx_master_customer_owner (owner_staff_id),
  KEY idx_master_customer_name (display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_customer_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  account_number VARCHAR(80) NOT NULL,
  account_number_normalised VARCHAR(80) NOT NULL,
  account_name VARCHAR(180) NULL,
  account_type ENUM('mobile','fixed','combined','other') NOT NULL DEFAULT 'combined',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_account_number (account_number_normalised),
  KEY idx_os2_account_customer (master_customer_id),
  CONSTRAINT fk_os2_account_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_customer_contacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  contact_type ENUM('mobile','phone','email','whatsapp','other') NOT NULL,
  label VARCHAR(80) NULL,
  contact_value VARCHAR(255) NOT NULL,
  contact_value_normalised VARCHAR(255) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_contact_customer (master_customer_id),
  KEY idx_os2_contact_value (contact_value_normalised),
  CONSTRAINT fk_os2_contact_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_mobile_services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  customer_account_id BIGINT UNSIGNED NULL,
  mobile_number VARCHAR(40) NOT NULL,
  mobile_number_normalised VARCHAR(40) NOT NULL,
  sim_number VARCHAR(80) NULL,
  imei VARCHAR(80) NULL,
  handset VARCHAR(180) NULL,
  package_name VARCHAR(180) NULL,
  contract_months SMALLINT UNSIGNED NULL,
  upgrade_date DATE NULL,
  cancellation_date DATE NULL,
  monthly_amount DECIMAL(12,2) NULL,
  status ENUM('active','pending','suspended','cancelled','archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_mobile_number (mobile_number_normalised),
  KEY idx_os2_mobile_customer (master_customer_id),
  KEY idx_os2_mobile_account (customer_account_id),
  CONSTRAINT fk_os2_mobile_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_mobile_account FOREIGN KEY (customer_account_id) REFERENCES os2_customer_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_fixed_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  customer_account_id BIGINT UNSIGNED NULL,
  fixed_account_number VARCHAR(100) NOT NULL,
  fixed_account_number_normalised VARCHAR(100) NOT NULL,
  provider VARCHAR(120) NULL,
  status ENUM('active','pending','suspended','cancelled','archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_fixed_account (fixed_account_number_normalised),
  KEY idx_os2_fixed_customer (master_customer_id),
  CONSTRAINT fk_os2_fixed_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_fixed_customer_account FOREIGN KEY (customer_account_id) REFERENCES os2_customer_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_fixed_services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fixed_account_id BIGINT UNSIGNED NOT NULL,
  service_type VARCHAR(120) NOT NULL,
  service_identifier VARCHAR(160) NULL,
  mac_address VARCHAR(80) NULL,
  solution_id VARCHAR(100) NULL,
  order_number VARCHAR(100) NULL,
  package_name VARCHAR(180) NULL,
  monthly_amount DECIMAL(12,2) NULL,
  renewal_date DATE NULL,
  cancellation_date DATE NULL,
  status ENUM('active','pending','suspended','cancelled','archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_fixed_service_account (fixed_account_id),
  KEY idx_os2_fixed_solution (solution_id),
  KEY idx_os2_fixed_order (order_number),
  CONSTRAINT fk_os2_fixed_service_account FOREIGN KEY (fixed_account_id) REFERENCES os2_fixed_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_authority_restrictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  restriction_code VARCHAR(80) NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  numeric_limit DECIMAL(14,2) NULL,
  text_value VARCHAR(500) NULL,
  approval_method ENUM('none','otp','id','written','purchase_order','manager','owner') NOT NULL DEFAULT 'none',
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_customer_restriction (master_customer_id, restriction_code),
  CONSTRAINT fk_os2_restriction_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_authorised_representatives (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  relationship_name VARCHAR(120) NULL,
  mobile VARCHAR(40) NULL,
  email VARCHAR(190) NULL,
  id_reference VARCHAR(120) NULL,
  permissions_json JSON NOT NULL,
  verification_method VARCHAR(120) NULL,
  evidence_document_id BIGINT UNSIGNED NULL,
  expires_at DATETIME NULL,
  status ENUM('active','expired','revoked','archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_rep_customer (master_customer_id),
  CONSTRAINT fk_os2_rep_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NULL,
  staff_user_id BIGINT UNSIGNED NULL,
  document_type VARCHAR(80) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  uploaded_by BIGINT UNSIGNED NOT NULL,
  archived_by BIGINT UNSIGNED NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_document_storage (storage_key),
  KEY idx_os2_document_customer (master_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_document_access_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  action_type ENUM('view','download','upload','archive') NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_document_access (document_id, created_at),
  CONSTRAINT fk_os2_document_access_document FOREIGN KEY (document_id) REFERENCES os2_documents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_work_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_type ENUM('task','reminder','appointment','follow_up','callback','meeting','personal') NOT NULL,
  title VARCHAR(220) NOT NULL,
  description TEXT NULL,
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  lifecycle_state ENUM('created','seen','started','updated','completed','accepted','returned','archived') NOT NULL DEFAULT 'created',
  creator_staff_id BIGINT UNSIGNED NOT NULL,
  owner_staff_id BIGINT UNSIGNED NOT NULL,
  assignee_staff_id BIGINT UNSIGNED NOT NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  customer_account_id BIGINT UNSIGNED NULL,
  inquiry_id BIGINT UNSIGNED NULL,
  starts_at DATETIME NULL,
  due_at DATETIME NULL,
  reminder_at DATETIME NULL,
  recurrence_rule VARCHAR(500) NULL,
  completed_at DATETIME NULL,
  accepted_at DATETIME NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_work_assignee_state (assignee_staff_id, lifecycle_state, due_at),
  KEY idx_os2_work_customer (master_customer_id),
  CONSTRAINT fk_os2_work_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_os2_work_account FOREIGN KEY (customer_account_id) REFERENCES os2_customer_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_work_item_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  work_item_id BIGINT UNSIGNED NOT NULL,
  from_state VARCHAR(40) NULL,
  to_state VARCHAR(40) NOT NULL,
  note TEXT NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_work_history (work_item_id, created_at),
  CONSTRAINT fk_os2_work_history_item FOREIGN KEY (work_item_id) REFERENCES os2_work_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_sticky_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  title VARCHAR(180) NULL,
  body TEXT NOT NULL,
  colour_key VARCHAR(40) NOT NULL DEFAULT 'yellow',
  category_key VARCHAR(80) NULL,
  position_x INT NOT NULL DEFAULT 40,
  position_y INT NOT NULL DEFAULT 100,
  width_px INT NOT NULL DEFAULT 320,
  height_px INT NOT NULL DEFAULT 240,
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  is_minimised TINYINT(1) NOT NULL DEFAULT 0,
  reminder_at DATETIME NULL,
  status ENUM('active','archived','deleted') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_notes_staff (staff_id, status, updated_at),
  CONSTRAINT fk_os2_note_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_ownership_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  previous_owner_staff_id BIGINT UNSIGNED NULL,
  new_owner_staff_id BIGINT UNSIGNED NULL,
  change_type ENUM('initial_assignment','claim','transfer','release','import') NOT NULL,
  approval_id BIGINT UNSIGNED NULL,
  reason VARCHAR(500) NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_ownership_customer (master_customer_id, created_at),
  CONSTRAINT fk_os2_ownership_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_staff_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  description VARCHAR(500) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  request_id CHAR(36) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_audit_entity (entity_type, entity_id, created_at),
  KEY idx_os2_audit_customer (master_customer_id, created_at),
  KEY idx_os2_audit_actor (actor_staff_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
