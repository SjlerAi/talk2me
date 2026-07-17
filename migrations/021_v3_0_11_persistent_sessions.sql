-- Talk2Me CRM v3.0.11
-- Persistent eight-hour application sessions for cPanel/Passenger.
-- This prevents users being logged out when the Node process is recycled.
CREATE TABLE IF NOT EXISTS app_sessions (
  session_id CHAR(64) NOT NULL,
  session_data LONGTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id),
  KEY idx_app_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
