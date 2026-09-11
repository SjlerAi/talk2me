'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normaliseExternalCode } = require('../src/services/staff-external-codes');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/staff-import-identities.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'views/staff-edit.ejs'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'sql/ONE_OFF_110_base_details_master_foundation.sql'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'sql/ONE_OFF_110A_staff_contact_seed.sql'), 'utf8');

assert.strictEqual(normaliseExternalCode(' olivierj06_c3d '), 'OLIVIERJ06_C3D');
assert.strictEqual(normaliseExternalCode('VONSB001 C3D'), 'VONSB001C3D');
assert.match(schema, /CREATE TABLE IF NOT EXISTS staff_external_codes/);
assert.match(route, /already belongs to/);
assert.match(route, /is_active=0/);
assert.match(route, /staff_external_code_saved/);
assert.match(view, /Import identities/);
assert.match(view, /Report \/ agent code/);
assert.match(routes, /staff-import-identities/);
assert.match(seed, /COALESCE\(NULLIF\(TRIM\(contact_number\),''\)/);
assert.ok(!/password_hash/.test(route), 'Import identity route must not read or write password hashes.');

console.log('Staff import identity validation passed.');
