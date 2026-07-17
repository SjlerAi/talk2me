-- Talk2Me CRM v1.18.0
-- Potential clients, complete client editing and database update support.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lifecycle_status ENUM('prospect','client','inactive','lost') NOT NULL DEFAULT 'client' AFTER customer_type,
  ADD COLUMN IF NOT EXISTS lead_source VARCHAR(120) NULL AFTER lifecycle_status,
  ADD COLUMN IF NOT EXISTS lead_status ENUM('new','contacted','qualified','converted','not_interested') NULL AFTER lead_source,
  ADD COLUMN IF NOT EXISTS city_town VARCHAR(140) NULL AFTER email,
  ADD COLUMN IF NOT EXISTS birthday DATE NULL AFTER id_number,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL AFTER cancellation_date,
  ADD COLUMN IF NOT EXISTS created_from_inquiry_id BIGINT UNSIGNED NULL AFTER notes,
  ADD COLUMN IF NOT EXISTS created_by_staff_id BIGINT UNSIGNED NULL AFTER created_from_inquiry_id;

UPDATE clients SET lifecycle_status='client' WHERE lifecycle_status IS NULL OR lifecycle_status='';

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='clients' AND index_name='idx_clients_lifecycle')=0,
  'CREATE INDEX idx_clients_lifecycle ON clients (lifecycle_status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='clients' AND index_name='idx_clients_lead_status')=0,
  'CREATE INDEX idx_clients_lead_status ON clients (lead_status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='clients' AND index_name='idx_clients_phone_lifecycle')=0,
  'CREATE INDEX idx_clients_phone_lifecycle ON clients (cell_number, lifecycle_status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
