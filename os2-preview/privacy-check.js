'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const required = [
  'privacy-routes.js',
  'migrations/20260801_009_privacy_retention_and_exports.sql',
  'PRIVACY_OPERATIONS_RUNBOOK.md'
];

for (const file of required) {
  if (!fs.existsSync(path.join(root,file))) throw new Error(`Missing privacy file: ${file}`);
}

const routes = fs.readFileSync(path.join(root,'privacy-routes.js'),'utf8');
const migration = fs.readFileSync(path.join(root,'migrations/20260801_009_privacy_retention_and_exports.sql'),'utf8');
const securityRoutes = fs.readFileSync(path.join(root,'security-routes.js'),'utf8');

const requiredRouteMarkers = [
  '/api/os2/privacy/customers/:customerId/consents',
  '/api/os2/privacy/requests',
  '/api/os2/privacy/requests/:id/decision',
  '/api/os2/privacy/requests/:id/export',
  '/api/os2/privacy/retention/reviews'
];
for (const marker of requiredRouteMarkers) if (!routes.includes(marker)) throw new Error(`Missing privacy route: ${marker}`);

const requiredTables = [
  'os2_customer_consents','os2_data_subject_requests','os2_data_exports','os2_retention_policies','os2_retention_reviews'
];
for (const table of requiredTables) if (!migration.includes(table)) throw new Error(`Missing privacy table: ${table}`);

if ((securityRoutes.match(/createPrivacyRouter/g) || []).length !== 2) throw new Error('Privacy router must be imported and mounted exactly once');
if (/CREATE\s+TABLE/i.test(routes)) throw new Error('Runtime CREATE TABLE detected in privacy routes');
if (!routes.includes('SELF_APPROVAL_NOT_ALLOWED')) throw new Error('Privacy self-approval protection missing');
if (!routes.includes('appendAudit')) throw new Error('Privacy audit integration missing');

console.log(JSON.stringify({ ok:true, module:'privacy', tables:requiredTables.length, routeMarkers:requiredRouteMarkers.length }, null, 2));