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

## 3. Bootstrap source controls

The runner accepts one reviewed SQL statement only. The source must:

- be a canonical regular file;
- be owned by the executing user;
- have exactly one hard link;
- reject group or world write permissions;
- remain the same device, inode, size and modification state during secure descriptor reading;
- be no larger than 1 MiB and not be empty;
- use LF line endings with a final newline;
- contain no UTF-8 BOM;
- contain no SQL comments;
- contain exactly one semicolon and one `CREATE TABLE` statement;
- create only `os2_schema_migrations`;
- define the required primary key, unique migration-name key, InnoDB engine and `utf8mb4_unicode_ci` collation.

The runner rejects destructive or unrelated SQL, including `DROP`, `ALTER`, `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `TRUNCATE`, `RENAME`, `GRANT`, `REVOKE`, database creation, `USE`, temporary objects, procedures, functions, triggers, events, `LOAD DATA`, `OUTFILE`, and `DUMPFILE`.

## 4. Database connection and session controls

The runner validates database host, port and user before connecting. Host path syntax is prohibited and the port must be an integer from 1 through 65535.

The connection contract requires:

- database `kloka_talk2me` only;
- a 10-second connection timeout;
- `multipleStatements: false`;
- keepalive disabled;
- named placeholders disabled;
- UTF-8 character handling;
- the active `DATABASE()` value to equal `kloka_talk2me`;
- a valid positive connection ID;
- session autocommit enabled;
- session time zone forced to UTC;
- session safety values verified before lock acquisition.

A database identity, session, connection or configuration mismatch is a hard stop.

## 5. Advisory-lock and ledger controls

The runner acquires `talk2me_os2_preview_migrations` with a bounded 10-second wait. It verifies that the active connection owns the lock before touching the ledger.

The bootstrap must then:

1. prove the ledger table does not already exist;
2. execute the single reviewed SQL statement;
3. verify exactly one ledger table exists;
4. verify InnoDB and `utf8mb4_unicode_ci`;
5. verify the exact ordered column inventory;
6. verify the unsigned auto-increment ID definition;
7. verify required columns are non-nullable;
8. verify the primary key;
9. verify the unique migration-name key;
10. verify the ledger contains zero rows.

During cleanup the runner verifies lock ownership again, requires `RELEASE_LOCK()` to succeed, and then requires `IS_FREE_LOCK()` to prove the advisory lock is free. The database connection must close before evidence publication.

## 6. Evidence target and publication controls

`MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH` must:

- be absolute and normalized;
- end in `.json`;
- point into a canonical real directory;
- use a directory owned by the executing user;
- use a directory inaccessible to group and world users;
- not already exist together with its checksum sidecar.

The runner creates private `0600` temporary files exclusively, flushes each file, publishes the JSON and SHA-256 sidecar using hard-link-based no-overwrite semantics, synchronizes the directory through a secure `O_DIRECTORY | O_NOFOLLOW` descriptor, and removes temporary files.

The evidence records:

- preview database identity;
- bootstrap source filename and SHA-256;
- verified backup reference and SHA-256;
- named operator and approved change reference;
- database and session verification;
- connection identity evidence;
- advisory-lock name, timeout, ownership, release and post-release free state;
- absent ledger before execution;
- exactly one created table;
- verified schema and empty ledger;
- secure source-read and single-statement validation;
- canonical private evidence-path controls;
- ordered start and completion timestamps;
- disabled production mutation and merge execution.

The private JSON evidence file and SHA-256 sidecar are the authoritative bootstrap execution evidence. Console output is not a substitute.

## 7. Bootstrap evidence verification

```bash
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
npm run verify:migration-ledger-bootstrap-evidence
```

The evidence verifier must prove the checked-out bootstrap checksum, verified backup reference and checksum, named operator, approved change reference, absent ledger before execution, exactly one created table, verified schema, empty ledger, complete advisory-lock lifecycle, and disabled production and merge execution flags.

## 8. Controlled migration

The migration command re-runs bootstrap evidence verification before opening a MySQL connection.

```bash
DB_NAME=kloka_talk2me \
ALLOW_PREVIEW_MIGRATIONS=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
npm run migrate:preview
```

Only after the evidence gate passes may the runner freeze migration sources, connect to `kloka_talk2me`, acquire `talk2me_os2_preview_migrations`, verify the ledger schema and strict checksum-matching prefix, and apply remaining migrations.

Migration completion is fail-closed. Advisory-lock ownership must remain with the active connection, release must be confirmed, the database connection must close, and final success must include `advisoryLockReleased: true` and `databaseConnectionClosedBeforeSuccess: true`.

## 9. Mandatory preview data verification

After migration and before restart:

```bash
DB_NAME=kloka_talk2me npm run verify:preview-data
```

This must run `schema-verification.js` followed by `merge-restore-evidence-verification.js`. Running only `npm run verify:schema` is not sufficient. A passing result must retain `mergeExecutionEnabled: false`.

## 10. Restart and smoke testing

Restart only the preview Node.js application. Do not restart or modify production. Verify `https://talk2me.kloka.co.za/health`, then test login, dashboard, customer search, Customer 360, work items, notifications, ownership claims, approvals, service updates, restrictions, and audit records.

Keep `EMAIL_WORKER_ENABLED=false` until SMTP is separately verified.

## 11. Rollback

Stop preview, restore the verified preview backup, rerun preview-data verification, reset to the previously verified commit, restart preview only, and record the result in GitHub Issue #83.

## 12. Completion rule

Code commits alone do not establish deployability. Dependency freeze, source checks, controlled ledger bootstrap, verified bootstrap execution evidence, migrations, preview verification, restart, smoke testing, permission testing, and formal UAT must all be completed and recorded.
