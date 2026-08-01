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
DB_HOST=<approved-preview-database-host> \
DB_PORT=3306 \
DB_USER=<approved-preview-database-user> \
DB_PASSWORD=<preview-database-password> \
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

The bootstrap source must be canonical, privately controlled, securely opened, and limited to one reviewed `CREATE TABLE os2_schema_migrations` statement. It must retain `UNIQUE KEY uq_os2_schema_migration_name`, InnoDB and `utf8mb4_unicode_ci`.

The controlled runner refuses an existing ledger table, verifies the exact schema, confirms the ledger is empty, proves the advisory-lock lifecycle, closes MySQL, and only then publishes a private JSON evidence file and SHA-256 sidecar.

## 3. Bootstrap evidence verification

```bash
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
npm run verify:migration-ledger-bootstrap-evidence
```

Do not proceed to controlled migrations when the evidence pair is absent, changed, inaccessible, non-private, non-canonical, or fails verification.

## 4. Controlled migration command

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
DB_NAME=kloka_talk2me \
DB_HOST=<approved-preview-database-host> \
DB_PORT=3306 \
DB_USER=<approved-preview-database-user> \
DB_PASSWORD=<preview-database-password> \
MIGRATION_OPERATOR=<named-operator> \
ALLOW_PREVIEW_MIGRATIONS=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
npm run migrate:preview
```

The exact controlled branch is mandatory. Every database identity, source, ledger, lock and completion control is fail-closed.

## 5. Bootstrap verifier isolation

Before any database connection, the migration runner executes `migration-ledger-bootstrap-evidence-verification.js` in a sanitized allowlisted environment.

The full parent environment is prohibited. Only basic runtime path, locale, temporary-directory and CI identity values may be inherited. `NODE_OPTIONS`, `NODE_PATH`, `BASH_ENV`, `ENV`, `CDPATH`, `GIT_DIR`, `GIT_WORK_TREE`, `NPM_CONFIG_PREFIX` and `NPM_CONFIG_USERCONFIG` are not inherited.

The verifier receives forced preview-only values, `NODE_ENV=production`, production mutation disabled and customer-merge execution disabled. It has a 30-second timeout, forced `SIGKILL`, shell execution disabled, hidden-window execution, a 4 MiB output bound, and must return valid successful JSON proving the preview database, checked-out bootstrap source and advisory-lock lifecycle.

## 6. Migration inventory controls

The migrations directory must be canonical, non-symlinked, owned by the executing user and not writable by group or world users. Path and directory-descriptor device, inode, owner, mode and modification identity must remain stable during inventory collection.

The directory may contain regular migration files only. Hidden files and non-file directory entries are prohibited.

The inventory must:

- contain at least 25 and at most 250 files;
- contain `20260801_025_merge_authorisation_restore_pin.sql`;
- use the exact `YYYYMMDD_NNN_slug.sql` filename format;
- use the date `20260801` for the current migration set;
- use a contiguous migration sequence beginning at `001`;
- contain no duplicate filenames;
- remain unchanged before the database connection opens.

A missing, duplicate, reordered, skipped, future, malformed or unexpected migration file is a hard stop.

## 7. Secure migration-source reads

Each migration must:

- be a canonical regular file;
- have exactly one hard link;
- share the migrations-directory owner;
- reject group or world write permissions;
- be larger than zero and no larger than 4 MiB;
- open with `O_NOFOLLOW`;
- preserve path and descriptor device, inode, owner, link count, size and modification identity;
- return exactly the descriptor-reported byte count;
- contain no UTF-8 BOM;
- contain no NUL byte;
- use LF rather than CRLF line endings;
- end with a final newline.

The runner rejects destructive database-level SQL and environment-changing SQL, including database creation or deletion, `USE`, grants, revocations, `LOAD DATA`, `OUTFILE`, `DUMPFILE`, global settings, master reset and shutdown operations.

Migration-ledger self-mutation is prohibited. Migration files may not create, alter, drop, insert into, update or otherwise reference `os2_schema_migrations`; only the controlled migration runner records ledger completion.

## 8. Database connection and session controls

The runner validates the database host, user and port before connecting. The port must be an integer from 1 through 65535.

The connection uses:

- a 10-second connection timeout;
- database `kloka_talk2me` only;
- UTF-8 handling;
- keepalive disabled;
- named placeholders disabled;
- positional placeholders for ledger writes;
- date values returned as dates;
- multiple statements enabled only because reviewed migration sources may contain ordered DDL statements.

Before lock acquisition, the runner verifies `DATABASE()` equals `kloka_talk2me`, the connection ID is valid, autocommit is enabled, and the UTC session is established and re-read successfully.

## 9. Ledger validation before migration

The migration advisory lock `talk2me_os2_preview_migrations` must be acquired within 10 seconds and owned by the active connection before ledger inspection.

The ledger schema must retain the expected InnoDB engine, `utf8mb4_unicode_ci` collation, exact ordered columns, primary key and unique migration-name key.

Existing ledger rows must form an exact strict prefix of the frozen source inventory. The runner validates:

- strictly increasing positive unique row IDs;
- unique trimmed migration names;
- exact source order;
- lowercase 64-character SHA-256 checksums;
- exact checksum equality;
- valid execution timestamps;
- bounded execution-operator text;
- non-negative integer execution time.

Unknown, duplicate, reordered, skipped, malformed or checksum-mismatched ledger entries are hard stops.

## 10. Controlled application and ledger recording

Already applied migrations are skipped only after strict-prefix verification. Every remaining source is applied in frozen order.

After each migration, the ledger write uses positional placeholders and records the migration name, exact SHA-256, named operator and measured execution time. The insert must affect exactly one row and return a positive insert ID. A migration is not accepted as recorded when ledger insertion is unconfirmed.

Individual `applied <migration>` console lines are progress output only and are not migration completion evidence.

## 11. Final ledger reconciliation

After all remaining sources run, the runner re-reads every ledger row and repeats the strict-prefix, checksum and execution-metadata validation.

The final ledger inventory must equal the frozen migration inventory exactly. The final result records the original applied count, newly applied count, final ledger count and total source count.

A source may not be considered complete merely because its SQL returned successfully. Complete migration evidence requires the final ledger inventory to match every frozen source exactly.

## 12. Lock release and connection closure

During cleanup, advisory-lock ownership must still match the active migration connection. `RELEASE_LOCK()` must return successful release, and `IS_FREE_LOCK()` must then prove that the lock is free.

A lock release failure is a hard stop. The database connection must close even when release verification fails.

Final success is reported only after the database connection closes before final success. It must include:

```text
advisoryLockReleased: true
advisoryLockFreeAfterRelease: true
databaseConnectionClosedBeforeSuccess: true
finalLedgerInventoryVerified: true
productionMutationEnabled: false
mergeExecutionEnabled: false
```

## 13. Mandatory preview data verification

After migration and before restart:

```bash
DB_NAME=kloka_talk2me npm run verify:preview-data
```

This must run `schema-verification.js` followed by `merge-restore-evidence-verification.js`. Running only `npm run verify:schema` is not sufficient. A passing result must retain `mergeExecutionEnabled: false`.

## 14. Restart and smoke testing

Restart only the preview Node.js application. Do not restart or modify production. Verify `https://talk2me.kloka.co.za/health`, then test login, dashboard, customer search, Customer 360, work items, notifications, ownership claims, approvals, service updates, restrictions and audit records.

Keep `EMAIL_WORKER_ENABLED=false` until SMTP is separately verified.

## 15. Rollback

Stop preview, restore the verified preview backup, rerun preview-data verification, reset to the previously verified commit, restart preview only, and record the result in GitHub Issue #83.

## 16. Completion rule

Code commits alone do not establish deployability. Dependency freeze, source checks, controlled ledger bootstrap, verified bootstrap execution evidence, migrations, final ledger reconciliation, preview verification, restart, smoke testing, permission testing and formal UAT must all be completed and recorded.
