# Talk2Me OS2 Preview Deployment Runbook

This runbook applies only to `talk2me.kloka.co.za` and database `kloka_talk2me`.
It must never be used against `talk2me.uent.co.za` or any production database.

## 1. Pre-deployment controls

1. Confirm the checked-out branch is `agent/talk2me-os2-integrated-rebuild`.
2. Confirm the application directory is `/home/kloka/repositories/talk2me/os2-preview`.
3. Confirm `DB_NAME=kloka_talk2me`.
4. Confirm a current preview-database backup exists.
5. Install dependencies with `npm ci` where a lockfile is available, otherwise `npm install`.
6. Run `npm run check`.
7. Run `npm run check:readiness`.
8. Stop immediately if either command reports a failure.

## 2. Controlled migration

Set `ALLOW_PREVIEW_MIGRATIONS=true` only for the migration command.

```bash
ALLOW_PREVIEW_MIGRATIONS=true npm run migrate:preview
```

The migration runner refuses any database name other than `kloka_talk2me`, records every migration checksum, and stops if an already-applied migration has changed.

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
