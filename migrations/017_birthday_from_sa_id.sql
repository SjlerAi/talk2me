-- Talk2Me CRM v1.23.0
-- Derive and correct birthdays from the first six digits (YYMMDD) of valid 13-digit SA ID numbers.

CREATE TABLE IF NOT EXISTS birthday_corrections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id BIGINT UNSIGNED NOT NULL,
  previous_birthday DATE NULL,
  derived_birthday DATE NOT NULL,
  corrected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_birthday_corrections_client (client_id),
  KEY idx_birthday_corrections_date (corrected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TEMPORARY TABLE IF EXISTS tmp_client_birthdays;
CREATE TEMPORARY TABLE tmp_client_birthdays AS
SELECT
  id AS client_id,
  birthday AS previous_birthday,
  STR_TO_DATE(
    CONCAT(
      CASE
        WHEN CAST(LEFT(TRIM(id_number),2) AS UNSIGNED) > MOD(YEAR(CURDATE()),100)
          THEN CONCAT('19',LEFT(TRIM(id_number),2))
        ELSE CONCAT('20',LEFT(TRIM(id_number),2))
      END,
      SUBSTRING(TRIM(id_number),3,4)
    ),
    '%Y%m%d'
  ) AS derived_birthday
FROM clients
WHERE TRIM(id_number) REGEXP '^[0-9]{13}$';

DELETE FROM tmp_client_birthdays
WHERE derived_birthday IS NULL
   OR DATE_FORMAT(derived_birthday,'%y%m%d') <> LEFT((SELECT TRIM(id_number) FROM clients c WHERE c.id=tmp_client_birthdays.client_id),6);

INSERT INTO birthday_corrections (client_id,previous_birthday,derived_birthday)
SELECT t.client_id,t.previous_birthday,t.derived_birthday
FROM tmp_client_birthdays t
WHERE NOT (t.previous_birthday <=> t.derived_birthday)
  AND NOT EXISTS (
    SELECT 1 FROM birthday_corrections bc
    WHERE bc.client_id=t.client_id
      AND bc.previous_birthday <=> t.previous_birthday
      AND bc.derived_birthday=t.derived_birthday
  );

UPDATE clients c
JOIN tmp_client_birthdays t ON t.client_id=c.id
SET c.birthday=t.derived_birthday,
    c.updated_at=NOW()
WHERE NOT (c.birthday <=> t.derived_birthday);

DROP TEMPORARY TABLE IF EXISTS tmp_client_birthdays;
