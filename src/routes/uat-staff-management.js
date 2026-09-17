'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
let schemaReady = false;
let schemaPromise = null;

function isOwner(user) {
  return String(user?.role || '').trim().toLowerCase() === 'owner';
}

function ownerOnly(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  if (!IS_UAT) return next();
  if (!isOwner(req.session.user)) {
    return res.status(403).render('error', {
      title: 'Owner access required',
      message: 'Only the Owner can add, edit, activate, deactivate or delete staff accounts in the UAT back office.'
    });
  }
  next();
}

async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const [columns] = await db.query(`SHOW COLUMNS FROM staff_users LIKE 'deleted_at'`);
    if (!columns.length) {
      await db.query('ALTER TABLE staff_users ADD COLUMN deleted_at DATETIME NULL AFTER is_active');
    }
    schemaReady = true;
  })().finally(() => { schemaPromise = null; });
  return schemaPromise;
}

async function getStaff(id) {
  const [[staff]] = await db.execute(`SELECT id,full_name,email,username,role,is_active,deleted_at
    FROM staff_users WHERE id=:id LIMIT 1`, { id });
  return staff || null;
}

async function activeOwnerCount(excludeId = null) {
  const [[row]] = await db.execute(`SELECT COUNT(*) total FROM staff_users
    WHERE role='owner' AND is_active=1 AND deleted_at IS NULL
      AND (:excludeId IS NULL OR id<>:excludeId)`, { excludeId });
  return Number(row?.total || 0);
}

router.use('/backoffice/staff', requireAuth, ownerOnly, async (req, res, next) => {
  try {
    await ensureSchema();
    next();
  } catch (error) { next(error); }
});

router.get('/backoffice/staff', requireAuth, ownerOnly, async (req, res, next) => {
  try {
    await ensureSchema();
    const [staff] = await db.query(`SELECT id,full_name,email,username,role,job_title,contact_number,profile_photo_path,is_active,last_login_at
      FROM staff_users
      WHERE deleted_at IS NULL
      ORDER BY is_active DESC,full_name ASC`);
    return res.render('staff-list', {
      title: 'Staff Management',
      staff,
      ownerStaffControls: true,
      currentStaffId: Number(req.session.user.id)
    });
  } catch (error) { next(error); }
});

router.post('/api/uat/staff/:id/status', requireAuth, ownerOnly, async (req, res, next) => {
  try {
    await ensureSchema();
    const id = Number(req.params.id);
    const active = String(req.body.active ?? '') === '1';
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, error: 'Invalid staff member.' });

    const staff = await getStaff(id);
    if (!staff || staff.deleted_at) return res.status(404).json({ ok: false, error: 'Staff member not found.' });
    if (!active && id === Number(req.session.user.id)) {
      return res.status(409).json({ ok: false, error: 'You cannot deactivate the Owner account you are currently using.' });
    }
    if (!active && staff.role === 'owner' && await activeOwnerCount(id) < 1) {
      return res.status(409).json({ ok: false, error: 'At least one active Owner account must remain.' });
    }

    await db.execute(`UPDATE staff_users SET is_active=:active WHERE id=:id AND deleted_at IS NULL`, {
      active: active ? 1 : 0,
      id
    });

    if (!active) {
      await db.execute(`UPDATE staff_login_sessions
        SET logout_at=NOW(),last_activity_at=NOW(),session_status='logged_out',logout_reason='account_deactivated'
        WHERE staff_id=:id AND session_status='active'`, { id });
    }

    return res.json({ ok: true, id, is_active: active ? 1 : 0 });
  } catch (error) { next(error); }
});

router.post('/api/uat/staff/:id/delete', requireAuth, ownerOnly, async (req, res, next) => {
  try {
    await ensureSchema();
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, error: 'Invalid staff member.' });
    if (id === Number(req.session.user.id)) {
      return res.status(409).json({ ok: false, error: 'You cannot delete the Owner account you are currently using.' });
    }

    const staff = await getStaff(id);
    if (!staff || staff.deleted_at) return res.status(404).json({ ok: false, error: 'Staff member not found.' });
    if (staff.role === 'owner' && await activeOwnerCount(id) < 1) {
      return res.status(409).json({ ok: false, error: 'At least one active Owner account must remain.' });
    }

    await db.execute(`UPDATE staff_users
      SET is_active=0,deleted_at=NOW()
      WHERE id=:id AND deleted_at IS NULL`, { id });

    await db.execute(`UPDATE staff_login_sessions
      SET logout_at=NOW(),last_activity_at=NOW(),session_status='logged_out',logout_reason='account_deleted'
      WHERE staff_id=:id AND session_status='active'`, { id });

    return res.json({ ok: true, id, deleted: true });
  } catch (error) { next(error); }
});

router.use('/api/uat/staff', (error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('[UAT Staff Management]', error);
  res.status(500).json({ ok: false, error: 'Staff account update failed.' });
});

module.exports = { router, ensureSchema };
