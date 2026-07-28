const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../services/audit');

const router = express.Router();
const MANAGEMENT_ROLES = ['owner', 'admin', 'manager'];

function isManagement(user) {
  return Boolean(user && MANAGEMENT_ROLES.includes(String(user.role || '').toLowerCase()));
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function panelSuffix(req, separator = '?') {
  return String(req.body?.panel || req.query?.panel || '') === '1' ? `${separator}panel=1` : '';
}

async function unassignedCount() {
  const [[row]] = await db.query(`SELECT COUNT(*) total
    FROM clients c
    WHERE c.is_active=1
      AND NOT EXISTS (
        SELECT 1 FROM client_assignments a
        WHERE a.is_active=1
          AND (a.client_id=c.id OR (c.account_number IS NOT NULL AND c.account_number<>'' AND a.account_number=c.account_number))
      )`);
  return Number(row?.total || 0);
}

router.use(async (req, res, next) => {
  res.locals.unassignedClientCount = 0;
  if (!req.session?.user || req.path !== '/workspace') return next();
  try {
    res.locals.unassignedClientCount = await unassignedCount();
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/api/client-assignments/status', requireAuth, async (req, res, next) => {
  try {
    const [[mine]] = await db.execute(`SELECT COUNT(DISTINCT c.id) total
      FROM clients c JOIN client_assignments a ON a.is_active=1 AND a.assigned_staff_id=:userId
        AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number))
      WHERE c.is_active=1`, { userId: req.session.user.id });
    const [[requests]] = await db.execute(`SELECT COUNT(*) total FROM data_change_requests
      WHERE request_type='claim_client' AND requested_by=:userId AND status IN ('pending_manager','pending_owner')`, { userId: req.session.user.id });
    res.json({
      ok: true,
      unassignedCount: await unassignedCount(),
      myClientCount: Number(mine?.total || 0),
      myPendingClaimCount: Number(requests?.total || 0)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/clients/assignment-centre', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.session.user.id);
    const management = isManagement(req.session.user);
    const allowed = ['unassigned', 'mine', 'requests', 'pending', 'all'];
    let view = allowed.includes(String(req.query.view || '')) ? String(req.query.view) : 'unassigned';
    if (!management && ['pending', 'all'].includes(view)) view = 'unassigned';
    const q = clean(req.query.q, 200);
    const params = { userId, q: `%${q}%` };
    const search = q ? ` AND (c.client_name LIKE :q OR c.cell_number LIKE :q OR c.email LIKE :q OR c.account_number LIKE :q OR c.city_town LIKE :q)` : '';
    let clients = [];
    let requests = [];

    if (view === 'requests') {
      [requests] = await db.execute(`SELECT r.*,c.client_name,c.cell_number,c.email,c.city_town,
          reviewer.full_name reviewed_by_name
        FROM data_change_requests r
        LEFT JOIN clients c ON c.id=r.client_id
        LEFT JOIN staff_users reviewer ON reviewer.id=r.reviewed_by
        WHERE r.request_type='claim_client' AND r.requested_by=:userId
        ORDER BY r.created_at DESC LIMIT 500`, { userId });
    } else if (view === 'pending') {
      [requests] = await db.execute(`SELECT r.*,c.client_name,c.cell_number,c.email,c.city_town,
          requester.full_name requested_by_name
        FROM data_change_requests r
        LEFT JOIN clients c ON c.id=r.client_id
        JOIN staff_users requester ON requester.id=r.requested_by
        WHERE r.request_type='claim_client' AND r.status IN ('pending_manager','pending_owner')
        ORDER BY r.created_at LIMIT 500`);
    } else {
      const assignmentJoin = `LEFT JOIN client_assignments a ON a.id=(SELECT a2.id FROM client_assignments a2
        WHERE a2.is_active=1 AND (a2.client_id=c.id OR (a2.account_number<>'' AND a2.account_number=c.account_number))
        ORDER BY (a2.client_id=c.id) DESC,a2.updated_at DESC LIMIT 1)`;
      const pendingJoin = `LEFT JOIN data_change_requests r ON r.id=(SELECT r2.id FROM data_change_requests r2
        WHERE r2.request_type='claim_client' AND r2.client_id=c.id AND r2.status IN ('pending_manager','pending_owner')
        ORDER BY r2.created_at LIMIT 1)`;
      let where = `c.is_active=1`;
      if (view === 'unassigned') where += ` AND a.assigned_staff_id IS NULL`;
      if (view === 'mine') where += ` AND a.assigned_staff_id=:userId`;
      if (view === 'all') where += ` AND a.assigned_staff_id IS NOT NULL`;
      [clients] = await db.execute(`SELECT c.id,c.client_name,c.cell_number,c.email,c.account_number,c.city_town,
          c.lifecycle_status,c.line_status,c.next_upgrade_date,c.created_at,a.assigned_staff_id,
          assigned.full_name assigned_staff_name,r.id pending_claim_id,r.requested_by pending_requested_by,
          requester.full_name pending_requested_by_name,r.created_at pending_requested_at
        FROM clients c ${assignmentJoin}
        LEFT JOIN staff_users assigned ON assigned.id=a.assigned_staff_id
        ${pendingJoin}
        LEFT JOIN staff_users requester ON requester.id=r.requested_by
        WHERE ${where}${search}
        ORDER BY CASE WHEN r.id IS NULL THEN 0 ELSE 1 END,c.client_name,c.id LIMIT 1000`, params);
    }

    const [[counts]] = await db.execute(`SELECT
      (SELECT COUNT(*) FROM clients c WHERE c.is_active=1 AND NOT EXISTS(SELECT 1 FROM client_assignments a WHERE a.is_active=1 AND (a.client_id=c.id OR (c.account_number<>'' AND a.account_number=c.account_number)))) unassigned_count,
      (SELECT COUNT(DISTINCT c.id) FROM clients c JOIN client_assignments a ON a.is_active=1 AND a.assigned_staff_id=:userId AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) WHERE c.is_active=1) mine_count,
      (SELECT COUNT(*) FROM data_change_requests WHERE request_type='claim_client' AND requested_by=:userId AND status IN ('pending_manager','pending_owner')) requests_count,
      (SELECT COUNT(*) FROM data_change_requests WHERE request_type='claim_client' AND status IN ('pending_manager','pending_owner')) pending_count,
      (SELECT COUNT(DISTINCT c.id) FROM clients c JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) WHERE c.is_active=1) assigned_count`, { userId });

    res.render('client-assignment-centre', {
      title: 'Client Assignment Centre',
      view,
      q,
      clients,
      requests,
      counts: counts || {},
      isManagement: management,
      requested: req.query.requested,
      reviewed: req.query.reviewed
    });
  } catch (error) {
    next(error);
  }
});

router.post('/clients/:id/request-claim', requireAuth, async (req, res, next) => {
  const clientId = positiveId(req.params.id);
  if (!clientId) return next();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[client]] = await conn.execute(`SELECT id,client_name,account_number,cell_number,email
      FROM clients WHERE id=:clientId AND is_active=1 FOR UPDATE`, { clientId });
    if (!client) throw new Error('Client not found.');
    const [[assignment]] = await conn.execute(`SELECT a.assigned_staff_id,s.full_name
      FROM client_assignments a JOIN staff_users s ON s.id=a.assigned_staff_id
      WHERE a.is_active=1 AND (a.client_id=:clientId OR (:account<>'' AND a.account_number=:account))
      ORDER BY (a.client_id=:clientId) DESC,a.updated_at DESC LIMIT 1`, { clientId, account: client.account_number || '' });
    if (assignment) throw new Error(`This client is already assigned to ${assignment.full_name}.`);
    const [[existing]] = await conn.execute(`SELECT id,requested_by FROM data_change_requests
      WHERE request_type='claim_client' AND client_id=:clientId AND status IN ('pending_manager','pending_owner')
      ORDER BY created_at LIMIT 1 FOR UPDATE`, { clientId });
    if (existing) {
      await conn.rollback();
      return res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=unassigned&requested=existing${panelSuffix(req, '&')}`);
    }
    const proposed = {
      client_id: client.id,
      account_number: client.account_number || null,
      assigned_staff_id: req.session.user.id,
      assigned_staff_name: req.session.user.full_name,
      scope: client.account_number ? 'account' : 'client'
    };
    const [result] = await conn.execute(`INSERT INTO data_change_requests
      (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by)
      VALUES ('claim_client','clients',:clientId,:clientId,:account,:summary,:reason,:json,'manager','pending_manager',:requestedBy)`, {
      clientId,
      account: client.account_number || null,
      summary: `Claim ${client.client_name || client.cell_number || `client #${client.id}`}`,
      reason: clean(req.body.reason, 2000) || 'Staff member requested responsibility for this unassigned client.',
      json: JSON.stringify(proposed),
      requestedBy: req.session.user.id
    });
    await conn.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,email_status)
      SELECT 'notification','Client claim awaiting approval',:message,'normal','unread',s.id,:createdBy,NOW(),:clientId,'not_configured'
      FROM staff_users s WHERE s.is_active=1 AND s.role IN ('owner','admin','manager')`, {
      message: `${req.session.user.full_name} requested assignment of ${client.client_name || 'an unassigned client'}. Open the Client Assignment Centre to approve or reject request #${result.insertId}.`,
      createdBy: req.session.user.id,
      clientId
    });
    await conn.commit();
    await audit(req, {
      actionType: 'client_claim_requested',
      entityType: 'data_change_requests',
      entityId: result.insertId,
      description: `${req.session.user.full_name} requested assignment of ${client.client_name || clientId}`,
      after: proposed
    });
    res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=requests&requested=1${panelSuffix(req, '&')}`);
  } catch (error) {
    await conn.rollback();
    if (!error.code) return res.status(409).render('error', { title: 'Client could not be claimed', message: error.message });
    next(error);
  } finally {
    conn.release();
  }
});

router.post('/client-claims/:id/decision', requireAuth, async (req, res, next) => {
  if (!isManagement(req.session.user)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Only management can approve or reject client claims.' });
  }
  const requestId = positiveId(req.params.id);
  if (!requestId) return next();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[request]] = await conn.execute(`SELECT * FROM data_change_requests
      WHERE id=:requestId AND request_type='claim_client' FOR UPDATE`, { requestId });
    if (!request || !['pending_manager', 'pending_owner'].includes(request.status)) throw new Error('This claim request has already been reviewed.');
    const decision = String(req.body.decision || '');
    const comment = clean(req.body.comment, 2000) || null;
    if (decision === 'reject') {
      await conn.execute(`UPDATE data_change_requests SET status='rejected',reviewed_by=:reviewedBy,
        reviewed_at=NOW(),review_comment=:comment WHERE id=:requestId`, {
        reviewedBy: req.session.user.id, comment, requestId
      });
      await conn.execute(`INSERT INTO staff_tasks
        (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,email_status)
        VALUES ('notification','Client claim not approved',:message,'normal','unread',:assignedTo,:createdBy,NOW(),:clientId,'not_configured')`, {
        message: `Your request to claim this client was not approved${comment ? `: ${comment}` : '.'}`,
        assignedTo: request.requested_by,
        createdBy: req.session.user.id,
        clientId: request.client_id
      });
      await conn.commit();
      await audit(req, { actionType: 'client_claim_rejected', entityType: 'data_change_requests', entityId: requestId, description: 'Client claim rejected', after: { comment } });
      return res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=pending&reviewed=rejected${panelSuffix(req, '&')}`);
    }
    if (decision !== 'approve') throw new Error('Choose approve or reject.');
    const [[client]] = await conn.execute(`SELECT id,client_name,account_number FROM clients
      WHERE id=:clientId AND is_active=1 FOR UPDATE`, { clientId: request.client_id });
    if (!client) throw new Error('The client is no longer available.');
    const [[existingAssignment]] = await conn.execute(`SELECT a.assigned_staff_id,s.full_name
      FROM client_assignments a JOIN staff_users s ON s.id=a.assigned_staff_id
      WHERE a.is_active=1 AND (a.client_id=:clientId OR (:account<>'' AND a.account_number=:account))
      ORDER BY a.updated_at DESC LIMIT 1 FOR UPDATE`, { clientId: client.id, account: client.account_number || '' });
    if (existingAssignment) throw new Error(`The client is already assigned to ${existingAssignment.full_name}.`);
    const [[staff]] = await conn.execute(`SELECT id,full_name FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1`, { id: request.requested_by });
    if (!staff) throw new Error('The requesting staff member is no longer active.');
    const [scopeClients] = client.account_number
      ? await conn.execute(`SELECT id FROM clients WHERE is_active=1 AND account_number=:account ORDER BY id`, { account: client.account_number })
      : [[{ id: client.id }]];
    await conn.execute(`UPDATE client_assignments SET is_active=0,updated_at=NOW()
      WHERE is_active=1 AND (client_id=:clientId OR (:account<>'' AND account_number=:account))`, { clientId: client.id, account: client.account_number || '' });
    for (const row of scopeClients) {
      await conn.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active)
        VALUES (:clientId,:account,:staffId,:assignedBy,1)
        ON DUPLICATE KEY UPDATE account_number=VALUES(account_number),assigned_staff_id=VALUES(assigned_staff_id),
          assigned_by=VALUES(assigned_by),is_active=1,updated_at=NOW()`, {
        clientId: row.id,
        account: client.account_number || null,
        staffId: staff.id,
        assignedBy: req.session.user.id
      });
    }
    if (client.account_number) {
      await conn.execute(`UPDATE customer_accounts SET assigned_staff_id=:staffId,assigned_by=:assignedBy,
        assignment_confirmed_at=NOW() WHERE account_number_normalised=UPPER(REPLACE(TRIM(:account),' ',''))`, {
        staffId: staff.id, assignedBy: req.session.user.id, account: client.account_number
      });
      await conn.execute(`UPDATE fixed_accounts SET assigned_staff_id=:staffId,updated_at=NOW()
        WHERE account_number=:account OR linked_mobile_account_number=:account`, { staffId: staff.id, account: client.account_number });
    }
    await conn.execute(`UPDATE data_change_requests SET status='applied',reviewed_by=:reviewedBy,
      reviewed_at=NOW(),review_comment=:comment,applied_at=NOW() WHERE id=:requestId`, {
      reviewedBy: req.session.user.id, comment, requestId
    });
    await conn.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,email_status)
      VALUES ('notification','Client claim approved',:message,'normal','unread',:assignedTo,:createdBy,NOW(),:clientId,'not_configured')`, {
      message: `${client.client_name || 'The client'} is now assigned to you.`,
      assignedTo: staff.id,
      createdBy: req.session.user.id,
      clientId: client.id
    });
    await conn.commit();
    await audit(req, {
      actionType: 'client_claim_approved',
      entityType: 'clients',
      entityId: client.id,
      description: `${client.client_name || client.id} assigned to ${staff.full_name}`,
      after: { assigned_staff_id: staff.id, assigned_staff_name: staff.full_name, scope: client.account_number ? 'account' : 'client' }
    });
    res.redirect(`${res.locals.basePath}/clients/assignment-centre?view=pending&reviewed=approved${panelSuffix(req, '&')}`);
  } catch (error) {
    await conn.rollback();
    if (!error.code) return res.status(409).render('error', { title: 'Claim could not be reviewed', message: error.message });
    next(error);
  } finally {
    conn.release();
  }
});

module.exports = router;
