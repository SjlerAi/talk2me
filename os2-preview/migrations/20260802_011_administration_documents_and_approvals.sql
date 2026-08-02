-- Talk2Me OS2 controlled preview migration 011
-- Moves administration schema out of runtime routes and supplies the document and approval tables required by the integrated source.

CREATE TABLE IF NOT EXISTS os2_launcher_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  link_name VARCHAR(80) NOT NULL,
  link_url VARCHAR(500) NOT NULL,
  icon_text VARCHAR(8) NOT NULL DEFAULT '↗',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_launcher_links_active_order (is_active, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_staff_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('photo','id_document') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_staff_documents_staff (staff_id, created_at),
  KEY idx_os2_staff_documents_type (document_type, created_at),
  UNIQUE KEY uq_os2_staff_documents_stored_name (stored_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_customer_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  master_customer_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('id','proof_of_address','bank_statement','company_registration','authority_letter','purchase_order','signed_instruction','other') NOT NULL DEFAULT 'other',
  original_filename VARCHAR(160) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  sha256_hash CHAR(64) NOT NULL,
  verification_status ENUM('unverified','verified','rejected') NOT NULL DEFAULT 'unverified',
  verified_by BIGINT UNSIGNED NULL,
  verified_at DATETIME NULL,
  verification_note VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  archived_by BIGINT UNSIGNED NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_customer_documents_storage_key (storage_key),
  KEY idx_os2_customer_documents_customer (master_customer_id, archived_at, created_at),
  KEY idx_os2_customer_documents_digest (sha256_hash),
  KEY idx_os2_customer_documents_verification (verification_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_document_access_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  access_type ENUM('metadata','view','download','verify','archive') NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_document_access_document (document_id, created_at),
  KEY idx_os2_document_access_staff (staff_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_approval_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_type VARCHAR(80) NOT NULL,
  action_key VARCHAR(80) NOT NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  target_entity_type VARCHAR(100) NULL,
  target_entity_id BIGINT UNSIGNED NULL,
  request_payload JSON NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  integrity_version INT UNSIGNED NOT NULL,
  status ENUM('pending','approved','rejected','deferred') NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_at DATETIME NOT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  decision_reason VARCHAR(1000) NULL,
  application_result JSON NULL,
  invalidated_at DATETIME NULL,
  invalidated_by BIGINT UNSIGNED NULL,
  invalidation_reason VARCHAR(1000) NULL,
  consumed_at DATETIME NULL,
  consumed_by BIGINT UNSIGNED NULL,
  consumed_for_entity_type VARCHAR(100) NULL,
  consumed_for_entity_id BIGINT UNSIGNED NULL,
  consumption_result JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_approval_requests_status (status, requested_at, id),
  KEY idx_os2_approval_requests_customer (master_customer_id, status, id),
  KEY idx_os2_approval_requests_target (target_entity_type, target_entity_id, status),
  KEY idx_os2_approval_requests_requester (requested_by, status, requested_at),
  KEY idx_os2_approval_requests_consumption (consumed_at, invalidated_at, integrity_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_approval_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  approval_request_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(32) NOT NULL,
  to_status VARCHAR(32) NOT NULL,
  reason VARCHAR(1000) NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_os2_approval_history_request (approval_request_id, created_at, id),
  KEY idx_os2_approval_history_actor (changed_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_approval_consumption_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  approval_request_id BIGINT UNSIGNED NOT NULL,
  action_key VARCHAR(80) NOT NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  target_entity_type VARCHAR(100) NULL,
  target_entity_id BIGINT UNSIGNED NULL,
  payload_hash CHAR(64) NOT NULL,
  consumed_by BIGINT UNSIGNED NOT NULL,
  consumed_for_entity_type VARCHAR(100) NULL,
  consumed_for_entity_id BIGINT UNSIGNED NULL,
  result_json JSON NULL,
  consumed_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_approval_consumption_request (approval_request_id),
  KEY idx_os2_approval_consumption_customer (master_customer_id, consumed_at),
  KEY idx_os2_approval_consumption_actor (consumed_by, consumed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO os2_launcher_links (link_name, link_url, icon_text, sort_order, is_active)
SELECT seed.link_name, seed.link_url, seed.icon_text, seed.sort_order, 1
FROM (
  SELECT 'Vodacom' AS link_name, 'https://www.vodacom.co.za/' AS link_url, 'V' AS icon_text, 10 AS sort_order
  UNION ALL SELECT 'MTN', 'https://www.mtn.co.za/', 'M', 20
  UNION ALL SELECT 'Telkom', 'https://www.telkom.co.za/', 'T', 30
  UNION ALL SELECT 'Sage', 'https://www.sage.com/en-za/', 'S', 40
) seed
WHERE NOT EXISTS (SELECT 1 FROM os2_launcher_links LIMIT 1);
