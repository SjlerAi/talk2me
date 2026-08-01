'use strict';

const fs = require('fs');
const path = require('path');

const mustContain = (file, tokens) => {
  const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
  for (const token of tokens) {
    if (!content.includes(token)) throw new Error(`${file} missing ${token}`);
  }
};

const mustExist = (file) => {
  if (!fs.existsSync(path.join(__dirname, file))) throw new Error(`Missing deployment dependency ${file}`);
};

mustContain('migration-runner.js', [
  "PREVIEW_DATABASE = 'kloka_talk2me'",
  'ALLOW_PREVIEW_MIGRATIONS_NOT_ENABLED',
  'MIGRATION_CHECKSUM_MISMATCH',
  'os2_schema_migrations'
]);

mustContain('readiness-check.js', [
  "process.env.DB_NAME !== 'kloka_talk2me'",
  'EMAIL_WORKER_ENABLED',
  'migrations.length < 25',
  '20260801_025_merge_authorisation_restore_pin.sql',
  'preview-data-verification.js',
  'merge-restore-evidence-verification.js',
  'merge-restore-pin-check.js',
  "scripts['verify:preview-data']"
]);

mustContain('preview-data-verification.js', [
  "const expectedDatabase = 'kloka_talk2me'",
  "'schema-verification.js'",
  "'merge-restore-evidence-verification.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal || result.status !== 0',
  'mergeExecutionEnabled: false'
]);

mustContain('merge-restore-evidence-verification.js', [
  "database !== 'kloka_talk2me'",
  'LEFT JOIN os2_backup_runs b ON b.id = a.backup_run_id',
  'LEFT JOIN os2_restore_tests rt ON rt.id = a.restore_test_id',
  'INVALID_PINNED_RESTORE_EVIDENCE'
]);

mustContain('merge-restore-pin-check.js', [
  'restore_test_id',
  'ORDER BY rt.completed_at DESC,rt.id DESC'
]);

[
  'migrations/20260801_025_merge_authorisation_restore_pin.sql',
  'schema-verification.js',
  'preview-data-verification.js',
  'merge-restore-evidence-verification.js',
  'merge-restore-pin-check.js'
].forEach(mustExist);

const packageJson = require('./package.json');
for (const script of [
  'migrate:preview',
  'verify:schema',
  'verify:preview-data',
  'verify:merge-restore-evidence',
  'check:merge-restore-pin',
  'check:readiness',
  'check:deployment'
]) {
  if (!packageJson.scripts[script]) throw new Error(`package.json missing ${script}`);
}

console.log(JSON.stringify({
  ok: true,
  check: 'deployment-controls',
  database: 'kloka_talk2me',
  minimumMigrationCount: 25,
  previewDataVerificationRequired: true,
  restoreEvidenceRequired: true,
  executionEnabled: false
}, null, 2));
