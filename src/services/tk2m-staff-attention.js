'use strict';

// Popup receipt != read receipt != task completion.
const {getArchiveCutoffs}=require('./tk2m-communications-archive');
// Only delivery events from the last seven rolling days may interrupt staff.
// Older work remains in the existing CRM inboxes and is NEVER auto-acknowledged.
const RECENT_ALERT_DAYS = 7;
const positiveId = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function chatToken(userId, key) {
  if (key === 'office') return 'office';
  const match = /^direct:(\d+):(\d+)$/.exec(String(key || ''));
  if (!match) return null;
  const a = Number(match[1]), b = Number(match[2]), u = Number(userId);
  if (!positiveId(a) || !positiveId(b) || a >= b || (a !== u && b !== u)) return null;
  return 'direct:' + (a === u ? b : a);
}

function composeAlerts(userId, chatRows = [], taskRows = [], updateRows = []) {
  const alerts = [], seenConversation = new Set();
  for (const m of chatRows) {
    const conversation = chatToken(userId, m.conversation_key);
    if (!conversation || seenConversation.has(conversation)) continue;
    seenConversation.add(conversation);
    alerts.push({
      kind:'chat', id:Number(m.id), conversation,
      sender:String(m.sender_name || 'Colleague'),
      title:'New message',
      preview:m.message_type === 'voice' ? 'New voice message' : String(m.body || '').slice(0,350),
      createdAt:m.created_at, priority:'normal'
    });
  }
  for (const t of taskRows) {
    alerts.push({
      kind:'task', id:Number(t.id), taskId:Number(t.id),
      sender:String(t.sender_name || 'Colleague'),
      title:t.type === 'notification' ? 'New message' : 'New task',
      preview:String(t.message || t.title || '').slice(0,350),
      createdAt:t.created_at,
      priority:['urgent','high'].includes(t.priority) ? t.priority : 'normal'
    });
  }
  for (const n of updateRows) {
    alerts.push({
      kind:'update', id:Number(n.id), taskId:Number(n.task_id),
      sender:String(n.sender_name || 'Colleague'),
      title:Number(n.action_required) ? 'Task requires action' : 'Task update',
      preview:String(n.notification_text || '').slice(0,350),
      createdAt:n.created_at,
      priority:Number(n.action_required) ? 'high' : 'normal'
    });
  }
  const importance = {urgent:3, high:2, normal:1};
  return alerts.sort((a,b) =>
    (importance[b.priority] || 1) - (importance[a.priority] || 1)
    || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    || b.id-a.id
  ).slice(0,15);
}

async function pendingAlerts(db, userId) {
  const staffId = positiveId(userId);
  if (!staffId) throw new Error('Invalid staff identity');
  const archive=await getArchiveCutoffs(db,staffId);
  const [chatRows] = await db.execute(
    `SELECT m.id,m.conversation_key,m.message_type,m.body,m.created_at,
            sender.full_name sender_name
       FROM staff_chat_messages m
       JOIN staff_users sender ON sender.id=m.sender_staff_id
       LEFT JOIN staff_chat_reads r
         ON r.staff_id=:staffId AND r.conversation_key=m.conversation_key
      WHERE m.sender_staff_id<>:staffId
        AND m.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND m.id>GREATEST(COALESCE(r.last_read_message_id,0),:archivedChatId)
        AND (m.conversation_key='office'
             OR m.conversation_key IN (
               SELECT CONCAT('direct:',LEAST(other.id,:staffId),':',GREATEST(other.id,:staffId))
                 FROM staff_users other WHERE other.is_active=1 AND other.id<>:staffId))
        AND NOT EXISTS (
          SELECT 1 FROM staff_attention_acknowledgments a
           WHERE a.staff_id=:staffId AND a.source_kind='chat'
             AND a.source_key=m.conversation_key AND a.source_id>=m.id)
      ORDER BY m.id DESC LIMIT 40`, {staffId,archivedChatId:archive.chatId}
  );
  const [taskRows] = await db.execute(
    `SELECT t.id,t.type,t.title,t.message,t.priority,t.created_at,
            sender.full_name sender_name
       FROM staff_tasks t
       JOIN staff_users sender ON sender.id=t.created_by
       LEFT JOIN staff_attention_acknowledgments a
         ON a.staff_id=:staffId AND a.source_kind='task' AND a.source_id=t.id
      WHERE t.assigned_to=:staffId AND t.created_by<>:staffId
        AND t.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND (t.type<>'notification' OR t.id>:archivedTaskId)
        AND t.status='unread' AND a.id IS NULL
      ORDER BY t.created_at DESC,t.id DESC LIMIT 20`, {staffId,archivedTaskId:archive.notificationTaskId}
  );
  const [updateRows] = await db.execute(
    `SELECT n.id,n.task_id,n.notification_text,n.action_required,n.created_at,
            COALESCE(actor.full_name,sender.full_name) sender_name
       FROM staff_task_notifications n
       JOIN staff_tasks t ON t.id=n.task_id
       JOIN staff_users sender ON sender.id=t.created_by
       LEFT JOIN staff_users actor ON actor.id=n.actor_staff_id
       LEFT JOIN staff_attention_acknowledgments a
         ON a.staff_id=:staffId AND a.source_kind='update' AND a.source_id=n.id
      WHERE n.recipient_staff_id=:staffId AND n.resolved_at IS NULL
        AND n.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND n.id>:archivedWorkflowId
        AND n.is_read=0 AND a.id IS NULL
      ORDER BY n.created_at DESC,n.id DESC LIMIT 20`, {staffId,archivedWorkflowId:archive.workflowId}
  );
  return composeAlerts(staffId, chatRows, taskRows, updateRows);
}

async function acknowledgeAlert(db, userId, kind, sourceId, method) {
  const staffId = positiveId(userId), id = positiveId(sourceId);
  if (!staffId || !id || !['chat','task','update'].includes(kind) || !['dismiss','open'].includes(method)) {
    return {status:400};
  }
  let key;
  if (kind === 'chat') {
    const [[message]] = await db.execute(
      'SELECT conversation_key,sender_staff_id FROM staff_chat_messages WHERE id=:id LIMIT 1', {id});
    if (!message || Number(message.sender_staff_id) === staffId
        || !chatToken(staffId,message.conversation_key)) return {status:404};
    key=message.conversation_key;
  } else if (kind === 'task') {
    const [[task]] = await db.execute(
      'SELECT id FROM staff_tasks WHERE id=:id AND assigned_to=:staffId LIMIT 1', {id,staffId});
    if (!task) return {status:404};
    key=String(id);
  } else {
    const [[notice]] = await db.execute(
      'SELECT id FROM staff_task_notifications WHERE id=:id AND recipient_staff_id=:staffId LIMIT 1', {id,staffId});
    if (!notice) return {status:404};
    key=String(id);
  }
  await db.execute(
    `INSERT IGNORE INTO staff_attention_acknowledgments
      (staff_id,source_kind,source_id,source_key,ack_method)
     VALUES (:staffId,:kind,:id,:key,:method)`,
    {staffId,kind,id,key,method}
  );
  return {status:200};
}

module.exports = {RECENT_ALERT_DAYS,positiveId,chatToken,composeAlerts,pendingAlerts,acknowledgeAlert};
