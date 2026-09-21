'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const MANAGEMENT_ROLES = new Set(['owner','manager','admin']);

function isManagement(user) {
  return Boolean(user && MANAGEMENT_ROLES.has(String(user.role || '').trim().toLowerCase()));
}

function scopeClause(scope) {
  if (scope === 'mine') {
    return `EXISTS (
      SELECT 1 FROM client_assignments vis
      WHERE vis.is_active=1
        AND (vis.client_id=c.id OR (COALESCE(vis.account_number,'')<>'' AND vis.account_number=c.account_number))
        AND vis.assigned_staff_id=:userId
    )`;
  }
  return `(
    EXISTS (
      SELECT 1 FROM client_assignments vis
      WHERE vis.is_active=1
        AND (vis.client_id=c.id OR (COALESCE(vis.account_number,'')<>'' AND vis.account_number=c.account_number))
        AND vis.assigned_staff_id=:userId
    )
    OR NOT EXISTS (
      SELECT 1 FROM client_assignments vis2
      WHERE vis2.is_active=1
        AND (vis2.client_id=c.id OR (COALESCE(vis2.account_number,'')<>'' AND vis2.account_number=c.account_number))
    )
  )`;
}

router.get('/backoffice/clients', requireAuth, async (req, res, next) => {
  if (!IS_UAT || isManagement(req.session.user)) return next();

  try {
    const userId = Number(req.session.user.id);
    const q = String(req.query.q || '').trim();
    const view = ['all','prospects','incomplete','unassigned','archived'].includes(String(req.query.view || ''))
      ? String(req.query.view)
      : 'all';
    const scope = String(req.query.scope || '').toLowerCase() === 'mine' ? 'mine' : 'all';

    const where = [scopeClause(scope)];
    const params = { userId };

    if (q) {
      params.like = `%${q}%`;
      where.push(`(c.client_name LIKE :like OR c.cell_number LIKE :like OR c.email LIKE :like OR c.account_number LIKE :like OR c.id_number LIKE :like)`);
    }
    if (view === 'prospects') where.push(`c.lifecycle_status='prospect' AND c.is_active=1`);
    if (view === 'incomplete') where.push(`c.lifecycle_status='prospect' AND c.is_active=1 AND (c.email IS NULL OR c.email='' OR c.city_town IS NULL OR c.city_town='' OR c.id_number IS NULL OR c.id_number='')`);
    if (view === 'unassigned') where.push(`c.is_active=1 AND NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.is_active=1 AND (ca.client_id=c.id OR (c.account_number IS NOT NULL AND c.account_number<>'' AND ca.account_number=c.account_number)))`);
    if (view === 'archived') where.push(`(c.lifecycle_status='archived' OR c.is_active=0)`);
    if (view === 'all') where.push(`c.is_active=1`);

    const sqlWhere = `WHERE ${where.join(' AND ')}`;

    const [clients] = await db.execute(`SELECT
      c.id,c.account_number,c.client_name,c.cell_number,c.email,c.lifecycle_status,c.lead_status,c.created_at,
      COALESCE(c.city_town,NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(c.raw_import_json, '$.city_town'))), ''),'') AS city_town,
      c.handset,c.upgrade_date,c.previous_upgrade_date,c.next_upgrade_date,c.line_status,c.birthday,
      (SELECT COUNT(*) FROM clients x WHERE
        (c.account_number IS NOT NULL AND c.account_number<>'' AND x.account_number=c.account_number)
        OR (c.id_number IS NOT NULL AND c.id_number<>'' AND x.id_number=c.id_number)
      ) AS line_count,
      (SELECT a.assigned_staff_id FROM client_assignments a
        WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))
        ORDER BY (a.client_id=c.id) DESC,a.updated_at DESC LIMIT 1) AS assigned_staff_id,
      (SELECT su.full_name FROM client_assignments a JOIN staff_users su ON su.id=a.assigned_staff_id
        WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number IS NOT NULL AND a.account_number<>'' AND a.account_number=c.account_number))
        ORDER BY (a.client_id=c.id) DESC,a.updated_at DESC LIMIT 1) AS assigned_staff_name,
      (SELECT i.query_text FROM inquiries i WHERE i.client_id=c.id ORDER BY i.created_at DESC LIMIT 1) AS last_inquiry,
      (SELECT i.action_taken FROM inquiries i WHERE i.client_id=c.id ORDER BY i.created_at DESC LIMIT 1) AS last_action
      FROM clients c ${sqlWhere}
      ORDER BY CASE WHEN c.lifecycle_status='prospect' THEN 0 ELSE 1 END,c.created_at DESC,c.client_name ASC LIMIT 200`, params);

    const visible = scopeClause(scope);
    const [[counts]] = await db.execute(`SELECT
      SUM(c.is_active=1) active_count,
      SUM(c.is_active=1 AND c.lifecycle_status='prospect') prospect_count,
      SUM(c.is_active=1 AND c.lifecycle_status='prospect' AND (c.email IS NULL OR c.email='' OR c.city_town IS NULL OR c.city_town='' OR c.id_number IS NULL OR c.id_number='')) incomplete_count,
      SUM(c.is_active=0 OR c.lifecycle_status='archived') archived_count
      FROM clients c WHERE ${visible}`, { userId });

    const [[unassigned]] = await db.execute(`SELECT COUNT(*) total FROM clients c
      WHERE c.is_active=1
        AND NOT EXISTS (SELECT 1 FROM client_assignments ca
          WHERE ca.is_active=1
            AND (ca.client_id=c.id OR (c.account_number IS NOT NULL AND c.account_number<>'' AND ca.account_number=c.account_number)))`);

    return res.render('clients-admin', {
      title: 'Client Administration',
      q,
      view,
      clients,
      staff: [],
      saved: req.query.saved,
      counts: { ...(counts || {}), unassigned_count: unassigned?.total || 0 },
      staffVisibilityScope: scope
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
