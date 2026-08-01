'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const required = [
  'collaboration-routes.js',
  'core/ownership.js',
  'migrations/20260801_004_collaboration_and_claims.sql'
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing collaboration file: ${file}`);
}

const routes = fs.readFileSync(path.join(root, 'collaboration-routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/20260801_004_collaboration_and_claims.sql'), 'utf8');
const ownership = fs.readFileSync(path.join(root, 'core/ownership.js'), 'utf8');

const routeMarkers = [
  '/api/os2/claims',
  '/api/os2/customers/:id/claims',
  '/api/os2/claims/:id/decision',
  '/api/os2/calendar',
  '/api/os2/sticky-notes/shared',
  '/api/os2/sticky-notes/:id/share'
];
for (const marker of routeMarkers) {
  if (!routes.includes(marker)) throw new Error(`Missing collaboration route: ${marker}`);
}
for (const table of ['os2_claim_requests','os2_claim_history','os2_calendar_events','os2_sticky_note_shares']) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) throw new Error(`Missing collaboration table: ${table}`);
}
if (!routes.includes('SELF_APPROVAL_NOT_ALLOWED')) throw new Error('Claim self-approval protection is missing');
if (!routes.includes("status !== 'pending'")) throw new Error('Claim final-state guard is missing');
if (!ownership.includes('transferOwnership')) throw new Error('Ownership transfer service is missing');
if (/CREATE\s+TABLE/i.test(routes)) throw new Error('Runtime schema mutation found in collaboration routes');

console.log('Collaboration and claims architecture check passed.');
