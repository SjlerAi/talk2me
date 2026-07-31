'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  STATUS_RULES,
  loadManagement,
  toCsv
} = require('../services/monthly-import-management');
const { retryMonthlyImportAction } = require('../services/monthly-import-finaliser');

const router = express.Router();
const allowedRoles = new Set(['owner', 'manager']);

function ownerManagerOnly(req, res, next) {
  if (!allowedRoles.has(String(req.session.user?.role || '').toLowerCase())) {
    return res.status(403).render('error', {
      title: 'Access denied',
      message: 'Only an owner or manager can open Monthly Import Management.'
    });
  }
  next();
}

function panelMode(req) {
  return String(req.query.panel || req.body.panel || '') === '1';
}

function returnQuery(req) {
  const query = new URLSearchParams(String(req.body.return_query || ''));
  if (panelMode(req)) query.set('panel', '1');
  return query;
}

router.get('/backoffice/monthly-import-management', requireAuth, ownerManagerOnly, async (req, res, next) => {
  try {
    const management = await loadManagement(req.query, { panelMode: panelMode(req) });
    res.render('monthly-import-management', {
      title: 'Monthly Import Management',
      ...management,
      statusRules: STATUS_RULES,
      notice: String(req.query.notice || '').slice(0, 500),
      error: String(req.query.error || '').slice(0, 500)
    });
  } catch (error) { next(error); }
});

router.get('/backoffice/monthly-import-management.csv', requireAuth, ownerManagerOnly, async (req, res, next) => {
  try {
    const management = await loadManagement(req.query, { exportAll: true, panelMode: panelMode(req) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="monthly-import-management.csv"');
    res.send(`\uFEFF${toCsv(management.rows)}`);
  } catch (error) { next(error); }
});

router.post('/backoffice/monthly-import-management/actions/:id/retry',
  requireAuth, ownerManagerOnly, async (req, res) => {
    const query = returnQuery(req);
    try {
      const result = await retryMonthlyImportAction(req.params.id, {
        userId: req.session.user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      query.set('notice', `Action #${result.actionId} completed safely. Live ${result.targetType} #${result.targetId} is now linked.`);
    } catch (error) {
      query.set('error', error.message);
    }
    res.redirect(`${res.locals.basePath}/backoffice/monthly-import-management?${query.toString()}`);
  });

module.exports = router;
module.exports.ownerManagerOnly = ownerManagerOnly;
