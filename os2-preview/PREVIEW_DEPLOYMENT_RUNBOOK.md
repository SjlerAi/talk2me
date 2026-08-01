# Talk2Me OS2 Preview Deployment Runbook

This runbook applies only to `talk2me.kloka.co.za` and database `kloka_talk2me`.
It must never be used against `talk2me.uent.co.za` or any production database.

## 1. Pre-deployment controls

1. Confirm the checked-out branch is `agent/talk2me-os2-integrated-rebuild`.
2. Confirm the application directory is `/home/kloka/repositories/talk2me/os2-preview`.
3. Confirm `DB_NAME=kloka_talk2me`.
4. Confirm `ALLOW_PRODUCTION_MUTATION=false` and `ENABLE_CUSTOMER_MERGE_EXECUTION=false`.
5. Confirm a current preview-database backup exists and has passed backup verification.
6. Stop when `package-lock.json` is absent. Do not substitute `npm install` for the controlled release path.
7. Install dependencies with `npm ci` from the committed lockfile.
8. Run `npm run check`.
9. Run `npm run check:readiness`.
10. Stop immediately if either command reports a failure.

## 2. Controlled migration

Set `ALLOW_PREVIEW_MIGRATIONS=true` only for the migration command and keep both prohibited execution flags false.

```bash
DB_NAME=kloka_talk2me \
ALLOW_PREVIEW_MIGRATIONS=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run migrate:preview
```

The migration runner must:

- refuse every database except `kloka_talk2me`;
- reject `ALLOW_PRODUCTION_MUTATION=true`;
- reject `ENABLE_CUSTOMER_MERGE_EXECUTION=true`;
- securely open the migrations directory with `O_DIRECTORY | O_NOFOLLOW`;
- securely open every migration with `O_NOFOLLOW`;
- compare path and descriptor device/inode identity;
- reject symbolic links and additional hard links;
- reject group-writable or world-writable migration sources;
- enforce a maximum migration file size;
- reject invalid SQL migration filenames rather than silently ignoring them;
- require at least 25 migrations and explicit migration 025 presence;
- read and freeze the complete migration source inventory before connecting to the database;
- acquire the MySQL advisory lock `talk2me_os2_preview_migrations` before ledger or migration activity;
- bind the advisory lock to the current MySQL `CONNECTION_ID()`;
- verify advisory-lock ownership through `IS_USED_LOCK()` before migration work;
- stop when lock ownership differs from the active migration connection;
- load migration ledger rows in primary-key order;
- require the applied ledger to be an exact strict prefix of the ordered source inventory;
- reject unknown, duplicate, reordered, skipped, or future ledger entries;
- validate every stored ledger checksum before applying any new migration;
- stop when an already-applied migration checksum differs;
- confirm advisory-lock ownership again before release;
- require `RELEASE_LOCK()` to report successful release.

Only one controlled migration process may operate against the preview database at a time. Any ledger gap, order mismatch, checksum mismatch, or advisory-lock ownership mismatch is a hard stop and requires investigation before rerunning migrations.

## 3. Mandatory preview data verification

After migration and before application restart, run the fail-closed database verification chain:

```bash
DB_NAME=kloka_talk2me npm run verify:preview-data
```

This command must complete the following checks in this exact order:

1. `schema-verification.js`
2. `merge-restore-evidence-verification.js`

Stop immediately if either verifier fails, is terminated by a signal, or cannot start. Do not bypass the orchestrator by running only one child verifier. A passing result must identify database `kloka_talk2me` and retain `mergeExecutionEnabled: false`.

## 4. Application restart

Restart only the preview Node.js application after `npm run verify:preview-data` passes. Do not restart, modify, or redeploy the production application.

After restart, verify:

```bash
curl -fsS https://talk2me.kloka.co.za/health
```

The response must show the expected preview version, connected preview database, and `ok: true`.

## 5. Smoke test order

1. Sign in using a preview staff account.
2. Open the dashboard.
3. Search for a copied customer.
4. Open Customer 360.
5. Create and transition a preview work item.
6. Create a preview notification.
7. Test a preview ownership claim and approval using separate accounts.
8. Test a mobile service update that does not require approval.
9. Test a restricted service update that creates an approval request.
10. Confirm audit entries exist for every mutation.

## 6. Email worker

Keep `EMAIL_WORKER_ENABLED=false` until SMTP settings have been verified and a controlled test recipient is approved. Then follow `EMAIL_WORKER_RUNBOOK.md`.

## 7. Rollback

- Stop the preview application.
- Restore the preview database backup if migration or data validation fails.
- Re-run `npm run verify:preview-data` against the restored preview database before restarting.
- Reset the preview working tree to the previously verified preview commit.
- Restart only the preview application.
- Record the failure and rollback result in GitHub Issue #83.

## 8. Completion rule

Do not declare the rebuild deployable merely because code was committed. Deployment, migration, preview data verification, smoke testing, permission testing, and formal UAT must all be completed and recorded first.
