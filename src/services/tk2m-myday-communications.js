'use strict';
// Today's communications are a history of what was communicated today.
// Previous days' unfinished instructions are kept in Outstanding Work.
// Original CRM records are never deleted, auto-completed, or moved.
const {positiveId}=require('./tk2m-staff-attention');
const {getArchiveCutoffs}=require('./tk2m-communications-archive');
const {saClock}=require('./tk2m-communications-brief');
const CUTOVER_DAY='2026-11-17';
const ACTIVE_STATES="t.status IN ('unread','seen','in_progress')";
const str=(value,max=3000)=>String(value||'').slice(0,max);
const TASK_COLUMNS=`SELECT t.id,t.title,t.message,t.created_at,t.status,
  t.assigned_to,t.created_by,sender.full_name sender_name,
  recipient.full_name recipient_name,ack.acknowledged_at receipt_at
 FROM staff_tasks t
 JOIN staff_users sender ON sender.id=t.created_by
 JOIN staff_users recipient ON recipient.id=t.assigned_to
 LEFT JOIN staff_attention_acknowledgments ack ON
   ack.staff_id=t.assigned_to AND ack.source_kind='task' AND ack.source_id=t.id`;
function taskItem(t,staffId,isManagementTeam){
 const assignedTo=Number(t.assigned_to),createdBy=Number(t.created_by);
 return {
  kind:'task',id:Number(t.id),createdAt:t.created_at,
  sender:str(t.sender_name,120),recipient:str(t.recipient_name,120),
  direction:assignedTo===staffId?'received':createdBy===staffId?'sent':'team',
  assignedTo,createdBy,subject:str(t.title,170),
  text:str(t.message||t.title),acknowledged:Boolean(t.receipt_at),
  acknowledgedAt:t.receipt_at||null,status:str(t.status,30),
  canComplete:(assignedTo===staffId||isManagementTeam) && ['unread','seen','in_progress'].includes(String(t.status)),
  completeOnBehalf:isManagementTeam && assignedTo!==staffId &&
    ['unread','seen','in_progress'].includes(String(t.status)),
  canReply:true
 };
}
const byCreated=(a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()||b.id-a.id;
async function myDayCommunications(db,viewer,options={}){
 const staffId=positiveId(viewer);
 if(!staffId)throw Error('Invalid staff');
 // Router, never this service, grants manager/owner team view.
 const isTeam=options.scope==='team';
 const today=saClock(options.now||new Date()).day;
 const audience=isTeam?'1=1':'(t.created_by=:staffId OR t.assigned_to=:staffId)';
 const activeAudience=`${audience} AND t.type='task'
  AND NOT EXISTS (SELECT 1 FROM staff_attention_acknowledgments hidden
    WHERE hidden.staff_id=:staffId AND hidden.source_kind='hide_team_task'
      AND hidden.source_id=t.id)`;
 const params={staffId,today,cutover:CUTOVER_DAY};
 const [currentTasks]=await db.execute(
  `${TASK_COLUMNS} WHERE ${activeAudience}
   AND t.created_at>=:today
   AND t.status IN ('unread','seen','in_progress','completed')
   ORDER BY t.created_at DESC,t.id DESC LIMIT 150`,params);
 const carryWhere=`${activeAudience} AND ${ACTIVE_STATES}
    AND t.created_at>=:cutover AND t.created_at<:today`;
 const [carryTasks]=await db.execute(
  `${TASK_COLUMNS} WHERE ${carryWhere}
   ORDER BY t.created_at DESC,t.id DESC LIMIT 200`,params);
 const [[total]]=await db.execute(
  `SELECT COUNT(*) total FROM staff_tasks t WHERE ${carryWhere}`,params);
 const archive=await getArchiveCutoffs(db,staffId);
 const [chatRows]=await db.execute(
  `SELECT m.id,m.body,m.message_type,m.conversation_key,
       m.sender_staff_id,m.created_at,sender.full_name sender_name,
       peer.full_name peer_name
   FROM staff_chat_messages m
   JOIN staff_users sender ON sender.id=m.sender_staff_id
   LEFT JOIN staff_users peer ON peer.id=CASE WHEN m.conversation_key LIKE 'direct:%'
    THEN IF(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(m.conversation_key,':',2),':',-1) AS UNSIGNED)=:staffId,
      CAST(SUBSTRING_INDEX(m.conversation_key,':',-1) AS UNSIGNED),
      CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(m.conversation_key,':',2),':',-1) AS UNSIGNED))
    ELSE NULL END
   WHERE m.created_at>=:today AND m.id>:archivedChatId
    AND NOT EXISTS(SELECT 1 FROM staff_attention_acknowledgments hidden
      WHERE hidden.staff_id=:staffId AND hidden.source_kind='hide_chat'
        AND hidden.source_id=m.id)
    AND (m.sender_staff_id=:staffId OR m.conversation_key='office'
      OR m.conversation_key IN(SELECT CONCAT('direct:',LEAST(other.id,:staffId),':',
        GREATEST(other.id,:staffId)) FROM staff_users other
        WHERE other.is_active=1 AND other.id<>:staffId))
   ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,
  {...params,archivedChatId:archive.chatId});
 const chats=chatRows.map(m=>{
   const key=String(m.conversation_key||''),ids=key.split(':'),
     other=key==='office'?null:(Number(ids[1])===staffId?Number(ids[2]):Number(ids[1]));
   const isSender=Number(m.sender_staff_id)===staffId;
   return {
     kind:'legacy_chat',id:Number(m.id),createdAt:m.created_at,
     sender:str(m.sender_name,120),recipient:key==='office'?'Office':str(m.peer_name||'Colleague',120),
     direction:isSender?'sent':'received',subject:'Communication',
     text:m.message_type==='voice'?'Voice message':str(m.body,3000),
     acknowledged:false,status:'message',canComplete:false,canReply:true,
     conversation:key==='office'?'office':'direct:'+other
   };
 });
 // Live work gets the first three headline slots; completed items remain
 // available in Today's history via the left/right arrows.
 const prioritizeActive=(a,b)=>(a.status==='completed'?1:0)-(b.status==='completed'?1:0)||byCreated(a,b);
 const todayItems=[...currentTasks.map(t=>taskItem(t,staffId,isTeam)),...chats]
   .sort(prioritizeActive).slice(0,150);
 const outstanding=carryTasks.map(t=>taskItem(t,staffId,isTeam));
 return {ok:true,day:today,scope:isTeam?'team':'mine',cutover:CUTOVER_DAY,
   today:todayItems,outstanding,
   counts:{today:todayItems.length,outstanding:Number(total?.total||0)}};
}
module.exports={CUTOVER_DAY,myDayCommunications};
