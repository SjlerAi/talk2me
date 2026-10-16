# Zippy — standalone personal assistant for Gerda

Zippy runs independently at its own hostname with a private MySQL DB. Gerda can open or install it on phone/desktop, dictate or type a reminder, view her personal agenda, manage contacts, snooze/complete tasks and subscribe to push notifications when configured. CRM staff instructions use a separate optional HMAC bridge and always require an explicit send confirmation.

## What is implemented

- Gerda-only login with a hashed password, rate limiting, server-side hashed sessions, HTTP-only Secure cookies and anti-CSRF request requirements.
- Voice/text UI (English/Afrikaans), private personal command router, calendar appointments, reminders and common recurring schedules. Optional opt-in OpenAI Responses API interpretation for unfamiliar utterances (only after an administrator explicitly enables it, since speech content is sent to that provider).
- Standalone private contacts, reminders and durable alert history in a different database from Talk2Me.
- Cron-driven one-minute scheduling (no persistent reminder worker) and optional Web Push.
- PWA manifest, service worker, offline application shell, phone and desktop layouts.
- Optional CRM bridge: resolves names through the Talk2Me UAT interpreter, previews the message, then sends an internal CRM message and monitored task only after Gerda confirms.

## Setup

See `docs/DEPLOY.md` and `.env.example`. The domain needs a DNS record, SSL, isolated hosting, separate database, Gerda credentials and VAPID setup **before** this can be called live.

Run `npm install` and `npm run check` to test, `npm run db:init` to prepare private tables, and `npm start` for the application. Run `npm run reminders:tick` from an external every-minute scheduler after validating a reminder on the actual phone.

**Security:** Do not commit `.env`, database backups, Gerda's password, personal contact data, VAPID private keys or bridge secrets.
