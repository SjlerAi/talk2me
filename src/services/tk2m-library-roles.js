'use strict';

// Publishing policy is ROLE-based. Messages, work assignment, notifications
// and audit trails continue to identify specific user IDs.
function hasOwnerLibraryAuthority(user) {
  return Boolean(user && String(user.role || '').trim().toLowerCase() === 'owner');
}

module.exports = { hasOwnerLibraryAuthority };
