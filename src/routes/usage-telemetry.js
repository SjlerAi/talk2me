'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { trackEvent } = require('../services/usage-telemetry');

const router = express.Router();

function clean(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

router.post('/api/usage/events', requireAuth, async (req, res) => {
  const eventType = clean(req.body?.event_type || 'ui_action', 40);
  const screenKey = clean(req.body?.screen_key, 120);
  const moduleName = clean(req.body?.module_name, 120);
  const entityType = clean(req.body?.entity_type, 80);
  const entityId = Number(req.body?.entity_id) || null;
  const action = clean(req.body?.action, 120);

  await trackEvent({
    staffId: req.session.user.id,
    eventType,
    screenKey,
    routePath: req.body?.route_path || req.originalUrl,
    moduleName,
    entityType,
    entityId,
    httpMethod: 'CLIENT',
    httpStatus: 200,
    metadata: action ? { action } : null
  });

  res.json({ ok: true });
});

module.exports = router;
