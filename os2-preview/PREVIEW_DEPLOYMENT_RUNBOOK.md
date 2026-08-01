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

The inventory must contain at least 25 and at most 250 files, include `20260801_025_merge_authorisation_restore_pin.sql`, use the exact `YYYYMMDD_NNN_slug.sql` filename format, use the date `20260801`, use a contiguous sequence beginning at `001`, contain no duplicate filenames and remain unchanged before MySQL opens.

## 7. Secure migration-source reads

Each migration must be canonical, regular, single-link, owner-consistent, safely permissioned, non-empty, no larger than 4 MiB, opened with `O_NOFOLLOW`, metadata-stable and byte-count stable. UTF-8 BOM, NUL bytes, CRLF and a missing final newline are prohibited.

Destructive database-level SQL and migration-ledger self-mutation are prohibited.

## 8. Database connection and session controls

The runner validates the database host, user and port. It uses a 10-second connection timeout, database `kloka_talk2me`, UTF-8 handling, keepalive disabled, named placeholders disabled, positional placeholders and reviewed multiple-statement migration execution.

Before lock acquisition, it verifies `DATABASE()`, connection identity, autocommit and the UTC session.

## 9. Ledger validation before migration

The advisory lock must be acquired and owned before ledger inspection. Existing rows must form an exact checksum-matching source prefix with increasing unique IDs, unique trimmed names, valid timestamps, bounded operator identity and non-negative execution duration.

## 10. Controlled application and ledger recording

Every remaining source is applied in frozen order. Each ledger insert uses positional placeholders, must affect exactly one row and must return a positive insert ID. Individual `applied` lines are progress output only.

## 11. Final ledger reconciliation

After execution, the complete ledger is re-read and validated again. Its final count and exact ordered inventory must equal the frozen migration source inventory.

## 12. Lock release and connection closure

`RELEASE_LOCK()` must succeed and `IS_FREE_LOCK()` must prove the lock is free. The database connection must close before final success.

Required completion evidence includes:

```text
advisoryLockReleased: true
advisoryLockFreeAfterRelease: true
databaseConnectionClosedBeforeSuccess: true
finalLedgerInventoryVerified: true
productionMutationEnabled: false
mergeExecutionEnabled: false
```

## 13. Mandatory preview data verification

After migration and before restart, run the controlled command with the complete preview identity:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
DB_NAME=kloka_talk2me \
DB_HOST=<approved-preview-database-host> \
DB_PORT=3306 \
DB_USER=<approved-preview-database-user> \
DB_PASSWORD=<preview-database-password> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:preview-data
```

### Preview data-verification orchestration

The orchestrator validates the exact preview database, exact controlled branch, absolute canonical application root, Node.js 20, disabled production mutation, disabled merge execution, database host, database user and valid port before starting a verifier.

Both database verifiers run in the same frozen sanitized allowlisted environment. The complete parent environment is not inherited. Node, shell, Git and npm startup overrides are excluded. Preview identity and safety flags are forced in every child.

Each verifier has a 60-second timeout, forced `SIGKILL`, shell execution disabled, hidden-window execution and a 4 MiB output limit. Startup errors, timeout, signal termination, non-zero status, invalid JSON, an unsuccessful result or database mismatch are hard stops.

The schema verification must complete first. `merge-restore-evidence-verification.js` may run only after successful schema evidence has been parsed and accepted.

The schema output must prove:

- at least 50 required tables;
- at least 25 verified column groups;
- at least 25 applied migrations;
- zero duplicate active account numbers;
- zero customers with multiple primary accounts;
- zero duplicate active mobile numbers;
- zero duplicate active access grants;
- zero archived customers with active ownership;
- zero invalid duplicate pairs;
- zero invalid merge plans;
- zero invalid or unpinned authorisations;
- zero invalid representative permission documents;
- zero expired active representatives;
- zero unsafe approvals;
- zero invalidated approvals still open.

This zero-defect evidence is mandatory. A successful exit status without the complete zero-defect evidence is not accepted.

The restore verifier must return its exact verifier identity and its restore-authorisation defect count must be zero. Any missing backup, invalid backup, missing restore test, failed restore, database mismatch, incomplete checksum or incorrectly ordered restore evidence blocks acceptance.

Final preview-data evidence must report:

```text
schemaVerifiedBeforeRestoreEvidence: true
verifierEnvironmentSanitized: true
verifierEnvironmentFrozen: true
fullParentEnvironmentInherited: false
schemaEvidenceParsed: true
schemaZeroDefectEvidenceVerified: true
restoreEvidenceParsed: true
restoreAuthorisationDefects: 0
databaseBackedVerificationExecuted: true
productionMutationEnabled: false
mergeExecutionEnabled: false
```

Running only `npm run verify:schema`, only the restore verifier or manually reviewing console output is not sufficient preview-data verification.

## 14. Restart and smoke testing

Restart only the preview Node.js application. Do not restart or modify production. Verify `https://talk2me.kloka.co.za/health`, then test login, dashboard, customer search, Customer 360, work items, notifications, ownership claims, approvals, service updates, restrictions and audit records.

Keep `EMAIL_WORKER_ENABLED=false` until SMTP is separately verified.

## 15. Rollback

Stop preview, restore the verified preview backup, rerun preview-data verification, reset to the previously verified commit, restart preview only, and record the result in GitHub Issue #83.

## 16. Completion rule

Code commits alone do not establish deployability. Dependency freeze, source checks, controlled ledger bootstrap, verified bootstrap execution evidence, migrations, final ledger reconciliation, preview verification, restart, smoke testing, permission testing and formal UAT must all be completed and recorded.
