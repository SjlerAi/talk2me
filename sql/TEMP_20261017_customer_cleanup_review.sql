-- UAT ONLY. Apply only after confirming database is uent_Crm and taking a backup.
-- Temporary decisions never modify the clients, customer_accounts or mobile_base_current tables.
CREATE TABLE IF NOT EXISTS temporary_cleanup_decisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 case_type VARCHAR(60) NOT NULL,
 case_key VARCHAR(150) NOT NULL,
 decision ENUM('approved_grouping','keep_separate','needs_correction','flagged') NOT NULL,
 notes TEXT NOT NULL,
 source_snapshot_hash CHAR(64) NOT NULL,
 reviewed_by BIGINT UNSIGNED NOT NULL,
 reviewed_at DATETIME NOT NULL,
 PRIMARY KEY (id),
 UNIQUE KEY uq_temp_cleanup_case (case_type,case_key),
 KEY ix_temp_cleanup_reviewer (reviewed_by,reviewed_at),
 CONSTRAINT fk_temp_cleanup_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
