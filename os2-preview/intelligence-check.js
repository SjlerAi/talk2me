'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'intelligence-routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '20260801_003_operational_intelligence.sql'), 'utf8');

assert(server.includes("require('./intelligence-routes')"), 'intelligence router import missing');
assert.strictEqual((server.match(/createIntelligenceRouter\(\{ pool, requireAuth \}\)/g) || []).length, 1, 'intelligence router must mount once');
assert(routes.includes("OPPORTUNITY_STAGES"), 'opportunity lifecycle validation missing');
assert(routes.includes("SELF_APPROVAL_NOT_ALLOWED"), 'attendance correction self-approval protection missing');
assert(routes.includes("rowsToCsv"), 'CSV export support missing');
assert(routes.includes("os2_report_exports"), 'report export audit missing');
assert(migration.includes('CREATE TABLE os2_opportunities'), 'opportunity schema missing');
assert(migration.includes('CREATE TABLE os2_attendance_corrections'), 'attendance correction schema missing');
assert(migration.includes('CREATE TABLE os2_report_exports'), 'report export schema missing');
assert(!routes.includes('CREATE TABLE'), 'runtime schema creation is forbidden');

console.log('Operational intelligence validation passed.');
