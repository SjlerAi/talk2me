'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { trackEvent } = require('../services/usage-telemetry');

const router = express.Router();

function clean(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// Staff can report *their own* window actions only. These are clearly labelled
// browser-reported, not authoritative server-side business changes.
const CLIENT_EVENTS = new Set([
  'feature_open', 'ui_action',
  'window_open', 'window_reopen', 'window_focus', 'window_minimize',
  'window_restore', 'window_maximize', 'window_unmaximize', 'window_close',
  'external_open', 'external_focus', 'external_close',
  'external_close_detected', 'external_still_open',
  'external_blocked', 'external_unconfigured'
]);
const WINDOW_EVENTS = new Set([...CLIENT_EVENTS].filter(v =>
  v.startsWith('window_') || v.startsWith('external_')));
const KINDS = new Set(['crm', 'crm_customer', 'external_embedded',
  'external_companion', 'external_supplier', 'native']);
function safeKey(value, max = 80) {
  return clean(value, max).replace(/[^a-zA-Z0-9:_-]/g, '');
}
router.post('/api/usage/events', requireAuth, async (req, res) => {
  const eventType = clean(req.body?.event_type || 'ui_action', 40);
  if (!CLIENT_EVENTS.has(eventType)) return res.status(400).json({ ok:false, error:'Invalid usage event type' });
  const screenKey = safeKey(req.body?.screen_key, 120);
  const moduleName = safeKey(req.body?.module_name, 120);
  const action = safeKey(req.body?.action, 80);
  const windowKey = safeKey(req.body?.window_key, 80);
  const windowKind = clean(req.body?.window_kind, 32);
  const outcome = clean(req.body?.outcome, 24);
  if (WINDOW_EVENTS.has(eventType) &&
    (!windowKey || !KINDS.has(windowKind))) {
    return res.status(400).json({ok:false,error:'Missing window audit fields'});
  }
  const metadata = {};
  if (action) metadata.action = action;
  if (WINDOW_EVENTS.has(eventType)) {
    metadata.window_key = windowKey;
    metadata.window_kind = windowKind;
    if (['success','requested','blocked','unconfigured','observed'].includes(outcome)) metadata.outcome = outcome;
  }

  await trackEvent({
    staffId: req.session.user.id,
    eventType,
    screenKey,
    // The CRM route is normalised and query strings are removed. Never record
    // external URLs, search text, customer form fields or message contents.
    routePath: typeof req.body?.route_path === 'string' &&
      req.body.route_path.startsWith('/') && !req.body.route_path.startsWith('//')
      ? req.body.route_path.split('?')[0] : req.originalUrl,
    moduleName,
    httpMethod: 'CLIENT',
    httpStatus: 200,
    metadata: Object.keys(metadata).length ? metadata : null
  });
  res.json({ ok: true });
});

module.exports = router;
