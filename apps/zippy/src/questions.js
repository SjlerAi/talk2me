'use strict';
const {query}=require('./db');
const {syncOwner,getFeed}=require('./activity');
function normalize(s){
 return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function staffWorkQuestion(message){
 const text=normalize(message);
 if(!/\b(?:did|has|have|het|wat|what|waar|status|klaar|voltooi|completed|finished|reply|replied|antwoord|terugvoer|update)\b/.test(text))return null;
 if(!/\b(?:crm|staff|taak|task|phoned|phone|called|call|bel|klaar|done|finished|completed|replied|reply|answered|antwoord|gese|say|said|update|terugvoer)\b/.test(text))return null;
 const m=text.match(/\b(?:did|has|het|what did|wat het|from|van)\s+([a-z][a-z'-]{1,28})\b/);
 return {name:m?.[1]||null,wantsReply:/\b(?:reply|replied|answer|answered|antwoord|said|say|gese|wat het)\b/.test(text)};
}
async function answerTrackedWork(message,owner){
 const question=staffWorkQuestion(message);
 if(!question)return null;
 let fetched=true;
 try{await syncOwner(owner);}catch(e){fetched=false;console.error('[zippy] CRM status lookup temporarily unavailable',e.code||e.message);}
 const [items]=await query(
  'SELECT task_id,recipient_name,last_status,last_checked_at FROM zippy_crm_tracking '+
  'WHERE owner_key=? ORDER BY task_id DESC LIMIT 25',[owner]);
 const target=question.name;
 const matches=items.filter(i=>!target||normalize(i.recipient_name).split(/\s+/)[0]===target);
 if(!matches.length)return {kind:'conversation',text:
  "I don't have a Zippy-monitored CRM instruction for "+(target||'that staff member')+
  ". I cannot confirm a call or a reply without a matching CRM record."};
 const task=matches[0],id=Number(task.task_id);
 const feed=await getFeed(owner,80);
 const related=feed.filter(x=>Number(x.taskId)===id);
 const actualReply=related.find(x=>x.kind==='crm_reply');
 const done=related.find(x=>x.kind==='crm_completed');
 let answer='Talk2Me task #'+id+' for '+task.recipient_name+
  ' is recorded as '+String(task.last_status||'unknown')+'. ';
 if(question.wantsReply){
  answer+=actualReply?'Latest task-linked CRM reply: '+actualReply.body:
   'No task-linked staff reply has been recorded for this instruction.';
 }else if(done){
  answer+=done.body+' This is the staff member’s recorded completion, not independent proof of a telephone call.';
 }else{
  answer+=actualReply?'The latest linked reply is: '+actualReply.body:
   'There is no recorded confirmation of a completed call.';
 }
 if(!fetched)answer+=' The CRM could not be refreshed now, so this is the last known status.';
 return {kind:'conversation',text:answer};
}
module.exports={staffWorkQuestion,answerTrackedWork};
