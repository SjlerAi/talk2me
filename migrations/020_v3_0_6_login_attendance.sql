-- Talk2Me CRM v3.0.6
-- Append-only staff login/logout and session attendance history.
CREATE TABLE IF NOT EXISTS staff_login_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  session_token CHAR(64) NOT NULL,
  login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  logout_at DATETIME NULL,
  session_status ENUM('active','logged_out','expired','replaced') NOT NULL DEFAULT 'active',
  logout_reason ENUM('manual','timeout','new_login','unknown') NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_login_token (session_token),
  KEY idx_staff_login_staff_date (staff_id,login_at),
  KEY idx_staff_login_status_expiry (session_status,expires_at),
  CONSTRAINT fk_staff_login_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
