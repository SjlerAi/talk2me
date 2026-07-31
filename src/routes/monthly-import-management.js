'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  STATUS_RULES,
  loadManagement,
  toCsv
} = require('../services/monthly-import-management');
const { retryMonthlyImportAction } = require('../services/monthly-import-finaliser');
const {
  loadBulkPreview,
  finaliseBulkSafe
} = require('../services/monthly-import-bulk-finaliser');
const {
  loadExceptionQueue,
  correctExceptionRow,
  linkExistingTarget,
  decideException
} = require('../services/monthly-import-exceptions');

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

function operationContext(req) {
  return {
    userId: req.session.user.id,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  };
}

function exceptionRedirect(req, res, message, isError = false) {
  const query = returnQuery(req);
  query.delete('focus_row');
  query.delete('live_search');
  query.set(isError ? 'error' : 'notice', message);
  return res.redirect(`${res.locals.basePath}/backoffice/monthly-import-management/exceptions?${query.toString()}`);
}

router.get('/backoffice/monthly-import-management', requireAuth, ownerManagerOnly, async (req, res, next) => {
  try {
    const [management, bulkPreview] = await Promise.all([
      loadManagement(req.query, { panelMode: panelMode(req) }),
      loadBulkPreview(req.query)
    ]);
    res.render('monthly-import-management', {
      title: 'Monthly Import Management',
      ...management,
      bulkPreview,
      statusRules: STATUS_RULES,
      notice: String(req.query.notice || '').slice(0, 500),
      error: String(req.query.error || '').slice(0, 500)
    });
  } catch (error) { next(error); }
});

router.get('/backoffice/monthly-import-management/bulk/preview',
  requireAuth, ownerManagerOnly, async (req, res, next) => {
    try {
      const preview = await loadBulkPreview(req.query);
      res.render('monthly-import-bulk-preview', {
        title: 'Preview Safe Monthly Import Records',
        preview,
        returnQuery: new URLSearchParams(req.query).toString()
      });
    } catch (error) { next(error); }
  });

router.get('/backoffice/monthly-import-management/exceptions',
  requireAuth, ownerManagerOnly, async (req, res, next) => {
    try {
      const queue = await loadExceptionQueue(req.query, { panelMode: panelMode(req) });
      res.render('monthly-import-exceptions', {
        title: 'Resolve Monthly Import Exceptions',
        ...queue,
        returnQuery: new URLSearchParams(req.query).toString(),
        notice: String(req.query.notice || '').slice(0, 500),
        error: String(req.query.error || '').slice(0, 500)
      });
    } catch (error) { next(error); }
  });

router.post('/backoffice/monthly-import-management/exceptions/:rowId/correct',
  requireAuth, ownerManagerOnly, async (req, res) => {
    try {
      const fields = {};
      for (const key of ['customer_name', 'phone_original', 'account_number']) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) fields[key] = req.body[key];
      }
      const safety = await correctExceptionRow(req.params.rowId, fields, operationContext(req));
      return exceptionRedirect(req, res, safety.safe
        ? 'Record corrected and rechecked. It is now safe and has returned to bulk approval.'
        : `Record corrected and rechecked. It still needs attention: ${safety.reason}`);
    } catch (error) {
      return exceptionRedirect(req, res, error.message, true);
    }
  });

router.post('/backoffice/monthly-import-management/exceptions/:rowId/link',
  requireAuth, ownerManagerOnly, async (req, res) => {
    try {
      const safety = await linkExistingTarget(
        req.params.rowId, req.body.target_type, req.body.target_id, operationContext(req)
      );
      return exceptionRedirect(req, res, safety.safe
        ? 'Live record selected and rechecked. The imported record is now safe for bulk approval.'
        : `Live record selected, but the imported record still needs attention: ${safety.reason}`);
    } catch (error) {
      return exceptionRedirect(req, res, error.message, true);
    }
  });

router.post('/backoffice/monthly-import-management/exceptions/:rowId/decision',
  requireAuth, ownerManagerOnly, async (req, res) => {
    try {
      const safety = await decideException(
        req.params.rowId, req.body.decision, req.body.reason, operationContext(req)
      );
      return exceptionRedirect(req, res, safety.safe
        ? 'Decision saved. This record is now safe for bulk approval.'
        : `Decision saved. The record remains excluded: ${safety.reason}`);
    } catch (error) {
      return exceptionRedirect(req, res, error.message, true);
    }
  });

router.post('/backoffice/monthly-import-management/bulk/finalise',
  requireAuth, ownerManagerOnly, async (req, res, next) => {
    try {
      if (String(req.body.confirm_bulk || '') !== 'yes') throw new Error('Confirm the bulk-safe finalisation before continuing.');
      const scope = Object.fromEntries(new URLSearchParams(String(req.body.return_query || '')));
      const result = await finaliseBulkSafe(scope, {
        userId: req.session.user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.render('monthly-import-bulk-results', {
        title: 'Bulk Monthly Import Results',
        result,
        returnQuery: new URLSearchParams(scope).toString()
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
        ...operationContext(req)
      });
      query.set('notice', `Action #${result.actionId} completed safely. Live ${result.targetType} #${result.targetId} is now linked.`);
    } catch (error) {
      query.set('error', error.message);
    }
    if (req.body.return_to === 'exceptions') {
      return res.redirect(`${res.locals.basePath}/backoffice/monthly-import-management/exceptions?${query.toString()}`);
    }
    res.redirect(`${res.locals.basePath}/backoffice/monthly-import-management?${query.toString()}`);
  });

module.exports = router;
module.exports.ownerManagerOnly = ownerManagerOnly;
module.exports.operationContext = operationContext;
