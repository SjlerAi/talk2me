-- Talk2Me CRM v3.2.3 -- protected mobile-line and fixed-service editing.
-- Existing service and line records remain in place; no delete operation is introduced.
ALTER TABLE data_change_requests MODIFY COLUMN request_type ENUM(
  'create_client','update_client','add_line','archive_record','delete_record',
  'change_authority','change_upgrade','change_assignment','claim_account',
  'add_fixed_service','update_fixed_service'
) NOT NULL;
