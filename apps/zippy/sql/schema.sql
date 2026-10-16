-- Standalone Zippy database. NEVER point at the Talk2Me CRM database.
CREATE TABLE IF NOT EXISTS zippy_sessions (
 token_hash CHAR(64) PRIMARY KEY, owner_key VARCHAR(160) NOT NULL,
 created_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL,
 INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS zippy_reminders (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 owner_key VARCHAR(160) NOT NULL,
 title VARCHAR(160) NOT NULL, notes TEXT NULL,
 entry_type ENUM('reminder','appointment') NOT NULL DEFAULT 'reminder',
 due_at DATETIME(3) NOT NULL, recurrence VARCHAR(32) NULL,
 state ENUM('open','fired','done','cancelled') NOT NULL DEFAULT 'open',
 lease_id VARCHAR(48) NULL, lease_until DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 INDEX idx_due (state,due_at), INDEX idx_owner_due (owner_key,due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS zippy_contacts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 owner_key VARCHAR(160) NOT NULL, name VARCHAR(160) NOT NULL,
 relationship VARCHAR(96) NULL, phone VARCHAR(64) NULL, email VARCHAR(200) NULL,
 notes TEXT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX idx_owner_name (owner_key,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS zippy_alerts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 owner_key VARCHAR(160) NOT NULL, reminder_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(160) NOT NULL, scheduled_at DATETIME(3) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 delivered_at DATETIME(3) NULL, read_at DATETIME(3) NULL,
 UNIQUE KEY uniq_fire (reminder_id,scheduled_at),
 INDEX idx_alert_owner (owner_key,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS zippy_push_subscriptions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 owner_key VARCHAR(160) NOT NULL, endpoint_hash CHAR(64) NOT NULL UNIQUE,
 subscription_json TEXT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS zippy_crm_drafts (
 id CHAR(36) PRIMARY KEY, owner_key VARCHAR(160) NOT NULL,
 remote_token VARCHAR(200) NULL, preview_json TEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 expires_at DATETIME(3) NOT NULL, confirmed_at DATETIME(3) NULL,
 INDEX idx_owner_expiry (owner_key,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- New sessions remain compatible with Gerda's existing login, while
-- CRM-authenticated sessions track the live password version without copying it.
CREATE TABLE IF NOT EXISTS zippy_auth_sessions (
 token_hash CHAR(64) PRIMARY KEY,
 auth_source ENUM('local','crm') NOT NULL,
 credential_marker CHAR(64) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX idx_auth_source (auth_source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Persist the visible one-screen history. A unique key makes background CRM
-- polling and retries idempotent; records are isolated by Zippy owner_key.
CREATE TABLE IF NOT EXISTS zippy_activity (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 owner_key VARCHAR(160) NOT NULL,
 event_key VARCHAR(160) NOT NULL,
 kind ENUM('reminder_saved','reminder_due','crm_sent','crm_reply','crm_completed','crm_status','crm_overdue') NOT NULL,
 title VARCHAR(160) NOT NULL,
 body TEXT NULL,
 task_id BIGINT UNSIGNED NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uniq_owner_event (owner_key,event_key),
 INDEX idx_owner_recent (owner_key,id),
 INDEX idx_owner_task (owner_key,task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS zippy_crm_tracking (
 owner_key VARCHAR(160) NOT NULL,
 task_id BIGINT UNSIGNED NOT NULL,
 recipient_name VARCHAR(160) NOT NULL,
 last_status VARCHAR(32) NOT NULL DEFAULT 'unread',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 last_checked_at DATETIME(3) NULL,
 PRIMARY KEY (owner_key,task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- The push provider acknowledges acceptance, not physical phone delivery.
-- Keep a durable record of retry attempts when phones are offline.
CREATE TABLE IF NOT EXISTS zippy_push_retries (
 alert_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 owner_key VARCHAR(160) NOT NULL,
 attempts INT NOT NULL DEFAULT 0,
 next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 last_attempt_at DATETIME(3) NULL,
 accepted_at DATETIME(3) NULL,
 INDEX idx_pending (accepted_at,next_attempt_at,attempts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS zippy_scheduler_status (
 id INT NOT NULL PRIMARY KEY,
 last_tick_at DATETIME(3) NULL,
 processed INT NOT NULL DEFAULT 0,
 failed INT NOT NULL DEFAULT 0,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
