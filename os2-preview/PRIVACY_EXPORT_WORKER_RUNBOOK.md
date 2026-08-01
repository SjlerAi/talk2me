# Talk2Me OS2 Privacy Export Worker Runbook

This runbook applies only to the preview environment at `talk2me.kloka.co.za` and database `kloka_talk2me`.

## Safety controls

The worker refuses to start unless:

- `DB_NAME=kloka_talk2me`
- `PRIVACY_EXPORT_WORKER_ENABLED=true`
- `PRIVACY_EXPORT_DIR` resolves to an absolute private server path

The export directory must not be inside the public web root.

Recommended path:

`/home/kloka/repositories/talk2me/private/privacy-exports`

Directory permissions must be restricted to the application account. Export files are created with owner-only read/write permissions.

## Required environment variables

```text
DB_HOST=localhost
DB_PORT=3306
DB_USER=kloka_talk
DB_PASSWORD=...
DB_NAME=kloka_talk2me
PRIVACY_EXPORT_WORKER_ENABLED=true
PRIVACY_EXPORT_DIR=/home/kloka/repositories/talk2me/private/privacy-exports
PRIVACY_EXPORT_BATCH_SIZE=3
PRIVACY_EXPORT_INTERVAL_MS=30000
```

## Controlled activation sequence

1. Back up the preview database.
2. Pull the approved rebuild branch.
3. Run `npm install` in `os2-preview`.
4. Run `npm run check`.
5. Enable preview migrations only for the migration command.
6. Run `ALLOW_PREVIEW_MIGRATIONS=true npm run migrate:preview`.
7. Run `npm run verify:schema`.
8. Confirm that migration 010 is recorded in `os2_schema_migrations`.
9. Confirm the export directory is outside the public web root.
10. Start one worker process with `npm run start:privacy-export-worker`.

Do not start multiple workers until single-worker preview testing has passed.

## Processing rules

- Only queued, unexpired exports are claimed.
- A database row lock protects queue claiming.
- Stale processing claims are reset after 20 minutes.
- Only approved or completed access/export requests are processed.
- The worker retries a failed export up to three times.
- The generated export receives a SHA-256 checksum.
- Database document metadata may be exported, but stored document binary content is not copied into the privacy export.
- The database stores the private server path; no public URL is generated.

## Verification

Use a preview-only approved privacy request and queue one JSON export and one CSV-bundle export.

Verify:

- status changes from `queued` to `processing` to `ready`;
- `generated_at`, `row_count`, `file_count`, `total_bytes` and checksum are populated;
- directory and files are not web-accessible;
- JSON and CSV data correspond to the selected Master Customer;
- another customer's information is absent;
- failed jobs retain a controlled failure reason;
- the worker does not process unapproved requests.

## Incident handling

Stop the worker immediately if:

- an export appears in a public directory;
- the database name is not `kloka_talk2me`;
- an export contains data from more than one Master Customer;
- checksum verification fails;
- repeated queue resets occur;
- a request that is not approved is processed.

After stopping the worker, revoke the affected export, preserve the audit evidence, move generated files to a quarantined private directory and record the incident in the security-event process.

## Cleanup

Expired or revoked exports must be removed through a separately approved maintenance procedure. The worker does not silently delete exports.
