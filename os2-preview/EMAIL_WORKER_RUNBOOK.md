# Talk2Me OS2 preview email worker

This worker is for the isolated preview environment only. Do not point it at the production database or production SMTP credentials.

## Required environment variables

- `DB_HOST`
- `DB_PORT` (defaults to `3306`)
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME` (must be `kloka_talk2me` for preview)
- `EMAIL_WORKER_ENABLED=true`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`

Optional controls:

- `SMTP_SECURE=true` for implicit TLS, normally port 465
- `SMTP_REPLY_TO`
- `SMTP_ALLOW_INVALID_CERT=false`
- `EMAIL_MAX_ATTEMPTS=7`
- `EMAIL_WORKER_INTERVAL_MS=30000`
- `EMAIL_WORKER_BATCH_SIZE=10`
- `EMAIL_DB_CONNECTION_LIMIT=4`

## Before starting

1. Apply preview migration `20260801_007_email_worker_delivery.sql` after migrations 001-006.
2. Install dependencies with the lockfile-preserving package command used for the preview application.
3. Run `npm run check`.
4. Confirm `DB_NAME=kloka_talk2me`.
5. Use a preview/test recipient before enabling general delivery.

## Start command

`npm run start:email-worker`

Run the worker as a separate managed Node.js process. The web application and email worker must not share a process lifecycle.

## Delivery behaviour

- Queue rows are claimed with a database transaction and `FOR UPDATE`.
- Claimed rows move from `pending` to `processing`.
- Successful sends store the SMTP provider message ID and delivery time.
- Failed sends return to `pending` with bounded backoff.
- Rows become `failed` after the configured maximum attempts.
- Processing claims older than 15 minutes are released automatically.
- Linked in-app notifications are updated to `sent` or `failed`.

## Safe shutdown

The runner handles `SIGTERM` and `SIGINT`, closes the SMTP transport, and closes the database pool.

## Preview verification

1. Create one email notification for a controlled test staff account.
2. Confirm a row appears in `os2_email_queue` as `pending`.
3. Start the worker.
4. Confirm the row becomes `sent` and has `provider_message_id` and `sent_at` values.
5. Confirm the related notification has `delivery_status='sent'` and `delivered_at` set.
6. Test an intentionally invalid recipient and confirm retry/backoff without exposing SMTP credentials or raw errors to the UI.
