'use strict';
// Persistent daily briefing receipts: reuse the existing recipient-scoped
// staff_attention_acknowledgments table; do not modify task/message status.
const {positiveId}=require('./tk2m-staff-attention');
const TZ='Africa/Johannesburg';
function saClock(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(now).reduce((m,p)=>{if(p.type!=='literal')m[p.type]=p.value;return m},{});
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
 const clock=saClock(now),params={staffId,today:clock.day};
 const [[tasks]]=await db.execute(
  `SELECT COUNT(*) total,
     COALESCE(SUM(CASE WHEN t.created_at<:today THEN 1 ELSE 0 END),0) carryover,
     COALESCE(SUM(CASE WHEN t.created_at>=:today THEN 1 ELSE 0 END),0) received_today
   FROM staff_tasks t
   WHERE t.assigned_to=:staffId AND ${activeSql}`,params);
 const [[messages]]=await db.execute(
  `SELECT COUNT(*) total,
     COALESCE(SUM(CASE WHEN m.created_at<:today THEN 1 ELSE 0 END),0) carryover,
     COALESCE(SUM(CASE WHEN m.created_at>=:today THEN 1 ELSE 0 END),0) received_today
   FROM staff_chat_messages m
   LEFT JOIN staff_chat_reads r
     ON r.staff_id=:staffId AND r.conversation_key=m.conversation_key
   WHERE ${visibleMessageSql}`,params);
 const [taskRows]=await db.execute(
  `SELECT t.id,t.title,t.created_at,t.due_at,t.status,s.full_name sender
   FROM staff_tasks t JOIN staff_users s ON s.id=t.created_by
   WHERE t.assigned_to=:staffId AND ${activeSql}
   ORDER BY t.created_at DESC,t.id DESC LIMIT 6`,params);
 const [messageRows]=await db.execute(
  `SELECT m.id,m.body,m.created_at,s.full_name sender
   FROM staff_chat_messages m
   JOIN staff_users s ON s.id=m.sender_staff_id
   LEFT JOIN staff_chat_reads r
     ON r.staff_id=:staffId AND r.conversation_key=m.conversation_key
   WHERE ${visibleMessageSql}
   ORDER BY m.created_at DESC,m.id DESC LIMIT 6`,params);
 const [ackRows]=await db.execute(
  `SELECT source_kind FROM staff_attention_acknowledgments
   WHERE staff_id=:staffId AND source_id=:dayId
     AND source_kind IN ('morning','afternoon')`,{staffId,dayId:clock.dayId});
 const acknowledged=new Set(ackRows.map(row=>row.source_kind));
 const counts={
   tasks:n(tasks.total),unreadMessages:n(messages.total),
   carriedTasks:n(tasks.carryover),carriedMessages:n(messages.carryover),
   todayTasks:n(tasks.received_today),todayMessages:n(messages.received_today)
 };
 const morningEligible=clock.minutes<16*60+30&&(counts.carriedTasks+counts.carriedMessages)>0;
 const afternoonEligible=clock.minutes>=16*60+30&&(counts.tasks+counts.unreadMessages)>0;
 const prompts={
   morning:{eligible:morningEligible,pending:morningEligible&&!acknowledged.has('morning')},
   afternoon:{eligible:afternoonEligible,pending:afternoonEligible&&!acknowledged.has('afternoon')}
 };
 return {
  ok:true,day:clock.day,dayId:clock.dayId,localTime:String(clock.hour).padStart(2,'0')+':'+String(clock.minute).padStart(2,'0'),
  counts,prompts,
  tasks:taskRows.map(t=>({id:Number(t.id),title:String(t.title||'Task').slice(0,180),sender:String(t.sender||'Staff'),createdAt:t.created_at,dueAt:t.due_at,status:t.status})),
  messages:messageRows.map(m=>({id:Number(m.id),preview:String(m.body||'New voice message').slice(0,140),sender:String(m.sender||'Staff'),createdAt:m.created_at}))
 };
}
async function acknowledgeDailyBrief(db,staffId,kind,now=new Date()){
 const id=positiveId(staffId);
 if(!id || !['morning','afternoon'].includes(String(kind||'')))return {status:400};
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
