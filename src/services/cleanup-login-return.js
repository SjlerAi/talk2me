'use strict';

// The only login deep link supported here is the temporary Cleanup Centre.
// Keeping an explicit allow-list avoids redirecting sign-ins to external sites.
function safeCleanupReturn(value, basePath = '/talk2me') {
  if (typeof value !== 'string' || value.length > 1500) return null;
  if (!value.startsWith('/') || value.startsWith('//') ||
      /[\x00-\x20\\#]/.test(value)) return null;
  const root = String(basePath || '').replace(/\/+$/, '') + '/temporary-cleanup';
  const pathOnly = value.split('?', 1)[0];
  if (/%2f|%5c|%2e|%00|%0a|%0d/i.test(pathOnly)) return null;
  try {
    const url = new URL(value, 'https://talk2me.invalid');
    if (url.origin !== 'https://talk2me.invalid') return null;
    if (url.pathname !== root && !url.pathname.startsWith(root + '/')) return null;
    return url.pathname + url.search;
  } catch (_) { return null; }
}

function cleanupLoginUrl(req, res, reason = '') {
  const base = String(res.locals.basePath || '').replace(/\/+$/, '');
  const valid = safeCleanupReturn(String(req.originalUrl || ''), base);
  const qs = new URLSearchParams();
  if (reason) qs.set('reason', reason);
  if (valid) qs.set('return_to', valid);
  return base + '/login' + (qs.toString() ? '?' + qs.toString() : '');
}

module.exports = { safeCleanupReturn, cleanupLoginUrl };
