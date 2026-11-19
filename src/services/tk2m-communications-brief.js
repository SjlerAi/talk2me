'use strict';
// One briefing for unfinished communications: both sender and recipient see
// their own open items. Recipients alone acknowledge the original red alert.
const {positiveId}=require('./tk2m-staff-attention');
const {getArchiveCutoffs}=require('./tk2m-communications-archive');
const CARRYOVER_CUTOVER='2026-11-17';
const TZ='Africa/Johannesburg';
function saClock(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(now).reduce((o,p)=>{if(p.type!=='literal')o[p.type]=p.value;return o},{});
  const day=parts.year+'-'+parts.month+'-'+parts.day;
  return {day,dayId:Number(day.replace(/-/g,'')),hour:Number(parts.hour),
    minute:Number(parts.minute),minutes:Number(parts.hour)*60+Number(parts.minute)};
}
function n(x){return Math.max(0,Number(x)||0);}
const activeSql="t.status IN ('unread','seen','in_progress')";
const visibleMessageSql=`
  m.sender_staff_id<>:staffId
  AND m.id>COALESCE(r.last_read_message_id,0)
  AND (m.conversation_key='office'
       OR m.conversation_key IN (
         SELECT CONCAT('direct:',LEAST(other.id,:staffId),':',GREATEST(other.id,:staffId))
         FROM staff_users other WHERE other.is_active=1 AND other.id<>:staffId))`;
async function dailyBrief(db,staff,now=new Date()){
 const staffId=positiveId(staff);
 if(!staffId)throw new Error('Invalid staff identity');
 const clock=saClock(now);
 const archive=await getArchiveCutoffs(db,staffId);
 const params={staffId,today:clock.day,archivedChatId:archive.chatId,cutover:CARRYOVER_CUTOVER};
 const [[tasks]]=await db.execute(
  `SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN t.created_at<:today THEN 1 ELSE 0 END),0) carryover,
    COALESCE(SUM(CASE WHEN t.created_at>=:today THEN 1 ELSE 0 END),0) received_today,
    COALESCE(SUM(CASE WHEN t.created_by=:staffId AND t.assigned_to<>:staffId THEN 1 ELSE 0 END),0) sent_total,
    COALESCE(SUM(CASE WHEN t.assigned_to=:staffId THEN 1 ELSE 0 END),0) received_total,
    COALESCE(SUM(CASE WHEN t.created_by=:staffId AND t.assigned_to<>:staffId AND t.created_at<:today THEN 1 ELSE 0 END),0) sent_carry,
    COALESCE(SUM(CASE WHEN t.assigned_to=:staffId AND t.created_at<:today THEN 1 ELSE 0 END),0) received_carry
   FROM staff_tasks t
   WHERE (t.assigned_to=:staffId OR t.created_by=:staffId)
     AND ${activeSql} AND t.type='task'
     AND t.created_at>=:cutover`,params);
 const [[messages]]=await db.execute(
  `SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN m.created_at<:today THEN 1 ELSE 0 END),0) carryover,
    COALESCE(SUM(CASE WHEN m.created_at>=:today THEN 1 ELSE 0 END),0) received_today
   FROM staff_chat_messages m
   LEFT JOIN staff_chat_reads r
     ON r.staff_id=:staffId AND r.conversation_key=m.conversation_key
   WHERE ${visibleMessageSql}
     AND NOT EXISTS (SELECT 1 FROM staff_attention_acknowledgments hidden
       WHERE hidden.staff_id=:staffId AND hidden.source_kind='hide_chat'
         AND hidden.source_id=m.id)
     AND m.id>:archivedChatId
     AND m.created_at>=DATE_SUB(NOW(),INTERVAL 2 DAY)`,params);
 const [taskRows]=await db.execute(
  `SELECT t.id,t.title,t.created_at,t.due_at,t.status,t.created_by,t.assigned_to,
     s.full_name sender,recipient.full_name recipient
   FROM staff_tasks t
   JOIN staff_users s ON s.id=t.created_by
   JOIN staff_users recipient ON recipient.id=t.assigned_to
   WHERE (t.assigned_to=:staffId OR t.created_by=:staffId)
     AND ${activeSql} AND t.type='task'
     AND t.created_at>=:cutover
   ORDER BY t.created_at DESC,t.id DESC LIMIT 8`,params);
 const [messageRows]=await db.execute(
  `SELECT m.id,m.body,m.created_at,s.full_name sender
   FROM staff_chat_messages m
   JOIN staff_users s ON s.id=m.sender_staff_id
   LEFT JOIN staff_chat_reads r
     ON r.staff_id=:staffId AND r.conversation_key=m.conversation_key
   WHERE ${visibleMessageSql}
     AND NOT EXISTS (SELECT 1 FROM staff_attention_acknowledgments hidden
       WHERE hidden.staff_id=:staffId AND hidden.source_kind='hide_chat'
         AND hidden.source_id=m.id)
     AND m.id>:archivedChatId
     AND m.created_at>=DATE_SUB(NOW(),INTERVAL 2 DAY)
   ORDER BY m.created_at DESC,m.id DESC LIMIT 6`,params);
 const [ackRows]=await db.execute(
  `SELECT source_kind FROM staff_attention_acknowledgments
   WHERE staff_id=:staffId AND source_id=:dayId
     AND source_kind IN ('morning','afternoon')`,{staffId,dayId:clock.dayId});
 const acknowledged=new Set(ackRows.map(r=>r.source_kind));
 const counts={
   tasks:n(tasks.total),unreadMessages:n(messages.total),
   carriedTasks:n(tasks.carryover),carriedMessages:n(messages.carryover),
   todayTasks:n(tasks.received_today),todayMessages:n(messages.received_today),
   sent:n(tasks.sent_total),received:n(tasks.received_total)+n(messages.total),
   sentCarried:n(tasks.sent_carry),receivedCarried:n(tasks.received_carry)+n(messages.carryover)
 };
 const morningEligible=clock.minutes<16*60+30&&(counts.carriedTasks+counts.carriedMessages)>0;
 const afternoonEligible=clock.minutes>=16*60+30&&(counts.tasks+counts.unreadMessages)>0;
 return {
  ok:true,day:clock.day,dayId:clock.dayId,localTime:String(clock.hour).padStart(2,'0')+':'+String(clock.minute).padStart(2,'0'),
  counts,prompts:{
    morning:{eligible:morningEligible,pending:morningEligible&&!acknowledged.has('morning')},
    afternoon:{eligible:afternoonEligible,pending:afternoonEligible&&!acknowledged.has('afternoon')}
  },
  tasks:taskRows.map(t=>({
    id:Number(t.id),title:String(t.title||'Communication').slice(0,180),
    sender:String(t.sender||'Staff'),recipient:String(t.recipient||'Staff'),
    createdAt:t.created_at,dueAt:t.due_at,status:t.status,
    direction:Number(t.created_by)===staffId&&Number(t.assigned_to)!==staffId?'sent':'received'
  })),
  messages:messageRows.map(m=>({id:Number(m.id),preview:String(m.body||'New voice message').slice(0,140),sender:String(m.sender||'Staff'),createdAt:m.created_at}))
 };
}
async function acknowledgeDailyBrief(db,staffId,kind,now=new Date()){
 const id=positiveId(staffId);
 if(!id||!['morning','afternoon'].includes(String(kind||'')))return {status:400};
 const summary=await dailyBrief(db,id,now);
 if(!summary.prompts[kind].eligible)return {status:409};
 await db.execute(
  `INSERT IGNORE INTO staff_attention_acknowledgments
   (staff_id,source_kind,source_id,source_key,ack_method)
   VALUES (:staffId,:kind,:sourceId,'communications-brief','reviewed')`,
  {staffId:id,kind,sourceId:summary.dayId});
 return {status:200};
}
module.exports={saClock,dailyBrief,acknowledgeDailyBrief};
