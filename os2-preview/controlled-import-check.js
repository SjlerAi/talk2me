'use strict';

const assert = require('assert');
const { classifyRow, normaliseAccount, normalisePhone } = require('./controlled-import-routes');

assert.strictEqual(normaliseAccount(' vb-123 45 '), 'VB12345');
assert.strictEqual(normalisePhone('+27 82 123 4567'), '0821234567');

const valid = classifyRow({
  account_number: 'VB-1001',
  cell_number: '082 123 4567',
  client_name: 'Example Customer',
  email: ' CUSTOMER@EXAMPLE.CO.ZA '
});
assert.strictEqual(valid.classification, 'ambiguous');
assert.deepStrictEqual(valid.validationErrors, []);
assert.strictEqual(valid.payload.accountNumber, 'VB1001');
assert.strictEqual(valid.payload.mobile, '0821234567');
assert.strictEqual(valid.payload.email, 'customer@example.co.za');

const invalid = classifyRow({ client_name: 'Missing identifiers' });
assert.strictEqual(invalid.classification, 'invalid');
assert(invalid.validationErrors.includes('ACCOUNT_NUMBER_REQUIRED'));
assert(invalid.validationErrors.includes('MOBILE_REQUIRED'));

console.log('Controlled import validation passed.');
