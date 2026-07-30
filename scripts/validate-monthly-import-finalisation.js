'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  AUTO_APPROVED_ACTIONS,
  FINALISABLE_NEW_ACTIONS
} = require('../src/services/monthly-import-finaliser');
const { normaliseSouthAfricanMobile } = require('../src/services/sa-phone-normalisation');

assert.deepStrictEqual(
  [...AUTO_APPROVED_ACTIONS].sort(),
  ['link_fixed_service', 'link_mobile_client'],
  'Only deterministic existing-record links may be automatically approved.'
);
assert(!AUTO_APPROVED_ACTIONS.has('resolve_mobile_conflict'));
assert(!AUTO_APPROVED_ACTIONS.has('resolve_fixed_conflict'));
assert(!AUTO_APPROVED_ACTIONS.has('create_mobile_record'));
assert.deepStrictEqual(
  [...FINALISABLE_NEW_ACTIONS].sort(),
  ['create_fixed_service', 'create_mobile_record'],
  'Only safe, matched-account new-record actions may be approved by explicit finalisation.'
);
assert(!FINALISABLE_NEW_ACTIONS.has('create_fixed_account_and_service'));

assert.strictEqual(normaliseSouthAfricanMobile('082 123 4567'), '27821234567');
assert.strictEqual(normaliseSouthAfricanMobile('+27 82 123 4567'), '27821234567');
assert.strictEqual(normaliseSouthAfricanMobile('011 123 4567'), '');

const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'monthly-import-finaliser.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'monthly-data-import.js'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'monthly-data-import.ejs'), 'utf8');
assert(service.includes("WHERE a.applied_status='not_applied'"), 'Finalisation must skip already-applied actions.');
assert(service.includes('FOR UPDATE'), 'Finalisation must lock the selected action and target rows.');
assert(service.includes('await connection.beginTransaction()'), 'Finalisation must use a database transaction.');
assert(service.includes('await connection.rollback()'), 'Finalisation must roll back on failure.');
assert(service.includes("m.classification='conflict'"), 'Unresolved conflicts must be counted and block finalisation.');
assert(service.includes('source_row_hash=:hash'), 'Fixed-service source hashes must be checked before writes.');
assert(service.includes('order_number=:orderNumber'), 'Fixed order-number uniqueness must be checked before writes.');
assert(service.includes('solution_id=:solutionId'), 'Fixed solution-ID uniqueness must be checked before writes.');
assert(service.includes('monthly_import_action_applied'), 'Applied action transitions must be audited.');
assert(service.includes('monthly_import_finalised'), 'The finalisation run must be audited.');
assert(routes.includes("name: 'dealer_reports', maxCount: 10"), 'Monthly upload must accept multiple report files.');
assert(routes.includes("router.post('/backoffice/data-import/process'"), 'The unified process route must exist.');
assert(routes.includes("router.post('/backoffice/data-import/finalise', requireAuth, managerOwnerOnly"), 'Only managers and owners may finalise.');
assert(view.includes("name=\"confirm_finalise\" value=\"yes\" required"), 'Finalisation must require explicit confirmation.');
assert(view.includes("panelMode?'?panel=1':''"), 'Monthly Import links and forms must preserve panel mode.');
assert(view.includes('-monthly-import-64'), 'The Monthly Import stylesheet cache key must be versioned for issue 64.');

console.log('Monthly import finalisation validation passed.');
