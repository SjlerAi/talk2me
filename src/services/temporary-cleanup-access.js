'use strict';

// Temporary UAT-only queue. It expires automatically and is invisible in production.
// Production activation requires a separately reviewed release, database backup and explicit approval.
const CLOSE_AT = Date.parse('2026-11-01T00:00:00+02:00');
const DEFAULT_STAFF_EMAILS = ['jonathan@talk-online.co.za', 'gerda@talk-online.co.za'];
const clean = value => String(value || '').trim().toLowerCase();

function isCleanupEnabled(now = Date.now()) {
  return clean(process.env.UAT_MODE) === 'true' &&
    clean(process.env.DB_NAME) === 'uent_crm' &&
    clean(process.env.T2M_TEMP_CLEANUP_ENABLED) !== 'false' &&
    clean(process.env.T2M_TEMP_CLEANUP_ENABLED) !== '0' &&
    Number(now) < CLOSE_AT;
}

function canUseTemporaryCleanup(user, now = Date.now()) {
  if (!isCleanupEnabled(now) || !user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) < 1) return false;
  if (clean(user.role) === 'owner') return true;
  const extra = clean(process.env.T2M_TEMP_CLEANUP_ALLOWED_EMAILS).split(',').filter(Boolean);
  const emails = new Set([...DEFAULT_STAFF_EMAILS, ...extra]);
  return emails.has(clean(user.email));
}

module.exports = { CLOSE_AT, isCleanupEnabled, canUseTemporaryCleanup };
