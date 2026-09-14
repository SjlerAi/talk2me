'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isSystemAgentCode } = require('../src/services/mobile-event-ledger');
const { normaliseSouthAfricanMobile, formatSouthAfricanMobile } = require('../src/services/sa-phone-normalisation');

const root = path.resolve(__dirname, '..');
const searchRoute = fs.readFileSync(path.join(root, 'src/routes/base-details-search.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes.js'), 'utf8');
const centreRoute = fs.readFileSync(path.join(root, 'src/routes/base-details-centre.js'), 'utf8');
const centreView = fs.readFileSync(path.join(root, 'views/base-details-centre.ejs'), 'utf8');
const lineView = fs.readFileSync(path.join(root, 'views/mobile-base-view.ejs'), 'utf8');

assert.strictEqual(isSystemAgentCode('SADMIN'), true);
assert.strictEqual(isSystemAgentCode(' sadmin '), true);
assert.strictEqual(isSystemAgentCode('LEROUXG02_C3D'), false);

assert.strictEqual(normaliseSouthAfricanMobile('0797929779'), '27797929779');
assert.strictEqual(normaliseSouthAfricanMobile('27797929779'), '27797929779');
assert.strictEqual(normaliseSouthAfricanMobile('+27797929779'), '27797929779');
assert.strictEqual(normaliseSouthAfricanMobile('027797929779'), '27797929779');
assert.strictEqual(normaliseSouthAfricanMobile('797929779'), '');
assert.strictEqual(formatSouthAfricanMobile('27797929779'), '0797929779');

assert.match(searchRoute, /router\.get\('\/search\/all'/);
assert.match(searchRoute, /mobile_base_current/);
assert.match(searchRoute, /icc_id LIKE :like/);
assert.match(searchRoute, /imsi LIKE :like/);
assert.match(searchRoute, /phoneLocal/);
assert.match(searchRoute, /COALESCE\([\s\S]*mb\.client_id[\s\S]*SELECT c3\.id[\s\S]*c3\.account_number[\s\S]*mb\.account_code/);
assert.match(searchRoute, /resolved_client_id/);
assert.match(searchRoute, /const seenBaseTargets = new Set/);
assert.match(searchRoute, /record_type: resolvedClientId \? 'mobile' : 'mobile_base'/);
assert.match(searchRoute, /customers\/\$\{resolvedClientId\}\/360/);
assert.match(searchRoute, /mobile-base\/\$\{row\.id\}/);
assert.match(searchRoute, /router\.get\('\/mobile-base\/:id'/);
assert.match(searchRoute, /materializeBaseAccount/);
assert.match(searchRoute, /mobile_base_snapshots/);
assert.match(searchRoute, /mobile_events/);
assert.ok(routes.indexOf("require('./routes/base-details-search')") < routes.indexOf("require('./routes/index')"), 'Base Details search must precede the legacy /search/all route.');
assert.match(centreRoute, /UPPER\(TRIM\(COALESCE\(agent_code,''\)\)\)='SADMIN'/);
assert.match(centreRoute, /UPPER\(TRIM\(agent_code\)\)<>'SADMIN'/);
assert.match(centreView, /system events/);
assert.match(lineView, /Vodacom current-service record/);
assert.match(lineView, /Activation & upgrade history/);
assert.ok(!/INSERT INTO clients|UPDATE clients|DELETE FROM clients/i.test(searchRoute), 'Search itself must remain read-only and must not directly mutate clients.');
assert.ok(!/INSERT INTO customer_accounts|UPDATE customer_accounts|DELETE FROM customer_accounts/i.test(searchRoute), 'Search itself must remain read-only and must not directly mutate accounts.');

console.log('Base Details final integration validation passed.');
