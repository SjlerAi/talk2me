-- Talk2Me Gerda Agent daily responsibility foundation
-- ADDITIVE ONLY: creates new Agent support tables and does not alter existing CRM history.

CREATE TABLE IF NOT EXISTS agent_task_watches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  issued_by BIGINT UNSIGNED NOT NULL,
  assigned_to BIGINT UNSIGNED NOT NULL,
  due_at DATETIME NOT NULL,
  alert_enabled TINYINT(1) NOT NULL DEFAULT 1,
  overdue_alerted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_task_watch_task (task_id),
  KEY idx_agent_task_watch_due (alert_enabled,due_at,overdue_alerted_at),
  KEY idx_agent_task_watch_assignee (assigned_to,due_at),
  KEY idx_agent_task_watch_issuer (issued_by,due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_responsibility_checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  work_date DATE NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_key VARCHAR(160) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'completed',
  completed_at DATETIME NULL,
  completed_by BIGINT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_responsibility_check (work_date,staff_id,source_type,source_key),
  KEY idx_agent_responsibility_staff_date (staff_id,work_date,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
