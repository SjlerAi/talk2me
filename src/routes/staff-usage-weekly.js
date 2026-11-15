'use strict';
// Read-only weekly staff audit. External portal content/URLs are never captured.
const express=require('express');
const db=require('../config/db');
const {requireOwner}=require('../middleware/auth');
const communication=require('../services/staff-communication-usage');
const router=express.Router();
const pad=n=>String(n).padStart(2,'0');
function iso(d){return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());}
function plus(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return iso(d);}
function monday(raw){
 const d=new Date(raw+'T12:00:00Z');
 if(Number.isNaN(d.getTime())||iso(d)!==raw)return null;
 d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return iso(d);
}
function currentWeek(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',
 year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const values=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return monday(values.year+'-'+values.month+'-'+values.day);
}
function chooseWeek(raw){
 if(!raw)return currentWeek();
 const date=String(raw);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const week=monday(date);
 if(!week||week<'2025-01-01'||week>plus(currentWeek(),7))return null;
 return week;
}
function range(week){return{from:week+' 00:00:00',to:plus(week,7)+' 00:00:00',
 start:week,end:plus(week,6),previous:plus(week,-7),next:plus(week,7)};}
function csvValue(value){
 let s=String(value==null?'':value).replace(/[\r\n]+/g,' ').slice(0,300);
 if(/^\s*[=+\-@]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
function formatAt(value){
 if(!value)return '—';
 return new Date(value).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',
 hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
const eventKind=e=>String(e).startsWith('external_')?'External portal':
 String(e).startsWith('window_')?'CRM window':e==='screen_view'?'Screen view':
 e==='http_action'?'Saved request':e==='feature_open'?'Launcher click':'CRM usage';
function safeTarget(row){
 if(row.source==='audit')return [row.entity_type,row.entity_id].filter(Boolean).join(' #')||'CRM record';
 return row.route_path||row.screen_key||'CRM';
}
// Reconstruct a timestamped timeline from authoritative message/task records
// in addition to ordinary screen visits. No message body or comment is selected.
function timelineSource(r,staffId){
 const parts=[],params=[];
 const push=(select,from,dateExpr,staffExpr,extra='')=>{
  parts.push(select+' FROM '+from+' WHERE '+dateExpr+'>=? AND '+dateExpr+'<? '+
    (staffId?' AND '+staffExpr+'=? ':'')+extra);
  params.push(r.from,r.to,...(staffId?[staffId]:[]));
 };
 push(
  "SELECT e.occurred_at event_at,e.staff_id,"+
  "CASE WHEN e.event_type='http_action' THEN 'server_request' ELSE 'browser_report' END source,"+
  "e.event_type event,e.screen_key,e.route_path,"+
  "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json,'$.window_key')),'null'),'') window_key,"+
  "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json,'$.window_kind')),'null'),'') window_kind,"+
  "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json,'$.outcome')),'null'),'') outcome,"+
  'e.entity_type,e.entity_id',
  'crm_usage_events e','e.occurred_at','e.staff_id');
 push(
  "SELECT a.created_at event_at,a.staff_id,'audit' source,a.action_type event,"+
  'NULL screen_key,NULL route_path,NULL window_key,NULL window_kind,NULL outcome,a.entity_type,a.entity_id',
  'audit_log a','a.created_at','a.staff_id');
 push(
  "SELECT m.created_at event_at,m.sender_staff_id staff_id,'chat' source,'message_sent' event,"+
  "'work_messages' screen_key,'/api/uat/chat/messages' route_path,"+
  "NULL window_key,NULL window_kind,NULL outcome,'staff_chat_messages' entity_type,m.id entity_id",
  'staff_chat_messages m','m.created_at','m.sender_staff_id');
 push(
  "SELECT rr.read_at event_at,rr.staff_id,'chat' source,'message_marked_read' event,"+
  "'work_messages' screen_key,'/api/uat/chat/messages' route_path,"+
  "NULL window_key,NULL window_kind,NULL outcome,'staff_chat_messages' entity_type,rr.message_id entity_id",
  'staff_chat_read_receipts rr','rr.read_at','rr.staff_id');
 push(
  "SELECT l.linked_at event_at,l.replying_staff_id staff_id,'chat' source,'direct_thread_reply_linked' event,"+
  "'work_messages' screen_key,'/api/uat/chat/messages' route_path,"+
  "NULL window_key,NULL window_kind,NULL outcome,'staff_chat_messages' entity_type,l.incoming_message_id entity_id",
  'staff_chat_reply_links l','l.linked_at','l.replying_staff_id');
 push(
  "SELECT t.created_at event_at,t.assigned_to staff_id,'task' source,'task_assigned' event,"+
  "'work' screen_key,'/tasks' route_path,NULL window_key,NULL window_kind,NULL outcome,"+
  "'staff_tasks' entity_type,t.id entity_id",
  'staff_tasks t','t.created_at','t.assigned_to');
 push(
  "SELECT t.seen_at event_at,t.assigned_to staff_id,'task' source,'task_marked_seen' event,"+
  "'work' screen_key,'/tasks' route_path,NULL window_key,NULL window_kind,NULL outcome,"+
  "'staff_tasks' entity_type,t.id entity_id",
  'staff_tasks t','t.seen_at','t.assigned_to');
 push(
  "SELECT t.started_at event_at,t.assigned_to staff_id,'task' source,'task_started' event,"+
  "'work' screen_key,'/tasks' route_path,NULL window_key,NULL window_kind,NULL outcome,"+
  "'staff_tasks' entity_type,t.id entity_id",
  'staff_tasks t','t.started_at','t.assigned_to');
 push(
  "SELECT t.completed_at event_at,COALESCE(w.completed_by,t.assigned_to) staff_id,"+
  "'task' source,'task_completed' event,'work' screen_key,'/tasks' route_path,"+
  "NULL window_key,NULL window_kind,NULL outcome,'staff_tasks' entity_type,t.id entity_id",
  'staff_tasks t LEFT JOIN staff_task_workflow w ON w.task_id=t.id',
  't.completed_at','COALESCE(w.completed_by,t.assigned_to)'," AND t.status='completed'");
 push(
  "SELECT c.created_at event_at,c.staff_id,'task' source,'task_comment_written' event,"+
  "'work' screen_key,'/tasks' route_path,NULL window_key,NULL window_kind,NULL outcome,"+
  "'staff_tasks' entity_type,c.task_id entity_id",
  'staff_task_comments c','c.created_at','c.staff_id',
  " AND c.comment<>'Opened / seen' AND c.comment<>'Task accepted and archived' "+
  "AND c.comment NOT LIKE 'Status changed to %' AND c.comment NOT LIKE 'Task completed %'");
 push(
  "SELECT w.acknowledged_at event_at,w.acknowledged_by staff_id,'task' source,'task_approved' event,"+
  "'work' screen_key,'/tasks' route_path,NULL window_key,NULL window_kind,NULL outcome,"+
  "'staff_tasks' entity_type,w.task_id entity_id",
  'staff_task_workflow w','w.acknowledged_at','w.acknowledged_by');
 push(
  "SELECT n.read_at event_at,n.recipient_staff_id staff_id,'notification' source,'task_notification_read' event,"+
  "'work' screen_key,'/tasks' route_path,NULL window_key,NULL window_kind,NULL outcome,"+
  "'staff_tasks' entity_type,n.task_id entity_id",
  'staff_task_notifications n','n.read_at','n.recipient_staff_id');
 return{sql:parts.join(' UNION ALL '),params};
}
async function timeline(r,staffId,limit=75,offset=0){
 const src=timelineSource(r,staffId);
 const [rows]=await db.query('SELECT * FROM ('+src.sql+
  ') entries ORDER BY event_at DESC,source,event LIMIT ? OFFSET ?',
  [...src.params,limit,offset]);
 return rows;
}
async function timelineCount(r,staffId){
 const src=timelineSource(r,staffId);
 const [[row]]=await db.query('SELECT COUNT(*) total FROM ('+src.sql+') entries',src.params);
 return Number(row.total);
}
async function peopleOverview(r){
 const [people]=await db.query('SELECT id,full_name,role,is_active FROM staff_users ORDER BY is_active DESC,role,full_name');
 const [usage]=await db.query(
  "SELECT staff_id,COUNT(*) events,SUM(event_type='screen_view') screens,"+
  "COUNT(DISTINCT CASE WHEN event_type='screen_view' THEN route_path ELSE NULL END) different_screens,"+
  "SUM(event_type='feature_open') launcher_clicks,SUM(event_type='http_action') saved_requests,"+
  "SUM(event_type IN ('window_open','window_reopen') AND "+
  "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.window_kind')),'') NOT LIKE 'external%') internal_opens,"+
  "SUM(event_type='external_open' OR (event_type='window_open' AND "+
  "JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.window_kind')) IN ('external_supplier','external_embedded'))) external_opens,"+
  "SUM(event_type IN ('window_close','external_close','external_close_detected')) closed_windows,"+
  "SUM(event_type='external_still_open') portal_observations,MAX(occurred_at) last_used "+
  'FROM crm_usage_events WHERE occurred_at>=? AND occurred_at<? GROUP BY staff_id',[r.from,r.to]);
 const [audit]=await db.query(
  'SELECT staff_id,COUNT(*) audited_changes FROM audit_log WHERE created_at>=? AND created_at<? GROUP BY staff_id',
  [r.from,r.to]);
 const a=new Map(usage.map(x=>[Number(x.staff_id),x]));
 const b=new Map(audit.map(x=>[Number(x.staff_id),x]));
 const comm=await communication.overview(r);
 return people.map(u=>({
  ...u,...(a.get(Number(u.id))||{}),...(comm.get(Number(u.id))||{}),
  id:Number(u.id),is_active:Number(u.is_active),
  audited_changes:Number(b.get(Number(u.id))?.audited_changes||0)
 }));
}
async function personDetail(r,staff){
 const args=[staff,r.from,r.to];
 const [screens]=await db.query(
  "SELECT COALESCE(route_path,screen_key) screen,COUNT(*) opens,MAX(occurred_at) last_used "+
  "FROM crm_usage_events WHERE staff_id=? AND occurred_at>=? AND occurred_at<? "+
  "AND event_type='screen_view' GROUP BY screen ORDER BY opens DESC,screen LIMIT 200",args);
 const [windows]=await db.query(
  "SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.window_key')),'null'),screen_key) window_key,"+
  "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.window_kind')),'null'),'') window_kind,"+
  "COALESCE(route_path,'') opened_route,"+
  "SUM(event_type IN ('window_open','window_reopen','external_open')) opened,"+
  "SUM(event_type IN ('window_focus','external_focus')) refocused,"+
  "SUM(event_type IN ('window_minimize','window_maximize','window_unmaximize','window_restore')) window_controls,"+
  "SUM(event_type IN ('window_close','external_close','external_close_detected')) closed,"+
  "SUM(event_type='external_still_open') observed_open,"+
  "SUM(event_type IN ('external_blocked','external_unconfigured')) failed_opens,MAX(occurred_at) last_used "+
  "FROM crm_usage_events WHERE staff_id=? AND occurred_at>=? AND occurred_at<? "+
  "AND (event_type LIKE 'window_%' OR event_type LIKE 'external_%') "+
  'GROUP BY window_key,window_kind,opened_route ORDER BY opened DESC,last_used DESC LIMIT 120',args);
 const [clicks]=await db.query(
  "SELECT COALESCE(screen_key,'(unknown)') feature,COALESCE(route_path,'') route_path,"+
  "COUNT(*) clicks,MAX(occurred_at) last_used FROM crm_usage_events WHERE staff_id=? "+
  "AND occurred_at>=? AND occurred_at<? AND event_type='feature_open' "+
  'GROUP BY screen_key,route_path ORDER BY clicks DESC LIMIT 100',args);
 const [requests]=await db.query(
  "SELECT COALESCE(route_path,'') route_path,COALESCE(http_method,'') method,"+
  "COUNT(*) successful_requests,MAX(occurred_at) last_used FROM crm_usage_events "+
  "WHERE staff_id=? AND occurred_at>=? AND occurred_at<? AND event_type='http_action' "+
  'GROUP BY route_path,http_method ORDER BY successful_requests DESC LIMIT 120',args);
 const [actions]=await db.query(
  'SELECT action_type,COUNT(*) actions,MAX(created_at) last_used FROM audit_log '+
  'WHERE staff_id=? AND created_at>=? AND created_at<? GROUP BY action_type ORDER BY actions DESC LIMIT 150',args);
 const [launchers]=await db.query('SELECT slot_key,display_name FROM os_external_launchers');
 const labels=new Map(launchers.map(x=>['managed-launcher:'+x.slot_key,x.display_name]));
 for(const row of windows){
  row.display_name=labels.get(row.window_key)||
   (row.window_key==='route'?(row.opened_route||'CRM page'):row.window_key||'CRM window');
 }
 const comms=await communication.person(r,staff);
 return{screens,windows,clicks,requests,actions,comms};
}
function filters(req){
 const week=chooseWeek(req.query.week);
 if(!week)return{error:'Invalid reporting week'};
 const raw=String(req.query.staff||'');
 const staff=raw&&/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))&&Number(raw)>0?Number(raw):null;
 if(raw&&!staff)return{error:'Invalid staff member'};
 return{week,staff};
}
router.get('/backoffice/staff-usage',requireOwner,async(req,res,next)=>{
 try{
  const f=filters(req);
  if(f.error)return res.status(400).render('error',{title:'Invalid report filter',message:f.error});
  const r=range(f.week),people=await peopleOverview(r);
  const person=f.staff?people.find(x=>x.id===f.staff):null;
  if(f.staff&&!person)return res.status(404).render('error',{title:'Unknown staff member',message:'Choose a listed staff member.'});
  const detail=person?await personDetail(r,f.staff):null;
  const total=person?await timelineCount(r,f.staff):0;
  const pages=Math.max(1,Math.ceil(total/75));
  const page=Math.min(pages,Math.max(1,Number.parseInt(req.query.page,10)||1));
  const events=person?await timeline(r,f.staff,75,(page-1)*75):[];
  res.set('Cache-Control','private, no-store');
  return res.render('staff-usage-weekly',{title:'Weekly Staff CRM Usage Audit',
   people,person,detail,events,total,pages,page,
   from:r.start,to:r.end,week:r.start,previous:r.previous,next:r.next,
   weekIsCurrent:r.start===currentWeek(),formatAt,eventKind,safeTarget});
 }catch(e){next(e)}
});
router.get('/backoffice/staff-usage.csv',requireOwner,async(req,res,next)=>{
 try{
  const f=filters(req);
  if(f.error)return res.status(400).type('text/plain').send(f.error);
  const r=range(f.week),people=await peopleOverview(r);
  if(f.staff&&!people.some(x=>x.id===f.staff))return res.sendStatus(404);
  const count=await timelineCount(r,f.staff);
  if(count>25000)return res.status(413).type('text/plain').send(
   'Week exceeds 25,000 events. Export one staff member at a time.');
  const events=await timeline(r,f.staff,25000,0);
  const names=new Map(people.map(x=>[x.id,x.full_name]));
  // Include individual inbound messages, including those NEVER opened or
  // answered, plus task status. They would otherwise be absent from an
  // action-only timeline. No message body or private completion note.
  if(f.staff){
   const detail=await communication.person(r,f.staff);
   for(const m of detail.incoming){
    events.push({event_at:m.created_at,staff_id:f.staff,source:'message_inbox',
     event:'message_received',route_path:'From '+m.sender_name,
     window_key:'read:'+m.read_status,window_kind:m.kind,
     outcome:m.reply?'reply #'+m.reply.reply_message_id:m.reply_status,
     entity_type:'staff_chat_messages',entity_id:m.id});
   }
   for(const t of detail.tasks){
    events.push({event_at:t.created_at,staff_id:f.staff,source:'task_inventory',
     event:'task_received_or_worked',route_path:'Assigned by '+t.created_by_name,
     window_key:'seen:'+(t.seen_at?'yes':'no'),
     window_kind:'status:'+t.status,
     outcome:'comments_this_week:'+t.comments_in_week,
     entity_type:'staff_tasks',entity_id:t.id});
   }
  }else{
   // When exporting everyone, include a per-staff summary to make the
   // team-wide CSV immediately usable for weekly management comparisons.
   for(const person of people){
    events.push({event_at:r.from,staff_id:person.id,source:'weekly_summary',
     event:'messages_and_tasks_summary',
     route_path:'direct_in:'+Number(person.messages_in||0)+
      '; sent:'+Number(person.messages_sent||0)+
      '; first_read_receipts:'+Number(person.receipts_created||0)+
      '; linked_replies:'+Number(person.linked_replies||0),
     window_key:'tasks_received:'+Number(person.tasks_received||0),
     window_kind:'tasks_seen:'+Number(person.tasks_opened||0),
     outcome:'tasks_completed:'+Number(person.tasks_completed||0),
     entity_type:'',entity_id:null});
   }
  }
  events.sort((a,b)=>new Date(b.event_at)-new Date(a.event_at));
  const lines=[['South Africa time','Staff','Event origin','Action','CRM screen/route',
   'Window or portal','Window type','Outcome','Related record'].map(csvValue).join(',')];
  for(const e of events){
   const reference=e.entity_type?e.entity_type+(e.entity_id?' #'+e.entity_id:''):'';
   lines.push([formatAt(e.event_at),names.get(Number(e.staff_id))||('Staff #'+e.staff_id),
    e.source,e.event,safeTarget(e),e.window_key||'',e.window_kind||'',e.outcome||'',reference]
    .map(csvValue).join(','));
  }
  res.set('Cache-Control','private, no-store');
  res.attachment('Talk2Me_Staff_Usage_'+f.week+(f.staff?'_staff_'+f.staff:'_all')+'.csv');
  return res.type('text/csv; charset=utf-8').send('\uFEFF'+lines.join('\r\n')+'\r\n');
 }catch(e){next(e)}
});
module.exports={router,chooseWeek,range,peopleOverview,personDetail,timeline,eventKind};
