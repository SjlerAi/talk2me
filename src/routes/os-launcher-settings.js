const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const {
  LauncherValidationError,
  enabledLaunchers,
  ensureTable,
  loadLaunchers,
  saveLaunchers,
  submittedValues
} = require('../services/os-launcher-settings');

const router = express.Router();

function isOwner(user) {
  return Boolean(user && ['owner', 'admin'].includes(user.role));
}

router.use(async (req, res, next) => {
  if (req.path !== '/workspace') return next();
  try {
    res.locals.osLaunchers = await loadLaunchers(db);
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/backoffice/os-launchers', requireAuth, async (req, res, next) => {
  if (!isOwner(req.session.user)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Only the owner or administrator can change workstation launcher settings.' });
  }
  try {
    const launchers = await loadLaunchers(db);
    res.render('os-launcher-settings', {
      title: 'Workstation Launchers', launchers, saved: req.query.saved, error: null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/backoffice/os-launchers', requireAuth, async (req, res, next) => {
  if (!isOwner(req.session.user)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Only the owner or administrator can change workstation launcher settings.' });
  }
  let connection;
  try {
    await ensureTable(db);
    connection = await db.getConnection();
    await saveLaunchers(connection, req.body, req.session.user.id);
    res.redirect(`${res.locals.basePath}/backoffice/os-launchers?saved=1${String(req.query.panel || req.body.panel || '') === '1' ? '&panel=1' : ''}`);
  } catch (error) {
    try {
      const persisted = await loadLaunchers(db);
      const launchers = error instanceof LauncherValidationError && error.submittedLaunchers
        ? error.submittedLaunchers
        : submittedValues(req.body, persisted);
      res.status(400).render('os-launcher-settings', {
        title: 'Workstation Launchers', launchers, saved: false,
        error: error instanceof LauncherValidationError ? error.message : 'Workstation launcher settings could not be saved. No settings were changed.'
      });
    } catch (renderError) {
      next(renderError);
    }
  } finally {
    if (connection) connection.release();
  }
});

router.get('/api/os/launchers', requireAuth, async (req, res, next) => {
  try {
    const launchers = enabledLaunchers(await loadLaunchers(db));
    res.json({ ok: true, launchers });
  } catch (error) {
    next(error);
  }
});

router.use(require('./monthly-data-import'));
router.use(require('./attendance'));

module.exports = router;
