-- TK2M production additive staff popup receipts. Not a chat read receipt or task completion.
-- Apply via approved guarded DB maintenance before deploying dependent code.
CREATE TABLE IF NOT EXISTS staff_attention_acknowledgments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  source_kind VARCHAR(16) NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(80) NOT NULL,
  ack_method VARCHAR(16) NOT NULL,
  acknowledged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_attention_source (staff_id,source_kind,source_id),
  KEY idx_staff_attention_chat (staff_id,source_kind,source_key,source_id),
  KEY idx_staff_attention_date (staff_id,acknowledged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
