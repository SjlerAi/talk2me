-- Talk2Me Issue #64 - Monthly Import finalisation prerequisite
-- REVIEWED ONE-OFF SQL ONLY. Back up production before applying this file manually.
-- Do not add this file to generic migrations and do not run npm run db:migrate.
-- Prerequisites:
--   sql/ONE_OFF_057_monthly_data_import.sql
--   sql/ONE_OFF_060_monthly_import_matching_review.sql

-- Schema preflight: read the exact live definition before preparing any DDL.
-- The generated ALTER starts with the live COLUMN_TYPE and appends one value only
-- when it is absent. No existing or future request_type value is hard-coded here.
SET @t2m_request_type_column_type = NULL;
SET @t2m_request_type_is_nullable = NULL;
SET @t2m_request_type_default = NULL;
SET @t2m_request_type_character_set = NULL;
SET @t2m_request_type_collation = NULL;
SET @t2m_request_type_comment = NULL;

SELECT
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  CHARACTER_SET_NAME,
  COLLATION_NAME,
  COLUMN_COMMENT
INTO
  @t2m_request_type_column_type,
  @t2m_request_type_is_nullable,
  @t2m_request_type_default,
  @t2m_request_type_character_set,
  @t2m_request_type_collation,
  @t2m_request_type_comment
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE()
  AND TABLE_NAME='data_change_requests'
  AND COLUMN_NAME='request_type'
LIMIT 1;

SELECT
  @t2m_request_type_column_type AS current_column_type,
  IF(
    LOCATE('''assign_account_number''',COALESCE(@t2m_request_type_column_type,'')) > 0,
    'assign_account_number already present; no ALTER required',
    'assign_account_number missing; the safe ALTER will append it'
  ) AS preflight_result;

SET @t2m_request_type_has_assignment =
  LOCATE('''assign_account_number''',COALESCE(@t2m_request_type_column_type,'')) > 0;

SET @t2m_request_type_new_column_type = IF(
  @t2m_request_type_has_assignment,
  @t2m_request_type_column_type,
  CONCAT(
    LEFT(@t2m_request_type_column_type,CHAR_LENGTH(@t2m_request_type_column_type)-1),
    ',''assign_account_number'')'
  )
);

SET @t2m_request_type_nullability = IF(
  @t2m_request_type_is_nullable='YES',
  ' NULL',
  ' NOT NULL'
);

SET @t2m_request_type_default_clause = CASE
  WHEN @t2m_request_type_default IS NOT NULL
    THEN CONCAT(' DEFAULT ',QUOTE(@t2m_request_type_default))
  WHEN @t2m_request_type_is_nullable='YES'
    THEN ' DEFAULT NULL'
  ELSE ''
END;

SET @t2m_request_type_charset_clause = IF(
  @t2m_request_type_character_set IS NULL,
  '',
  CONCAT(' CHARACTER SET ',@t2m_request_type_character_set)
);

SET @t2m_request_type_collation_clause = IF(
  @t2m_request_type_collation IS NULL,
  '',
  CONCAT(' COLLATE ',@t2m_request_type_collation)
);

SET @t2m_request_type_comment_clause = CONCAT(
  ' COMMENT ',
  QUOTE(COALESCE(@t2m_request_type_comment,''))
);

-- A missing preflight row deliberately references a non-existent sentinel table,
-- causing the script to stop before any ALTER. A second run is a harmless SELECT.
SET @t2m_request_type_sql = CASE
  WHEN @t2m_request_type_column_type IS NULL
    THEN 'SELECT * FROM monthly_import_preflight_failed_request_type_column_missing'
  WHEN @t2m_request_type_has_assignment
    THEN 'SELECT ''assign_account_number already present; schema unchanged'' AS monthly_import_result'
  ELSE CONCAT(
    'ALTER TABLE data_change_requests MODIFY COLUMN request_type ',
    @t2m_request_type_new_column_type,
    @t2m_request_type_charset_clause,
    @t2m_request_type_collation_clause,
    @t2m_request_type_nullability,
    @t2m_request_type_default_clause,
    @t2m_request_type_comment_clause
  )
END;

PREPARE t2m_request_type_statement FROM @t2m_request_type_sql;
EXECUTE t2m_request_type_statement;
DEALLOCATE PREPARE t2m_request_type_statement;

-- No new Monthly Import table is required. Finalisation uses the existing
-- monthly_import_actions applied_* fields as its idempotency record and writes all
-- live changes, audit rows, and action transitions in one transaction.
--
-- Production application:
-- 1. Back up the database.
-- 2. Apply this file once through the approved cPanel/phpMyAdmin SQL workflow.
-- 3. Review the preflight output and verify the reported live COLUMN_TYPE.
-- 4. Verify data_change_requests.request_type includes assign_account_number and
--    that every value from the preflight COLUMN_TYPE remains present.
-- 5. Run Monthly Import first with a small reviewed report set.
--
-- Rollback:
-- Do not remove assign_account_number while provisional requests use it. Application
-- rollback is performed by deploying the previous release; no imported live records
-- are deleted automatically.
