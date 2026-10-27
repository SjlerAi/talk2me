'use strict';
// Static regression guard for the retired Cudu experience on the new TK2M CRM.
// No browser, database or staff login is required to run this test.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

for (const template of ['views/os-shell.ejs', 'views/layout.ejs']) {
  const src = read(template);
  const css = src.split('\n').filter(line => line.includes('/public/css/cudo-widget.css'));
  const script = src.split('\n').filter(line => line.includes('/public/js/cudo-widget.js'));
  assert.equal(css.length, 1, template + ' loads stylesheet once');
  assert.equal(script.length, 1, template + ' loads widget once');
  for (const line of [...css, ...script]) {
    assert.match(line, /isUat\s*&&\s*!cudoDisabled\s*&&/);
  }
}

const server = read('server.js');
assert.match(server, /https:\/\/crm\.tk2m\.co\.za/);
assert.match(server, /if \(!CUDO_DISABLED\) \{\s*const cudoAi = require\('\.\/src\/routes\/cudo-ai'\)/);
const work = read('public/js/uat-work-widgets.js');
assert.match(work, /retireCudoInTk2m\s*=\s*window\.location\.hostname === 'crm\.tk2m\.co\.za'/);
assert.match(work, /taskState\.management\s*&&\s*!retireCudoInTk2m\s*\?\s*quickCommandHtml\(\)/);
assert.match(work, /taskState\.management\s*&&\s*!prefill\.advanced\s*&&\s*!retireCudoInTk2m/);
assert.match(work, /<h3>New task<\/h3>/);
console.log('PASS: Cudu widget and API retired on permanent TK2M CRM; regular tasks preserved.');
