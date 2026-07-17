# Talk2Me CRM v3.1.0 deployment

This release adds Fixed Accounts and Fixed Services while retaining the existing mobile CRM.

## Correct order

1. Back up the `uent_talk2me_crm` database in phpMyAdmin.
2. In phpMyAdmin, click the `uent_talk2me_crm` database. Do not select `uent_Attendance`.
3. Import `migrations/022_v3_1_0_fixed_services.sql`.
4. Confirm that phpMyAdmin shows `fixed_accounts` and `fixed_services` and that the import completed without an error.
5. Upload the v3.1.0 ZIP into `public_html/talk2me/` and extract it there, replacing the application files but keeping the live `.env` file.
6. In cPanel Node.js App, set the application version to `3.1.0` if that field is shown.
7. Run `npm install` and then restart the Node.js application.

## Expected imported totals

- Fixed accounts: 22
- Fixed services: 42
- Exact mobile-account links: 7 fixed accounts
- Fixed-only accounts awaiting optional manual linking: 15

The migration is idempotent: importing it again updates matching source records instead of creating duplicate fixed accounts or services.

## Smoke test

1. Log in and confirm the footer displays Version 3.1.0.
2. Open Customers → Fixed Accounts and confirm 22 accounts.
3. Open Customers → Fixed Services and confirm 42 services.
4. Search `B0055790` in the top search bar. It should show mobile and fixed results.
5. Search `S25109390044`. It should open the PNP Finance fixed account.
6. Open a fixed account, create a fixed inquiry, and confirm it appears in Fixed Customer 360.
7. Create a task from Fixed Customer 360 and confirm the fixed account is displayed on the task.
8. Open Reports → Fixed Services, test Export CSV and Print.

## Data-quality flags retained

- Two imported services have no activation date.
- One imported service has no SIM number.
- MAC `FC3FFC2FOOA5` is retained exactly as supplied and flagged for verification because it contains the letter O.

No fixed SIM number is treated as a customer contact telephone number.
