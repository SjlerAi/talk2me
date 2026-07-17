-- Talk2Me CRM v1.12.2
-- Robust Client Administration fix.
-- Run inside the existing uent_talk2me_crm database.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS city_town VARCHAR(160) NULL AFTER email;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS birthday DATE NULL AFTER upgrade_date;

UPDATE clients
SET city_town = NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json, '$.city_town'))), '')
WHERE (city_town IS NULL OR TRIM(city_town) = '')
  AND raw_import_json IS NOT NULL
  AND LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json, '$.city_town')), ''))) NOT IN ('', 'null', 'undefined');

UPDATE clients
SET birthday = STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(raw_import_json, '$.birthday')), '%Y-%m-%d')
WHERE birthday IS NULL
  AND raw_import_json IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_import_json, '$.birthday')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
