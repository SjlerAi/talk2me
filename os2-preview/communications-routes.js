'use strict';

const express = require('express');
const { withTransaction } = require('./core/transaction');
const { requirePermission } = require('./core/permissions');
const { appendAudit } = require('./core/audit');

function text(value, max = 255) {
  const result = String(value == null ? '' : value).trim();
  return result ? result.slice(0, max) : null;
}
function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function context(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
  };
}
function management(user) {
  return ['owner','manager','admin'].includes(String(user?.role || '').toLowerCase());
}
function safeUrl(value) {
  const url = text(value, 500);
  if (!url) return null;
  if (!url.startsWith('/')) throw new Error('INVALID_ACTION_URL');
  return url;
}
function normaliseAudience(body) {
  const type = ['all','role','staff_list'].includes(body.audienceType) ? body.audienceType : 'all';
  if (type === 'role') {
    const roles = (Array.isArray(body.roles) ? body.roles : []).map(x => String(x).toLowerCase()).filter(x => ['owner','manager','admin','staff'].includes(x));
    if (!roles.length) throw new Error('BROADCAST_ROLES_REQUIRED');
    return { type, value: [...new Set(roles)] };
  }
  if (type === 'staff_list') {
    const staffIds = (Array.isArray(body.staffIds) ? body.staffIds : []).map(Number).filter(x => Number.isInteger(x) && x > 0);
    if (!staffIds.length) throw new Error('BROADCAST_STAFF_REQUIRED');
    return { type, value: [...new Set(staffIds)] };
  }
  return { type: 'all', value: [] };
}
async function resolveAudience(connection, audience) {
  let sql = 'SELECT id,full_name,email,role FROM staff_users WHERE is_active=1';
  const params = {};
  if (audience.type === 'role') {
    sql += ' AND role IN (:roles)';
    params.roles = audience.value;
  } else if (audience.type === 'staff_list') {
    sql += ' AND id IN (:ids)';
    params.ids = audience.value;
  }
  const [rows] = await connection.execute(sql, params);
  return rows;
}
async function createNotification(connection, options) {
  const [result] = await connection.execute(`
    INSERT INTO os2_notifications
      (recipient_staff_id,sender_staff_id,master_customer_id,work_item_id,notification_type,
       title,message,action_url,priority,delivery_channel,delivery_status,created_at)
    VALUES
      (:recipient,:sender,:customer,:workItem,:type,:title,:message,:actionUrl,:priority,:channel,
       CASE WHEN :channel='in_app' THEN 'sent' ELSE 'pending' END,NOW())`, {
    recipient: Number(options.recipientStaffId),
    sender: options.senderStaffId ? Number(options.senderStaffId) : null,
    customer: positiveId(options.masterCustomerId),
    workItem: positiveId(options.workItemId),
    type: options.notificationType || 'general',
    title: options.title,
    message: options.message || null,
    actionUrl: options.actionUrl || null,
    priority: options.priority || 'normal',
    channel: options.deliveryChannel || 'in_app'
  });
  return Number(result.insertId);
}
async function queueEmail(connection, options) {
  if (!options.email) return null;
  const [result] = await connection.execute(`
    INSERT INTO os2_email_queue
      (recipient_email,recipient_name,subject,body_text,body_html,related_entity_type,
       related_entity_id,status,attempts,next_attempt_at,created_by,created_at,updated_at)
    VALUES
      (:email,:name,:subject,:bodyText,:bodyHtml,:entityType,:entityId,'pending',0,NOW(),:actor,NOW(),NOW())`, {
    email: options.email,
    name: options.name || null,
    subject: options.subject,
    bodyText: options.bodyText,
    bodyHtml: options.bodyHtml || null,
    entityType: options.entityType || null,
    entityId: positiveId(options.entityId),
    actor: positiveId(options.actorStaffId)
  });
  return Number(result.insertId);
}

module.exports = function createCommunicationsRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use('/api/os2', requireAuth);

  router.get('/api/os2/notifications', async (req, res) => {
    const includeArchived = req.query.archived === '1';
    try {
      const [rows] = await pool.execute(`
        SELECT n.*,sender.full_name sender_name,mc.display_name customer_name
          FROM os2_notifications n
          LEFT JOIN staff_users sender ON sender.id=n.sender_staff_id
          LEFT JOIN os2_master_customers mc ON mc.id=n.master_customer_id
         WHERE n.recipient_staff_id=:staffId
           AND (:includeArchived=1 OR n.archived_at IS NULL)
         ORDER BY n.read_at IS NULL DESC,FIELD(n.priority,'urgent','high','normal','low'),n.created_at DESC
         LIMIT 250`, { staffId:Number(req.user.id), includeArchived:includeArchived ? 1 : 0 });
      const unread = rows.filter(row => !row.read_at && !row.archived_at).length;
      res.json({ ok:true, unread, notifications:rows });
    } catch (error) {
      console.error('Notifications load failed', error.code || error.message);
      res.status(500).json({ ok:false, error:'NOTIFICATIONS_LOAD_FAILED' });
    }
  });

  router.post('/api/os2/notifications/:id/read', async (req, res) => {
    try {
      const [result] = await pool.execute(`UPDATE os2_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=:id AND recipient_staff_id=:staffId`, { id:Number(req.params.id), staffId:Number(req.user.id) });
      if (!result.affectedRows) return res.status(404).json({ ok:false, error:'NOTIFICATION_NOT_FOUND' });
      res.json({ ok:true });
    } catch (error) { res.status(500).json({ ok:false, error:'NOTIFICATION_UPDATE_FAILED' }); }
  });

  router.post('/api/os2/notifications/:id/archive', async (req, res) => {
    try {
      const [result] = await pool.execute(`UPDATE os2_notifications SET archived_at=COALESCE(archived_at,NOW()),read_at=COALESCE(read_at,NOW()) WHERE id=:id AND recipient_staff_id=:staffId`, { id:Number(req.params.id), staffId:Number(req.user.id) });
      if (!result.affectedRows) return res.status(404).json({ ok:false, error:'NOTIFICATION_NOT_FOUND' });
      res.json({ ok:true });
    } catch (error) { res.status(500).json({ ok:false, error:'NOTIFICATION_ARCHIVE_FAILED' }); }
  });

  router.post('/api/os2/notifications', async (req, res) => {
    const recipientStaffId = positiveId(req.body.recipientStaffId);
    const title = text(req.body.title, 240);
    if (!recipientStaffId || !title) return res.status(400).json({ ok:false, error:'RECIPIENT_AND_TITLE_REQUIRED' });
    if (!management(req.user) && recipientStaffId !== Number(req.user.id)) return res.status(403).json({ ok:false, error:'INSUFFICIENT_PERMISSION' });
    try {
      const notificationId = await withTransaction(pool, async connection => {
        const [[recipient]] = await connection.execute('SELECT id,full_name,email FROM staff_users WHERE id=:id AND is_active=1', { id:recipientStaffId });
        if (!recipient) throw new Error('RECIPIENT_NOT_FOUND');
        const channel = ['in_app','email','both'].includes(req.body.deliveryChannel) ? req.body.deliveryChannel : 'in_app';
        const id = await createNotification(connection, {
          recipientStaffId, senderStaffId:req.user.id,
          masterCustomerId:req.body.masterCustomerId, workItemId:req.body.workItemId,
          notificationType:text(req.body.notificationType,80) || 'general', title,
          message:text(req.body.message,5000), actionUrl:safeUrl(req.body.actionUrl),
          priority:['low','normal','high','urgent'].includes(req.body.priority) ? req.body.priority : 'normal',
          deliveryChannel:channel
        });
        if (channel !== 'in_app') await queueEmail(connection, {
          email:recipient.email, name:recipient.full_name, subject:title,
          bodyText:text(req.body.message,5000) || title, entityType:'os2_notifications', entityId:id,
          actorStaffId:req.user.id
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id, actionType:'notification_created', entityType:'os2_notifications',
          entityId:id, masterCustomerId:positiveId(req.body.masterCustomerId),
          description:`Notification sent to ${recipient.full_name}`, after:{ recipientStaffId, title, channel },
          requestContext:context(req)
        });
        return id;
      });
      res.status(201).json({ ok:true, notificationId });
    } catch (error) {
      const known = ['RECIPIENT_NOT_FOUND','INVALID_ACTION_URL'].includes(error.message);
      res.status(known ? 400 : 500).json({ ok:false, error:known ? error.message : 'NOTIFICATION_CREATE_FAILED' });
    }
  });

  router.get('/api/os2/broadcasts', requirePermission('notification.broadcast'), async (req, res) => {
    try {
      const [rows] = await pool.execute(`SELECT b.*,su.full_name creator_name FROM os2_broadcasts b JOIN staff_users su ON su.id=b.created_by ORDER BY b.created_at DESC LIMIT 200`);
      res.json({ ok:true, broadcasts:rows });
    } catch (error) { res.status(500).json({ ok:false, error:'BROADCASTS_LOAD_FAILED' }); }
  });

  router.post('/api/os2/broadcasts', requirePermission('notification.broadcast'), async (req, res) => {
    const title = text(req.body.title,240);
    const message = text(req.body.message,10000);
    if (!title || !message) return res.status(400).json({ ok:false, error:'TITLE_AND_MESSAGE_REQUIRED' });
    try {
      const result = await withTransaction(pool, async connection => {
        const audience = normaliseAudience(req.body);
        const channel = ['in_app','email','both'].includes(req.body.deliveryChannel) ? req.body.deliveryChannel : 'in_app';
        const priority = ['low','normal','high','urgent'].includes(req.body.priority) ? req.body.priority : 'normal';
        const [insert] = await connection.execute(`
          INSERT INTO os2_broadcasts
            (title,message,audience_type,audience_json,delivery_channel,priority,status,scheduled_at,created_by,created_at,updated_at)
          VALUES (:title,:message,:type,:audienceJson,:channel,:priority,'queued',:scheduledAt,:actor,NOW(),NOW())`, {
          title,message,type:audience.type,audienceJson:JSON.stringify(audience.value),channel,priority,
          scheduledAt:req.body.scheduledAt || null, actor:Number(req.user.id)
        });
        const broadcastId = Number(insert.insertId);
        const recipients = await resolveAudience(connection,audience);
        for (const recipient of recipients) {
          const notificationId = await createNotification(connection, {
            recipientStaffId:recipient.id,senderStaffId:req.user.id,notificationType:'broadcast',title,message,
            priority,deliveryChannel:channel,actionUrl:safeUrl(req.body.actionUrl)
          });
          if (channel !== 'in_app') await queueEmail(connection, {
            email:recipient.email,name:recipient.full_name,subject:title,bodyText:message,
            entityType:'os2_broadcasts',entityId:broadcastId,actorStaffId:req.user.id
          });
          await connection.execute(`UPDATE os2_notifications SET delivery_status=CASE WHEN :channel='in_app' THEN 'sent' ELSE delivery_status END WHERE id=:id`, { channel,id:notificationId });
        }
        await connection.execute(`UPDATE os2_broadcasts SET status='sent',sent_at=NOW(),updated_at=NOW() WHERE id=:id`, { id:broadcastId });
        await appendAudit(connection, {
          actorStaffId:req.user.id,actionType:'broadcast_sent',entityType:'os2_broadcasts',entityId:broadcastId,
          description:`Broadcast sent to ${recipients.length} active staff members`,
          after:{ audience,channel,priority,recipientCount:recipients.length },requestContext:context(req)
        });
        return { broadcastId, recipientCount:recipients.length };
      });
      res.status(201).json({ ok:true,...result });
    } catch (error) {
      const known = ['BROADCAST_ROLES_REQUIRED','BROADCAST_STAFF_REQUIRED','INVALID_ACTION_URL'].includes(error.message);
      res.status(known ? 400 : 500).json({ ok:false,error:known ? error.message : 'BROADCAST_CREATE_FAILED' });
    }
  });

  router.post('/api/os2/digests/generate', requirePermission('notification.broadcast'), async (req, res) => {
    const digestDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.digestDate || '')) ? req.body.digestDate : new Date().toISOString().slice(0,10);
    try {
      const result = await withTransaction(pool, async connection => {
        const [staff] = await connection.execute('SELECT id,full_name,email,role FROM staff_users WHERE is_active=1 ORDER BY id');
        let generated = 0;
        for (const person of staff) {
          const managerView = ['owner','manager','admin'].includes(String(person.role).toLowerCase());
          const [work] = await connection.execute(`
            SELECT w.id,w.title,w.priority,w.lifecycle_state,w.due_at,mc.display_name customer_name
              FROM os2_work_items w LEFT JOIN os2_master_customers mc ON mc.id=w.master_customer_id
             WHERE w.archived_at IS NULL AND w.lifecycle_state NOT IN ('accepted','archived')
               AND (:managerView=1 OR w.assigned_staff_id=:staffId)
               AND (DATE(w.due_at)<=:digestDate OR DATE(w.start_at)=:digestDate)
             ORDER BY w.due_at,FIELD(w.priority,'urgent','high','normal','low') LIMIT 100`, {
            managerView:managerView ? 1 : 0,staffId:Number(person.id),digestDate
          });
          const [customerCare] = await connection.execute(`
            SELECT id,display_name,primary_mobile FROM os2_master_customers
             WHERE archived_at IS NULL AND (DATE(birth_date)=:digestDate OR id IN (
               SELECT master_customer_id FROM os2_mobile_lines WHERE archived_at IS NULL AND DATE(next_upgrade_date)<=DATE_ADD(:digestDate,INTERVAL 7 DAY)
             )) ORDER BY display_name LIMIT 100`, { digestDate });
          const payload = { digestDate,staff:{ id:person.id,name:person.full_name,role:person.role },work,customerCare };
          const digestType = managerView ? (String(person.role).toLowerCase()==='owner' ? 'owner_daily' : 'manager_daily') : 'staff_daily';
          const [insert] = await connection.execute(`
            INSERT INTO os2_digest_runs
              (digest_type,target_staff_id,digest_date,payload_json,delivery_channel,status,generated_at)
            VALUES (:type,:staffId,:date,:payload,'both','generated',NOW())
            ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),status='generated',generated_at=NOW(),failure_reason=NULL`, {
            type:digestType,staffId:Number(person.id),date:digestDate,payload:JSON.stringify(payload)
          });
          const subject = `Talk2Me daily work summary - ${digestDate}`;
          const body = [`Hello ${person.full_name},`,``,`Work items requiring attention: ${work.length}`,`Customer-care opportunities: ${customerCare.length}`,'','Open Talk2Me for the full list.'].join('\n');
          await createNotification(connection, {
            recipientStaffId:person.id,senderStaffId:req.user.id,notificationType:'daily_digest',title:subject,
            message:body,priority:work.some(item => item.priority==='urgent') ? 'high' : 'normal',deliveryChannel:'both',actionUrl:'/'
          });
          await queueEmail(connection, {
            email:person.email,name:person.full_name,subject,bodyText:body,
            entityType:'os2_digest_runs',entityId:insert.insertId || null,actorStaffId:req.user.id
          });
          generated += 1;
        }
        await appendAudit(connection, {
          actorStaffId:req.user.id,actionType:'daily_digests_generated',entityType:'os2_digest_runs',entityId:null,
          description:`Generated ${generated} daily digests for ${digestDate}`,
          after:{ digestDate,generated },requestContext:context(req)
        });
        return generated;
      });
      res.json({ ok:true,digestDate,generated:result });
    } catch (error) {
      console.error('Digest generation failed',error.code || error.message);
      res.status(500).json({ ok:false,error:'DIGEST_GENERATION_FAILED' });
    }
  });

  router.get('/api/os2/email-queue', requirePermission('notification.broadcast'), async (req, res) => {
    try {
      const status = text(req.query.status,30) || 'pending';
      const [rows] = await pool.execute(`SELECT id,recipient_email,recipient_name,subject,related_entity_type,related_entity_id,status,attempts,next_attempt_at,sent_at,failure_reason,created_at FROM os2_email_queue WHERE (:status='all' OR status=:status) ORDER BY created_at DESC LIMIT 250`, { status });
      res.json({ ok:true,emails:rows });
    } catch (error) { res.status(500).json({ ok:false,error:'EMAIL_QUEUE_LOAD_FAILED' }); }
  });

  return router;
};
