'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const customerActions = fs.readFileSync(path.join(root, 'public/js/customer-actions.js'), 'utf8');
const launchers = fs.readFileSync(path.join(root, 'public/js/os-launchers.js'), 'utf8');
const myDay = fs.readFileSync(path.join(root, 'public/js/calendar-home-uat.js'), 'utf8');

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

// Fallbacks must not navigate the parent workspace away from My Day.
assert.doesNotMatch(myDay, /window\.location\.assign\(/, 'My Day fallback must never replace the original CRM screen');
assert.match(myDay, /window\.open\(destination\.href/, 'Use a separate work window when the OS manager is unavailable');
assert.match(myDay, /destination\.origin !== window\.location\.origin/, 'Fallback popups must remain same-origin');
assert.match(myDay, /popup\.opener = null/, 'Fallback popups must not retain parent opener access');
console.log('UAT popup navigation validation passed.');
