'use strict';
// The Zippy action feed contains only private events for the authenticated
// account. CRM updates are independently revalidated by the signed UAT bridge.
const {query,toIso}=require('./db');
const {bridgeCall,configured}=require('./crm');
const {sendPush}=require('./push');
const MAX_TRACKED=25;

async function event(owner,key,kind,title,body='',taskId=null){
 if(!owner||!key||!kind)return false;
 const [insert]=await query(
  "INSERT IGNORE INTO zippy_activity(owner_key,event_key,kind,title,body,task_id) VALUES(?,?,?,?,?,?)",
  [owner,String(key).slice(0,160),kind,String(title).slice(0,160),
   String(body||'').slice(0,2000),taskId]);
 return insert.affectedRows===1;
}
async function trackSent(owner,taskId,preview,instruction){
 const id=Number(taskId);
 if(!Number.isSafeInteger(id)||id<=0)return;
 const recipient=String(preview?.assignee?.displayName||preview?.assignee?.name||'staff').slice(0,160);
 const subject=String(instruction||preview?.instruction||'').slice(0,1750);
 await query("INSERT INTO zippy_crm_tracking(owner_key,task_id,recipient_name,last_status) VALUES(?,?,?,'unread') "+
  "ON DUPLICATE KEY UPDATE recipient_name=VALUES(recipient_name)",[owner,id,recipient]);
 await event(owner,'crm_sent:'+id,'crm_sent','Sent to '+recipient,
  subject+'\nMonitored in Talk2Me CRM · Task #'+id,id);
}
async function logReminder(owner,id,title,dueAt){
 return event(owner,'reminder_saved:'+id,'reminder_saved','Reminder saved: '+title,
  'Scheduled for '+new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(dueAt)),null);
}
async function getFeed(owner,limit=40){
 const [rows]=await query(
  'SELECT id,kind,title,body,task_id,created_at FROM zippy_activity WHERE owner_key=? ORDER BY id DESC LIMIT ?',
  [owner,Math.max(1,Math.min(80,Number(limit)||40))]);
 return rows.map(r=>({id:Number(r.id),kind:r.kind,title:r.title,body:r.body,
  taskId:r.task_id?Number(r.task_id):null,createdAt:toIso(r.created_at)}));
}
async function sendOwnerAlert(owner,kind,title,body,id){
 try{
  await sendPush({owner,id:kind+':'+id,title,body:body.slice(0,180)});
 }catch(e){console.error('[zippy] CRM activity push unavailable',e.code||e.message);}
}
async function syncOwner(owner){
 if(!configured())return {checked:0,updates:0,available:false};
 const [tracked]=await query(
  'SELECT task_id,recipient_name,last_status FROM zippy_crm_tracking WHERE owner_key=? ORDER BY task_id DESC LIMIT ?',
  [owner,MAX_TRACKED]);
 if(!tracked.length)return {checked:0,updates:0,available:true};
 // Only the CRM, not Zippy, determines the real status and which reply belongs
 // to an issued task. Never infer completion from the mere presence of a reply.
 const report=await bridgeCall('updates',{taskIds:tracked.map(x=>Number(x.task_id)),actorEmail:owner});
 const snapshots=new Map((report.tasks||[]).map(t=>[Number(t.id),t]));
 const replies=(report.replies||[]).slice(0,75);
 let updates=0;
 for(const item of tracked){
  const id=Number(item.task_id),current=snapshots.get(id);
  if(!current)continue;
  const latest=String(current.status||'unread').slice(0,32);
  const prev=String(item.last_status||'unread');
  const recipient=String(current.recipientName||item.recipient_name||'staff').slice(0,120);
  if(latest!==prev){
   const finished=latest==='completed';
   const body=finished
    ? recipient+' marked the task complete'+(current.completionNote?': '+current.completionNote:' (no completion note recorded).')
    :recipient+' changed task #'+id+' from '+prev+' to '+latest+'.';
   const kind=finished?'crm_completed':'crm_status';
   const created=await event(owner,kind+':'+id+':'+latest,kind,
    finished?'Task completed by '+recipient:'Task status updated',body,id);
   if(created){
    updates++;
    if(finished)await sendOwnerAlert(owner,'crmcompleted','CRM task completed by '+recipient,body,id);
   }
   await query('UPDATE zippy_crm_tracking SET last_status=?,last_checked_at=UTC_TIMESTAMP(3) WHERE owner_key=? AND task_id=?',
    [latest,owner,id]);
  }else{
   await query('UPDATE zippy_crm_tracking SET last_checked_at=UTC_TIMESTAMP(3) WHERE owner_key=? AND task_id=?',
    [owner,id]);
  }
  const due=new Date(current.dueAt).getTime();
  if(latest!=='completed'&&latest!=='cancelled'&&Number.isFinite(due)&&due<Date.now()){
   const title='CRM task overdue: '+recipient;
   const created=await event(owner,'crm_overdue:'+id,'crm_overdue',title,
    'Task #'+id+' is still '+latest+'. '+recipient+' has not recorded completion in Talk2Me.',id);
   if(created){updates++;await sendOwnerAlert(owner,'crmoverdue',title,'Task #'+id+' needs follow-up.',id);}
  }
 }
 for(const reply of replies){
  const id=Number(reply.taskId);
  if(!snapshots.has(id)||!tracked.some(t=>Number(t.task_id)===id))continue;
  const name=String(reply.senderName||'Staff').slice(0,100);
  const body=String(reply.body||'').slice(0,1800);
  const created=await event(owner,'crm_reply:'+id+':'+Number(reply.id),'crm_reply',
   'CRM reply from '+name,'“'+body+'”\nRecorded against task #'+id,id);
  if(created){
   updates++;
   await sendOwnerAlert(owner,'crmreply','CRM reply from '+name,body,id+':'+Number(reply.id));
  }
 }
 return {checked:tracked.length,updates,available:true};
}
async function syncAll(){
 // Only owners already using Zippy have tracked CRM work. Isolated personal
 // accounts remain separate and no other CRM users are queried.
 const [rows]=await query('SELECT DISTINCT owner_key FROM zippy_crm_tracking ORDER BY owner_key LIMIT 5');
 let checked=0,updates=0,failed=0;
 for(const row of rows){
  try{const report=await syncOwner(row.owner_key);checked+=report.checked;updates+=report.updates;}
  catch(e){failed++;console.error('[zippy] CRM sync failed',e.code||e.message);}
 }
 return {checked,updates,failed};
}
module.exports={event,trackSent,logReminder,getFeed,syncOwner,syncAll};
