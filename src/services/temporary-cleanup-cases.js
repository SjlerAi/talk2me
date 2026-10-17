'use strict';
// Read-only, common case definitions for queue, next-item and reporting.
const queryCases = {
  same_account_phone: `SELECT c.cell_number_normalised case_key,COUNT(*) record_count,COUNT(DISTINCT COALESCE(c.next_upgrade_date,c.upgrade_date)) upgrade_variants,COUNT(DISTINCT NULLIF(TRIM(c.client_name),'')) name_variants,
    MAX(c.client_name) display_name,MAX(c.account_number) display_account
    FROM clients c WHERE c.account_id IS NOT NULL AND c.cell_number_normalised REGEXP '^27[0-9]{9}$'
    GROUP BY c.cell_number_normalised HAVING COUNT(*)>1 AND COUNT(DISTINCT c.account_id)=1`,
  cross_account_phone: `SELECT c.cell_number_normalised case_key,COUNT(*) record_count,COUNT(DISTINCT COALESCE(c.next_upgrade_date,c.upgrade_date)) upgrade_variants,COUNT(DISTINCT NULLIF(TRIM(c.client_name),'')) name_variants,
    MAX(c.client_name) display_name,MAX(c.account_number) display_account
    FROM clients c WHERE c.cell_number_normalised REGEXP '^27[0-9]{9}$'
    GROUP BY c.cell_number_normalised HAVING COUNT(*)>1 AND COUNT(DISTINCT c.account_id)>1`,
  account_alias: `SELECT UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(a.account_number),'[-/][0-9][[:space:]]*$',''),'[^A-Z0-9]','')) case_key,
    COUNT(*) record_count,0 upgrade_variants,0 name_variants,MAX(a.display_name) display_name,MAX(a.account_number) display_account
    FROM customer_accounts a GROUP BY case_key HAVING case_key<>'' AND COUNT(*)>1`,
  staff_conflict: `SELECT UPPER(REPLACE(TRIM(a.account_number),' ','')) case_key,COUNT(*) record_count,0 upgrade_variants,0 name_variants,
    MAX(c.client_name) display_name,MAX(a.account_number) display_account FROM client_assignments a LEFT JOIN clients c ON c.id=a.client_id
    WHERE a.is_active=1 AND TRIM(COALESCE(a.account_number,''))<>'' GROUP BY case_key
    HAVING COUNT(DISTINCT a.assigned_staff_id)>1`,
  base_unlinked: `SELECT (CONVERT(CAST(b.id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci) case_key,1 record_count,0 upgrade_variants,0 name_variants,b.account_name display_name,b.account_code display_account
    FROM mobile_base_current b WHERE b.client_id IS NULL`
};
module.exports = {queryCases};
