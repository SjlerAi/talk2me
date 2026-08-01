CREATE TABLE IF NOT EXISTS os2_security_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type VARCHAR(80) NOT NULL,
  severity ENUM('info','warning','high','critical') NOT NULL DEFAULT 'info',
  staff_id BIGINT UNSIGNED NULL,
  session_id VARCHAR(128) NULL,
  request_id VARCHAR(64) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  route VARCHAR(255) NULL,
  method VARCHAR(12) NULL,
  details_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_security_events_created (created_at),
  KEY idx_security_events_type (event_type,created_at),
  KEY idx_security_events_staff (staff_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS os2_login_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  identity_hash CHAR(64) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  was_successful TINYINT(1) NOT NULL DEFAULT 0,
  failure_reason VARCHAR(80) NULL,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_login_attempts_identity (identity_hash,attempted_at),
  KEY idx_login_attempts_ip (ip_address,attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE app_sessions
  ADD COLUMN IF NOT EXISTS last_seen_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS revoked_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(120) NULL,
  ADD KEY IF NOT EXISTS idx_app_sessions_user_active (expires_at,revoked_at);
