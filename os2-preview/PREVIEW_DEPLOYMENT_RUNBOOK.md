# Talk2Me OS2 Preview Deployment Runbook

This runbook applies only to `talk2me.kloka.co.za` and database `kloka_talk2me`.
It must never be used against `talk2me.uent.co.za` or any production database.

## 1. Pre-deployment controls

1. Confirm branch `agent/talk2me-os2-integrated-rebuild` and application root `/home/kloka/repositories/talk2me/os2-preview`.
2. Confirm `DB_NAME=kloka_talk2me`, `ALLOW_PRODUCTION_MUTATION=false`, and `ENABLE_CUSTOMER_MERGE_EXECUTION=false`.
3. Confirm a current verified preview backup exists.
4. Stop when `package-lock.json` is absent. Do not substitute `npm install`.
5. Install with `npm ci`, then run `npm run check` and `npm run check:readiness`.

## 2. One-time migration ledger bootstrap

The migration runner is prohibited from creating tables at runtime. Before the first governed migration run, verify that `os2_schema_migrations` does not already exist, review `MIGRATION_LEDGER_BOOTSTRAP.sql`, and apply that file manually to `kloka_talk2me` only.

Hard stops:

- never apply the bootstrap to production;
- never change the bootstrap SQL without review and a new commit;
- stop if the table already exists unexpectedly;
- stop if the runner reports `MIGRATION_LEDGER_BOOTSTRAP_REQUIRED`;
- do not replace the bootstrap with runtime `CREATE TABLE` logic.

The runner verifies the ledger table engine, collation, exact ordered columns, defaults, primary key, and unique migration-name key before reading ledger contents or applying migrations.

## 3. Controlled migration

```bash
DB_NAME=kloka_talk2me \
ALLOW_PREVIEW_MIGRATIONS=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run migrate:preview
```

The runner securely freezes migration sources, acquires `talk2me_os2_preview_migrations`, binds ownership to `CONNECTION_ID()`, verifies ownership with `IS_USED_LOCK()`, validates the ledger as an exact checksum-matching strict prefix of source, applies only the remaining ordered migrations, and confirms `RELEASE_LOCK()`.

Unknown, duplicate, reordered, skipped, future, malformed, or checksum-mismatched ledger entries are hard stops. Only one controlled migration process may operate at a time.

## 4. Mandatory preview data verification

After migration and before restart:

```bash
DB_NAME=kloka_talk2me npm run verify:preview-data
```

This must run `schema-verification.js` followed by `merge-restore-evidence-verification.js`. Running only `npm run verify:schema` is not sufficient. A passing result must retain `mergeExecutionEnabled: false`.

## 5. Restart and smoke testing

Restart only the preview Node.js application. Do not restart or modify production. Verify `https://talk2me.kloka.co.za/health`, then test login, dashboard, customer search, Customer 360, work items, notifications, ownership claims, approvals, service updates, restrictions, and audit records.

Keep `EMAIL_WORKER_ENABLED=false` until SMTP is separately verified.

## 6. Rollback

Stop preview, restore the verified preview backup, rerun preview-data verification, reset to the previously verified commit, restart preview only, and record the result in GitHub Issue #83.

## 7. Completion rule

Code commits alone do not establish deployability. Dependency freeze, source checks, reviewed ledger bootstrap, migrations, preview verification, restart, smoke testing, permission testing, and formal UAT must all be completed and recorded.
