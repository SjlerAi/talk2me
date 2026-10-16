# Zippy standalone deployment runbook

This app is **separate from Talk2Me**. It has its own document root / Passenger application root, its own MySQL database and Gerda-only login. It is NOT a route inside the CRM website. The CRM bridge is optional and remains disabled until both apps are configured.

## The owner must do once

1. Create `zippy.uent.co.za` in cPanel DNS/domain management, with a valid HTTPS certificate, pointing to Zippy's independent Node application (NOT to `/home/uent/public_html/talk2me` and NOT to an existing CRM Passenger app). The domain did not resolve at the time the code was prepared.
2. Prefer a separate hosting account or service for Zippy. The existing shared CloudLinux account has repeatedly reached PID/thread limits. Do not add an always-running scheduler to that account.
3. Create a **new** MySQL database and restricted user, separate from `uent_Crm` and the CRM UAT DB. Grant that user only access to the Zippy database.
4. Create application secrets (never post them into chat or commit them). See `.env.example`.
5. Confirm the exact Talk2Me Gerda staff account ID and role, and configure the optional HMAC bridge on the UAT CRM only after verifying the right account.

## Application setup (Node 22+)

- Copy `apps/zippy/` to its own application root, e.g. `/home/<dedicated-user>/apps/zippy`. In cPanel Setup Node.js App, set the app URI to `zippy.uent.co.za`, app root to that directory, environment to Production, startup to `server.js`. Point DNS and SSL at that independent app.
- Run `npm install --omit=dev --no-audit --no-fund` in Zippy app root. Keep `node_modules` outside any public document root.
- Generate the password hash offline with `ZIPPY_NEW_PASSWORD='a-unique-very-long-password' node bin/hash-password.js`. Place only the resulting hash in `ZIPPY_PASSWORD_HASH`, not the password. Keep `ZIPPY_OWNER_EMAIL` set to Gerda's intended login email, and set `ZIPPY_COOKIE_SECRET` to a long random secret for future signed features.
- Set `ZIPPY_DB_*` settings for the separate private DB. `node bin/init-db.js` creates only tables beginning `zippy_`.
- Start Zippy via Passenger or the hosting service, then visit `/api/health`; verify login at `https://zippy.uent.co.za` and that `/api/me` is unauthenticated until Gerda signs in.
- Create VAPID keys with `npx web-push generate-vapid-keys` in your own administrator environment and populate `ZIPPY_VAPID_*`. In Zippy on Gerda's device, tap **Enable alerts** and allow notification permission. On iOS, install Zippy via Safari Share → Add to Home Screen before enabling push. Desktop/Android browsers also require permission.
- **Schedule exactly one** `node bin/tick.js` job every minute in a proper scheduler on the *Zippy hosting environment*; do not run a persistent polling loop or deploy it to the busy CRM account. A cron example is `* * * * * cd /path/to/zippy && /path/to/node bin/tick.js >> /path/to/private/zippy-reminders.log 2>&1`.
- Test a reminder due within five minutes with the browser closed on Gerda's device; verify push, notification open, snooze, Done and recurring scheduling. A green health endpoint alone is NOT proof that notifications reach the device.

## Talk2Me CRM bridge (UAT only)

Optional `src/routes/zippy-bridge.js` is mounted in the Talk2Me CRM only in UAT, and only when enabled with `ZIPPY_BRIDGE_SECRET` (at least 32 characters) and `ZIPPY_BRIDGE_GERDA_STAFF_ID`. Set the **same** secret in Zippy as `ZIPPY_CRM_BRIDGE_SECRET` and set `ZIPPY_CRM_BASE_URL=https://uent.co.za/talk2me` for UAT. Only the configured active owner/manager CRM staff ID can be used. No Gerda password or CRM session cookie is stored in Zippy. All bridge requests are signed, timestamped and nonce-protected. The bridge uses CRM-resolved staff identities and returns a preview token. Only Gerda's explicit confirmation sends the internal message and creates its monitored task; WhatsApp and email are disabled in the bridge initially.

Do not activate the CRM bridge until a separate Zippy site is healthy and user identity has been verified. Never expose personal Zippy reminders via CRM endpoints.

## Known first-release limitations

- Voice relies on browser speech recognition and needs a microphone tap; it is not always listening in the background.
- Mobile push requires VAPID configuration, permission, compatible browser/device and the scheduled job. Delivery is subject to device settings/network conditions; this is not a medical-grade alarm.
- Natural-language parsing handles common English/Afrikaans reminders, deadlines and recurrence; ambiguous instructions ask a follow-up rather than inventing dates.
- External WhatsApp/email delivery, native mobile alarm behavior, passkeys and encrypted backups are later enhancements. This first version offers private reminders/calendar, contacts and confirmed internal CRM work.
