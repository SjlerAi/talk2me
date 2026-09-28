const express = require('express');

module.exports = function createNotificationRouter({ pool, requireAuth, requestIp }) {
  const router = express.Router();
  let taskColumnsCache = null;

  async function taskColumns() {
    if (taskColumnsCache) return taskColumnsCache;
    const [rows] = await pool.execute(`SELECT COLUMN_NAME name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff_tasks'`);
    taskColumnsCache = new Set(rows.map(row => row.name));
    return taskColumnsCache;
  }

  function firstSupported(columns, names) {
    return names.find(name => columns.has(name)) || null;
  }

  function buildInsert(columns, values) {
    const entries = Object.entries(values).filter(([key, value]) => columns.has(key) && value !== undefined);
    if (!entries.length) throw new Error('NO_SUPPORTED_TASK_COLUMNS');
    return {
      sql: `INSERT INTO staff_tasks (${entries.map(([key]) => `\`${key}\``).join(',')}) VALUES (${entries.map(([key]) => `:${key}`).join(',')})`,
      params: Object.fromEntries(entries)
    };
  }

  function unreadSql(statusColumn) {
    if (!statusColumn) return '1=1';
    return `LOWER(COALESCE(\`${statusColumn}\`,'unread')) NOT IN ('seen','read','completed','done','archived')`;
  }

  function activeSql(statusColumn) {
    if (!statusColumn) return '1=1';
    return `LOWER(COALESCE(\`${statusColumn}\`,'unread')) NOT IN ('completed','done','archived')`;
  }

  async function audit(connection, req, actionType, entityId, description, afterJson) {
    await connection.execute(`INSERT INTO audit_log
      (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent,created_at)
      VALUES (:staffId,:actionType,'staff_tasks',:entityId,:description,NULL,:afterJson,:ip,:userAgent,NOW())`, {
      staffId:req.user.id,
      actionType,
      entityId,
      description,
      afterJson:JSON.stringify(afterJson || {}),
      ip:requestIp(req),
      userAgent:String(req.headers['user-agent'] || '').slice(0,255)
    });
  }

  router.get('/api/notifications', requireAuth, async (req, res) => {
    try {
      const columns = await taskColumns();
      const canBroadcast = ['owner','manager'].includes(req.user.role);
      if (!columns.size) return res.json({ ok:true, unread:0, items:[], canBroadcast, recipients:[] });
      const recipient = firstSupported(columns, ['assigned_staff_id','assigned_to','recipient_staff_id','staff_id','user_id']);
      const title = firstSupported(columns, ['title','task_title','subject','name']);
      const message = firstSupported(columns, ['message','description','task_description','details','body']);
      const status = firstSupported(columns, ['status','task_status']);
      const created = firstSupported(columns, ['created_at','created_on','created_date']);
      const client = firstSupported(columns, ['client_id','customer_id','entity_id']);
      const inquiry = firstSupported(columns, ['inquiry_id','related_inquiry_id']);
      if (!recipient) return res.json({ ok:true, unread:0, items:[], canBroadcast, recipients:[] });

      const select = [
        'id',
        title ? `\`${title}\` title` : "'Notification' title",
        message ? `\`${message}\` message` : "'' message",
        status ? `\`${status}\` status` : "'unread' status",
        created ? `\`${created}\` created_at` : 'NULL created_at',
        client ? `\`${client}\` client_id` : 'NULL client_id',
        inquiry ? `\`${inquiry}\` inquiry_id` : 'NULL inquiry_id'
      ].join(',');
      const unreadOrder = status ? `CASE WHEN ${unreadSql(status)} THEN 0 ELSE 1 END` : '0';
      const timeOrder = created ? `\`${created}\`` : 'id';
      const [items] = await pool.execute(`SELECT ${select} FROM staff_tasks
        WHERE \`${recipient}\`=:staffId AND ${activeSql(status)}
        ORDER BY ${unreadOrder} ASC, ${timeOrder} DESC LIMIT 100`, { staffId:req.user.id });
      const [[unreadRow]] = await pool.execute(`SELECT COUNT(*) unread FROM staff_tasks WHERE \`${recipient}\`=:staffId AND ${activeSql(status)} AND ${unreadSql(status)}`, { staffId:req.user.id });
      let recipients = [];
      if (canBroadcast) {
        const [staff] = await pool.execute('SELECT id, full_name, role FROM staff_users WHERE is_active=1 ORDER BY full_name LIMIT 20');
        recipients = staff;
      }
      res.json({ ok:true, unread:Number(unreadRow.unread || 0), items, canBroadcast, recipients });
    } catch (error) {
      console.error('Notification query failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'NOTIFICATION_QUERY_FAILED' });
    }
  });

  router.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ ok:false, error:'INVALID_NOTIFICATION_ID' });
    const connection = await pool.getConnection();
    try {
      const columns = await taskColumns();
      const recipient = firstSupported(columns, ['assigned_staff_id','assigned_to','recipient_staff_id','staff_id','user_id']);
      const status = firstSupported(columns, ['status','task_status']);
      const readAt = firstSupported(columns, ['read_at','seen_at']);
      if (!recipient || !status) return res.status(409).json({ ok:false, error:'NOTIFICATION_READ_UNSUPPORTED' });
      await connection.beginTransaction();
      const updates = [`\`${status}\`='seen'`];
      if (readAt) updates.push(`\`${readAt}\`=NOW()`);
      if (columns.has('updated_at')) updates.push('`updated_at`=NOW()');
      const [result] = await connection.execute(`UPDATE staff_tasks SET ${updates.join(',')} WHERE id=:id AND \`${recipient}\`=:staffId AND ${activeSql(status)}`, { id, staffId:req.user.id });
      if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ ok:false, error:'NOTIFICATION_NOT_FOUND' }); }
      await audit(connection, req, 'notification_read', id, `Notification ${id} marked as read`, { notification_id:id, status:'seen' });
      await connection.commit();
      res.json({ ok:true, id, status:'seen' });
    } catch (error) {
      await connection.rollback();
      console.error('Notification read failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'NOTIFICATION_READ_FAILED' });
    } finally { connection.release(); }
  });

  router.post('/api/notifications/:id/complete', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ ok:false, error:'INVALID_NOTIFICATION_ID' });
    const connection = await pool.getConnection();
    try {
      const columns = await taskColumns();
      const recipient = firstSupported(columns, ['assigned_staff_id','assigned_to','recipient_staff_id','staff_id','user_id']);
      const status = firstSupported(columns, ['status','task_status']);
      const completedAt = firstSupported(columns, ['completed_at','closed_at','archived_at']);
      if (!recipient || !status) return res.status(409).json({ ok:false, error:'NOTIFICATION_COMPLETE_UNSUPPORTED' });
      await connection.beginTransaction();
      const updates = [`\`${status}\`='completed'`];
      if (completedAt) updates.push(`\`${completedAt}\`=NOW()`);
      if (columns.has('updated_at')) updates.push('`updated_at`=NOW()');
      const [result] = await connection.execute(`UPDATE staff_tasks SET ${updates.join(',')} WHERE id=:id AND \`${recipient}\`=:staffId AND ${activeSql(status)}`, { id, staffId:req.user.id });
      if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ ok:false, error:'NOTIFICATION_NOT_FOUND' }); }
      await audit(connection, req, 'notification_completed', id, `Notification ${id} completed`, { notification_id:id, status:'completed' });
      await connection.commit();
      res.json({ ok:true, id, status:'completed' });
    } catch (error) {
      await connection.rollback();
      console.error('Notification completion failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'NOTIFICATION_COMPLETE_FAILED' });
    } finally { connection.release(); }
  });

  router.post('/api/notifications/broadcast', requireAuth, async (req, res) => {
    if (!['owner','manager'].includes(req.user.role)) return res.status(403).json({ ok:false, error:'INSUFFICIENT_PERMISSION' });
    const titleText = String(req.body.title || '').trim().slice(0,160);
    const messageText = String(req.body.message || '').trim().slice(0,3000);
    const target = String(req.body.target || 'team').trim();
    const staffId = Number(req.body.staffId || 0);
    if (!titleText || !messageText) return res.status(400).json({ ok:false, error:'TITLE_AND_MESSAGE_REQUIRED' });
    if (!['team','staff'].includes(target)) return res.status(400).json({ ok:false, error:'INVALID_MESSAGE_TARGET' });
    if (target === 'staff' && (!Number.isInteger(staffId) || staffId < 1)) return res.status(400).json({ ok:false, error:'SELECT_STAFF_MEMBER' });

    const connection = await pool.getConnection();
    try {
      const columns = await taskColumns();
      const recipient = firstSupported(columns, ['assigned_staff_id','assigned_to','recipient_staff_id','staff_id','user_id']);
      if (!recipient) return res.status(409).json({ ok:false, error:'TASK_RECIPIENT_COLUMN_NOT_FOUND' });
      const [staff] = target === 'team'
        ? await connection.execute('SELECT id, full_name FROM staff_users WHERE is_active=1 ORDER BY full_name LIMIT 20')
        : await connection.execute('SELECT id, full_name FROM staff_users WHERE id=:staffId AND is_active=1 LIMIT 1', { staffId });
      if (!staff.length) return res.status(404).json({ ok:false, error:'STAFF_NOT_FOUND' });

      await connection.beginTransaction();
      let createdCount = 0;
      for (const person of staff) {
        const values = {
          [recipient]: person.id,
          title: titleText,
          task_title: titleText,
          subject: titleText,
          name: titleText,
          message: messageText,
          description: messageText,
          task_description: messageText,
          details: messageText,
          body: messageText,
          status: 'unread',
          task_status: 'unread',
          priority: 'normal',
          task_type: target === 'team' ? 'broadcast' : 'direct_message',
          created_by: req.user.id,
          created_by_staff_id: req.user.id,
          sender_staff_id: req.user.id,
          created_at: new Date(),
          updated_at: new Date()
        };
        const insert = buildInsert(columns, values);
        await connection.execute(insert.sql, insert.params);
        createdCount += 1;
      }
      const description = target === 'team'
        ? `Broadcast sent to ${createdCount} staff members`
        : `Direct message sent to ${staff[0].full_name}`;
      await audit(connection, req, target === 'team' ? 'notification_broadcast' : 'notification_direct_message', req.user.id, description, { title:titleText, target, staff_id:target === 'staff' ? staffId : null, recipients:createdCount });
      await connection.commit();
      res.status(201).json({ ok:true, recipients:createdCount, target, recipientName:target === 'staff' ? staff[0].full_name : null });
    } catch (error) {
      await connection.rollback();
      console.error('Notification send failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'NOTIFICATION_SEND_FAILED' });
    } finally { connection.release(); }
  });

  return router;
};
