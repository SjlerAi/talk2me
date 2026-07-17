-- Talk2Me CRM Version 3.0 - approvals and immutable audit foundation

CREATE TABLE IF NOT EXISTS data_change_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_type ENUM('create_client','update_client','add_line','archive_record','delete_record','change_authority','change_upgrade','change_assignment') NOT NULL,
  entity_type VARCHAR(60) NOT NULL DEFAULT 'clients',
  record_id BIGINT UNSIGNED NULL,
  client_id BIGINT UNSIGNED NULL,
  account_number VARCHAR(80) NULL,
  summary VARCHAR(255) NOT NULL,
  reason TEXT NULL,
  proposed_data_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (JSON_VALID(proposed_data_json)),
  required_approval_role ENUM('manager','owner') NOT NULL DEFAULT 'manager',
  status ENUM('pending_manager','pending_owner','approved','rejected','cancelled','applied') NOT NULL DEFAULT 'pending_manager',
  requested_by BIGINT UNSIGNED NOT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_comment TEXT NULL,
  applied_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_change_status_created (status,created_at),
  KEY idx_change_client (client_id,status),
  KEY idx_change_requested_by (requested_by,status),
  CONSTRAINT fk_change_requester FOREIGN KEY (requested_by) REFERENCES staff_users(id),
  CONSTRAINT fk_change_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_change_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NULL,
  entity_id BIGINT UNSIGNED NULL,
  description VARCHAR(500) NOT NULL,
  before_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (before_json IS NULL OR JSON_VALID(before_json)),
  after_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (after_json IS NULL OR JSON_VALID(after_json)),
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_staff (staff_id,created_at),
  KEY idx_audit_entity (entity_type,entity_id,created_at),
  CONSTRAINT fk_audit_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

