CREATE TABLE IF NOT EXISTS os2_customer_consents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  consent_type VARCHAR(80) NOT NULL,
  consent_status ENUM('granted','withdrawn','not_required','pending') NOT NULL DEFAULT 'pending',
  source VARCHAR(80) NULL,
  evidence_reference VARCHAR(255) NULL,
  granted_at DATETIME NULL,
  withdrawn_at DATETIME NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_consent_customer (master_customer_id, consent_type, consent_status),
  CONSTRAINT fk_consent_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_consent_staff FOREIGN KEY (recorded_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_data_subject_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  request_type ENUM('access','correction','restriction','objection','deletion','export') NOT NULL,
  status ENUM('received','identity_verification','in_review','approved','rejected','completed','cancelled') NOT NULL DEFAULT 'received',
  request_reference VARCHAR(80) NOT NULL,
  request_details TEXT NULL,
  rejection_reason TEXT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dsr_reference (request_reference),
  KEY idx_dsr_status_due (status, due_at),
  KEY idx_dsr_customer (master_customer_id, created_at),
  CONSTRAINT fk_dsr_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_dsr_creator FOREIGN KEY (created_by) REFERENCES staff_users(id),
  CONSTRAINT fk_dsr_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_data_exports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  data_subject_request_id BIGINT UNSIGNED NULL,
  export_format ENUM('json','csv_bundle') NOT NULL DEFAULT 'json',
  status ENUM('queued','processing','ready','failed','expired','revoked') NOT NULL DEFAULT 'queued',
  storage_reference VARCHAR(500) NULL,
  content_sha256 CHAR(64) NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  generated_at DATETIME NULL,
  failure_reason VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_export_customer (master_customer_id, created_at),
  KEY idx_export_status (status, expires_at),
  CONSTRAINT fk_export_customer FOREIGN KEY (master_customer_id) REFERENCES os2_master_customers(id),
  CONSTRAINT fk_export_request FOREIGN KEY (data_subject_request_id) REFERENCES os2_data_subject_requests(id),
  CONSTRAINT fk_export_staff FOREIGN KEY (created_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_retention_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(100) NOT NULL,
  retention_days INT UNSIGNED NOT NULL,
  action_type ENUM('review','archive','anonymise','delete') NOT NULL DEFAULT 'review',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  legal_basis VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_retention_entity (entity_type),
  CONSTRAINT fk_retention_staff FOREIGN KEY (created_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_retention_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  retention_policy_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','retained','archived','anonymised','deleted','deferred') NOT NULL DEFAULT 'pending',
  decision_reason TEXT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_retention_review (retention_policy_id, entity_type, entity_id),
  KEY idx_retention_review_status (status, created_at),
  CONSTRAINT fk_retention_review_policy FOREIGN KEY (retention_policy_id) REFERENCES os2_retention_policies(id),
  CONSTRAINT fk_retention_review_staff FOREIGN KEY (reviewed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;