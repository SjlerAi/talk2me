-- Talk2Me Phase 1.5 - Customer Snapshot helper indexes
-- Safe to run multiple times on MySQL 8+ cPanel installs.

SET @db := DATABASE();

SET @exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'clients' AND index_name = 'idx_clients_id_number'
);
SET @sql := IF(@exists = 0, 'ALTER TABLE clients ADD INDEX idx_clients_id_number (id_number)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'clients' AND index_name = 'idx_clients_account_upgrade'
);
SET @sql := IF(@exists = 0, 'ALTER TABLE clients ADD INDEX idx_clients_account_upgrade (account_number, upgrade_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'inquiries' AND index_name = 'idx_inquiries_client_created'
);
SET @sql := IF(@exists = 0, 'ALTER TABLE inquiries ADD INDEX idx_inquiries_client_created (client_id, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'inquiries' AND index_name = 'idx_inquiries_email_created'
);
SET @sql := IF(@exists = 0, 'ALTER TABLE inquiries ADD INDEX idx_inquiries_email_created (email, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
