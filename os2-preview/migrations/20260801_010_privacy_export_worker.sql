-- Talk2Me OS2 preview-only migration 010
-- Controlled privacy export worker metadata. Never run against production.

ALTER TABLE os2_data_exports
  ADD COLUMN worker_id VARCHAR(120) NULL AFTER status,
  ADD COLUMN claimed_at DATETIME NULL AFTER worker_id,
  ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER claimed_at,
  ADD COLUMN file_count INT NOT NULL DEFAULT 0 AFTER row_count,
  ADD COLUMN total_bytes BIGINT NOT NULL DEFAULT 0 AFTER file_count,
  ADD COLUMN generated_at DATETIME NULL AFTER total_bytes,
  ADD INDEX idx_os2_data_exports_queue (status,expires_at,created_at),
  ADD INDEX idx_os2_data_exports_worker (worker_id,claimed_at);

CREATE TABLE IF NOT EXISTS os2_export_access_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  data_export_id BIGINT UNSIGNED NOT NULL,
  accessed_by BIGINT UNSIGNED NOT NULL,
  access_type ENUM('metadata_view','release_authorised','download_started','download_completed','revoked') NOT NULL,
  request_id VARCHAR(80) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  details_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_export_access_export (data_export_id,created_at),
  KEY idx_export_access_staff (accessed_by,created_at),
  CONSTRAINT fk_export_access_export FOREIGN KEY (data_export_id) REFERENCES os2_data_exports(id),
  CONSTRAINT fk_export_access_staff FOREIGN KEY (accessed_by) REFERENCES staff_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
