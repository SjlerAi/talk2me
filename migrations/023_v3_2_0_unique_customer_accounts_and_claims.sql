-- Talk2Me CRM v3.2.0 -- canonical unique accounts and staff claim approvals
-- Import into uent_talk2me_crm after migration 022.

CREATE TABLE IF NOT EXISTS customer_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_number VARCHAR(80) NOT NULL,
  account_number_normalised VARCHAR(80) NOT NULL,
  display_name VARCHAR(180) NULL,
  assigned_staff_id BIGINT UNSIGNED NULL,
  assigned_by BIGINT UNSIGNED NULL,
  assignment_confirmed_at DATETIME NULL,
  account_status ENUM('active','inactive','cancelled','unknown') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_accounts_number (account_number_normalised),
  KEY idx_customer_accounts_staff (assigned_staff_id),
  CONSTRAINT fk_customer_accounts_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_customer_accounts_assigner FOREIGN KEY (assigned_by) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_id BIGINT UNSIGNED NULL AFTER account_number;
ALTER TABLE fixed_accounts ADD COLUMN IF NOT EXISTS account_id BIGINT UNSIGNED NULL AFTER account_number_normalised;
CREATE INDEX IF NOT EXISTS idx_clients_account_id ON clients (account_id);
CREATE INDEX IF NOT EXISTS idx_fixed_accounts_account_id ON fixed_accounts (account_id);

INSERT INTO customer_accounts (account_number,account_number_normalised,display_name)
SELECT MIN(source.account_number),source.account_number_normalised,MAX(source.display_name)
FROM (
  SELECT TRIM(account_number) account_number,UPPER(REPLACE(TRIM(account_number),' ','')) account_number_normalised,MAX(client_name) display_name
  FROM clients WHERE account_number IS NOT NULL AND TRIM(account_number)<>''
  GROUP BY UPPER(REPLACE(TRIM(account_number),' ',''))
  UNION ALL
  SELECT TRIM(account_number),UPPER(REPLACE(TRIM(account_number),' ','')),MAX(customer_name)
  FROM fixed_accounts WHERE account_number IS NOT NULL AND TRIM(account_number)<>''
  GROUP BY UPPER(REPLACE(TRIM(account_number),' ',''))
) source
GROUP BY source.account_number_normalised
ON DUPLICATE KEY UPDATE display_name=COALESCE(customer_accounts.display_name,VALUES(display_name));

UPDATE clients c JOIN customer_accounts a ON a.account_number_normalised=UPPER(REPLACE(TRIM(c.account_number),' ','')) SET c.account_id=a.id WHERE c.account_number IS NOT NULL AND TRIM(c.account_number)<>'';
UPDATE fixed_accounts f JOIN customer_accounts a ON a.account_number_normalised=UPPER(REPLACE(TRIM(f.account_number),' ','')) SET f.account_id=a.id WHERE f.account_number IS NOT NULL AND TRIM(f.account_number)<>'';

UPDATE customer_accounts a
LEFT JOIN (
  SELECT ca.account_number,ca.assigned_staff_id,ca.assigned_by
  FROM client_assignments ca
  WHERE ca.is_active=1 AND ca.account_number IS NOT NULL AND ca.account_number<>''
) x ON UPPER(REPLACE(TRIM(x.account_number),' ',''))=a.account_number_normalised
SET a.assigned_staff_id=COALESCE(a.assigned_staff_id,x.assigned_staff_id),a.assigned_by=COALESCE(a.assigned_by,x.assigned_by),a.assignment_confirmed_at=CASE WHEN COALESCE(a.assigned_staff_id,x.assigned_staff_id) IS NOT NULL THEN COALESCE(a.assignment_confirmed_at,NOW()) ELSE NULL END;

UPDATE customer_accounts a JOIN fixed_accounts f ON f.account_id=a.id
SET a.assigned_staff_id=COALESCE(a.assigned_staff_id,f.assigned_staff_id),a.assignment_confirmed_at=CASE WHEN COALESCE(a.assigned_staff_id,f.assigned_staff_id) IS NOT NULL THEN COALESCE(a.assignment_confirmed_at,NOW()) ELSE NULL END
WHERE f.assigned_staff_id IS NOT NULL;

-- Existing approval enum is extended without removing any existing request types.
ALTER TABLE data_change_requests MODIFY COLUMN request_type ENUM('create_client','update_client','add_line','archive_record','delete_record','change_authority','change_upgrade','change_assignment','claim_account','add_fixed_service') NOT NULL;

UPDATE clients SET main_contact_name=NULL WHERE LOWER(TRIM(main_contact_name))='null';
UPDATE clients SET main_contact_number=NULL WHERE LOWER(TRIM(main_contact_number))='null';
