-- Talk2Me CRM v1.12.1
-- Fix Client Administration search by adding the fields used by the Back Office.
-- Safe to run more than once inside database uent_talk2me_crm.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS city_town VARCHAR(160) NULL AFTER email,
  ADD COLUMN IF NOT EXISTS birthday DATE NULL AFTER upgrade_date;

UPDATE clients
SET
  city_town = COALESCE(
    NULLIF(TRIM(city_town), ''),
    NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json, '$.city_town'))), '')
  ),
  birthday = COALESCE(
    birthday,
    STR_TO_DATE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json, '$.birthday')), ''), '%Y-%m-%d')
  )
WHERE raw_import_json IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_city_town ON clients (city_town);
CREATE INDEX IF NOT EXISTS idx_clients_birthday ON clients (birthday);
