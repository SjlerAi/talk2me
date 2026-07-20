const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const MANAGED_SLOT_KEYS = ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5'];
const DEFAULTS = [
  { slot_key: 'slot_1', display_name: 'Vodacom', icon_text: 'V', portal_url: '', open_mode: 'separate', sort_order: 1, is_enabled: 1 },
  { slot_key: 'slot_2', display_name: 'MTN', icon_text: 'MTN', portal_url: '', open_mode: 'separate', sort_order: 2, is_enabled: 1 },
  { slot_key: 'slot_3', display_name: 'Telkom', icon_text: 'T', portal_url: '', open_mode: 'separate', sort_order: 3, is_enabled: 1 },
  { slot_key: 'slot_4', display_name: 'Sage', icon_text: 'S', portal_url: '', open_mode: 'separate', sort_order: 4, is_enabled: 1 },
  { slot_key: 'slot_5', display_name: 'System 5', icon_text: '5', portal_url: '', open_mode: 'separate', sort_order: 5, is_enabled: 0 }
];

function isOwner(user) {
  return Boolean(user && ['owner', 'admin'].includes(user.role));
}

async function ensureOpenModeColumn() {
  const [[column]] = await db.execute(`SELECT COUNT(*) total
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='os_external_launchers'
      AND COLUMN_NAME='open_mode'`);
  if (!Number(column?.total || 0)) {
    await db.execute(`ALTER TABLE os_external_launchers
      ADD COLUMN open_mode ENUM('embedded','separate') NOT NULL DEFAULT 'separate'
      AFTER portal_url`);
  }
}

async function ensureTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS os_external_launchers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    slot_key VARCHAR(40) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    icon_text VARCHAR(12) NOT NULL,
    portal_url VARCHAR(1000) NULL,
    open_mode ENUM('embedded','separate') NOT NULL DEFAULT 'separate',
    sort_order INT NOT NULL DEFAULT 0,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_os_external_launchers_slot (slot_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await ensureOpenModeColumn();

  for (const item of DEFAULTS) {
    await db.execute(`INSERT INTO os_external_launchers
      (slot_key,display_name,icon_text,portal_url,open_mode,sort_order,is_enabled)
      VALUES (:slot_key,:display_name,:icon_text,NULL,:open_mode,:sort_order,:is_enabled)
      ON DUPLICATE KEY UPDATE slot_key=VALUES(slot_key)`, item);
  }
}

async function loadLaunchers() {
  await ensureTable();
  const placeholders = MANAGED_SLOT_KEYS.map(() => '?').join(',');
  const [rows] = await db.query(`SELECT id,slot_key,display_name,icon_text,portal_url,open_mode,sort_order,is_enabled
    FROM os_external_launchers
    WHERE slot_key IN (${placeholders})
    ORDER BY sort_order,id`, MANAGED_SLOT_KEYS);
  return rows;
}

router.use(async (req, res, next) => {
  if (req.path !== '/workspace') return next();
  try {
    res.locals.osLaunchers = await loadLaunchers();
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
    const launchers = await loadLaunchers();
    res.render('os-launcher-settings', { title: 'Workstation Launchers', launchers, saved: req.query.saved, error: null });
  } catch (error) {
    next(error);
  }
});

router.post('/backoffice/os-launchers', requireAuth, async (req, res, next) => {
  if (!isOwner(req.session.user)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Only the owner or administrator can change workstation launcher settings.' });
  }
  try {
    await ensureTable();
    const launchers = await loadLaunchers();
    for (const row of launchers) {
      const key = row.slot_key;
      const displayName = String(req.body[`display_name_${key}`] || '').trim().slice(0, 100);
      const iconText = String(req.body[`icon_text_${key}`] || '').trim().slice(0, 12);
      const portalUrl = String(req.body[`portal_url_${key}`] || '').trim();
      const openMode = req.body[`open_mode_${key}`] === 'embedded' ? 'embedded' : 'separate';
      const isEnabled = req.body[`is_enabled_${key}`] === '1' ? 1 : 0;
      if (isEnabled && !displayName) throw new Error('Every enabled launcher must have a display name.');
      if (portalUrl && !/^https:\/\//i.test(portalUrl)) throw new Error(`${displayName || 'Launcher'} must use an https:// address.`);
      await db.execute(`UPDATE os_external_launchers SET
        display_name=:displayName,icon_text=:iconText,portal_url=:portalUrl,open_mode=:openMode,
        is_enabled=:isEnabled,updated_by=:updatedBy
        WHERE slot_key=:key`, {
        displayName: displayName || `System ${key.slice(-1)}`,
        iconText: iconText || displayName.slice(0, 1).toUpperCase() || key.slice(-1),
        portalUrl: portalUrl || null,
        openMode,
        isEnabled,
        updatedBy: req.session.user.id,
        key
      });
    }
    res.redirect(`${res.locals.basePath}/backoffice/os-launchers?saved=1`);
  } catch (error) {
    try {
      const launchers = await loadLaunchers();
      res.status(400).render('os-launcher-settings', { title: 'Workstation Launchers', launchers, saved: false, error: error.message });
    } catch (renderError) {
      next(renderError);
    }
  }
});

router.get('/api/os/launchers', requireAuth, async (req, res, next) => {
  try {
    const launchers = (await loadLaunchers()).filter(item => item.is_enabled);
    res.json({ ok: true, launchers });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
