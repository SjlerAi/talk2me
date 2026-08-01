'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const worker = fs.readFileSync(path.join(root,'email-worker.js'),'utf8');
const runner = fs.readFileSync(path.join(root,'email-worker-runner.js'),'utf8');
const migration = fs.readFileSync(path.join(root,'migrations','20260801_007_email_worker_delivery.sql'),'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

const checks = [
  ['nodemailer dependency', Boolean(pkg.dependencies?.nodemailer)],
  ['queue row locking', worker.includes('FOR UPDATE')],
  ['processing claim state', worker.includes("status='processing'")],
  ['bounded retry policy', worker.includes('EMAIL_MAX_ATTEMPTS') && worker.includes('retryDelayMinutes')],
  ['stale claim recovery', worker.includes('STALE_PROCESSING_CLAIM_RELEASED')],
  ['SMTP opt-in switch', worker.includes('EMAIL_WORKER_ENABLED')],
  ['safe SMTP configuration check', worker.includes('smtpConfigured')],
  ['notification delivery update', worker.includes('os2_notifications') && worker.includes("delivery_status='sent'")],
  ['standalone worker runner', runner.includes('startEmailWorker') && runner.includes('SIGTERM')],
  ['delivery tracking migration', migration.includes('processing_started_at') && migration.includes('provider_message_id')],
  ['no runtime schema creation', !worker.includes('CREATE TABLE') && !runner.includes('CREATE TABLE')]
];

const failed = checks.filter(([,passed]) => !passed);
for (const [name,passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`Email worker validation failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log('Email worker validation passed.');
