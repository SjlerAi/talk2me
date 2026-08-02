'use strict';

const assert = require('assert');
const { evaluateRestrictions } = require('./core/restrictions');
const { normalisePermissions, canRepresentativePerform } = require('./core/representatives');
const { safePayload } = require('./core/approvals');
const { assertTransition } = require('./core/work-items');
const { hasPermission } = require('./core/permissions');

function expectThrow(fn, message) {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert(thrown, `Expected ${message} to throw`);
  return thrown;
}

const blocked = evaluateRestrictions([
  { restriction_type: 'no_new_lines' },
  { restriction_type: 'maximum_line_count', restriction_value: '3' }
], 'add_mobile_line', { currentLineCount: 3 });
assert.strictEqual(blocked.allowed, false);
assert(blocked.blockers.includes('no_new_lines'));
assert(blocked.blockers.includes('maximum_line_count'));

const approval = evaluateRestrictions([
  { restriction_type: 'approval_for_upgrades' }
], 'upgrade');
assert.strictEqual(approval.allowed, true);
assert.strictEqual(approval.requiresApproval, true);

const permissions = normalisePermissions(['add_line','view_account','delete_customer','add_line']);
assert.deepStrictEqual(permissions, ['add_line','view_account']);
assert.strictEqual(canRepresentativePerform({ permissions: permissions }, 'add_line'), true);
assert.strictEqual(canRepresentativePerform({ permissions: permissions }, 'cancel_service'), false);

assert.deepStrictEqual(safePayload(Buffer.from('{"a":1}')), { a: 1 });
assert.deepStrictEqual(safePayload('not-json'), {});

assert.doesNotThrow(() => assertTransition('created','started'));
assert.strictEqual(expectThrow(() => assertTransition('accepted','started'), 'invalid transition').message, 'INVALID_WORK_ITEM_TRANSITION');

assert.strictEqual(hasPermission({ id: 1, role: 'owner' }, 'customer.delete'), true);
assert.strictEqual(hasPermission({ id: 2, role: 'staff' }, 'work.update', { ownerStaffId: 2 }), true);
assert.strictEqual(hasPermission({ id: 2, role: 'staff' }, 'customer.delete'), false);

console.log('Integrated core checks passed');
