# Talk2Me OS2 Preview Backup and Recovery Runbook

## Scope

This runbook applies only to the preview environment:

- Application: `https://talk2me.kloka.co.za`
- Database: `kloka_talk2me`
- Application path: `/home/kloka/repositories/talk2me/os2-preview`

It must never be pointed at the production database or production application.

## Required environment controls

```bash
DB_NAME=kloka_talk2me
ALLOW_PREVIEW_BACKUPS=true
BACKUP_PRIVATE_DIR=/home/kloka/private_backups/talk2me
```

`BACKUP_PRIVATE_DIR` must not be inside `public_html` and must not be web-accessible.

## Create a preview database backup

From the preview application directory:

```bash
npm run backup:preview
```

The runner will:

1. refuse any database except `kloka_talk2me`;
2. require explicit backup opt-in;
3. create a private SQL dump using a consistent transaction;
4. calculate a SHA-256 checksum;
5. record file size, table count and estimated row count;
6. write the evidence to `os2_backup_runs`;
7. delete an incomplete dump when generation fails.

## Verify a backup

Use the backup ID returned by the backup command:

```bash
npm run verify:backup -- 123
```

Verification checks:

- file exists;
- file is not empty;
- SHA-256 checksum matches the recorded checksum;
- dump contains expected SQL markers;
- evidence is written to `os2_operational_checks`.

A checksum pass proves file integrity only. It does not prove that the backup can be restored.

## Restore-test procedure

Restore tests must use a separate isolated database. Never restore over `kloka_talk2me` and never restore over production.

1. Create an isolated database such as `kloka_talk2me_restore_test_YYYYMMDD`.
2. Record a planned restore test in `os2_restore_tests`.
3. Import the verified SQL dump into the isolated database.
4. Run table-count and key-schema checks.
5. Run application read-only smoke tests against the isolated database.
6. Record passed and failed checks with evidence.
7. Delete the isolated database after evidence has been retained.

## Recovery acceptance criteria

A backup is recovery-qualified only when all of the following are true:

- backup status is `verified`;
- restore test status is `passed`;
- restored table count matches expectations;
- schema verification passes;
- duplicate account and mobile checks pass;
- login and read-only customer search pass against the isolated restore;
- evidence is reviewed by an authorised manager or owner.

## Retention guidance

For preview backups:

- daily backups: retain 14 days;
- weekly verified backups: retain 8 weeks;
- pre-migration backups: retain until the migration and UAT cycle is formally closed.

Expired backup records may be marked `expired`. Physical file removal must be controlled and logged.

## Failure handling

When a backup or verification fails:

1. do not restart migration or deployment work automatically;
2. inspect the recorded failure reason;
3. confirm private-directory permissions and free disk space;
4. confirm `mysqldump` availability;
5. create a new backup rather than modifying a recorded backup file;
6. retain failure evidence for troubleshooting.

## Production protection

No command in this runbook authorises production backup, restore, migration or deployment work. Production remains outside this preview rebuild process.
