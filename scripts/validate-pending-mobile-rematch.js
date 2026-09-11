'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/services/pending-mobile-rematcher.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/routes/base-details-centre.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'views/base-details-centre.ejs'), 'utf8');

assert.match(service, /b\.import_type IN \('activation','upgrade'\)/);
assert.match(service, /m\.review_status='pending'/);
assert.match(service, /a\.approval_status='pending'/);
assert.match(service, /a\.applied_status='not_applied'/);
assert.match(service, /mobile_base_current/);
assert.match(service, /previous_action_type === 'create_mobile_record'/);
assert.match(service, /result\.actionType === 'link_existing_mobile_base'/);
assert.doesNotMatch(service, /DELETE FROM/i);
assert.doesNotMatch(service, /UPDATE clients/i);
assert.doesNotMatch(service, /UPDATE customer_accounts/i);
assert.doesNotMatch(service, /INSERT INTO clients/i);
assert.doesNotMatch(service, /INSERT INTO customer_accounts/i);
assert.match(route, /rematch-pending-mobile/);
assert.match(route, /pending_mobile_imports_rematched/);
assert.match(view, /Re-match pending mobile imports/);
assert.match(view, /Applied or previously decided records are never reset/);

console.log('Pending mobile re-match safety validation passed.');
