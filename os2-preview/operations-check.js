'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const required = [
  'backup-runner.js',
  'backup-verification.js',
  'migrations/20260801_011_backup_recovery_and_operations.sql',
  'BACKUP_AND_RECOVERY_RUNBOOK.md'
];
for (const file of required) if (!fs.existsSync(path.join(root,file))) throw new Error(`Missing operations file: ${file}`);

const backup = fs.readFileSync(path.join(root,'backup-runner.js'),'utf8');
const verify = fs.readFileSync(path.join(root,'backup-verification.js'),'utf8');
const migration = fs.readFileSync(path.join(root,'migrations/20260801_011_backup_recovery_and_operations.sql'),'utf8');

for (const marker of ['REFUSING_NON_PREVIEW_DATABASE','ALLOW_PREVIEW_BACKUPS','BACKUP_PRIVATE_DIR','mysqldump','sha256']) {
  if (!backup.includes(marker)) throw new Error(`Missing backup safety marker: ${marker}`);
}
for (const marker of ['checksumMatches','BACKUP_FILE_MISSING','backup_file_verification']) {
  if (!verify.includes(marker)) throw new Error(`Missing verification marker: ${marker}`);
}
for (const table of ['os2_backup_runs','os2_restore_tests','os2_operational_checks']) {
  if (!migration.includes(table)) throw new Error(`Missing operations table: ${table}`);
}
if (/CREATE\s+TABLE/i.test(backup) || /CREATE\s+TABLE/i.test(verify)) throw new Error('Runtime CREATE TABLE detected in operations scripts');

console.log(JSON.stringify({ ok:true, module:'backup-recovery-operations', requiredFiles:required.length, tables:3 }, null, 2));
