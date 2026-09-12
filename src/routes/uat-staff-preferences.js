const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const MANAGEMENT_ROLES = new Set(['owner', 'admin', 'manager']);
const PALETTE = [
  '#7c3aed', '#2563eb', '#059669', '#ea580c', '#db2777', '#0891b2', '#9333ea', '#16a34a',
  '#c2410c', '#0284c7', '#be123c', '#4f46e5', '#0f766e', '#a16207', '#6d28d9', '#b91c1c',
  '#0369a1', '#15803d', '#9f1239', '#4338ca'
];
let schemaPromise;

function management(user) {
  return Boolean(user && MANAGEMENT_ROLES.has(String(user.role || '').toLowerCase()));
}

function idOf(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function defaultColor(staffId) {
  const id = Number(staffId) || 0;
  return PALETTE[Math.abs(id) % PALETTE.length];
}

function validColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : null;
}

async function ensureSchema() {
  if (!IS_UAT) throw new Error('UAT staff preferences are disabled outside UAT.');
  if (!schemaPromise) {
    schemaPromise = db.query(`CREATE TABLE IF NOT EXISTS staff_ui_preferences (
      staff_id BIGINT UNSIGNED NOT NULL,
      calendar_color CHAR(7) NOT NULL,
      updated_by BIGINT UNSIGNED NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (staff_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

router.get('/api/uat/staff-colors', requireAuth, async (req, res, next) => {
  if (!IS_UAT) return res.sendStatus(404);
  try {
    await ensureSchema();
    const [rows] = await db.execute(`SELECT s.id,s.full_name,s.role,s.is_active,p.calendar_color
      FROM staff_users s
      LEFT JOIN staff_ui_preferences p ON p.staff_id=s.id
      WHERE s.is_active=1
      ORDER BY s.full_name`);
    res.json({
      ok: true,
      staff: rows.map(row => ({
        id: Number(row.id),
        name: row.full_name,
        role: row.role,
        color: validColor(row.calendar_color) || defaultColor(row.id),
        custom: Boolean(validColor(row.calendar_color))
      }))
    });
  } catch (error) { next(error); }
});

router.post('/api/uat/staff-colors/:id', requireAuth, async (req, res, next) => {
  if (!IS_UAT) return res.sendStatus(404);
  if (!management(req.session.user)) return res.status(403).json({ ok: false, error: 'Management access required.' });
  try {
    await ensureSchema();
    const staffId = idOf(req.params.id);
    const color = validColor(req.body.color);
    if (!staffId || !color) return res.status(400).json({ ok: false, error: 'Choose a valid staff colour.' });
    const [[staff]] = await db.execute('SELECT id,full_name FROM staff_users WHERE id=:staffId AND is_active=1 LIMIT 1', { staffId });
    if (!staff) return res.status(404).json({ ok: false, error: 'Active staff member not found.' });
    await db.execute(`INSERT INTO staff_ui_preferences (staff_id,calendar_color,updated_by)
      VALUES (:staffId,:color,:updatedBy)
      ON DUPLICATE KEY UPDATE calendar_color=VALUES(calendar_color),updated_by=VALUES(updated_by),updated_at=NOW()`, {
      staffId, color, updatedBy: Number(req.session.user.id)
    });
    res.json({ ok: true, staff: { id: staffId, name: staff.full_name, color, custom: true } });
  } catch (error) { next(error); }
});

router.delete('/api/uat/staff-colors/:id', requireAuth, async (req, res, next) => {
  if (!IS_UAT) return res.sendStatus(404);
  if (!management(req.session.user)) return res.status(403).json({ ok: false, error: 'Management access required.' });
  try {
    await ensureSchema();
    const staffId = idOf(req.params.id);
    if (!staffId) return res.status(400).json({ ok: false, error: 'Invalid staff member.' });
    await db.execute('DELETE FROM staff_ui_preferences WHERE staff_id=:staffId', { staffId });
    res.json({ ok: true, color: defaultColor(staffId), custom: false });
  } catch (error) { next(error); }
});

module.exports = router;
