'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normaliseSouthAfricanMobile } = require('../src/services/sa-phone-normalisation');
const { normaliseAccount, normaliseMac, mobileResult, fixedResult } = require('../src/services/monthly-import-matcher');

const root = path.resolve(__dirname, '..');
const matchingSources = [
  'src/services/monthly-import-matcher.js',
  'src/routes/monthly-data-import.js'
].map(file => fs.readFileSync(path.join(root, file), 'utf8'));
const matchingSql = fs.readFileSync(path.join(root, 'sql/ONE_OFF_060_monthly_import_matching_review.sql'), 'utf8');

assert.strictEqual(normaliseSouthAfricanMobile('082 123 4567'), '27821234567');
assert.strictEqual(normaliseSouthAfricanMobile('+27 (82) 123-4567'), '27821234567');
assert.strictEqual(normaliseSouthAfricanMobile('27821234567'), '27821234567');
assert.strictEqual(normaliseSouthAfricanMobile('012 345 6789'), '');
assert.strictEqual(normaliseSouthAfricanMobile('821234567'), '');
assert.strictEqual(normaliseSouthAfricanMobile('2782123456'), '');
assert.strictEqual(normaliseAccount(' vb 03-6728 '), 'VB036728');
assert.strictEqual(normaliseMac('0c:61-f9 32.ef7b'), '0C61F932EF7B');

const mobileReferences = { mobile: new Map([['27821234567', new Map([[7, { id: 7, clientName: 'Test', accountId: 3, matchedFields: ['cell_number'] }]])]]) };
assert.strictEqual(mobileResult({ phone_original: '082 123 4567' }, mobileReferences).classification, 'exact_match');
assert.strictEqual(mobileResult({ phone_original: '083 000 0000' }, mobileReferences).classification, 'new_record');
const fixedReferences = {
  accountsByNumber: new Map([['B123', [{ id: 4, account_number: 'B123', display_name: 'Example' }]]]),
  fixedAccountsByAccountId: new Map(), fixedAccountsByNumber: new Map(), servicesByFixedAccount: new Map()
};
const fixedProposal = fixedResult({ account_number: 'B 123' }, fixedReferences);
assert.strictEqual(fixedProposal.classification, 'exact_match');
assert.strictEqual(fixedProposal.actionType, 'create_fixed_service');

const forbiddenLiveWrite = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:`)?(?:clients|customer_accounts|fixed_accounts|fixed_services)(?:`)?\b/i;
for (const source of matchingSources) {
  assert.ok(!forbiddenLiveWrite.test(source), 'Phase 2 matching code must not write to live customer/account/service tables.');
}
assert.match(matchingSources[0], /ON DUPLICATE KEY UPDATE/i);
assert.match(matchingSql, /UNIQUE KEY uq_monthly_import_matches_row \(import_row_id\)/);
assert.match(matchingSql, /UNIQUE KEY uq_monthly_import_actions_match \(match_id\)/);
assert.ok(!matchingSql.includes('monthly_import_matches.sql'), 'One-off SQL must not register itself with generic migrations.');

console.log('Monthly import matching validation passed.');
