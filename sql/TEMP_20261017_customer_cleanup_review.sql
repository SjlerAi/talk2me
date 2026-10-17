-- One-off UAT-only correction and approval store. Apply ONLY to verified uent_Crm after a full backup.
-- Does not change production or any CRM line by itself.
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

CREATE TABLE IF NOT EXISTS temporary_cleanup_review_history (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 case_type VARCHAR(60) NOT NULL,
 case_key VARCHAR(150) NOT NULL,
 decision VARCHAR(40) NOT NULL,
 notes TEXT NOT NULL,
 source_snapshot_hash CHAR(64) NOT NULL,
 reviewed_by BIGINT UNSIGNED NOT NULL,
 reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (id),
 KEY ix_temp_review_case (case_type,case_key,reviewed_at),
 KEY ix_temp_review_person (reviewed_by),
 CONSTRAINT fk_temp_review_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS temporary_cleanup_changes (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 action_type VARCHAR(60) NOT NULL,
 case_type VARCHAR(60) NOT NULL,
 case_key VARCHAR(150) NOT NULL,
 client_id BIGINT UNSIGNED NULL,
 before_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK(JSON_VALID(before_json)),
 after_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK(JSON_VALID(after_json)),
 reviewed_by BIGINT UNSIGNED NOT NULL,
 notes TEXT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (id),
 KEY ix_temp_change_case (case_type,case_key,created_at),
 KEY ix_temp_change_client (client_id),
 KEY ix_temp_change_person (reviewed_by),
 CONSTRAINT fk_temp_change_reviewer FOREIGN KEY (reviewed_by) REFERENCES staff_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
