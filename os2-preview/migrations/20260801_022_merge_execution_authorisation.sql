CREATE TABLE os2_customer_merge_execution_authorisations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  merge_plan_id BIGINT NOT NULL,
  plan_hash CHAR(64) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  backup_run_id BIGINT NOT NULL,
  change_reference VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  requested_by BIGINT NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  authorised_by BIGINT NULL,
  authorised_at DATETIME NULL,
  expires_at DATETIME NULL,
  revoked_by BIGINT NULL,
  revoked_at DATETIME NULL,
  revocation_reason VARCHAR(1000) NULL,
  consumed_at DATETIME NULL,
  consumed_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_merge_execution_plan (merge_plan_id),
  INDEX idx_merge_execution_status (status,expires_at),
  INDEX idx_merge_execution_backup (backup_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE os2_customer_merge_execution_authorisation_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  authorisation_id BIGINT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NULL,
  reason VARCHAR(1000) NULL,
  details_json JSON NULL,
  changed_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_merge_execution_auth_history (authorisation_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
