'use strict';
const db=require('../config/db');
const chatAudit=require('./staff-chat-audit');
const idOf=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
function elapsedLabel(first,second){
 if(!first||!second)return null;
 const minutes=Math.round((new Date(second)-new Date(first))/60000);
 if(!Number.isFinite(minutes)||minutes<0)return null;
 if(minutes<60)return minutes+' min';
 if(minutes<2880)return (minutes/60).toFixed(1)+' h';
 return (minutes/1440).toFixed(1)+' days';
}
// MySQL DATETIME values represent Johannesburg business time. Compare using
// the same local date/time, not UTC midnight (which loses midnight-02:00 events).
const timeParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',
 year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',
 minute:'2-digit',second:'2-digit'});
const isInside=(x,r)=>{
 if(!x)return false;
 const v=timeParts.formatToParts(new Date(x));
 const m=Object.fromEntries(v.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const local=m.year+'-'+m.month+'-'+m.day+' '+m.hour+':'+m.minute+':'+m.second;
 return local>=r.from && local<r.to;
};
function recipientFrom(key,sender){
 const m=String(key||'').match(/^direct:(\d+):(\d+)$/);
 if(!m||Number(m[1])===Number(m[2]))return null;
 if(Number(sender)===Number(m[1]))return Number(m[2]);
 if(Number(sender)===Number(m[2]))return Number(m[1]);
 return null;
}
function addTo(map,id,key,amount=1){
 if(!id)return;
 const n=Number(id);
 if(!map.has(n))map.set(n,{messages_in:0,office_in:0,messages_sent:0,
  receipts_created:0,linked_replies:0,tasks_received:0,tasks_issued:0,tasks_opened:0,
  tasks_completed:0,task_comments:0,task_approvals:0});
 map.get(n)[key]+=Number(amount||0);
}
async function overview(r){
 await chatAudit.ensureSchema();
 const totals=new Map();
 const [messages]=await db.query(
  'SELECT conversation_key,sender_staff_id,COUNT(*) n FROM staff_chat_messages '+
  'WHERE created_at>=? AND created_at<? GROUP BY conversation_key,sender_staff_id',
  [r.from,r.to]);
 for(const m of messages){
  addTo(totals,m.sender_staff_id,'messages_sent',m.n);
  const recipient=recipientFrom(m.conversation_key,m.sender_staff_id);
  if(recipient)addTo(totals,recipient,'messages_in',m.n);
 }
 const [read]=await db.query('SELECT staff_id,COUNT(*) n FROM staff_chat_read_receipts '+
  'WHERE read_at>=? AND read_at<? GROUP BY staff_id',[r.from,r.to]);
 for(const x of read)addTo(totals,x.staff_id,'receipts_created',x.n);
 const [reply]=await db.query('SELECT replying_staff_id,COUNT(*) n FROM staff_chat_reply_links '+
  'WHERE linked_at>=? AND linked_at<? GROUP BY replying_staff_id',[r.from,r.to]);
 for(const x of reply)addTo(totals,x.replying_staff_id,'linked_replies',x.n);
 const [tasks]=await db.query(
  'SELECT assigned_to,COUNT(*) n FROM staff_tasks WHERE created_at>=? AND created_at<? GROUP BY assigned_to',
  [r.from,r.to]);
 for(const x of tasks)addTo(totals,x.assigned_to,'tasks_received',x.n);
 const [issued]=await db.query(
  'SELECT created_by,COUNT(*) n FROM staff_tasks WHERE created_at>=? AND created_at<? GROUP BY created_by',
  [r.from,r.to]);
 for(const x of issued)addTo(totals,x.created_by,'tasks_issued',x.n);
 const [opened]=await db.query(
  'SELECT assigned_to,COUNT(*) n FROM staff_tasks WHERE seen_at>=? AND seen_at<? GROUP BY assigned_to',
  [r.from,r.to]);
 for(const x of opened)addTo(totals,x.assigned_to,'tasks_opened',x.n);
 const [completed]=await db.query(
  'SELECT COALESCE(w.completed_by,t.assigned_to) actor,COUNT(*) n FROM staff_tasks t '+
  'LEFT JOIN staff_task_workflow w ON w.task_id=t.id '+
  "WHERE t.status='completed' AND t.completed_at>=? AND t.completed_at<? "+
  'GROUP BY actor',[r.from,r.to]);
 for(const x of completed)addTo(totals,x.actor,'tasks_completed',x.n);
 const [comments]=await db.query(
  'SELECT staff_id,COUNT(*) n FROM staff_task_comments '+
  "WHERE created_at>=? AND created_at<? AND comment<>'Opened / seen' "+
  "AND comment<>'Task accepted and archived' AND comment NOT LIKE 'Status changed to %' "+
  "AND comment NOT LIKE 'Task completed %' GROUP BY staff_id",[r.from,r.to]);
 for(const x of comments)addTo(totals,x.staff_id,'task_comments',x.n);
 const [approvals]=await db.query(
  'SELECT acknowledged_by staff_id,COUNT(*) n FROM staff_task_workflow WHERE '+
  'acknowledged_by IS NOT NULL AND acknowledged_at>=? AND acknowledged_at<? GROUP BY acknowledged_by',
  [r.from,r.to]);
 for(const x of approvals)addTo(totals,x.staff_id,'task_approvals',x.n);
 return totals;
}
async function person(r,staffId){
 await chatAudit.ensureSchema();
 const id=idOf(staffId);
 if(!id)throw Error('Invalid staff');
 const key1='direct:'+id+':%',key2='direct:%:'+id;
 const [raw]=await db.query(
  'SELECT m.id,m.conversation_key,m.sender_staff_id,m.message_type,m.created_at,'+
  "COALESCE(s.full_name,'Unknown staff') sender_name,"+
  'rr.read_at,c.last_read_message_id,c.updated_at cursor_at '+
  'FROM staff_chat_messages m LEFT JOIN staff_users s ON s.id=m.sender_staff_id '+
  'LEFT JOIN staff_chat_read_receipts rr ON rr.message_id=m.id AND rr.staff_id=? '+
  'LEFT JOIN staff_chat_reads c ON c.staff_id=? AND c.conversation_key=m.conversation_key '+
  "WHERE m.created_at>=? AND m.created_at<? AND (m.conversation_key='office' "+
  'OR m.conversation_key LIKE ? OR m.conversation_key LIKE ?) '+
  'ORDER BY m.id DESC LIMIT 400',
  [id,id,r.from,r.to,key1,key2]);
 const incoming=raw.filter(m=>Number(m.sender_staff_id)!==id&&
  (m.conversation_key==='office'||recipientFrom(m.conversation_key,m.sender_staff_id)===id));
 const outbound=raw.filter(m=>Number(m.sender_staff_id)===id);
 const msgIds=incoming.map(m=>Number(m.id));
 let links=[];
 if(msgIds.length){
  const [rows]=await db.query('SELECT l.incoming_message_id,l.reply_message_id,l.linked_at,'+
   'm.created_at reply_at FROM staff_chat_reply_links l '+
   'JOIN staff_chat_messages m ON m.id=l.reply_message_id '+
   'WHERE l.replying_staff_id=? AND l.incoming_message_id IN ('+
   msgIds.map(()=>'?').join(',')+') ORDER BY l.reply_message_id',
   [id,...msgIds]);
  links=rows;
 }
 const linkMap=new Map();
 for(const l of links){if(!linkMap.has(Number(l.incoming_message_id)))linkMap.set(Number(l.incoming_message_id),l);}
 for(const m of incoming){
  const receipt=m.read_at;
  const older=Number(m.last_read_message_id||0)>=Number(m.id);
  m.kind=m.conversation_key==='office'?'Office broadcast':'Direct';
  m.read_status=receipt?'opened_recorded':older?'legacy_marked_read':'not_marked_read';
  m.reply=linkMap.get(Number(m.id))||null;
  m.reply_after=m.reply?elapsedLabel(m.created_at,m.reply.reply_at):null;
  m.reply_status=m.kind==='Office broadcast'?'not_directly_attributable':
    m.reply?'linked_reply':'no_linked_reply';
 }
 const [sentLinks]=await db.query(
  'SELECT l.reply_message_id,l.incoming_message_id,l.linked_at '+
  'FROM staff_chat_reply_links l WHERE l.replying_staff_id=? AND l.linked_at>=? AND l.linked_at<?',
  [id,r.from,r.to]);
 const bySent=new Map(sentLinks.map(x=>[Number(x.reply_message_id),x]));
 const [people]=await db.query('SELECT id,full_name FROM staff_users');
 const names=new Map(people.map(x=>[Number(x.id),x.full_name]));
 for(const m of outbound){
  m.reply=bySent.get(Number(m.id))||null;
  m.kind=m.conversation_key==='office'?'Office broadcast':'Direct';
  m.recipient_name=m.kind==='Direct'
   ?(names.get(recipientFrom(m.conversation_key,id))||'Other staff member')
   :'Office group';
 }
 const [tasks]=await db.query(
  'SELECT t.id,t.title,t.type,t.status,t.priority,t.created_at,t.seen_at,t.started_at,'+
  't.completed_at,t.due_at,t.created_by,t.assigned_to,'+
  "COALESCE(creator.full_name,'Unknown staff') created_by_name,"+
  "COALESCE(assignee.full_name,'Unknown staff') assigned_to_name,"+
  "COALESCE(w.workflow_state,'active') workflow_state,w.completed_by,w.completed_at workflow_completed_at,"+
  'w.acknowledged_by,w.acknowledged_at,w.returned_at '+
  'FROM staff_tasks t LEFT JOIN staff_users creator ON creator.id=t.created_by '+
  'LEFT JOIN staff_users assignee ON assignee.id=t.assigned_to '+
  'LEFT JOIN staff_task_workflow w ON w.task_id=t.id '+
  'WHERE (t.assigned_to=? OR t.created_by=?) AND ( '+
  '(t.created_at>=? AND t.created_at<?) OR (t.seen_at>=? AND t.seen_at<?) OR '+
  '(t.started_at>=? AND t.started_at<?) OR (t.completed_at>=? AND t.completed_at<?) OR '+
  '(w.acknowledged_at>=? AND w.acknowledged_at<?) OR '+
  '(w.returned_at>=? AND w.returned_at<?) OR '+
  'EXISTS(SELECT 1 FROM staff_task_comments c WHERE c.task_id=t.id AND c.staff_id=? '+
  'AND c.created_at>=? AND c.created_at<?)) '+
  'ORDER BY t.created_at DESC,t.id DESC LIMIT 250',
  [id,id,r.from,r.to,r.from,r.to,r.from,r.to,r.from,r.to,
   r.from,r.to,r.from,r.to,id,r.from,r.to]);
 const taskIds=tasks.map(x=>Number(x.id));
 const responses=new Map();
 if(taskIds.length){
  const [comments]=await db.query(
   'SELECT task_id,COUNT(*) n,MAX(created_at) last_comment '+
   'FROM staff_task_comments WHERE staff_id=? AND created_at>=? AND created_at<? '+
   "AND comment<>'Opened / seen' AND comment<>'Task accepted and archived' "+
   "AND comment NOT LIKE 'Status changed to %' AND comment NOT LIKE 'Task completed %' "+
   'AND task_id IN ('+taskIds.map(()=>'?').join(',')+') GROUP BY task_id',
   [id,r.from,r.to,...taskIds]);
  for(const c of comments)responses.set(Number(c.task_id),c);
 }
 for(const t of tasks){
  t.comments_in_week=Number(responses.get(Number(t.id))?.n||0);
  t.open_after=t.seen_at?elapsedLabel(t.created_at,t.seen_at):null;
  t.received_in_week=isInside(t.created_at,r);
  t.opened_in_week=isInside(t.seen_at,r);
  t.completed_in_week=t.status==='completed'&&isInside(t.completed_at,r)&&
   (Number(t.completed_by)===id||(!t.completed_by&&Number(t.assigned_to)===id));
 }
 const metrics={
  incoming_direct:incoming.filter(x=>x.kind==='Direct').length,
  incoming_office:incoming.filter(x=>x.kind==='Office broadcast').length,
  messages_marked_read:incoming.filter(x=>x.read_status!=='not_marked_read').length,
  newly_recorded_reads:incoming.filter(x=>x.read_at&&isInside(x.read_at,r)).length,
  linked_incoming_replies:incoming.filter(x=>x.reply).length,
  outbound_messages:outbound.length,
  outbound_linked_replies:outbound.filter(x=>x.reply).length,
  tasks_received:tasks.filter(x=>Number(x.assigned_to)===id&&x.received_in_week).length,
  tasks_issued:tasks.filter(x=>Number(x.created_by)===id&&x.received_in_week).length,
  tasks_opened:tasks.filter(x=>Number(x.assigned_to)===id&&x.opened_in_week).length,
  tasks_completed:tasks.filter(x=>x.completed_in_week).length,
  tasks_with_written_response:tasks.filter(x=>x.comments_in_week>0).length,
  task_comments:tasks.reduce((sum,t)=>sum+t.comments_in_week,0),
  pending_of_week:tasks.filter(x=>Number(x.assigned_to)===id&&x.received_in_week&&
    ['unread','seen','in_progress'].includes(x.status)).length,
  unread_of_week:tasks.filter(x=>Number(x.assigned_to)===id&&x.received_in_week&&x.status==='unread').length
 };
 return{incoming,outbound,tasks,metrics};
}
module.exports={overview,person,recipientFrom};
