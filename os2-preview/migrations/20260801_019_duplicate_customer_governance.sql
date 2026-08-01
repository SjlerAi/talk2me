CREATE TABLE os2_customer_duplicate_cases (
  id BIGINT NOT NULL AUTO_INCREMENT,
  primary_customer_id BIGINT NOT NULL,
  candidate_customer_id BIGINT NOT NULL,
  match_basis VARCHAR(80) NOT NULL,
  match_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  evidence_json JSON NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'open',
  proposed_survivor_customer_id BIGINT NULL,
  resolution_reason VARCHAR(1000) NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by BIGINT NULL,
  reviewed_at DATETIME NULL,
  closed_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_duplicate_pair (primary_customer_id,candidate_customer_id),
  INDEX idx_duplicate_status (status,created_at),
  INDEX idx_duplicate_primary (primary_customer_id,status),
  INDEX idx_duplicate_candidate (candidate_customer_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE os2_customer_duplicate_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  duplicate_case_id BIGINT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  reason VARCHAR(1000) NULL,
  details_json JSON NULL,
  changed_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_duplicate_history_case (duplicate_case_id,created_at),
  INDEX idx_duplicate_history_event (event_type,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
