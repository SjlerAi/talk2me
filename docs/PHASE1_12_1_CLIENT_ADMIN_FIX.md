# Talk2Me CRM v1.12.1 - Client Administration Fix

## Fix
The Back Office client search failed because the application queried `clients.city_town` and `clients.birthday`, but those columns were not yet present in the database.

## Install
1. Extract this flat ZIP directly into `public_html/talk2me` and overwrite existing files.
2. In phpMyAdmin, select `uent_talk2me_crm` and import:
   `migrations/012_client_admin_fields_fix.sql`
3. Change the Node.js environment variable:
   `APP_VERSION=1.12.1`
4. Save and restart the Node.js application.
5. Hard refresh the browser with Ctrl+F5.

No NPM install is required for this patch.
