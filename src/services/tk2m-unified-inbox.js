'use strict';
// A single recipient-scoped Communications feed. Existing historical chat
// messages remain readable, but all new sends use the actionable task record.
const {positiveId}=require('./tk2m-staff-attention');
const {getArchiveCutoffs}=require('./tk2m-communications-archive');
const short=(v,len=500)=>String(v||'').slice(0,len);
async function listInbox(db,viewer,options={}){
 const staffId=positiveId(viewer);
 if(!staffId)throw new Error('Invalid staff identity');
 // Team access must be authorised by the router before it calls this service.
 const isTeam=options.scope==='team';
 const taskAudience=isTeam?'1=1':'(t.assigned_to=:staffId OR t.created_by=:staffId)';
 const archive=await getArchiveCutoffs(db,staffId);
 const params={staffId,archivedChatId:archive.chatId};
 const [tasks]=await db.execute(
  `SELECT t.id,t.title,t.message,t.created_at,t.status,t.assigned_to,t.created_by,
      sender.full_name sender_name,recipient.full_name recipient_name,
      ack.acknowledged_at receipt_at
    FROM staff_tasks t
    JOIN staff_users sender ON sender.id=t.created_by
    JOIN staff_users recipient ON recipient.id=t.assigned_to
    LEFT JOIN staff_attention_acknowledgments ack ON
      ack.staff_id=t.assigned_to AND ack.source_kind='task' AND ack.source_id=t.id
    WHERE ${taskAudience}
      AND NOT EXISTS(SELECT 1 FROM staff_attention_acknowledgments hidden
        WHERE hidden.staff_id=:staffId AND hidden.source_kind='hide_team_task'
          AND hidden.source_id=t.id)
      AND t.type='task' AND t.status IN ('unread','seen','in_progress')
      AND t.created_at>=DATE_SUB(NOW(),INTERVAL 2 DAY)
    ORDER BY t.created_at DESC,t.id DESC LIMIT 100`,params);
 const [messages]=await db.execute(
  `SELECT m.id,m.body,m.message_type,m.conversation_key,m.sender_staff_id,m.created_at,
      sender.full_name sender_name,peer.full_name peer_name
    FROM staff_chat_messages m
    JOIN staff_users sender ON sender.id=m.sender_staff_id
    LEFT JOIN staff_users peer ON peer.id=CASE
      WHEN m.conversation_key LIKE 'direct:%'
       THEN IF(
         CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(m.conversation_key,':',2),':',-1) AS UNSIGNED)=:staffId,
         CAST(SUBSTRING_INDEX(m.conversation_key,':',-1) AS UNSIGNED),
         CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(m.conversation_key,':',2),':',-1) AS UNSIGNED))
      ELSE NULL END
    WHERE m.id>:archivedChatId
      AND m.created_at>=DATE_SUB(NOW(),INTERVAL 2 DAY)
      AND NOT EXISTS (SELECT 1 FROM staff_attention_acknowledgments hidden
        WHERE hidden.staff_id=:staffId AND hidden.source_kind='hide_chat'
          AND hidden.source_id=m.id)
      AND (m.sender_staff_id=:staffId
        OR m.conversation_key='office'
        OR m.conversation_key IN (
          SELECT CONCAT('direct:',LEAST(other.id,:staffId),':',GREATEST(other.id,:staffId))
          FROM staff_users other WHERE other.is_active=1 AND other.id<>:staffId))
    ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,params);
 const result=[
   ...tasks.map(t=>({
    kind:'task',id:Number(t.id),createdAt:t.created_at,
    sender:short(t.sender_name,120),recipient:short(t.recipient_name,120),
    direction:Number(t.assigned_to)===staffId?'received':(Number(t.created_by)===staffId?'sent':'team'),
    assignedTo:Number(t.assigned_to),createdBy:Number(t.created_by),
    subject:short(t.title,170),text:short(t.message||t.title,2500),
    acknowledged:!!t.receipt_at,acknowledgedAt:t.receipt_at||null,
    status:t.status,canComplete:Number(t.assigned_to)===staffId
   })),
   ...messages.map(m=>{
    const self=Number(m.sender_staff_id)===staffId;
    const key=String(m.conversation_key||'');
    const ids=key.split(':');
    const other=key==='office'?null:(Number(ids[1])===staffId?Number(ids[2]):Number(ids[1]));
    return {
      kind:'legacy_chat',id:Number(m.id),createdAt:m.created_at,
      sender:short(m.sender_name,120),recipient:key==='office'?'Office':short(m.peer_name||'Colleague',120),
      direction:self?'sent':'received',
      subject:'Communication',text:m.message_type==='voice'?'Voice message':short(m.body,2500),
      acknowledged:false,status:'message',canComplete:false,
      conversation:key==='office'?'office':'direct:'+other
    };
   })
 ].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()||b.id-a.id).slice(0,120);
 return {ok:true,windowDays:2,scope:isTeam?'team':'mine',items:result,openCount:tasks.length,
   counts:{received:result.filter(x=>x.direction==='received').length,sent:result.filter(x=>x.direction==='sent').length}};
}
module.exports={listInbox};
