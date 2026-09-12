const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const MANAGEMENT_ROLES = new Set(['owner', 'admin', 'manager']);
const ACTIVE_TASKS = "('unread','seen','in_progress')";
const privateRoot = String(process.env.PRIVATE_UPLOAD_DIR || '').trim();
const voiceDir = path.join(privateRoot, 'messages', 'voice');
let schemaPromise;

function management(user) {
  return Boolean(user && MANAGEMENT_ROLES.has(String(user.role || '').toLowerCase()));
}

function idOf(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clean(value, max = 5000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function sqlDateTime(value) {
  const raw = clean(value, 19);
  if (!raw) return null;
  const normalized = raw.replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(normalized)) return null;
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

function directKey(a, b) {
  const first = Math.min(Number(a), Number(b));
  const second = Math.max(Number(a), Number(b));
  return `direct:${first}:${second}`;
}

async function resolveConversation(userId, token) {
  const raw = clean(token, 80);
  if (raw === 'office') return { token: 'office', key: 'office', type: 'office', other: null };
  const match = raw.match(/^direct:(\d+)$/);
  if (!match) return null;
  const otherId = idOf(match[1]);
  if (!otherId || otherId === Number(userId)) return null;
  const [[staff]] = await db.execute('SELECT id,full_name,role FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1', { id: otherId });
  if (!staff) return null;
  return { token: `direct:${otherId}`, key: directKey(userId, otherId), type: 'direct', other: staff };
}

function authorisedForKey(userId, key) {
  if (key === 'office') return true;
  const match = String(key || '').match(/^direct:(\d+):(\d+)$/);
  return Boolean(match && (Number(match[1]) === Number(userId) || Number(match[2]) === Number(userId)));
}

async function ensureSchema() {
  if (!IS_UAT) throw new Error('UAT work widgets are disabled outside UAT.');
  if (!schemaPromise) {
    schemaPromise = (async () => {
      if (!privateRoot || privateRoot === '/home/uent/talk2me_private_uploads') throw new Error('UAT work widgets require the isolated private upload directory.');
      fs.mkdirSync(voiceDir, { recursive: true, mode: 0o700 });
      await db.query(`CREATE TABLE IF NOT EXISTS staff_chat_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        conversation_key VARCHAR(80) NOT NULL,
        sender_staff_id BIGINT UNSIGNED NOT NULL,
        message_type VARCHAR(20) NOT NULL DEFAULT 'text',
        body TEXT NULL,
        voice_filename VARCHAR(255) NULL,
        voice_mime VARCHAR(100) NULL,
        voice_bytes BIGINT UNSIGNED NULL,
        voice_seconds SMALLINT UNSIGNED NULL,
        related_client_id BIGINT UNSIGNED NULL,
        related_task_id BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_staff_chat_conversation (conversation_key,id),
        KEY idx_staff_chat_sender (sender_staff_id,created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await db.query(`CREATE TABLE IF NOT EXISTS staff_chat_reads (
        staff_id BIGINT UNSIGNED NOT NULL,
        conversation_key VARCHAR(80) NOT NULL,
        last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (staff_id,conversation_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await db.query(`CREATE TABLE IF NOT EXISTS staff_task_workflow (
        task_id BIGINT UNSIGNED NOT NULL,
        workflow_state VARCHAR(40) NOT NULL DEFAULT 'active',
        my_priority_date DATE NULL,
        completed_by BIGINT UNSIGNED NULL,
        completed_at DATETIME NULL,
        acknowledged_by BIGINT UNSIGNED NULL,
        acknowledged_at DATETIME NULL,
        returned_by BIGINT UNSIGNED NULL,
        returned_at DATETIME NULL,
        return_reason TEXT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (task_id),
        KEY idx_task_workflow_state (workflow_state,updated_at),
        KEY idx_task_workflow_priority (my_priority_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await db.query(`CREATE TABLE IF NOT EXISTS staff_task_notifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        task_id BIGINT UNSIGNED NOT NULL,
        recipient_staff_id BIGINT UNSIGNED NOT NULL,
        actor_staff_id BIGINT UNSIGNED NULL,
        event_type VARCHAR(50) NOT NULL,
        notification_text VARCHAR(500) NOT NULL,
        action_required TINYINT(1) NOT NULL DEFAULT 0,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        read_at DATETIME NULL,
        resolved_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_task_notifications_recipient (recipient_staff_id,resolved_at,is_read,created_at),
        KEY idx_task_notifications_task (task_id,recipient_staff_id,action_required,resolved_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

const mimeExtensions = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav'
};

const voiceStorage = multer.diskStorage({
  destination(req, file, callback) {
    try {
      fs.mkdirSync(voiceDir, { recursive: true, mode: 0o700 });
      callback(null, voiceDir);
    } catch (error) { callback(error); }
  },
  filename(req, file, callback) {
    const extension = mimeExtensions[String(file.mimetype || '').toLowerCase()] || '.webm';
    callback(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${extension}`);
  }
});

const uploadVoice = multer({
  storage: voiceStorage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    const mime = String(file.mimetype || '').toLowerCase();
    callback(mimeExtensions[mime] ? null : new Error('Unsupported voice-note format.'), Boolean(mimeExtensions[mime]));
  }
}).single('voice');

async function markConversationRead(userId, key, messageId) {
  if (!messageId) return;
  await db.execute(`INSERT INTO staff_chat_reads (staff_id,conversation_key,last_read_message_id)
    VALUES (:userId,:key,:messageId)
    ON DUPLICATE KEY UPDATE last_read_message_id=GREATEST(last_read_message_id,VALUES(last_read_message_id)),updated_at=NOW()`, {
    userId, key, messageId
  });
}

async function conversationSummary(userId, token, name, staffId = null) {
  const resolved = staffId ? { key: directKey(userId, staffId) } : { key: 'office' };
  const [[latest]] = await db.execute(`SELECT m.id,m.message_type,m.body,m.created_at,m.sender_staff_id,s.full_name sender_name
    FROM staff_chat_messages m JOIN staff_users s ON s.id=m.sender_staff_id
    WHERE m.conversation_key=:key ORDER BY m.id DESC LIMIT 1`, { key: resolved.key });
  const [[read]] = await db.execute('SELECT last_read_message_id FROM staff_chat_reads WHERE staff_id=:userId AND conversation_key=:key LIMIT 1', { userId, key: resolved.key });
  const [[count]] = await db.execute(`SELECT COUNT(*) total FROM staff_chat_messages
    WHERE conversation_key=:key AND id>:lastRead AND sender_staff_id<>:userId`, {
    key: resolved.key, lastRead: Number(read?.last_read_message_id || 0), userId
  });
  return {
    token,
    name,
    staffId,
    unread: Number(count?.total || 0),
    latest: latest ? {
      id: latest.id,
      type: latest.message_type,
      preview: latest.message_type === 'voice' ? 'Voice note' : clean(latest.body, 90),
      senderName: latest.sender_name,
      senderId: latest.sender_staff_id,
      createdAt: latest.created_at
    } : null
  };
}

async function taskNotification({ taskId, recipientId, actorId, eventType, message, actionRequired = false }) {
  if (!recipientId || Number(recipientId) === Number(actorId)) return;
  await db.execute(`INSERT INTO staff_task_notifications
    (task_id,recipient_staff_id,actor_staff_id,event_type,notification_text,action_required)
    VALUES (:taskId,:recipientId,:actorId,:eventType,:message,:required)`, {
    taskId, recipientId, actorId: actorId || null, eventType, message: clean(message, 500), required: actionRequired ? 1 : 0
  });
}

async function getTask(taskId) {
  const [[task]] = await db.execute(`SELECT t.*,ass.full_name assigned_name,creator.full_name created_by_name,
    cl.client_name related_client_name,
    COALESCE(w.workflow_state,CASE WHEN t.status='completed' THEN 'accepted' ELSE 'active' END) workflow_state,
    w.my_priority_date,w.completed_at workflow_completed_at,w.acknowledged_at,w.returned_at,w.return_reason
    FROM staff_tasks t
    JOIN staff_users ass ON ass.id=t.assigned_to
    JOIN staff_users creator ON creator.id=t.created_by
    LEFT JOIN clients cl ON cl.id=t.related_client_id
    LEFT JOIN staff_task_workflow w ON w.task_id=t.id
    WHERE t.id=:taskId LIMIT 1`, { taskId });
  return task || null;
}

router.get('/api/uat/widgets/health', async (req, res) => {
  if (!IS_UAT) return res.sendStatus(404);
  try {
    await ensureSchema();
    const [rows] = await db.execute(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('staff_chat_messages','staff_chat_reads','staff_tasks','staff_task_workflow')`);
    const names = new Set(rows.map(row => row.TABLE_NAME));
    res.json({
      status: names.size === 4 ? 'ok' : 'error',
      environment: 'uat',
      chat: names.has('staff_chat_messages') && names.has('staff_chat_reads'),
      tasks: names.has('staff_tasks') && names.has('staff_task_workflow'),
      voiceDirectory: privateRoot === '/home/uent/talk2me_uat_private_uploads'
    });
  } catch (error) {
    res.status(503).json({ status: 'error', environment: 'uat' });
  }
});

router.get('/api/uat/chat/bootstrap', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = Number(req.session.user.id);
    const [staff] = await db.execute('SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
    const conversations = [await conversationSummary(userId, 'office', 'Office')];
    for (const person of staff) {
      if (Number(person.id) === userId) continue;
      conversations.push(await conversationSummary(userId, `direct:${person.id}`, person.full_name, person.id));
    }
    const [[system]] = await db.execute(`SELECT COUNT(*) total FROM staff_task_notifications
      WHERE recipient_staff_id=:userId AND resolved_at IS NULL AND (is_read=0 OR action_required=1)`, { userId });
    res.json({
      ok: true,
      user: { id: userId, name: req.session.user.full_name, role: req.session.user.role },
      staff,
      conversations,
      unreadTotal: conversations.reduce((sum, item) => sum + item.unread, 0),
      systemUnread: Number(system?.total || 0)
    });
  } catch (error) { next(error); }
});

router.get('/api/uat/chat/messages', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = Number(req.session.user.id);
    const conversation = await resolveConversation(userId, req.query.conversation);
    if (!conversation) return res.status(400).json({ ok: false, error: 'Invalid conversation.' });
    const [rows] = await db.execute(`SELECT m.*,s.full_name sender_name
      FROM staff_chat_messages m JOIN staff_users s ON s.id=m.sender_staff_id
      WHERE m.conversation_key=:key ORDER BY m.id DESC LIMIT 120`, { key: conversation.key });
    const messages = rows.reverse().map(row => ({
      id: row.id,
      senderId: row.sender_staff_id,
      senderName: row.sender_name,
      type: row.message_type,
      body: row.body || '',
      voiceUrl: row.message_type === 'voice' ? `${res.locals.basePath}/api/uat/chat/voice/${row.id}` : null,
      voiceSeconds: row.voice_seconds || null,
      relatedClientId: row.related_client_id || null,
      relatedTaskId: row.related_task_id || null,
      createdAt: row.created_at
    }));
    const lastId = messages.length ? Number(messages[messages.length - 1].id) : 0;
    await markConversationRead(userId, conversation.key, lastId);
    res.json({ ok: true, conversation: { token: conversation.token, type: conversation.type, name: conversation.other?.full_name || 'Office' }, messages });
  } catch (error) { next(error); }
});

router.post('/api/uat/chat/messages', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = Number(req.session.user.id);
    const conversation = await resolveConversation(userId, req.body.conversation);
    if (!conversation) return res.status(400).json({ ok: false, error: 'Choose a valid conversation.' });
    const body = clean(req.body.body, 4000);
    if (!body) return res.status(400).json({ ok: false, error: 'Type a message.' });
    const relatedClientId = idOf(req.body.related_client_id);
    const relatedTaskId = idOf(req.body.related_task_id);
    const [result] = await db.execute(`INSERT INTO staff_chat_messages
      (conversation_key,sender_staff_id,message_type,body,related_client_id,related_task_id)
      VALUES (:key,:userId,'text',:body,:relatedClientId,:relatedTaskId)`, {
      key: conversation.key, userId, body, relatedClientId, relatedTaskId
    });
    await markConversationRead(userId, conversation.key, result.insertId);
    res.json({ ok: true, id: result.insertId });
  } catch (error) { next(error); }
});

router.post('/api/uat/chat/voice', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    uploadVoice(req, res, async error => {
      if (error) return res.status(400).json({ ok: false, error: error.message || 'Voice note could not be uploaded.' });
      try {
        const userId = Number(req.session.user.id);
        const conversation = await resolveConversation(userId, req.body.conversation);
        if (!conversation || !req.file) {
          if (req.file?.path) fs.unlink(req.file.path, () => {});
          return res.status(400).json({ ok: false, error: !conversation ? 'Choose a valid conversation.' : 'No voice note received.' });
        }
        const seconds = Math.max(1, Math.min(180, Number(req.body.duration_seconds || 1)));
        const relatedClientId = idOf(req.body.related_client_id);
        const relatedTaskId = idOf(req.body.related_task_id);
        const [result] = await db.execute(`INSERT INTO staff_chat_messages
          (conversation_key,sender_staff_id,message_type,voice_filename,voice_mime,voice_bytes,voice_seconds,related_client_id,related_task_id)
          VALUES (:key,:userId,'voice',:filename,:mime,:bytes,:seconds,:relatedClientId,:relatedTaskId)`, {
          key: conversation.key, userId, filename: req.file.filename, mime: req.file.mimetype, bytes: req.file.size, seconds,
          relatedClientId, relatedTaskId
        });
        await markConversationRead(userId, conversation.key, result.insertId);
        res.json({ ok: true, id: result.insertId });
      } catch (inner) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        next(inner);
      }
    });
  } catch (error) { next(error); }
});

router.get('/api/uat/chat/voice/:id', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const id = idOf(req.params.id);
    if (!id) return res.sendStatus(404);
    const [[message]] = await db.execute(`SELECT id,conversation_key,voice_filename,voice_mime,voice_bytes
      FROM staff_chat_messages WHERE id=:id AND message_type='voice' LIMIT 1`, { id });
    if (!message || !authorisedForKey(Number(req.session.user.id), message.conversation_key)) return res.sendStatus(404);
    const filename = path.basename(String(message.voice_filename || ''));
    const filePath = path.join(voiceDir, filename);
    if (!filename || !fs.existsSync(filePath)) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store');
    res.type(message.voice_mime || 'audio/webm');
    res.sendFile(filePath);
  } catch (error) { next(error); }
});

router.get('/api/uat/chat/system', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = Number(req.session.user.id);
    const [alerts] = await db.execute(`SELECT n.id,n.task_id,n.event_type,n.notification_text,n.action_required,n.is_read,n.created_at,t.title,t.priority,t.status
      FROM staff_task_notifications n JOIN staff_tasks t ON t.id=n.task_id
      WHERE n.recipient_staff_id=:userId AND n.resolved_at IS NULL AND (n.is_read=0 OR n.action_required=1)
      ORDER BY n.action_required DESC,n.created_at DESC,n.id DESC LIMIT 80`, { userId });
    res.json({ ok: true, alerts: alerts.map(row => ({
      id: row.id, taskId: row.task_id, type: row.event_type, text: row.notification_text,
      actionRequired: Boolean(row.action_required), isRead: Boolean(row.is_read), createdAt: row.created_at,
      taskTitle: row.title, priority: row.priority, status: row.status
    })) });
  } catch (error) { next(error); }
});

router.post('/api/uat/chat/system/:id/read', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    await db.execute(`UPDATE staff_task_notifications SET is_read=1,read_at=COALESCE(read_at,NOW())
      WHERE id=:id AND recipient_staff_id=:userId`, { id: idOf(req.params.id), userId: Number(req.session.user.id) });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/api/uat/tasks', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = Number(req.session.user.id);
    const isManager = management(req.session.user);
    const requested = String(req.query.scope || 'mine');
    const scope = requested === 'sent' ? 'sent' : requested === 'team' && isManager ? 'team' : 'mine';
    const where = scope === 'sent' ? 't.created_by=:userId' : scope === 'team' ? '1=1' : 't.assigned_to=:userId';
    const [tasks] = await db.execute(`SELECT t.id,t.title,t.message,t.priority,t.status,t.due_at,t.created_at,t.assigned_to,t.created_by,
      ass.full_name assigned_name,creator.full_name created_by_name,cl.client_name related_client_name,t.related_client_id,
      COALESCE(w.workflow_state,CASE WHEN t.status='completed' THEN 'accepted' ELSE 'active' END) workflow_state
      FROM staff_tasks t
      JOIN staff_users ass ON ass.id=t.assigned_to
      JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN clients cl ON cl.id=t.related_client_id
      LEFT JOIN staff_task_workflow w ON w.task_id=t.id
      WHERE ${where} AND (t.status IN ${ACTIVE_TASKS} OR (t.status='completed' AND w.workflow_state='awaiting_sender_ack'))
      ORDER BY CASE WHEN t.due_at IS NOT NULL AND t.due_at<NOW() THEN 0 WHEN t.priority='urgent' THEN 1 WHEN t.priority='high' THEN 2 ELSE 3 END,
        t.due_at IS NULL,t.due_at,t.created_at DESC LIMIT 120`, { userId });
    const [staff] = await db.execute('SELECT id,full_name,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
    res.json({ ok: true, scope, management: isManager, staff, tasks });
  } catch (error) { next(error); }
});

router.get('/api/uat/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const taskId = idOf(req.params.id);
    if (!taskId) return res.sendStatus(404);
    let task = await getTask(taskId);
    if (!task) return res.sendStatus(404);
    const userId = Number(req.session.user.id);
    const isManager = management(req.session.user);
    const assignee = Number(task.assigned_to) === userId;
    const creator = Number(task.created_by) === userId;
    if (!isManager && !assignee && !creator) return res.sendStatus(403);
    if (assignee && task.status === 'unread') {
      await db.execute(`UPDATE staff_tasks SET status='seen',seen_at=COALESCE(seen_at,NOW()) WHERE id=:taskId`, { taskId });
      await db.execute(`INSERT INTO staff_task_workflow (task_id,workflow_state) VALUES (:taskId,'active') ON DUPLICATE KEY UPDATE task_id=VALUES(task_id)`, { taskId });
      await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,'Opened / seen')`, { taskId, userId });
      await taskNotification({ taskId, recipientId: task.created_by, actorId: userId, eventType: 'seen', message: `${task.assigned_name} opened “${task.title}”.` });
      task = await getTask(taskId);
    }
    await db.execute(`UPDATE staff_task_notifications SET is_read=1,read_at=COALESCE(read_at,NOW())
      WHERE task_id=:taskId AND recipient_staff_id=:userId AND action_required=0`, { taskId, userId });
    const [comments] = await db.execute(`SELECT c.id,c.comment,c.created_at,c.staff_id,s.full_name
      FROM staff_task_comments c JOIN staff_users s ON s.id=c.staff_id WHERE c.task_id=:taskId ORDER BY c.created_at ASC,c.id ASC`, { taskId });
    const waitingApproval = task.status === 'completed' && task.workflow_state === 'awaiting_sender_ack';
    const archived = task.status === 'cancelled' || (task.status === 'completed' && task.workflow_state === 'accepted');
    res.json({
      ok: true,
      task,
      comments,
      permissions: {
        canUpdate: (isManager || assignee) && !waitingApproval && !archived,
        canApprove: (isManager || creator) && waitingApproval,
        canComment: isManager || assignee || creator
      }
    });
  } catch (error) { next(error); }
});

router.post('/api/uat/tasks', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const title = clean(req.body.title, 180);
    const message = clean(req.body.message, 5000);
    const assignedTo = idOf(req.body.assigned_to);
    const priority = ['normal','high','urgent'].includes(String(req.body.priority || '')) ? String(req.body.priority) : 'normal';
    const dueAt = sqlDateTime(req.body.due_at);
    const relatedClientId = idOf(req.body.related_client_id);
    if (!title || !message || !assignedTo) return res.status(400).json({ ok: false, error: 'Choose a person and enter a title and task.' });
    const [[recipient]] = await db.execute('SELECT id,full_name FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1', { id: assignedTo });
    if (!recipient) return res.status(400).json({ ok: false, error: 'The assigned staff member was not found.' });
    if (relatedClientId) {
      const [[client]] = await db.execute('SELECT id FROM clients WHERE id=:id LIMIT 1', { id: relatedClientId });
      if (!client) return res.status(400).json({ ok: false, error: 'The related customer was not found.' });
    }
    const [result] = await db.execute(`INSERT INTO staff_tasks
      (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
      VALUES ('task',:title,:message,:priority,:assignedTo,:createdBy,:dueAt,:relatedClientId,'not_requested')`, {
      title, message, priority, assignedTo, createdBy: Number(req.session.user.id), dueAt, relatedClientId
    });
    await db.execute(`INSERT INTO staff_task_workflow (task_id,workflow_state) VALUES (:taskId,'active') ON DUPLICATE KEY UPDATE task_id=VALUES(task_id)`, { taskId: result.insertId });
    await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,'Task created')`, { taskId: result.insertId, userId: Number(req.session.user.id) });
    await taskNotification({
      taskId: result.insertId,
      recipientId: assignedTo,
      actorId: Number(req.session.user.id),
      eventType: 'assigned',
      message: `${req.session.user.full_name} assigned “${title}” to you.`
    });
    res.json({ ok: true, id: result.insertId });
  } catch (error) { next(error); }
});

router.post('/api/uat/tasks/:id/status', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const taskId = idOf(req.params.id);
    const task = await getTask(taskId);
    if (!task) return res.sendStatus(404);
    const userId = Number(req.session.user.id);
    const isManager = management(req.session.user);
    if (!isManager && Number(task.assigned_to) !== userId) return res.sendStatus(403);
    const status = String(req.body.status || '');
    if (!['seen','in_progress','completed','cancelled'].includes(status) || (status === 'cancelled' && !isManager)) return res.status(400).json({ ok: false, error: 'That task status is not available.' });
    const completionNote = clean(req.body.completion_note, 4000);
    await db.execute(`INSERT INTO staff_task_workflow (task_id,workflow_state) VALUES (:taskId,'active') ON DUPLICATE KEY UPDATE task_id=VALUES(task_id)`, { taskId });
    if (status === 'completed') {
      if (!completionNote) return res.status(400).json({ ok: false, error: 'Add a short completion note.' });
      const selfAssigned = Number(task.created_by) === Number(task.assigned_to);
      await db.execute(`UPDATE staff_tasks SET status='completed',seen_at=COALESCE(seen_at,NOW()),started_at=COALESCE(started_at,NOW()),completed_at=NOW(),completion_note=:note WHERE id=:taskId`, { taskId, note: completionNote });
      await db.execute(`UPDATE staff_task_workflow SET workflow_state=:state,completed_by=:userId,completed_at=NOW(),acknowledged_by=:ackBy,acknowledged_at=:ackAt,returned_by=NULL,returned_at=NULL,return_reason=NULL WHERE task_id=:taskId`, {
        taskId, userId, state: selfAssigned ? 'accepted' : 'awaiting_sender_ack', ackBy: selfAssigned ? userId : null, ackAt: selfAssigned ? new Date() : null
      });
      await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`, { taskId, userId, comment: `Task completed — ${completionNote}` });
      if (!selfAssigned) await taskNotification({ taskId, recipientId: task.created_by, actorId: userId, eventType: 'completed', actionRequired: true, message: `${task.assigned_name} completed “${task.title}”. Review it.` });
    } else if (status === 'cancelled') {
      await db.execute(`UPDATE staff_tasks SET status='cancelled',completed_at=NOW() WHERE id=:taskId`, { taskId });
      await db.execute(`UPDATE staff_task_workflow SET workflow_state='cancelled' WHERE task_id=:taskId`, { taskId });
    } else {
      await db.execute(`UPDATE staff_tasks SET status=:status,seen_at=CASE WHEN :status IN ('seen','in_progress') THEN COALESCE(seen_at,NOW()) ELSE seen_at END,started_at=CASE WHEN :status='in_progress' THEN COALESCE(started_at,NOW()) ELSE started_at END WHERE id=:taskId`, { taskId, status });
      await db.execute(`UPDATE staff_task_workflow SET workflow_state=:state WHERE task_id=:taskId`, { taskId, state: status === 'in_progress' ? 'in_progress' : 'active' });
      await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`, { taskId, userId, comment: `Status changed to ${status.replaceAll('_',' ')}` });
      await taskNotification({ taskId, recipientId: task.created_by, actorId: userId, eventType: status, message: `${task.assigned_name} changed “${task.title}” to ${status.replaceAll('_',' ')}.` });
    }
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post('/api/uat/tasks/:id/decision', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const taskId = idOf(req.params.id);
    const task = await getTask(taskId);
    if (!task) return res.sendStatus(404);
    const userId = Number(req.session.user.id);
    if (!management(req.session.user) && Number(task.created_by) !== userId) return res.sendStatus(403);
    if (task.status !== 'completed' || task.workflow_state !== 'awaiting_sender_ack') return res.status(400).json({ ok: false, error: 'This task is not waiting for approval.' });
    const action = String(req.body.action || '');
    if (action === 'accept') {
      await db.execute(`UPDATE staff_task_workflow SET workflow_state='accepted',acknowledged_by=:userId,acknowledged_at=NOW(),return_reason=NULL WHERE task_id=:taskId`, { taskId, userId });
      await db.execute(`UPDATE staff_task_notifications SET resolved_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW()) WHERE task_id=:taskId AND recipient_staff_id=:userId AND action_required=1 AND resolved_at IS NULL`, { taskId, userId });
      await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,'Task accepted and archived')`, { taskId, userId });
      await taskNotification({ taskId, recipientId: task.assigned_to, actorId: userId, eventType: 'accepted', message: `${req.session.user.full_name} accepted “${task.title}”.` });
      return res.json({ ok: true });
    }
    if (action === 'return') {
      const reason = clean(req.body.reason, 2000);
      if (!reason) return res.status(400).json({ ok: false, error: 'Explain what still needs to be done.' });
      await db.execute(`UPDATE staff_tasks SET status='in_progress',completed_at=NULL,completion_note=NULL WHERE id=:taskId`, { taskId });
      await db.execute(`UPDATE staff_task_workflow SET workflow_state='returned',returned_by=:userId,returned_at=NOW(),return_reason=:reason,acknowledged_by=NULL,acknowledged_at=NULL WHERE task_id=:taskId`, { taskId, userId, reason });
      await db.execute(`UPDATE staff_task_notifications SET resolved_at=NOW(),is_read=1,read_at=COALESCE(read_at,NOW()) WHERE task_id=:taskId AND recipient_staff_id=:userId AND action_required=1 AND resolved_at IS NULL`, { taskId, userId });
      await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`, { taskId, userId, comment: `Returned for more work — ${reason}` });
      await taskNotification({ taskId, recipientId: task.assigned_to, actorId: userId, eventType: 'returned', actionRequired: true, message: `${req.session.user.full_name} returned “${task.title}”: ${reason}` });
      return res.json({ ok: true });
    }
    res.status(400).json({ ok: false, error: 'Choose accept or return.' });
  } catch (error) { next(error); }
});

router.post('/api/uat/tasks/:id/comments', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const taskId = idOf(req.params.id);
    const task = await getTask(taskId);
    if (!task) return res.sendStatus(404);
    const userId = Number(req.session.user.id);
    if (!management(req.session.user) && Number(task.assigned_to) !== userId && Number(task.created_by) !== userId) return res.sendStatus(403);
    const comment = clean(req.body.comment, 5000);
    if (!comment) return res.status(400).json({ ok: false, error: 'Type an update.' });
    await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment) VALUES (:taskId,:userId,:comment)`, { taskId, userId, comment });
    const recipients = new Set([Number(task.assigned_to), Number(task.created_by)]);
    recipients.delete(userId);
    for (const recipientId of recipients) await taskNotification({ taskId, recipientId, actorId: userId, eventType: 'comment', message: `${req.session.user.full_name} added an update to “${task.title}”: ${comment}` });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
