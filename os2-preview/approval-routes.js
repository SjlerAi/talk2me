const express = require('express');
const createNotificationRouter = require('./notification-routes');

module.exports = function createApprovalRouter({ pool, requireAuth, requestIp }) {
  const router = express.Router();
  let cache = null;

  async function tableColumns(table) {
    const [rows] = await pool.execute(`SELECT COLUMN_NAME name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table`, { table });
    return new Set(rows.map(row => row.name));
  }

  async function schema() {
    if (cache) return cache;
    cache = {
      requests: await tableColumns('data_change_requests'),
      assignments: await tableColumns('client_assignments'),
      tasks: await tableColumns('staff_tasks')
    };
    return cache;
  }

  function firstExisting(set, names) {
    return names.find(name => set.has(name)) || null;
  }

  function insertSql(table, available, values) {
    const entries = Object.entries(values).filter(([key, value]) => available.has(key) && value !== undefined);
    if (!entries.length) return null;
    return {
      sql: `INSERT INTO ${table} (${entries.map(([key]) => `\`${key}\``).join(',')}) VALUES (${entries.map(([key]) => `:${key}`).join(',')})`,
      params: Object.fromEntries(entries)
    };
  }

  function updateSql(table, available, values, where) {
    const entries = Object.entries(values).filter(([key, value]) => available.has(key) && value !== undefined);
    return {
      sql: `UPDATE ${table} SET ${entries.map(([key]) => `\`${key}\`=:${key}`).join(',')} WHERE ${where}`,
      params: Object.fromEntries(entries)
    };
  }

  function requireManager(req, res, next) {
    if (!req.user) return res.status(401).json({ ok:false, error:'AUTHENTICATION_REQUIRED' });
    if (!['owner','manager'].includes(req.user.role)) return res.status(403).json({ ok:false, error:'INSUFFICIENT_PERMISSION' });
    next();
  }

  async function notifyRequester(connection, columns, staffId, title, message) {
    if (!columns.size || !staffId) return;
    const values = {
      staff_id: staffId,
      assigned_staff_id: staffId,
      recipient_staff_id: staffId,
      title,
      task_title: title,
      description: message,
      message,
      task_type: 'notification',
      status: 'unread',
      priority: 'normal',
      created_at: new Date(),
      updated_at: new Date()
    };
    const insert = insertSql('staff_tasks', columns, values);
    if (insert) await connection.execute(insert.sql, insert.params);
  }

  router.get('/api/approvals', requireAuth, requireManager, async (req, res) => {
    try {
      const sc = await schema();
      const entity = firstExisting(sc.requests, ['entity_id','client_id']);
      const requester = firstExisting(sc.requests, ['requested_by','requested_by_staff_id','staff_id']);
      const type = firstExisting(sc.requests, ['request_type','change_type']);
      if (!entity || !requester || !sc.requests.has('status')) return res.json({ ok:true, items:[], count:0 });
      const [items] = await pool.execute(`SELECT r.*, c.client_name, c.account_number,
        requester.full_name requester_name,
        current_staff.full_name current_assignee
        FROM data_change_requests r
        LEFT JOIN clients c ON c.id=r.\`${entity}\`
        LEFT JOIN staff_users requester ON requester.id=r.\`${requester}\`
        LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (c.account_number<>'' AND a.account_number=c.account_number))
        LEFT JOIN staff_users current_staff ON current_staff.id=a.assigned_staff_id
        WHERE r.status IN ('pending','pending_manager','pending_owner')
        ${type ? `AND r.\`${type}\` IN ('client_claim','claim_client','assignment_claim')` : ''}
        ORDER BY r.id ASC LIMIT 100`);
      res.json({ ok:true, items, count:items.length, role:req.user.role });
    } catch (error) {
      console.error('Approval queue failed', error);
      res.status(500).json({ ok:false, error:error.code || 'APPROVAL_QUEUE_FAILED' });
    }
  });

  router.post('/api/approvals/:id/decision', requireAuth, requireManager, async (req, res) => {
    const requestId = Number(req.params.id);
    const decision = String(req.body.decision || '').trim();
    const note = String(req.body.note || '').trim().slice(0,1000);
    if (!Number.isInteger(requestId) || requestId < 1) return res.status(400).json({ ok:false, error:'INVALID_REQUEST_ID' });
    if (!['approve','reject'].includes(decision)) return res.status(400).json({ ok:false, error:'INVALID_DECISION' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const sc = await schema();
      const entity = firstExisting(sc.requests, ['entity_id','client_id']);
      const requester = firstExisting(sc.requests, ['requested_by','requested_by_staff_id','staff_id']);
      if (!entity || !requester) throw new Error('UNSUPPORTED_REQUEST_SCHEMA');
      const [[request]] = await connection.execute(`SELECT * FROM data_change_requests WHERE id=:requestId FOR UPDATE`, { requestId });
      if (!request) { await connection.rollback(); return res.status(404).json({ ok:false, error:'REQUEST_NOT_FOUND' }); }
      if (!['pending','pending_manager','pending_owner'].includes(String(request.status))) { await connection.rollback(); return res.status(409).json({ ok:false, error:'REQUEST_ALREADY_DECIDED' }); }
      const clientId = Number(request[entity]);
      const requesterId = Number(request[requester]);
      if (requesterId === Number(req.user.id)) { await connection.rollback(); return res.status(403).json({ ok:false, error:'SELF_APPROVAL_NOT_ALLOWED' }); }
      const [[customer]] = await connection.execute('SELECT id, client_name, account_number FROM clients WHERE id=:clientId AND is_active=1 LIMIT 1 FOR UPDATE', { clientId });
      if (!customer) { await connection.rollback(); return res.status(404).json({ ok:false, error:'CUSTOMER_NOT_FOUND' }); }
      const [[requesterUser]] = await connection.execute('SELECT id, full_name FROM staff_users WHERE id=:requesterId AND is_active=1 LIMIT 1', { requesterId });
      if (!requesterUser) { await connection.rollback(); return res.status(404).json({ ok:false, error:'REQUESTER_NOT_FOUND' }); }

      let assignmentId = null;
      if (decision === 'approve') {
        await connection.execute(`UPDATE client_assignments SET is_active=0 WHERE is_active=1 AND (client_id=:clientId OR (:accountNumber<>'' AND account_number=:accountNumber))`, { clientId, accountNumber:customer.account_number || '' });
        const assignment = insertSql('client_assignments', sc.assignments, {
          client_id: clientId,
          account_number: customer.account_number || '',
          assigned_staff_id: requesterId,
          is_active: 1,
          assigned_by: req.user.id,
          created_by: req.user.id,
          created_at: new Date(),
          updated_at: new Date()
        });
        if (!assignment) throw new Error('UNSUPPORTED_ASSIGNMENT_SCHEMA');
        const [result] = await connection.execute(assignment.sql, assignment.params);
        assignmentId = Number(result.insertId);
        await connection.execute(`UPDATE inquiries SET assigned_staff_id=:requesterId, updated_at=NOW() WHERE client_id=:clientId AND status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')`, { requesterId, clientId });
      }

      const requestUpdate = updateSql('data_change_requests', sc.requests, {
        status: decision === 'approve' ? 'approved' : 'rejected',
        reviewed_by: req.user.id,
        approved_by: decision === 'approve' ? req.user.id : undefined,
        rejected_by: decision === 'reject' ? req.user.id : undefined,
        review_note: note || null,
        reviewer_note: note || null,
        decision_note: note || null,
        reviewed_at: new Date(),
        approved_at: decision === 'approve' ? new Date() : undefined,
        rejected_at: decision === 'reject' ? new Date() : undefined,
        updated_at: new Date()
      }, 'id=:requestId');
      requestUpdate.params.requestId = requestId;
      await connection.execute(requestUpdate.sql, requestUpdate.params);

      const title = decision === 'approve' ? 'Client claim approved' : 'Client claim rejected';
      const message = decision === 'approve'
        ? `${customer.client_name} has been assigned to you.${note ? ` Note: ${note}` : ''}`
        : `Your claim for ${customer.client_name} was rejected.${note ? ` Reason: ${note}` : ''}`;
      await notifyRequester(connection, sc.tasks, requesterId, title, message);
      await connection.execute(`INSERT INTO audit_log
        (staff_id, action_type, entity_type, entity_id, description, before_json, after_json, ip_address, user_agent, created_at)
        VALUES (:staffId,:actionType,'data_change_requests',:requestId,:description,:beforeJson,:afterJson,:ip,:userAgent,NOW())`, {
        staffId:req.user.id,
        actionType:decision === 'approve' ? 'client_claim_approved' : 'client_claim_rejected',
        requestId,
        description:`${decision === 'approve' ? 'Approved' : 'Rejected'} claim for ${customer.client_name}`,
        beforeJson:JSON.stringify({ status:request.status, requester_id:requesterId }),
        afterJson:JSON.stringify({ status:decision === 'approve' ? 'approved' : 'rejected', assignment_id:assignmentId, note }),
        ip:requestIp(req),
        userAgent:String(req.headers['user-agent'] || '').slice(0,255)
      });
      await connection.commit();
      res.json({ ok:true, requestId, decision, customerId:clientId, requesterId, assignmentId });
    } catch (error) {
      await connection.rollback();
      console.error('Approval decision failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'APPROVAL_DECISION_FAILED' });
    } finally { connection.release(); }
  });

  router.use(createNotificationRouter({ pool, requireAuth, requestIp }));
  return router;
};
