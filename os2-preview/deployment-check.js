'use strict';

const fs = require('fs');
const path = require('path');

const mustContain = (file, tokens) => {
  const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
  for (const token of tokens) {
    if (!content.includes(token)) throw new Error(`${file} missing ${token}`);
  }
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
  'migrationCount'
]);

const packageJson = require('./package.json');
for (const script of ['migrate:preview','check:readiness','check:deployment']) {
  if (!packageJson.scripts[script]) throw new Error(`package.json missing ${script}`);
}

console.log('Deployment controls validated.');
