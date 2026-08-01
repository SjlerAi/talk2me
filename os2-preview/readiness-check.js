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
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor !== 20) failures.push(`Node.js 20.x is required, found ${process.versions.node}`);
if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') warnings.push('NODE_ENV is not production');
if (String(process.env.EMAIL_WORKER_ENABLED || '').toLowerCase() === 'true') {
  ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_FROM'].forEach(requireEnv);
} else {
  warnings.push('Email worker is disabled');
}

[
  'server.js','package.json','migration-runner.js','schema-verification.js','preview-data-verification.js',
  'runtime-release-identity-check.js','merge-restore-evidence-verification.js','merge-restore-pin-check.js',
  'customer-merge-plan-routes.js','customer-merge-freshness-routes.js',
  'customer-merge-execution-authorisation-routes.js','customer-merge-execution-readiness-routes.js',
  'email-worker.js','email-worker-runner.js','integrated-routes.js','operational-routes.js',
  'service-lifecycle-routes.js','controlled-import-routes.js','communications-routes.js',
  'collaboration-routes.js','intelligence-routes.js','document-routes.js'
].forEach(checkFile);

const migrationDir = path.join(__dirname, 'migrations');
if (!fs.existsSync(migrationDir)) {
  failures.push('Missing migrations directory');
} else {
  const migrations = fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
  if (migrations.length < 25) failures.push(`Expected at least 25 migrations, found ${migrations.length}`);
  const requiredMigration = '20260801_025_merge_authorisation_restore_pin.sql';
  if (!migrations.includes(requiredMigration)) failures.push(`Missing migration ${requiredMigration}`);
}

const packageJson = require('./package.json');
const scripts = packageJson.scripts || {};
if (packageJson.name !== 'talk2me-os2-preview') failures.push('Unexpected preview package identity');
if (packageJson.version !== '0.59.0') failures.push('Unexpected preview package version');
if (scripts['verify:merge-restore-evidence'] !== 'node merge-restore-evidence-verification.js') {
  failures.push('Missing verify:merge-restore-evidence command');
}
if (scripts['verify:preview-data'] !== 'node preview-data-verification.js') {
  failures.push('Missing verify:preview-data command');
}
if (scripts['verify:runtime-release-identity'] !== 'node runtime-release-identity-check.js') {
  failures.push('Missing verify:runtime-release-identity command');
}
if (scripts['check:merge-restore-pin'] !== 'node merge-restore-pin-check.js') {
  failures.push('Missing check:merge-restore-pin command');
}

const migrationCount = fs.existsSync(migrationDir)
  ? fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).length
  : 0;

const summary = {
  ok: failures.length === 0,
  application: packageJson.name,
  version: packageJson.version,
  nodeVersion: process.versions.node,
  database: process.env.DB_NAME || null,
  migrationCount,
  runtimeReleaseIdentityCommandRegistered: scripts['verify:runtime-release-identity'] === 'node runtime-release-identity-check.js',
  previewDataVerificationCommandRegistered: scripts['verify:preview-data'] === 'node preview-data-verification.js',
  mergeRestoreEvidenceCommandRegistered: scripts['verify:merge-restore-evidence'] === 'node merge-restore-evidence-verification.js',
  mergeRestorePinCheckRegistered: scripts['check:merge-restore-pin'] === 'node merge-restore-pin-check.js',
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  failures,
  warnings
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
