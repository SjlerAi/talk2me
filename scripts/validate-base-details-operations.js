'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { mobileResult } = require('../src/services/monthly-import-matcher');
const { valuesFor, STAGE_ACTION_PREFIX } = require('../src/services/base-details-stager');
const { normaliseAccountNumber } = require('../src/services/base-details-account-unifier');
const { firstAcross, numeric } = require('../src/services/mobile-event-ledger');

const root = path.resolve(__dirname, '..');
const stager = fs.readFileSync(path.join(root, 'src/services/base-details-stager.js'), 'utf8');
const unifier = fs.readFileSync(path.join(root, 'src/services/base-details-account-unifier.js'), 'utf8');
const ledger = fs.readFileSync(path.join(root, 'src/services/mobile-event-ledger.js'), 'utf8');
const centre = fs.readFileSync(path.join(root, 'src/routes/base-details-centre.js'), 'utf8');

assert.strictEqual(STAGE_ACTION_PREFIX, 'stage_base_');
assert.strictEqual(normaliseAccountNumber(' b0123456 '), 'B0123456');
assert.strictEqual(numeric('R 1,234.50'), 1234.5);
assert.strictEqual(firstAcross({ sourceFields: { Channel: 'Retail' } }, ['Channel']), 'Retail');

const references = {
  mobile: new Map(),
  currentMobileByPhone: new Map([
    ['27710000001', { id: 900, msisdn_normalised: '27710000001', account_id: 22, client_id: null, account_code: 'B0000022' }]
  ])
};
const monthly = mobileResult({ phone_original: '27710000001' }, references);
assert.strictEqual(monthly.classification, 'possible_match');
assert.strictEqual(monthly.actionType, 'link_existing_mobile_base');
assert.strictEqual(monthly.targetType, 'mobile_base_current');
assert.strictEqual(monthly.proposedAccountId, 22);

const noBase = mobileResult({ phone_original: '27710000002' }, { mobile: new Map(), currentMobileByPhone: new Map() });
assert.strictEqual(noBase.classification, 'new_record');
assert.strictEqual(noBase.actionType, 'create_mobile_record');

const staged = valuesFor({
  id: 1, batch_id: 2, row_fingerprint: 'a'.repeat(64),
  phone_original: '071 000 0003', account_number: 'B0000003',
  proposed_client_id: 10, proposed_account_id: 20,
  raw_data_json: JSON.stringify({
    sourceFields: { MSISDN: '0710000003', 'Account Code': 'B0000003' },
    baseDetails: { accountCode: 'B0000003', msisdn: '0710000003', accountName: 'Test', eligibleUpgradeFlag: 'Y' }
  })
});
assert.strictEqual(staged.msisdnNormalised, '27710000003');
assert.strictEqual(staged.accountCore, 'B0000003');
assert.strictEqual(JSON.parse(staged.rawJson).MSISDN, '0710000003');

// Hard safety guards: staging may not manipulate CRM customer history.
assert.ok(!/INSERT INTO clients/i.test(stager));
assert.ok(!/UPDATE clients/i.test(stager));
assert.ok(!/DELETE FROM clients/i.test(stager));
assert.ok(!/INSERT INTO customer_accounts/i.test(stager));
assert.ok(!/UPDATE customer_accounts/i.test(stager));
assert.ok(!/DELETE FROM customer_accounts/i.test(stager));

// Account unifier may create genuinely missing account masters, but never edits/deletes client history or merges account rows.
assert.match(unifier, /INSERT INTO customer_accounts/i);
assert.ok(!/UPDATE clients/i.test(unifier));
assert.ok(!/DELETE FROM clients/i.test(unifier));
assert.ok(!/DELETE FROM customer_accounts/i.test(unifier));
assert.ok(!/UPDATE customer_accounts\s+SET\s+account_number/i.test(unifier));

// Event ledger is append/upsert history only and resolves staff through the maintained alias table.
assert.match(ledger, /INSERT INTO mobile_events/i);
assert.match(ledger, /resolveStaffByExternalCode/);
assert.ok(!/INSERT INTO clients/i.test(ledger));
assert.ok(!/UPDATE clients/i.test(ledger));
assert.ok(!/DELETE FROM clients/i.test(ledger));

assert.match(centre, /\/backoffice\/base-details\/unify-accounts/);
assert.match(centre, /\/backoffice\/base-details\/sync-events/);

console.log('Base Details operational safety validation passed.');
