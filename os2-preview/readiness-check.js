'use strict';

const fs = require('fs');
const path = require('path');

const failures = [];
const warnings = [];

function requireEnv(name) {
  if (!String(process.env[name] || '').trim()) failures.push(`Missing ${name}`);
}

function checkFile(relativePath) {
  if (!fs.existsSync(path.join(__dirname, relativePath))) failures.push(`Missing file ${relativePath}`);
}

['DB_HOST','DB_USER','DB_NAME'].forEach(requireEnv);
if (process.env.DB_NAME && process.env.DB_NAME !== 'kloka_talk2me') failures.push('DB_NAME is not the preview database');
if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') warnings.push('NODE_ENV is not production');
if (String(process.env.EMAIL_WORKER_ENABLED || '').toLowerCase() === 'true') {
  ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_FROM'].forEach(requireEnv);
} else {
  warnings.push('Email worker is disabled');
}

[
  'server.js','package.json','migration-runner.js','email-worker.js','email-worker-runner.js',
  'integrated-routes.js','operational-routes.js','service-lifecycle-routes.js',
  'controlled-import-routes.js','communications-routes.js','collaboration-routes.js',
  'intelligence-routes.js','document-routes.js'
].forEach(checkFile);

const migrations = fs.readdirSync(path.join(__dirname, 'migrations')).filter(name => name.endsWith('.sql')).sort();
if (migrations.length < 7) failures.push(`Expected at least 7 migrations, found ${migrations.length}`);

const summary = {
  ok: failures.length === 0,
  version: require('./package.json').version,
  database: process.env.DB_NAME || null,
  migrationCount: migrations.length,
  failures,
  warnings
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
