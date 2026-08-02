# Talk2Me OS2 Preview Backup and Recovery Runbook

## Scope

This runbook applies only to:

- Application: `https://talk2me.kloka.co.za`
- Database: `kloka_talk2me`
- Branch: `agent/talk2me-os2-integrated-rebuild`
- Application path: `/home/kloka/repositories/talk2me/os2-preview`

Production `talk2me.uent.co.za` is outside this process.

## Required environment

```bash
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild
DB_NAME=kloka_talk2me
DB_HOST=<approved-preview-database-host>
DB_PORT=3306
DB_USER=<approved-preview-database-user>
DB_PASSWORD=<preview-database-password>
ALLOW_PREVIEW_BACKUPS=true
ALLOW_PRODUCTION_MUTATION=false
ENABLE_CUSTOMER_MERGE_EXECUTION=false
BACKUP_PRIVATE_DIR=/home/kloka/private_backups/talk2me
```

The private directory must be absolute, normalized, canonical, owned by the operator, inaccessible to group and world users, outside `public_html`, and opened with no-follow directory controls.

## Create a preview backup

Run from the preview application directory:

```bash
npm run backup:preview
```

The backup runner is preview-only, branch-bound, fail-closed, private-directory restricted, descriptor-based, checksum-backed and limited to a 15-minute dump process. It records a running backup before execution, verifies the completed output, stores SHA-256, size, table count and row estimate, and removes partial output after failure.

## Verify a backup

```bash
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
DB_NAME=kloka_talk2me \
DB_HOST=<approved-preview-database-host> \
DB_PORT=3306 \
DB_USER=<approved-preview-database-user> \
DB_PASSWORD=<preview-database-password> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:backup -- 123
```

Verification checks preview identity, backup-record identity, canonical private storage, regular-file status, permissions, owner, hard-link count, stable descriptor identity, exact file size, SHA-256 with constant-time comparison, SQL markers, timestamp order and operational evidence recording.

A checksum pass proves file integrity only. It does not prove recoverability.

## Controlled isolated restore test

The restore runner requires a pre-created empty isolated database. It must never create or drop the target database. Database creation and later removal remain explicit operator actions outside the runner so that an incorrect target cannot be silently created, overwritten or deleted.

The target name must use this exact shape:

```text
kloka_talk2me_restore_test_YYYYMMDD_HHMMSS_xxxxxx
```

Example:

```text
kloka_talk2me_restore_test_20260802_064500_a1b2c3
```

The target must not be `kloka_talk2me`, must not contain `prod` or `production`, and must contain zero tables before import.

Run from the preview application directory:

```bash
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
DB_NAME=kloka_talk2me \
DB_HOST=<approved-preview-database-host> \
DB_PORT=3306 \
DB_USER=<approved-preview-database-user> \
DB_PASSWORD=<preview-database-password> \
BACKUP_ID=123 \
RESTORE_TARGET_DATABASE=kloka_talk2me_restore_test_20260802_064500_a1b2c3 \
RESTORE_REVIEWER_ID=<authorised-manager-or-owner-staff-id> \
ALLOW_PREVIEW_RESTORE_TEST=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
node restore-test-runner.js
```

### Restore-test controls

The runner enforces the following controls:

1. Exact source database `kloka_talk2me`.
2. Exact controlled branch.
3. Explicit restore-test opt-in.
4. Production mutation disabled.
5. Customer-merge execution disabled.
6. Positive backup ID required.
7. Positive authorised reviewer ID required.
8. Valid database host, user and port.
9. Exact isolated target-name pattern.
10. Preview database prohibited as target.
11. Production-like names prohibited.
12. Target database must already exist.
13. Target database must be empty.
14. Runner never creates the target database.
15. Runner never drops the target database.
16. Source backup status must be `verified`.
17. Backup type must be `database` or `full`.
18. Backup database identity must be `kloka_talk2me`.
19. Backup checksum must be lowercase SHA-256.
20. Backup size must exceed 1 KiB.
21. Backup table count must be at least 50.
22. Backup failure reason must be empty.
23. Backup path must remain inside the recorded storage directory.
24. Backup path must be canonical.
25. Backup file must be regular.
26. Symbolic links are rejected.
27. Additional hard links are rejected.
28. Group and world access are rejected.
29. Backup size is capped at 20 GiB.
30. Backup path and descriptor identity must match.
31. Device and inode must remain stable.
32. File size must remain stable.
33. Modification time must remain stable.
34. Read byte count must match recorded size.
35. Backup checksum is reverified before import.
36. Checksum comparison is constant-time.
37. Import child receives a sanitized environment.
38. Full parent environment is not inherited.
39. `MYSQL_PWD` is scoped to the import child.
40. Shell execution is disabled.
41. Hidden-window execution is enabled.
42. Import uses TCP explicitly.
43. Import uses UTF-8 explicitly.
44. Connection timeout is 10 seconds.
45. Import timeout is 20 minutes.
46. Timeout termination uses `SIGKILL`.
47. Import stderr capture is bounded.
48. Preview database connection identity is verified.
49. Restore target connection identity is verified.
50. Autocommit is required.
51. Both sessions are forced to UTC.
52. A running restore-test record is created before import.
53. The record pins the backup ID.
54. The record pins the actual target database.
55. `target_environment` is `isolated_preview_restore`.
56. `created_by` and `reviewed_by` are recorded.
57. Restored table count is compared with backup evidence.
58. Required core and governance tables are checked.
59. Exactly 25 migration-ledger rows are required.
60. Every migration checksum must be valid SHA-256.

### Required semantic checks

The restored database must contain:

```text
staff_users
customers
customer_accounts
mobile_lines
os2_schema_migrations
os2_backup_runs
os2_restore_tests
```

The structured evidence records target identity, source identity, backup ID, restore ID, checksum, file size, table count, row estimate, migration count, worker identity, each semantic check and any missing tables.

A passed restore test must finish with evidence equivalent to:

```text
check: isolated-restore-test
targetEnvironment: isolated_preview_restore
backupChecksumReverified: true
targetDatabasePrecreated: true
targetDatabaseInitiallyEmpty: true
targetDatabaseDroppedAutomatically: false
failedChecks: 0
productionMutationEnabled: false
mergeExecutionEnabled: false
```

The database row must record `reviewed_by`, `verified_checks`, `failed_checks`, `evidence_json`, completion time and status. Any failed semantic check changes the restore-test status to `failed` and blocks recovery qualification.

## Manual cleanup after evidence retention

The runner deliberately leaves the isolated target database in place. Review the restore evidence first. After approval and retention of the evidence, an authorised operator may remove the isolated database through a separate reviewed operation. The runner itself must never create or drop the target database.

## Recovery acceptance

A backup is recovery-qualified only when:

- backup status is `verified`;
- checksum and recorded size match;
- file and directory privacy controls pass;
- restore test status is `passed`;
- restored table count matches the backup;
- `failed_checks` equals zero;
- required tables are present;
- exactly 25 migration records exist with valid checksums;
- evidence is reviewed by an authorised manager or owner.

## Retention

- Daily preview backups: 14 days.
- Weekly verified backups: 8 weeks.
- Pre-migration backups: retain until migration and UAT are formally closed.

Physical deletion must be controlled and logged. Do not edit or replace an existing recorded backup file.

## Failure handling

When backup generation, verification or restore testing fails, stop migration and deployment activity, inspect the recorded failure, preserve evidence, verify storage permissions and free space, confirm the database client binaries, create a new backup when needed, and never modify a recorded verified backup file.

No command in this runbook authorises production backup, restore, migration, restart or deployment activity.
