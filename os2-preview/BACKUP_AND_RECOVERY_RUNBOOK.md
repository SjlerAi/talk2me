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

The runner enforces these controls:

1. Exact preview database only.
2. Exact controlled branch only.
3. Explicit preview-backup opt-in.
4. Production mutation disabled.
5. Customer-merge execution disabled.
6. Valid database host, user and port.
7. Ten-second database connection timeout.
8. One database connection only.
9. Keepalive disabled.
10. Named placeholders disabled.
11. Database identity checked with `DATABASE()`.
12. Valid connection ID required.
13. UTC database session required.
14. Private canonical backup directory required.
15. Symlinked directory rejected.
16. Group-readable directory rejected.
17. World-readable directory rejected.
18. Directory ownership verified.
19. Directory path and descriptor identity compared.
20. Randomized collision-resistant SQL filename.
21. Path-escape prevention.
22. Exclusive no-follow file creation.
23. Backup file mode `0600`.
24. Sanitized `mysqldump` environment.
25. Full parent environment not inherited.
26. `MYSQL_PWD` supplied only to the dump process.
27. Shell execution disabled.
28. Hidden-window execution enabled.
29. Dump timeout limited to 15 minutes.
30. Timeout termination uses `SIGKILL`.
31. `stderr` capture is bounded.
32. Consistent transaction dump.
33. Quick row streaming enabled.
34. Routines included.
35. Triggers included.
36. Events included.
37. Binary data exported safely.
38. GTID output disabled.
39. Tablespace output disabled.
40. Dump timestamps and comments removed for stable evidence.
41. Backup record inserted before dump.
42. Insert must affect exactly one row.
43. Positive backup ID required.
44. Table count captured.
45. Row estimate captured.
46. Table count must be positive.
47. Row estimate must be non-negative.
48. Output must be a regular file.
49. Symlinked output rejected.
50. Additional hard links rejected.
51. Output owner must match the private directory owner.
52. Output permissions must remain private.
53. Output path must remain canonical.
54. Output must exceed 1 KiB.
55. Output is capped at 20 GiB.
56. SHA-256 generated through no-follow reads.
57. Checksum format validated.
58. Completion update must affect exactly one running record.
59. Partial output removed after failure.
60. Final JSON retains preview-only safety evidence.

## Verify a backup

Use the returned backup ID:

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

Verification is descriptor-based and fail-closed. It validates the database record, preview identity, storage path, filename pattern, private directory, regular-file status, no symlink, one hard link, owner, permissions, canonical path, stable device/inode/size/modification identity, a maximum 20 GiB read bound, exact byte count, SHA-256 using constant-time comparison, recorded file size, table count, row estimate, ordered timestamps, absence of a failure reason, SQL markers, absence of HTML and absence of NUL bytes.

A successful verification updates the backup to `verified`, clears stale failure text, stores structured verification metadata, and inserts a passed `backup_file_verification` row into `os2_operational_checks`. Both database writes must be confirmed.

Required final evidence includes:

```text
check: preview-backup-verification
secureDescriptorRead: true
checksumMatches: true
recordedSizeMatches: true
canonicalPathVerified: true
privatePermissionsVerified: true
hardLinkCountVerified: true
operationalEvidenceRecorded: true
productionMutationEnabled: false
mergeExecutionEnabled: false
```

## Restore testing

Checksum verification proves file integrity only. Recovery qualification still requires an isolated restore test.

1. Create a separate database such as `kloka_talk2me_restore_test_YYYYMMDD`.
2. Record the planned test in `os2_restore_tests`.
3. Import the verified SQL dump into the isolated database.
4. Compare table count with the verified backup record.
5. Run key schema and data-integrity checks.
6. Run read-only application smoke tests against the isolated restore.
7. Record evidence JSON, verified-check count and failed-check count.
8. Require authorised review.
9. Delete the isolated database only after evidence retention.

Never restore over `kloka_talk2me` and never restore over production.

## Recovery acceptance

A backup is recovery-qualified only when:

- backup status is `verified`;
- checksum and recorded size match;
- file and directory privacy controls pass;
- restore test status is `passed`;
- restored table count matches the backup;
- failed checks equal zero;
- schema verification passes;
- login and read-only customer search pass against the isolated restore;
- evidence is reviewed by an authorised manager or owner.

## Retention

- Daily preview backups: 14 days.
- Weekly verified backups: 8 weeks.
- Pre-migration backups: retain until migration and UAT are formally closed.

Physical deletion must be controlled and logged. Do not edit or replace an existing recorded backup file.

## Failure handling

When generation or verification fails, stop migration and deployment activity, inspect the recorded failure, verify private-directory permissions and disk space, confirm `mysqldump` availability, create a new backup rather than modifying the failed file, and retain failure evidence.

No command in this runbook authorises production backup, restore, migration, restart or deployment activity.
