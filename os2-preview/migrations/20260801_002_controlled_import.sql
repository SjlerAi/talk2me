-- Talk2Me OS2 preview-only controlled import pipeline
-- Apply manually to the preview database only. Never run automatically at application startup.

CREATE TABLE os2_import_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_type VARCHAR(80) NOT NULL,
  source_filename VARCHAR(255) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  status ENUM('uploaded','analysing','review','approved','finalising','completed','failed','cancelled') NOT NULL DEFAULT 'uploaded',
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  safe_rows INT UNSIGNED NOT NULL DEFAULT 0,
  review_rows INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_rows INT UNSIGNED NOT NULL DEFAULT 0,
  finalised_rows INT UNSIGNED NOT NULL DEFAULT 0,
  error_rows INT UNSIGNED NOT NULL DEFAULT 0,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  completed_at DATETIME NULL,
  failure_message VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_import_batches_hash (source_sha256),
  KEY ix_os2_import_batches_status (status, created_at),
  KEY ix_os2_import_batches_uploaded_by (uploaded_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE os2_import_rows (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  raw_payload JSON NOT NULL,
  normalised_payload JSON NULL,
  classification ENUM('safe_create','safe_update','ambiguous','duplicate','invalid','ignored') NOT NULL DEFAULT 'ambiguous',
  match_strategy VARCHAR(80) NULL,
  matched_master_customer_id BIGINT UNSIGNED NULL,
  matched_account_id BIGINT UNSIGNED NULL,
  confidence_score DECIMAL(5,2) NULL,
  validation_errors JSON NULL,
  review_notes TEXT NULL,
  review_decision ENUM('pending','approve','reject','override') NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  finalisation_status ENUM('pending','finalised','failed','skipped') NOT NULL DEFAULT 'pending',
  finalised_entity_type VARCHAR(80) NULL,
  finalised_entity_id BIGINT UNSIGNED NULL,
  finalisation_error VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_import_rows_batch_row (batch_id, source_row_number),
  KEY ix_os2_import_rows_classification (batch_id, classification),
  KEY ix_os2_import_rows_review (batch_id, review_decision),
  KEY ix_os2_import_rows_customer (matched_master_customer_id),
  CONSTRAINT fk_os2_import_rows_batch FOREIGN KEY (batch_id) REFERENCES os2_import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE os2_import_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  row_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) NOT NULL,
  event_payload JSON NULL,
  actor_staff_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_os2_import_events_batch (batch_id, created_at),
  KEY ix_os2_import_events_row (row_id, created_at),
  CONSTRAINT fk_os2_import_events_batch FOREIGN KEY (batch_id) REFERENCES os2_import_batches(id),
  CONSTRAINT fk_os2_import_events_row FOREIGN KEY (row_id) REFERENCES os2_import_rows(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
