'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const customerActions = fs.readFileSync(path.join(root, 'public/js/customer-actions.js'), 'utf8');
const launchers = fs.readFileSync(path.join(root, 'public/js/os-launchers.js'), 'utf8');

assert.match(customerActions, /panelMode/);
assert.match(customerActions, /talk2me:open-route/);
assert.match(customerActions, /window\.parent\.postMessage/);
assert.match(customerActions, /data-panel-self/);
assert.match(customerActions, /url\.searchParams\.delete\('panel'\)/);
assert.match(launchers, /talk2me:open-route/);
assert.match(launchers, /event\.origin !== window\.location\.origin/);
assert.match(launchers, /openInternalRoute/);
assert.match(launchers, /windows\.open\(/);
assert.match(launchers, /url\.searchParams\.delete\('panel'\)/);

console.log('UAT popup navigation validation passed.');
