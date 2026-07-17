# Talk2Me CRM v3.2.0 deployment

## Database first

1. Export a complete backup of `uent_talk2me_crm`.
2. Select `uent_talk2me_crm` in phpMyAdmin.
3. Import `migrations/023_v3_2_0_unique_customer_accounts_and_claims.sql`.
4. Confirm that `customer_accounts` exists.
5. Confirm that the migration completed without errors before replacing application files.

The migration treats account numbers as text. Prefixes such as B, V, VB and I and all leading zeros are preserved. Matching uses a separate uppercase, space-free normalized value.

## Application

Upload and extract the v3.2.0 ZIP into `public_html/talk2me/`, preserve the live `.env`, set the cPanel application version to 3.2.0, run `npm install`, and restart Node.js.

## Test

1. Open an account with multiple mobile lines and confirm one unique account number is displayed.
2. Test Add Mobile Line and verify the account number is prefilled and locked.
3. Test Add Fixed Service and confirm it appears under the same account.
4. Log in as staff on an unassigned account and submit Request Claim.
5. Confirm the account remains unassigned while the request is pending.
6. Log in as owner or manager, open Approvals, approve the claim, and confirm all lines become assigned.
7. Reject a second test claim and confirm the account remains unassigned.

Claim requests are included in the management morning digest and Command Centre approval count.
