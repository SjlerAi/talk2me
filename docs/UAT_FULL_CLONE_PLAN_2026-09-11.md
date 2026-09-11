# Talk2Me full-clone UI UAT plan — 11 Sep 2026

## Selected UAT space

Reuse the existing stopped cPanel Node application at:

- URL: `https://uent.co.za/talk2me`
- existing cPanel application root: `/home/uent/public_html/talk2me`
- Node runtime shown in cPanel: v20.20.2

The production application remains:

- URL: `https://talk2me.uent.co.za`
- production root: `/home/uent/talk2me.uent.co.za`

## Golden rule

UAT is a full application clone but must not use the production database. It must have its own database, database credentials, session state and runtime configuration. No UAT action may write to the live Talk2Me production database.

## Code baseline

Do not continue from whatever old code happens to be present in `/home/uent/public_html/talk2me`.

The UAT baseline is the current approved production source at exact main SHA:

`08fc4420735d3b672550cae06b43fd4875f17505`

Development branch:

`uat/talk2me-ui-redesign`

This preserves the newly completed Base Details integration and CRM technical cleanup while allowing an aggressive UI/navigation redesign without changing production.

## Database

Preferred UAT database name: `uent_talk2me_crm_uat` (or another available cPanel-compliant name).

Create it from a fresh copy of the current production `uent_talk2me_crm` database. Never use production DB credentials in the UAT `.env`.

## Runtime configuration

The existing subdirectory URL matches the application's default `BASE_PATH=/talk2me`, so the old `uent.co.za/talk2me` application is a good fit for the test space.

UAT `.env` must use:

- `BASE_PATH=/talk2me`
- separate `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- separate `SESSION_SECRET`
- UAT/test application name where useful

## Outbound-safety controls

Before UAT is opened for testing:

- do not install production cron jobs for UAT;
- disable/suppress scheduled staff and owner email jobs;
- disable customer campaign sending and any other outbound customer communication unless explicitly enabled for a controlled test;
- prevent search-engine indexing (`noindex`/robots protection);
- keep normal CRM authentication in place;
- make the UI visibly identify itself as UAT/TEST.

## UI redesign scope

Backbone remains unchanged wherever possible. Initial work is presentation/information architecture:

1. new shell/navigation;
2. My Day;
3. customer-first search and Customer 360;
4. Log Interaction;
5. Tasks & Follow-ups;
6. Upgrades/Opportunities;
7. simplified Management Dashboard;
8. grouped Team / Operations / Reports / Settings.

Existing routes/services/database structures remain available during the first redesign stage. No historical production data is deleted as part of UI simplification.

## Promotion rule

The UAT database is never promoted back to production. After owner/manager acceptance, approved code/UI changes are merged through the normal protected GitHub -> CI -> controlled Elitehost production release path. Production data remains authoritative throughout.
