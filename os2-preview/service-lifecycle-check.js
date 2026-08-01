'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'service-lifecycle-routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '20260801_005_schema_alignment_and_service_lifecycle.sql'), 'utf8');

const assertions = [
  [server.includes("require('./service-lifecycle-routes')"), 'service lifecycle router import'],
  [(server.match(/createServiceLifecycleRouter/g) || []).length === 2, 'single service lifecycle router mount'],
  [routes.includes("router.patch('/api/os2/mobile-lines/:id'"), 'mobile update route'],
  [routes.includes("router.post('/api/os2/mobile-lines/:id/cancel'"), 'mobile cancellation route'],
  [routes.includes("router.get('/api/os2/customers/:id/service-history'"), 'service history route'],
  [routes.includes('enforceCustomerAction'), 'restriction enforcement'],
  [routes.includes('createApproval'), 'approval creation'],
  [migration.includes('CREATE TABLE IF NOT EXISTS os2_mobile_lines'), 'mobile line alignment table'],
  [migration.includes('CREATE TABLE IF NOT EXISTS os2_customer_ownership'), 'ownership alignment table'],
  [migration.includes('CREATE TABLE IF NOT EXISTS os2_customer_restrictions'), 'restriction alignment table'],
  [migration.includes('CREATE TABLE IF NOT EXISTS os2_service_change_history'), 'service history table'],
  [!routes.includes('CREATE TABLE'), 'no runtime table creation']
];

const failed = assertions.filter(([ok]) => !ok).map(([, name]) => name);
if (failed.length) {
  console.error(`Service lifecycle validation failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('Service lifecycle validation passed.');
