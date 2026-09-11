'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isSystemAgentCode } = require('../src/services/mobile-event-ledger');

const root = path.resolve(__dirname, '..');
const searchRoute = fs.readFileSync(path.join(root, 'src/routes/base-details-search.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes.js'), 'utf8');
const centreRoute = fs.readFileSync(path.join(root, 'src/routes/base-details-centre.js'), 'utf8');
const centreView = fs.readFileSync(path.join(root, 'views/base-details-centre.ejs'), 'utf8');
const lineView = fs.readFileSync(path.join(root, 'views/mobile-base-view.ejs'), 'utf8');

assert.strictEqual(isSystemAgentCode('SADMIN'), true);
assert.strictEqual(isSystemAgentCode(' sadmin '), true);
assert.strictEqual(isSystemAgentCode('LEROUXG02_C3D'), false);
assert.match(searchRoute, /router\.get\('\/search\/all'/);
assert.match(searchRoute, /mobile_base_current/);
assert.match(searchRoute, /icc_id LIKE :like/);
assert.match(searchRoute, /imsi LIKE :like/);
assert.match(searchRoute, /NOT EXISTS[\s\S]*clients c2/);
assert.match(searchRoute, /router\.get\('\/mobile-base\/:id'/);
assert.match(searchRoute, /mobile_base_snapshots/);
assert.match(searchRoute, /mobile_events/);
assert.ok(routes.indexOf("require('./routes/base-details-search')") < routes.indexOf("require('./routes/index')"), 'Base Details search must precede the legacy /search/all route.');
assert.match(centreRoute, /UPPER\(TRIM\(COALESCE\(agent_code,''\)\)\)='SADMIN'/);
assert.match(centreRoute, /UPPER\(TRIM\(agent_code\)\)<>'SADMIN'/);
assert.match(centreView, /system events/);
assert.match(lineView, /Vodacom current-service record/);
assert.match(lineView, /Activation & upgrade history/);
assert.ok(!/INSERT INTO clients|UPDATE clients|DELETE FROM clients/i.test(searchRoute), 'Read-only current-service search must not mutate clients.');
assert.ok(!/INSERT INTO customer_accounts|UPDATE customer_accounts|DELETE FROM customer_accounts/i.test(searchRoute), 'Read-only current-service search must not mutate accounts.');

console.log('Base Details final integration validation passed.');
