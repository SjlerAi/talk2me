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

The controlled runner securely validates the reviewed bootstrap source, refuses every database except `kloka_talk2me`, requires verified backup evidence, acquires the shared advisory lock, refuses an existing ledger table, verifies the resulting schema and empty ledger, confirms lock release, closes the database connection, and atomically publishes private bootstrap evidence with a SHA-256 sidecar.

Hard stops include production targeting, enabled production mutation, enabled merge execution, missing backup evidence, unsafe evidence paths, an existing ledger table, failed schema verification, a non-empty ledger, or unconfirmed advisory-lock release.

## 3. Bootstrap execution evidence

The bootstrap runner itself creates the private JSON evidence file and SHA-256 sidecar. Do not redirect console output as a substitute and do not hand-author either file.

```bash
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
npm run verify:migration-ledger-bootstrap-evidence
```

The evidence must prove the checked-out bootstrap checksum, verified backup reference and checksum, named operator, approved change reference, absent ledger before execution, exactly one created table, verified schema, empty ledger, complete advisory-lock lifecycle, and disabled production and merge execution flags.

## 4. Controlled migration

The migration command re-runs bootstrap evidence verification before opening a MySQL connection.

```bash
DB_NAME=kloka_talk2me \
ALLOW_PREVIEW_MIGRATIONS=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
npm run migrate:preview
```

Before any database connection, the migration runner must require and verify bootstrap evidence, inherit verifier output, stop on verifier startup errors, signals, or non-zero status, and force prohibited execution flags to false in the verifier process.

Only after the evidence gate passes may the runner freeze migration sources, connect to `kloka_talk2me`, acquire `talk2me_os2_preview_migrations`, verify the ledger schema and strict checksum-matching prefix, and apply remaining migrations.

Migration completion is fail-closed:

- advisory-lock ownership must still belong to the active migration connection;
- `RELEASE_LOCK()` must return successful release;
- lock release failure is a hard stop and must produce a non-zero process result;
- the database connection must close even when release verification fails;
- success is reported only after the database connection closes;
- a success record must include `advisoryLockReleased: true` and `databaseConnectionClosedBeforeSuccess: true`;
- no operator may treat earlier `applied` console lines as proof of successful migration completion.

Do not proceed when the evidence pair is absent, modified, points to a different bootstrap source, or fails verification. Unknown, duplicate, reordered, skipped, future, malformed, or checksum-mismatched ledger entries remain hard stops. Only one controlled migration process may operate at a time.

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
