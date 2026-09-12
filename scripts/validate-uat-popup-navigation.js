'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const os = fs.readFileSync(path.join(root, 'public/js/os-v6.js'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'views/layout.ejs'), 'utf8');

assert.match(os, /talk2me:open-route/);
assert.match(os, /event\.origin !== location\.origin/);
assert.match(os, /windows\.open\(/);
assert.match(layout, /talk2me:open-route/);
assert.match(layout, /window\.parent\.postMessage/);
assert.match(layout, /data-panel-self/);

console.log('UAT popup navigation validation passed.');
