-- Talk2Me CRM Phase 2.1
-- Safe extension: line identity, upgrade calculation and authorised account contact.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS cell_number_normalised VARCHAR(20) NULL AFTER cell_number,
  ADD COLUMN IF NOT EXISTS line_status ENUM('active','inactive','cancelled','suspended','unknown') NOT NULL DEFAULT 'unknown' AFTER cancellation_date,
  ADD COLUMN IF NOT EXISTS previous_upgrade_date DATE NULL AFTER monthly_invoice_amount,
  ADD COLUMN IF NOT EXISTS contract_term_months SMALLINT UNSIGNED NOT NULL DEFAULT 24 AFTER previous_upgrade_date,
  ADD COLUMN IF NOT EXISTS next_upgrade_date DATE NULL AFTER contract_term_months,
  ADD COLUMN IF NOT EXISTS last_upgrade_consultant VARCHAR(120) NULL AFTER next_upgrade_date,
  ADD COLUMN IF NOT EXISTS main_contact_name VARCHAR(160) NULL AFTER line_status,
  ADD COLUMN IF NOT EXISTS main_contact_number VARCHAR(30) NULL AFTER main_contact_name,
  ADD COLUMN IF NOT EXISTS main_contact_number_normalised VARCHAR(20) NULL AFTER main_contact_number,
  ADD COLUMN IF NOT EXISTS account_authority_status ENUM('unknown','confirmed','not_authorised') NOT NULL DEFAULT 'unknown' AFTER main_contact_number_normalised,
  ADD COLUMN IF NOT EXISTS authority_verified_at DATETIME NULL AFTER account_authority_status,
  ADD COLUMN IF NOT EXISTS authority_verified_by BIGINT UNSIGNED NULL AFTER authority_verified_at,
  ADD COLUMN IF NOT EXISTS authority_notes TEXT NULL AFTER authority_verified_by;

-- In the live import, upgrade_date is already the calculated 24-month due date.
-- The true source date is retained in raw_import_json.previous_upgrade_date.
UPDATE clients
SET previous_upgrade_date = COALESCE(
  previous_upgrade_date,
  STR_TO_DATE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json,'$.previous_upgrade_date')),''),'%Y-%m-%d')
)
WHERE raw_import_json IS NOT NULL;

-- For CRM-created records that have no import JSON, preserve the existing value as the source date.
UPDATE clients
SET previous_upgrade_date = COALESCE(previous_upgrade_date, upgrade_date)
WHERE raw_import_json IS NULL AND upgrade_date IS NOT NULL;

UPDATE clients
SET contract_term_months = 24
WHERE contract_term_months IS NULL OR contract_term_months NOT IN (24,36);

UPDATE clients
SET next_upgrade_date = CASE
      WHEN source_system='Excel Upgrades Database' AND upgrade_date IS NOT NULL THEN upgrade_date
      ELSE DATE_ADD(previous_upgrade_date, INTERVAL contract_term_months MONTH)
    END,
    upgrade_date = CASE
      WHEN source_system='Excel Upgrades Database' AND upgrade_date IS NOT NULL THEN upgrade_date
      ELSE DATE_ADD(previous_upgrade_date, INTERVAL contract_term_months MONTH)
    END
WHERE previous_upgrade_date IS NOT NULL OR upgrade_date IS NOT NULL;

UPDATE clients
SET last_upgrade_consultant = NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json,'$.last_upgrade_consultant'))),'')
WHERE raw_import_json IS NOT NULL;

UPDATE clients
SET main_contact_name = NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json,'$.main_contact_name'))),''),
    main_contact_number = NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json,'$.main_contact_number'))),'')
WHERE raw_import_json IS NOT NULL;

-- Convert South African numbers to a stable matching value: 082... and +2782... become 2782...
UPDATE clients
SET cell_number_normalised = CASE
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(cell_number,' ',''),'-',''),'(',''),')',''),'+',''),'.','') REGEXP '^0[0-9]{9}$'
    THEN CONCAT('27', SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(cell_number,' ',''),'-',''),'(',''),')',''),'+',''),'.',''),2))
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(cell_number,' ',''),'-',''),'(',''),')',''),'+',''),'.','') REGEXP '^27[0-9]{9}$'
    THEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(cell_number,' ',''),'-',''),'(',''),')',''),'+',''),'.','')
  ELSE NULL
END;

UPDATE clients
SET main_contact_number_normalised = CASE
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(main_contact_number,' ',''),'-',''),'(',''),')',''),'+',''),'.','') REGEXP '^0[0-9]{9}$'
    THEN CONCAT('27', SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(main_contact_number,' ',''),'-',''),'(',''),')',''),'+',''),'.',''),2))
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(main_contact_number,' ',''),'-',''),'(',''),')',''),'+',''),'.','') REGEXP '^27[0-9]{9}$'
    THEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(main_contact_number,' ',''),'-',''),'(',''),')',''),'+',''),'.','')
  ELSE NULL
END;

CREATE INDEX IF NOT EXISTS idx_clients_cell_normalised ON clients (cell_number_normalised);
CREATE INDEX IF NOT EXISTS idx_clients_account_line ON clients (account_number, line_status);
CREATE INDEX IF NOT EXISTS idx_clients_next_upgrade ON clients (next_upgrade_date);

-- Reuse the existing correction log and make valid ID dates authoritative.
INSERT INTO birthday_corrections (client_id,previous_birthday,derived_birthday)
SELECT c.id,c.birthday,
  STR_TO_DATE(CONCAT(
    CASE WHEN CAST(LEFT(TRIM(c.id_number),2) AS UNSIGNED) > MOD(YEAR(CURDATE()),100) THEN '19' ELSE '20' END,
    LEFT(TRIM(c.id_number),6)
  ),'%Y%m%d')
FROM clients c
WHERE TRIM(c.id_number) REGEXP '^[0-9]{13}$'
  AND STR_TO_DATE(CONCAT(
    CASE WHEN CAST(LEFT(TRIM(c.id_number),2) AS UNSIGNED) > MOD(YEAR(CURDATE()),100) THEN '19' ELSE '20' END,
    LEFT(TRIM(c.id_number),6)
  ),'%Y%m%d') IS NOT NULL
  AND NOT (c.birthday <=> STR_TO_DATE(CONCAT(
    CASE WHEN CAST(LEFT(TRIM(c.id_number),2) AS UNSIGNED) > MOD(YEAR(CURDATE()),100) THEN '19' ELSE '20' END,
    LEFT(TRIM(c.id_number),6)
  ),'%Y%m%d'));

UPDATE clients c
SET c.birthday = STR_TO_DATE(CONCAT(
  CASE WHEN CAST(LEFT(TRIM(c.id_number),2) AS UNSIGNED) > MOD(YEAR(CURDATE()),100) THEN '19' ELSE '20' END,
  LEFT(TRIM(c.id_number),6)
),'%Y%m%d')
WHERE TRIM(c.id_number) REGEXP '^[0-9]{13}$'
  AND STR_TO_DATE(CONCAT(
    CASE WHEN CAST(LEFT(TRIM(c.id_number),2) AS UNSIGNED) > MOD(YEAR(CURDATE()),100) THEN '19' ELSE '20' END,
    LEFT(TRIM(c.id_number),6)
  ),'%Y%m%d') IS NOT NULL;
