'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const expectedDatabase = 'kloka_talk2me';
const actualDatabase = String(process.env.DB_NAME || '').trim();
const checks = [
  'schema-verification.js',
  'merge-restore-evidence-verification.js'
];

if (actualDatabase !== expectedDatabase) {
  console.error(JSON.stringify({
    ok: false,
    check: 'preview-data-verification',
    error: 'PREVIEW_DATABASE_REQUIRED',
    expectedDatabase,
    actualDatabase: actualDatabase || null
  }, null, 2));
  process.exit(1);
}

const completed = [];
for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, check)], {
    cwd: __dirname,
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(JSON.stringify({
      ok: false,
      check: 'preview-data-verification',
      failedVerifier: check,
      error: result.error.message
    }, null, 2));
    process.exit(1);
  }

  if (result.signal || result.status !== 0) {
    console.error(JSON.stringify({
      ok: false,
      check: 'preview-data-verification',
      failedVerifier: check,
      exitStatus: result.status,
      signal: result.signal || null,
      completed
    }, null, 2));
    process.exit(result.status || 1);
  }

  completed.push(check);
}

console.log(JSON.stringify({
  ok: true,
  check: 'preview-data-verification',
  database: expectedDatabase,
  completed,
  mergeExecutionEnabled: false
}, null, 2));
