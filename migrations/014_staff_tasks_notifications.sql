-- Talk2Me CRM v1.14.0 - Staff tasks, notifications and email delivery
CREATE TABLE IF NOT EXISTS staff_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type ENUM('notification','task') NOT NULL DEFAULT 'task',
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  priority ENUM('normal','high','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('unread','seen','in_progress','completed','cancelled') NOT NULL DEFAULT 'unread',
  assigned_to BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  related_client_id BIGINT UNSIGNED NULL,
  related_inquiry_id BIGINT UNSIGNED NULL,
  due_at DATETIME NULL,
  seen_at DATETIME NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  completion_note TEXT NULL,
  email_status ENUM('pending','sent','failed','not_configured') NOT NULL DEFAULT 'pending',
  email_sent_at DATETIME NULL,
  email_error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_staff_tasks_assigned_status (assigned_to,status),
  KEY idx_staff_tasks_due (due_at),
  KEY idx_staff_tasks_created (created_at),
  CONSTRAINT fk_staff_tasks_assigned FOREIGN KEY (assigned_to) REFERENCES staff_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_staff_tasks_creator FOREIGN KEY (created_by) REFERENCES staff_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_staff_tasks_client FOREIGN KEY (related_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_staff_tasks_inquiry FOREIGN KEY (related_inquiry_id) REFERENCES inquiries(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_task_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  comment TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_comments_task (task_id,created_at),
  CONSTRAINT fk_task_comments_task FOREIGN KEY (task_id) REFERENCES staff_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_comments_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
