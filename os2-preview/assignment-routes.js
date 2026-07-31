const express = require('express');

module.exports = function createAssignmentRouter({ pool, requireAuth, requestIp }) {
  const router = express.Router();
  let schemaCache = null;

  async function columns(table) {
    const [rows] = await pool.execute(`SELECT COLUMN_NAME name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table`, { table });
    return new Set(rows.map(row => row.name));
  }

  async function schema() {
    if (schemaCache) return schemaCache;
    schemaCache = {
      assignments: await columns('client_assignments'),
      requests: await columns('data_change_requests')
    };
    return schemaCache;
  }

  function buildInsert(table, available, values) {
    const entries = Object.entries(values).filter(([key, value]) => available.has(key) && value !== undefined);
    if (!entries.length) throw new Error(`NO_SUPPORTED_COLUMNS_${table}`);
    return {
      sql: `INSERT INTO ${table} (${entries.map(([key]) => `\`${key}\``).join(',')}) VALUES (${entries.map(([key]) => `:${key}`).join(',')})`,
      params: Object.fromEntries(entries)
    };
  }

  function buildUpdate(table, available, values, id) {
    const entries = Object.entries(values).filter(([key, value]) => available.has(key) && value !== undefined);
    if (!entries.length) throw new Error(`NO_SUPPORTED_COLUMNS_${table}`);
    return {
      sql: `UPDATE ${table} SET ${entries.map(([key]) => `\`${key}\`=:${key}`).join(',')} WHERE id=:assignmentId`,
      params: { ...Object.fromEntries(entries), assignmentId: id }
    };
  }

  async function audit(connection, req, actionType, entityId, description, beforeJson, afterJson) {
    await connection.execute(`INSERT INTO audit_log
      (staff_id, action_type, entity_type, entity_id, description, before_json, after_json, ip_address, user_agent, created_at)
      VALUES (:staffId,:actionType,'clients',:entityId,:description,:beforeJson,:afterJson,:ip,:userAgent,NOW())`, {
      staffId: req.user.id,
      actionType,
      entityId,
      description,
      beforeJson: beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson: afterJson ? JSON.stringify(afterJson) : null,
      ip: requestIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
  }

  router.get('/api/assignments/options', requireAuth, async (req, res) => {
    try {
      const [staff] = await pool.execute(`SELECT id, full_name, role FROM staff_users WHERE is_active=1 ORDER BY full_name`);
      res.json({ ok: true, staff, canManage: ['owner','manager'].includes(req.user.role) });
    } catch (error) {
      console.error('Assignment options failed', error);
      res.status(500).json({ ok:false, error:error.code || 'ASSIGNMENT_OPTIONS_FAILED' });
    }
  });

  router.get('/api/customers/:id/assignment', requireAuth, async (req, res) => {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId < 1) return res.status(400).json({ ok:false, error:'INVALID_CUSTOMER_ID' });
    try {
      const [[customer]] = await pool.execute('SELECT id, client_name, account_number FROM clients WHERE id=:clientId LIMIT 1', { clientId });
      if (!customer) return res.status(404).json({ ok:false, error:'CUSTOMER_NOT_FOUND' });
      const [[assignment]] = await pool.execute(`SELECT a.id, a.assigned_staff_id, s.full_name assigned_staff
        FROM client_assignments a LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
        WHERE a.is_active=1 AND (a.client_id=:clientId OR (:accountNumber<>'' AND a.account_number=:accountNumber))
        ORDER BY a.id DESC LIMIT 1`, { clientId, accountNumber: customer.account_number || '' });
      let pendingClaim = null;
      const sc = await schema();
      if (sc.requests.size && sc.requests.has('status')) {
        const entityColumn = sc.requests.has('entity_id') ? 'entity_id' : sc.requests.has('client_id') ? 'client_id' : null;
        const typeColumn = sc.requests.has('request_type') ? 'request_type' : sc.requests.has('change_type') ? 'change_type' : null;
        if (entityColumn) {
          const [rows] = await pool.execute(`SELECT * FROM data_change_requests WHERE \`${entityColumn}\`=:clientId AND status IN ('pending','pending_manager','pending_owner') ${typeColumn ? `AND \`${typeColumn}\` IN ('client_claim','claim_client','assignment_claim')` : ''} ORDER BY id DESC LIMIT 1`, { clientId });
          pendingClaim = rows[0] || null;
        }
      }
      res.json({ ok:true, customer, assignment: assignment || null, pendingClaim, canManage:['owner','manager'].includes(req.user.role), canClaim:req.user.role==='staff' });
    } catch (error) {
      console.error('Assignment lookup failed', error);
      res.status(500).json({ ok:false, error:error.code || 'ASSIGNMENT_LOOKUP_FAILED' });
    }
  });

  router.get('/api/diagnostics/claim-table', requireAuth, async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ ok:false, error:'OWNER_ONLY' });
    try {
      const [[status]] = await pool.execute(`SELECT ENGINE, ROW_FORMAT, TABLE_ROWS, AUTO_INCREMENT, CREATE_OPTIONS,
          DATA_LENGTH, INDEX_LENGTH, DATA_FREE
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_change_requests'
        LIMIT 1`);
      const [requestColumns] = await pool.execute(`SELECT ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
          COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_change_requests'
        ORDER BY ORDINAL_POSITION`);
      const [[summary]] = await pool.execute('SELECT COUNT(*) row_count, MAX(id) max_id FROM data_change_requests');
      res.json({ ok:true, table_status:status || null, row_summary:summary || null, columns:requestColumns });
    } catch (error) {
      console.error('Claim table diagnostic failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'CLAIM_TABLE_DIAGNOSTIC_FAILED' });
    }
  });

  router.post('/api/customers/:id/assign', requireAuth, async (req, res) => {
    if (!['owner','manager'].includes(req.user.role)) return res.status(403).json({ ok:false, error:'INSUFFICIENT_PERMISSION' });
    const clientId = Number(req.params.id);
    const staffId = Number(req.body.staffId);
    if (!Number.isInteger(clientId) || clientId < 1 || !Number.isInteger(staffId) || staffId < 1) return res.status(400).json({ ok:false, error:'INVALID_ASSIGNMENT' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[customer]] = await connection.execute('SELECT id, client_name, account_number FROM clients WHERE id=:clientId AND is_active=1 LIMIT 1 FOR UPDATE', { clientId });
      const [[staff]] = await connection.execute('SELECT id, full_name FROM staff_users WHERE id=:staffId AND is_active=1 LIMIT 1', { staffId });
      if (!customer || !staff) { await connection.rollback(); return res.status(404).json({ ok:false, error:!customer?'CUSTOMER_NOT_FOUND':'STAFF_NOT_FOUND' }); }

      const [[existing]] = await connection.execute(`SELECT a.id, a.assigned_staff_id, a.is_active, s.full_name assigned_staff
        FROM client_assignments a
        LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
        WHERE a.client_id=:clientId OR (:accountNumber<>'' AND a.account_number=:accountNumber)
        ORDER BY a.is_active DESC, a.id DESC
        LIMIT 1 FOR UPDATE`, { clientId, accountNumber:customer.account_number || '' });

      const sc = await schema();
      const values = {
        client_id: clientId,
        account_number: customer.account_number || '',
        assigned_staff_id: staffId,
        is_active: 1,
        assigned_by: req.user.id,
        updated_at: new Date()
      };

      let assignmentId;
      if (existing) {
        const update = buildUpdate('client_assignments', sc.assignments, values, existing.id);
        await connection.execute(update.sql, update.params);
        assignmentId = Number(existing.id);
      } else {
        const insertValues = {
          ...values,
          created_by: req.user.id,
          created_at: new Date()
        };
        const insert = buildInsert('client_assignments', sc.assignments, insertValues);
        const [result] = await connection.execute(insert.sql, insert.params);
        assignmentId = Number(result.insertId);
      }

      await connection.execute(`UPDATE client_assignments SET is_active=0
        WHERE id<>:assignmentId AND is_active=1
          AND (client_id=:clientId OR (:accountNumber<>'' AND account_number=:accountNumber))`, {
        assignmentId,
        clientId,
        accountNumber: customer.account_number || ''
      });

      await connection.execute('UPDATE inquiries SET assigned_staff_id=:staffId, updated_at=NOW() WHERE client_id=:clientId AND status IN (\'open\',\'follow_up\',\'waiting_customer\',\'waiting_network\',\'waiting_supplier\')', { staffId, clientId });
      await audit(connection, req, 'client_assigned', clientId, `Assigned ${customer.client_name} to ${staff.full_name}`, existing || null, { assignment_id:assignmentId, assigned_staff_id:staffId, assigned_staff:staff.full_name });
      await connection.commit();
      res.json({ ok:true, assignmentId, customerId:clientId, staffId, staffName:staff.full_name });
    } catch (error) {
      await connection.rollback();
      console.error('Client assignment failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'CLIENT_ASSIGNMENT_FAILED' });
    } finally { connection.release(); }
  });

  router.post('/api/customers/:id/claim', requireAuth, async (req, res) => {
    if (req.user.role !== 'staff') return res.status(403).json({ ok:false, error:'ONLY_STAFF_CAN_REQUEST_CLAIM' });
    const clientId = Number(req.params.id);
    const reason = String(req.body.reason || '').trim().slice(0,1000);
    if (!Number.isInteger(clientId) || clientId < 1) return res.status(400).json({ ok:false, error:'INVALID_CUSTOMER_ID' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[customer]] = await connection.execute('SELECT id, client_name, account_number FROM clients WHERE id=:clientId AND is_active=1 LIMIT 1', { clientId });
      if (!customer) { await connection.rollback(); return res.status(404).json({ ok:false, error:'CUSTOMER_NOT_FOUND' }); }
      const sc = await schema();
      const values = {
        request_type: 'client_claim',
        change_type: 'client_claim',
        entity_type: 'clients',
        entity_id: clientId,
        client_id: clientId,
        requested_by: req.user.id,
        requested_by_staff_id: req.user.id,
        staff_id: req.user.id,
        status: 'pending_manager',
        reason: reason || `Claim requested for ${customer.client_name}`,
        description: reason || `Claim requested for ${customer.client_name}`,
        proposed_json: JSON.stringify({ client_id:clientId, account_number:customer.account_number || '', assigned_staff_id:req.user.id }),
        after_json: JSON.stringify({ client_id:clientId, assigned_staff_id:req.user.id }),
        created_at: new Date(),
        updated_at: new Date()
      };
      const insert = buildInsert('data_change_requests', sc.requests, values);
      const [result] = await connection.execute(insert.sql, insert.params);
      await audit(connection, req, 'client_claim_requested', clientId, `Requested claim for ${customer.client_name}`, null, { request_id:result.insertId, requested_staff_id:req.user.id, reason });
      await connection.commit();
      res.status(201).json({ ok:true, requestId:Number(result.insertId), customerId:clientId });
    } catch (error) {
      await connection.rollback();
      console.error('Client claim failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'CLIENT_CLAIM_FAILED' });
    } finally { connection.release(); }
  });

  return router;
};
