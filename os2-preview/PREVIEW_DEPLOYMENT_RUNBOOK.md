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

The migration runner is prohibited from creating tables at runtime. The bootstrap must be executed only through `migration-ledger-bootstrap-runner.js`, never through application startup and never by copying SQL into an uncontrolled session.

Create a private canonical evidence directory before execution. It must be a real non-symlink directory, owned by the operator, and inaccessible to group and world users.

```bash
DB_NAME=kloka_talk2me \
ALLOW_MIGRATION_LEDGER_BOOTSTRAP=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
VERIFIED_BACKUP_REFERENCE=<verified-preview-backup-reference> \
VERIFIED_BACKUP_SHA256=<64-character-sha256> \
BOOTSTRAP_OPERATOR=<named-operator> \
BOOTSTRAP_CHANGE_REFERENCE=<approved-change-reference> \
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
npm run bootstrap:migration-ledger
```

The controlled runner:

- securely opens `MIGRATION_LEDGER_BOOTSTRAP.sql` with `O_NOFOLLOW`;
- rejects symlinks, additional hard links, writable-by-group/world files, oversized files, and path/descriptor identity changes;
- validates that the SQL creates exactly one table and contains no prohibited mutation statements;
- refuses every database except `kloka_talk2me`;
- requires explicit verified-backup reference and SHA-256 evidence;
- validates the evidence target before opening a database connection;
- acquires `talk2me_os2_preview_migrations` and binds ownership to the active `CONNECTION_ID()`;
- refuses an existing ledger table rather than altering or reusing it silently;
- executes the reviewed bootstrap source once;
- verifies the created ledger schema, engine, collation, columns, primary key, and unique key;
- confirms the ledger is empty;
- confirms advisory-lock ownership and successful release;
- closes the database connection before evidence publication;
- atomically publishes a private JSON evidence file and SHA-256 sidecar using exclusive `0600` temporary files, filesystem sync, and no-overwrite hard-link publication;
- removes partial publication if either final evidence file cannot be published.

Hard stops:

- never run the bootstrap against production;
- never set `ALLOW_PRODUCTION_MUTATION=true`;
- never set `ENABLE_CUSTOMER_MERGE_EXECUTION=true`;
- never run without a verified preview backup reference and SHA-256;
- never use a relative, non-canonical, shared, or pre-existing evidence path;
- never change the bootstrap SQL without review and a new commit;
- stop if the ledger table already exists;
- stop if advisory-lock release cannot be confirmed;
- stop if the runner reports `MIGRATION_LEDGER_BOOTSTRAP_REQUIRED`;
- do not replace the bootstrap runner with runtime `CREATE TABLE` logic.

The migration runner separately verifies the ledger table engine, collation, exact ordered columns, defaults, primary key, and unique migration-name key before reading ledger contents or applying migrations.

## 3. Bootstrap execution evidence

The bootstrap runner itself creates the private JSON evidence file and SHA-256 sidecar. Do not redirect console output as a substitute and do not hand-author either file.

The evidence records the preview database, bootstrap filename and SHA-256, verified backup reference and SHA-256, named operator, approved change reference, start and completion timestamps, pre-existing and created ledger-table counts, schema verification, empty-ledger result, advisory-lock lifecycle, and both prohibited execution flags set to false.

Verify the generated pair before applying migration 001 or any later migration:

```bash
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
npm run verify:migration-ledger-bootstrap-evidence
```

The verifier must:

- validate a private canonical evidence directory;
- securely open the evidence and checksum files with `O_NOFOLLOW`;
- reject symbolic links, additional hard links, non-private permissions, oversized files, and path/descriptor identity changes;
- validate the bootstrap evidence checksum with constant-time comparison;
- bind the evidence to the checked-out `MIGRATION_LEDGER_BOOTSTRAP.sql` SHA-256;
- verify the approved backup reference and checksum are present;
- prove the ledger table was absent before execution;
- prove exactly one ledger table was created;
- confirm the ledger schema was verified and remains empty;
- confirm the complete advisory lock lifecycle, including release;
- retain production mutation and customer-merge execution as disabled.

Do not proceed to controlled migrations when the evidence pair is absent, has been modified, or fails verification.

## 4. Controlled migration

```bash
DB_NAME=kloka_talk2me \
ALLOW_PREVIEW_MIGRATIONS=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run migrate:preview
```

The runner securely freezes migration sources, acquires `talk2me_os2_preview_migrations`, binds ownership to `CONNECTION_ID()`, verifies ownership with `IS_USED_LOCK()`, validates the ledger as an exact checksum-matching strict prefix of source, applies only the remaining ordered migrations, and confirms `RELEASE_LOCK()`.

Unknown, duplicate, reordered, skipped, future, malformed, or checksum-mismatched ledger entries are hard stops. Only one controlled migration process may operate at a time.

## 5. Mandatory preview data verification

After migration and before restart:

```bash
DB_NAME=kloka_talk2me npm run verify:preview-data
```

This must run `schema-verification.js` followed by `merge-restore-evidence-verification.js`. Running only `npm run verify:schema` is not sufficient. A passing result must retain `mergeExecutionEnabled: false`.

## 6. Restart and smoke testing

Restart only the preview Node.js application. Do not restart or modify production. Verify `https://talk2me.kloka.co.za/health`, then test login, dashboard, customer search, Customer 360, work items, notifications, ownership claims, approvals, service updates, restrictions, and audit records.

Keep `EMAIL_WORKER_ENABLED=false` until SMTP is separately verified.

## 7. Rollback

Stop preview, restore the verified preview backup, rerun preview-data verification, reset to the previously verified commit, restart preview only, and record the result in GitHub Issue #83.

## 8. Completion rule

Code commits alone do not establish deployability. Dependency freeze, source checks, controlled ledger bootstrap, verified bootstrap execution evidence, migrations, preview verification, restart, smoke testing, permission testing, and formal UAT must all be completed and recorded.
