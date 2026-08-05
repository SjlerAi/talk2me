-- GitHub issue #89 - enable owner-resolution records for immediate client claims.
-- This only extends the existing request-type enum; it creates no new workflow table.

SET @t2m_claim_column_type = NULL;
SET @t2m_claim_is_nullable = NULL;
SET @t2m_claim_default = NULL;

SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
INTO @t2m_claim_column_type,@t2m_claim_is_nullable,@t2m_claim_default
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE()
  AND TABLE_NAME='data_change_requests'
  AND COLUMN_NAME='request_type'
LIMIT 1;

SET @t2m_claim_has_type =
  LOCATE('''claim_client''',COALESCE(@t2m_claim_column_type,'')) > 0;

SET @t2m_claim_new_type = IF(
  @t2m_claim_has_type,
  @t2m_claim_column_type,
  CONCAT(LEFT(@t2m_claim_column_type,CHAR_LENGTH(@t2m_claim_column_type)-1),',''claim_client'')')
);

SET @t2m_claim_sql = CASE
  WHEN @t2m_claim_column_type IS NULL
    THEN 'SELECT * FROM immediate_claim_preflight_failed_request_type_column_missing'
  WHEN @t2m_claim_has_type
    THEN 'SELECT ''claim_client already present; schema unchanged'' AS immediate_claim_result'
  ELSE CONCAT(
    'ALTER TABLE data_change_requests MODIFY COLUMN request_type ',
    @t2m_claim_new_type,
    IF(@t2m_claim_is_nullable='YES',' NULL',' NOT NULL'),
    CASE
      WHEN @t2m_claim_default IS NOT NULL THEN CONCAT(' DEFAULT ',QUOTE(@t2m_claim_default))
      WHEN @t2m_claim_is_nullable='YES' THEN ' DEFAULT NULL'
      ELSE ''
    END
  )
END;

PREPARE t2m_claim_statement FROM @t2m_claim_sql;
EXECUTE t2m_claim_statement;
DEALLOCATE PREPARE t2m_claim_statement;
