const express = require('express');
const { requireAuth } = require('../middleware/auth');
const nightlyLogout = require('../services/nightly-logout');
const db = require('../config/db');

const router = express.Router();

function isManagement(user) {
  return Boolean(user && ['owner', 'admin', 'manager'].includes(user.role));
}

router.get('/api/session-status', (req, res) => {
  if (!req.session.user) return res.status(401).json({ authenticated: false, reason: 'default_logout' });
  res.json({ authenticated: true });
});

router.get('/api/attendance/nightly-settings', requireAuth, async (req, res, next) => {
  try {
    if (!isManagement(req.session.user)) return res.sendStatus(403);
    const settings = await nightlyLogout.getNightlyLogoutSettings();
    res.json({
      enabled: Boolean(settings.auto_logout_enabled),
      time: String(settings.auto_logout_time || '22:00:00').slice(0, 5),
      timezone: settings.timezone || 'Africa/Johannesburg',
      lastRunDate: settings.last_auto_logout_date || null
    });
  } catch (error) { next(error); }
});

router.post('/backoffice/attendance/nightly-logout', requireAuth, async (req, res, next) => {
  try {
    if (!isManagement(req.session.user)) {
      return res.status(403).render('error', { title: 'Access denied', message: 'Only management can configure automatic logout.' });
    }

    await nightlyLogout.ensureNightlyLogoutSchema();
    const enabled = req.body.auto_logout_enabled === '1' ? 1 : 0;
    const time = String(req.body.auto_logout_time || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return res.status(400).render('error', { title: 'Invalid logout time', message: 'Choose a valid automatic logout time.' });
    }

    await db.execute(`UPDATE nightly_logout_settings SET
      enabled=:enabled,logout_time=:time,updated_by=:updatedBy
      WHERE id=1`, {
      enabled,
      time: `${time}:00`,
      updatedBy: req.session.user.id
    });

    res.redirect(`${res.locals.basePath}/backoffice/attendance?saved=settings${String(req.body.panel || '') === '1' ? '&panel=1' : ''}`);
  } catch (error) { next(error); }
});

module.exports = router;
