'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { decideLegacyClaim } = require('../services/legacy-client-claim-decision');

const router = express.Router();

function panelMode(req) {
  return String(req.body?.panel || req.query?.panel || '') === '1';
}

function wantsJson(req) {
  return req.xhr || String(req.get('accept') || '').includes('application/json');
}

async function decide(req, res, next) {
  try {
    const result = await decideLegacyClaim(req.params.id, req.body.decision, {
      messageId: req.body.message_id,
      reason: req.body.reason || req.body.comment,
      user: req.session.user,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    if (wantsJson(req)) return res.json({ ok: true, result });
    const panel = panelMode(req) ? '&panel=1' : '';
    if (result.status === 'conflict') {
      return res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=pending&focus_request=${result.requestId}&reviewed=conflict${panel}`);
    }
    const source = String(req.body.return_to || 'assignment');
    if (source === 'message') return res.redirect(`${res.locals.basePath}/tasks?view=active${panel}`);
    return res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=pending&reviewed=${result.classification}${panel}`);
  } catch (error) {
    if (!error.statusCode) return next(error);
    if (wantsJson(req)) return res.status(error.statusCode).json({ ok: false, message: error.message, classification: error.classification });
    return res.status(error.statusCode).render('error', { title: 'Claim could not be reviewed', message: error.message });
  }
}

router.post('/legacy-client-claims/:id/decision', requireAuth, decide);
// Compatibility for the existing Assignment Centre and Approval Centre action URL.
router.post('/client-claims/:id/decision', requireAuth, decide);

module.exports = router;
