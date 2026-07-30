-- Talk2Me Issue #64 - Monthly Import finalisation prerequisite
-- REVIEWED ONE-OFF SQL ONLY. Back up production before applying this file manually.
-- Do not add this file to generic migrations and do not run npm run db:migrate.
-- Prerequisites:
--   sql/ONE_OFF_057_monthly_data_import.sql
--   sql/ONE_OFF_060_monthly_import_matching_review.sql

-- The existing provisional mobile workflow already writes assign_account_number
-- requests. Include that established workflow value explicitly so Monthly Import
-- can create safe provisional mobile records without bypassing account review.
ALTER TABLE data_change_requests MODIFY COLUMN request_type ENUM(
  'create_client','update_client','add_line','archive_record','delete_record',
  'change_authority','change_upgrade','change_assignment','claim_account',
  'add_fixed_service','update_fixed_service','assign_account_number'
) NOT NULL;

-- No new Monthly Import table is required. Finalisation uses the existing
-- monthly_import_actions applied_* fields as its idempotency record and writes all
-- live changes, audit rows, and action transitions in one transaction.
--
-- Production application:
-- 1. Back up the database.
-- 2. Apply this file once through the approved cPanel/phpMyAdmin SQL workflow.
-- 3. Verify data_change_requests.request_type includes assign_account_number.
-- 4. Run Monthly Import first with a small reviewed report set.
--
-- Rollback:
-- Do not remove assign_account_number while provisional requests use it. Application
-- rollback is performed by deploying the previous release; no imported live records
-- are deleted automatically.
