'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { audit } = require('../services/audit');
const { normaliseExternalCode } = require('../services/staff-external-codes');

const router = express.Router();

async function schemaReady(connection = db) {
  const [rows] = await connection.query(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff_external_codes'
  `);
  return rows.length === 1;
}

router.get('/backoffice/staff/:id/import-identities', requireAuth, requireRole('owner','manager'), async (req, res, next) => {
  try {
    if (!await schemaReady()) return res.status(503).json({ ok: false, schemaReady: false, message: 'Staff import identities are not installed yet.' });
    const staffId = Number(req.params.id);
    const [[staff]] = await db.execute('SELECT id,full_name,email,contact_number,is_active FROM staff_users WHERE id=:id LIMIT 1', { id: staffId });
    if (!staff) return res.status(404).json({ ok: false, message: 'Staff member not found.' });
    const [codes] = await db.execute(`
      SELECT id,source_system,external_code,external_code_normalised,is_active,created_at,updated_at
      FROM staff_external_codes WHERE staff_id=:id
      ORDER BY is_active DESC,external_code_normalised,source_system,id
    `, { id: staffId });
    return res.json({ ok: true, schemaReady: true, staff, codes });
  } catch (error) { next(error); }
});

router.post('/backoffice/staff/:id/import-identities', requireAuth, requireRole('owner','manager'), async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    if (!await schemaReady(connection)) return res.status(503).json({ ok: false, schemaReady: false, message: 'Apply the reviewed Base Details foundation SQL first.' });
    const staffId = Number(req.params.id);
    const code = normaliseExternalCode(req.body.external_code);
    if (!Number.isSafeInteger(staffId) || staffId < 1) return res.status(400).json({ ok: false, message: 'Invalid staff member.' });
    if (!code || code.length > 120) return res.status(400).json({ ok: false, message: 'Enter a valid report / agent code.' });

    await connection.beginTransaction();
    const [[staff]] = await connection.execute('SELECT id,full_name FROM staff_users WHERE id=:id FOR UPDATE', { id: staffId });
    if (!staff) {
      await connection.rollback();
      return res.status(404).json({ ok: false, message: 'Staff member not found.' });
    }
    const [existing] = await connection.execute(`
      SELECT sec.*,su.full_name staff_name
      FROM staff_external_codes sec
      JOIN staff_users su ON su.id=sec.staff_id
      WHERE sec.external_code_normalised=:code
      ORDER BY sec.id FOR UPDATE
    `, { code });
    const otherStaff = existing.find(row => Number(row.staff_id) !== staffId);
    if (otherStaff) {
      await connection.rollback();
      return res.status(409).json({ ok: false, message: `${code} already belongs to ${otherStaff.staff_name}. It cannot be assigned to two staff members.` });
    }
    let codeId;
    if (existing.length) {
      codeId = Number(existing[0].id);
      await connection.execute(`
        UPDATE staff_external_codes
        SET source_system='VODACOM_REPORTS',external_code=:code,external_code_normalised=:code,is_active=1
        WHERE id=:id
      `, { id: codeId, code });
    } else {
      const [created] = await connection.execute(`
        INSERT INTO staff_external_codes (staff_id,source_system,external_code,external_code_normalised,is_active)
        VALUES (:staffId,'VODACOM_REPORTS',:code,:code,1)
      `, { staffId, code });
      codeId = Number(created.insertId);
    }
    await connection.commit();
    await audit(req, {
      actionType: 'staff_external_code_saved', entityType: 'staff_external_codes', entityId: codeId,
      description: `Report / agent code ${code} linked to staff member #${staffId}.`,
      after: { staffId, code, sourceSystem: 'VODACOM_REPORTS', active: true }
    });
    return res.json({ ok: true, message: `${code} is now linked to ${staff.full_name}.` });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

router.post('/backoffice/staff/:staffId/import-identities/:codeId/deactivate', requireAuth, requireRole('owner','manager'), async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const staffId = Number(req.params.staffId);
    const codeId = Number(req.params.codeId);
    await connection.beginTransaction();
    const [[row]] = await connection.execute(`
      SELECT id,staff_id,external_code,external_code_normalised,is_active
      FROM staff_external_codes WHERE id=:codeId AND staff_id=:staffId FOR UPDATE
    `, { codeId, staffId });
    if (!row) {
      await connection.rollback();
      return res.status(404).json({ ok: false, message: 'Report / agent code not found.' });
    }
    await connection.execute('UPDATE staff_external_codes SET is_active=0 WHERE id=:codeId', { codeId });
    await connection.commit();
    await audit(req, {
      actionType: 'staff_external_code_deactivated', entityType: 'staff_external_codes', entityId: codeId,
      description: `Report / agent code ${row.external_code} deactivated for staff member #${staffId}.`,
      before: { staffId, code: row.external_code, active: Boolean(row.is_active) },
      after: { staffId, code: row.external_code, active: false }
    });
    return res.json({ ok: true, message: `${row.external_code} is no longer active for import matching.` });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    next(error);
  } finally { connection.release(); }
});

module.exports = router;
