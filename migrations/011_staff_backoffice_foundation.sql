-- Talk2Me CRM Phase 1.12 - Staff and Back Office foundation
-- Run inside the existing uent_talk2me_crm database.

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(80) NULL AFTER id,
  ADD COLUMN IF NOT EXISTS surname VARCHAR(80) NULL AFTER first_name,
  ADD COLUMN IF NOT EXISTS contact_number VARCHAR(30) NULL AFTER email,
  ADD COLUMN IF NOT EXISTS alternate_contact_number VARCHAR(30) NULL AFTER contact_number,
  ADD COLUMN IF NOT EXISTS id_number VARCHAR(30) NULL AFTER alternate_contact_number,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL AFTER id_number,
  ADD COLUMN IF NOT EXISTS job_title VARCHAR(100) NULL AFTER role,
  ADD COLUMN IF NOT EXISTS branch_name VARCHAR(120) NULL AFTER job_title,
  ADD COLUMN IF NOT EXISTS employment_start_date DATE NULL AFTER branch_name,
  ADD COLUMN IF NOT EXISTS profile_photo_path VARCHAR(255) NULL AFTER employment_start_date,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT NULL AFTER profile_photo_path,
  ADD COLUMN IF NOT EXISTS last_login_at DATETIME NULL AFTER internal_notes,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

CREATE TABLE IF NOT EXISTS staff_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('id_document','profile_photo','contract','other') NOT NULL DEFAULT 'other',
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  uploaded_by BIGINT UNSIGNED NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_staff_documents_staff (staff_id),
  CONSTRAINT fk_staff_documents_staff FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_staff_documents_uploader FOREIGN KEY (uploaded_by) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE staff_users
SET first_name = CASE WHEN first_name IS NULL OR first_name='' THEN SUBSTRING_INDEX(full_name,' ',1) ELSE first_name END,
    surname = CASE WHEN surname IS NULL OR surname='' THEN NULLIF(TRIM(SUBSTRING(full_name, LENGTH(SUBSTRING_INDEX(full_name,' ',1))+1)), '') ELSE surname END;
