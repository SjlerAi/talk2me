# Talk2Me CRM v1.12.2

This patch fixes Client Administration search even when older database schemas do not yet contain `city_town` or `birthday`.

The route now reads those values safely from `raw_import_json`, while migration 013 adds and backfills the columns without converting text values such as `null` into dates.

## Install
1. Extract the flat ZIP directly into `public_html/talk2me` and overwrite existing files.
2. Import `migrations/013_client_admin_robust_fix.sql` in `uent_talk2me_crm`.
3. Set `APP_VERSION=1.12.2`.
4. Restart the Node.js app and hard refresh.
