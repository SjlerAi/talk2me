'use strict';

const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

const details = read('src/routes/customer-details.js');
const actions = read('public/js/customer-actions.js');
const server = read('server.js');
const command = read('src/routes/uat-command-centre.js');
const launcher = read('public/js/os-launcher-strip.js');

requireText(details, "AND NOT (:account<>'' AND account_number=:account)", 'same-account sibling exclusion');
requireText(details, 'verifySavedCustomer', 'post-save verification');
requireText(details, 'Customer details were not updated.', 'affected-row guard');
requireText(actions, 'refreshOpenCustomerWindows', 'open Customer 360 refresh');
requireText(actions, "params.get('details_saved') === '1'", 'verified-save refresh trigger');
requireText(server, "require('./src/routes/uat-command-centre')", 'UAT Command Centre mount');
requireText(command, "router.get('/command-centre', requireAuth", 'authenticated UAT Command Centre route');
requireText(command, 'if (!IS_UAT) return next();', 'UAT-only Command Centre guard');
requireText(launcher, 'data.uatCommandCentre', 'temporary UAT Command Centre launcher');

console.log('UAT customer save and Command Centre validation passed.');
