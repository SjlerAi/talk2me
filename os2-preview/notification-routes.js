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
      if (!columns.size) return res.json({ ok:true, unread:0, items:[], canBroadcast:['owner','manager'].includes(req.user.role) });
      const recipient = firstSupported(columns, ['assigned_staff_id','assigned_to','recipient_staff_id','staff_id','user_id']);
      const title = firstSupported(columns, ['title','task_title','subject','name']);
      const message = firstSupported(columns, ['message','description','task_description','details','body']);
      const status = firstSupported(columns, ['status','task_status']);
      const created = firstSupported(columns, ['created_at','created_on','created_date']);
      const client = firstSupported(columns, ['client_id','customer_id','entity_id']);
      const inquiry = firstSupported(columns, ['inquiry_id','related_inquiry_id']);
      if (!recipient) return res.json({ ok:true, unread:0, items:[], canBroadcast:['owner','manager'].includes(req.user.role) });

      const select = [
        'id',
        title ? `\`${title}\` title` : "'Notification' title",
        message ? `\`${message}\` message` : "'' message",
        status ? `\`${status}\` status` : "'unread' status",
        created ? `\`${created}\` created_at` : 'NULL created_at',
        client ? `\`${client}\` client_id` : 'NULL client_id',
        inquiry ? `\`${inquiry}\` inquiry_id` : 'NULL inquiry_id'
      ].join(',');
      const [items] = await pool.execute(`SELECT ${select} FROM staff_tasks WHERE \`${recipient}\`=:staffId ORDER BY ${created ? `\`${created}\`` : 'id'} DESC LIMIT 50`, { staffId:req.user.id });
      const unread = items.filter(item => !['seen','read','completed','done','archived'].includes(String(item.status || '').toLowerCase())).length;
      res.json({ ok:true, unread, items, canBroadcast:['owner','manager'].includes(req.user.role) });
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
      const readAt = firstSupported(columns, ['read_at','seen_at','completed_at']);
      if (!recipient || !status) return res.status(409).json({ ok:false, error:'NOTIFICATION_READ_UNSUPPORTED' });
      await connection.beginTransaction();
      const updates = [`\`${status}\`='seen'`];
      if (readAt) updates.push(`\`${readAt}\`=NOW()`);
      const [result] = await connection.execute(`UPDATE staff_tasks SET ${updates.join(',')} WHERE id=:id AND \`${recipient}\`=:staffId`, { id, staffId:req.user.id });
      if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ ok:false, error:'NOTIFICATION_NOT_FOUND' }); }
      await audit(connection, req, 'notification_read', id, `Notification ${id} marked as read`, { notification_id:id });
      await connection.commit();
      res.json({ ok:true, id });
    } catch (error) {
      await connection.rollback();
      console.error('Notification read failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'NOTIFICATION_READ_FAILED' });
    } finally { connection.release(); }
  });

  router.post('/api/notifications/broadcast', requireAuth, async (req, res) => {
    if (!['owner','manager'].includes(req.user.role)) return res.status(403).json({ ok:false, error:'INSUFFICIENT_PERMISSION' });
    const titleText = String(req.body.title || '').trim().slice(0,160);
    const messageText = String(req.body.message || '').trim().slice(0,3000);
    if (!titleText || !messageText) return res.status(400).json({ ok:false, error:'TITLE_AND_MESSAGE_REQUIRED' });
    const connection = await pool.getConnection();
    try {
      const columns = await taskColumns();
      const recipient = firstSupported(columns, ['assigned_staff_id','assigned_to','recipient_staff_id','staff_id','user_id']);
      if (!recipient) return res.status(409).json({ ok:false, error:'TASK_RECIPIENT_COLUMN_NOT_FOUND' });
      const [staff] = await connection.execute('SELECT id FROM staff_users WHERE is_active=1');
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
          task_type: 'broadcast',
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
      await audit(connection, req, 'notification_broadcast', req.user.id, `Broadcast sent to ${createdCount} staff members`, { title:titleText, recipients:createdCount });
      await connection.commit();
      res.status(201).json({ ok:true, recipients:createdCount });
    } catch (error) {
      await connection.rollback();
      console.error('Notification broadcast failed', error);
      res.status(500).json({ ok:false, error:error.code || error.message || 'NOTIFICATION_BROADCAST_FAILED' });
    } finally { connection.release(); }
  });

  return router;
};
