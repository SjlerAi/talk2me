CREATE TABLE os2_customer_merge_plans (
  id BIGINT NOT NULL AUTO_INCREMENT,
  duplicate_case_id BIGINT NOT NULL,
  survivor_customer_id BIGINT NOT NULL,
  source_customer_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  plan_json JSON NOT NULL,
  plan_hash CHAR(64) NOT NULL,
  blocker_count INT NOT NULL DEFAULT 0,
  conflict_count INT NOT NULL DEFAULT 0,
  prepared_by BIGINT NOT NULL,
  prepared_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by BIGINT NULL,
  approved_at DATETIME NULL,
  rejected_by BIGINT NULL,
  rejected_at DATETIME NULL,
  decision_reason VARCHAR(1000) NULL,
  executed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_merge_plan_case (duplicate_case_id),
  INDEX idx_merge_plan_status (status, prepared_at),
  INDEX idx_merge_plan_customers (survivor_customer_id, source_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE os2_customer_merge_plan_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  merge_plan_id BIGINT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(32) NULL,
  to_status VARCHAR(32) NULL,
  reason VARCHAR(1000) NULL,
  details_json JSON NULL,
  changed_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_merge_plan_history (merge_plan_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
