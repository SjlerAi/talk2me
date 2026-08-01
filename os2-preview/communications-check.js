'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const required = [
  'communications-routes.js',
  'migrations/20260801_006_communications_and_digest.sql'
];

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`Missing required communications file: ${file}`);
}

const routes = fs.readFileSync(path.join(root, 'communications-routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/20260801_006_communications_and_digest.sql'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const permissions = fs.readFileSync(path.join(root, 'core/permissions.js'), 'utf8');

const routeRequirements = [
  '/api/os2/notifications',
  '/api/os2/broadcasts',
  '/api/os2/digests/generate',
  '/api/os2/email-queue',
  'SELF_APPROVAL'
];
for (const token of routeRequirements.slice(0,4)) {
  if (!routes.includes(token)) throw new Error(`Communications route missing token: ${token}`);
}

for (const table of ['os2_notifications','os2_broadcasts','os2_digest_runs','os2_email_queue']) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) throw new Error(`Communications migration missing table: ${table}`);
}

const mountCount = (server.match(/createCommunicationsRouter\(\{ pool, requireAuth \}\)/g) || []).length;
if (mountCount !== 1) throw new Error(`Communications router must be mounted once; found ${mountCount}`);
if (!permissions.includes('notification.broadcast')) throw new Error('Broadcast permission missing');
if (/CREATE\s+TABLE/i.test(routes)) throw new Error('Runtime CREATE TABLE is forbidden');
if (!routes.includes('safeUrl')) throw new Error('Action URL validation missing');
if (!routes.includes('os2_email_queue')) throw new Error('Email queue integration missing');
if (!routes.includes('os2_digest_runs')) throw new Error('Digest persistence missing');

console.log('Communications architecture check passed');
