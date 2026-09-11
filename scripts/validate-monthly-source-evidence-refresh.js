'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { hashBuffer } = require('../src/services/monthly-source-evidence-refresh');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/services/monthly-source-evidence-refresh.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/routes/monthly-source-evidence-refresh.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'views/monthly-source-evidence-refresh.ejs'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes.js'), 'utf8');

assert.strictEqual(hashBuffer(Buffer.from('Talk2Me')), 'fd35d6f8c2f085659021d62c8557024f646786117879ceafba504333b4160385');
assert.match(service, /WHERE file_hash=:fileHash/);
assert.match(service, /storedRows\.length !== parsed\.rows\.length/);
assert.match(service, /row_fingerprint/);
assert.match(service, /source_row_number/);
assert.match(service, /UPDATE monthly_import_rows\s+SET raw_data_json=/i);
assert.match(service, /monthly_import_source_evidence_refreshed/);
assert.match(service, /Base Details uses its own current\/snapshot workflow/);

// The refresh must never alter business matching/approval/finalisation/customer state.
for (const forbidden of [
  /INSERT INTO monthly_import_batches/i,
  /UPDATE monthly_import_batches/i,
  /DELETE FROM monthly_import_batches/i,
  /INSERT INTO monthly_import_matches/i,
  /UPDATE monthly_import_matches/i,
  /INSERT INTO monthly_import_actions/i,
  /UPDATE monthly_import_actions/i,
  /INSERT INTO clients/i,
  /UPDATE clients/i,
  /DELETE FROM clients/i,
  /INSERT INTO customer_accounts/i,
  /UPDATE customer_accounts/i,
  /DELETE FROM customer_accounts/i
]) assert.ok(!forbidden.test(service), `Forbidden write found: ${forbidden}`);

assert.match(route, /requireRole\('owner','manager'\)/);
assert.match(route, /upload\.single\('source_evidence_report'\)/);
assert.match(view, /Nothing was changed/);
assert.match(view, /raw_data_json/);
assert.match(routes, /monthly-source-evidence-refresh/);

console.log('Monthly source-evidence refresh safety validation passed.');
