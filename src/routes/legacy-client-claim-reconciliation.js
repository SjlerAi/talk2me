'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  loadLegacyClaimReconciliation,
  toCsv
} = require('../services/legacy-client-claim-reconciliation');

const router = express.Router();
const allowedRoles = new Set(['owner', 'manager', 'admin']);

function managementOnly(req, res, next) {
  const role = String(req.session.user?.role || '').toLowerCase();
  if (!allowedRoles.has(role)) {
    return res.status(403).render('error', {
      title: 'Access denied',
      message: 'Only an owner, manager or administrator can open this reconciliation report.'
    });
  }
  next();
}

function isPanelRequest(req) {
  return String(req.query.panel || '') === '1';
}

router.get('/backoffice/legacy-client-claim-reconciliation', requireAuth, managementOnly, async (req, res, next) => {
  try {
    const report = await loadLegacyClaimReconciliation(req.query, {
      basePath: res.locals.basePath,
      panelMode: isPanelRequest(req)
    });
    res.render('legacy-client-claim-reconciliation', {
      title: 'Legacy Client Claim Reconciliation',
      ...report
    });
  } catch (error) { next(error); }
});

router.get('/backoffice/legacy-client-claim-reconciliation.csv', requireAuth, managementOnly, async (req, res, next) => {
  try {
    const report = await loadLegacyClaimReconciliation(req.query, {
      basePath: res.locals.basePath,
      panelMode: isPanelRequest(req),
      exportAll: true
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="legacy-client-claim-reconciliation.csv"');
    res.send(`\uFEFF${toCsv(report.rows)}`);
  } catch (error) { next(error); }
});

module.exports = router;
module.exports.managementOnly = managementOnly;
module.exports.isPanelRequest = isPanelRequest;
