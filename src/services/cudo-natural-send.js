'use strict';
const crypto=require('crypto');
const db=require('../config/db');
const {normal}=require('./cudo-natural-parser');
const {ensureAgentResponsibilitySchema,createAgentInstructionInTransaction}=require('./office-intelligence-agent');
const {channelAvailability,createWorkDispatch}=require('./work-dispatch');

async function sendNaturalCommand({draft,actorId,typedName}={}){
 if(!draft||draft.type!=='natural_instruction')throw new Error('There is no instruction to send.');
 const issuer=Number(actorId);
 if(!Number.isSafeInteger(issuer)||issuer<=0)throw new Error('Sign in to send a message.');
 if(draft.requesterId&&Number(draft.requesterId)!==issuer)throw new Error('This instruction belongs to a different signed-in user. Please repeat it.');
 if(Date.now()-Number(draft.createdAt)>10*60*1000)throw new Error('The name confirmation has expired. Please repeat the instruction.');
 const recipient=draft.assignee;
 if(draft.source==='voice'||draft.assigneeNear){
  const typed=normal(typedName);
  if(!typed||![normal(recipient.shortName),normal(recipient.name)].includes(typed))
   throw new Error('Type '+recipient.shortName+' to confirm the staff name heard by Cudo.');
 }
 const [[active]]=await db.execute('SELECT id FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1',{id:Number(recipient.id)});
 if(!active)throw new Error('The recipient is no longer active in the CRM.');
 if(draft.reference){
  const table=draft.reference.kind==='client'?'clients':'staff_users';
  const [[person]]=await db.execute('SELECT id FROM '+table+' WHERE id=:id AND is_active=1 LIMIT 1',{id:Number(draft.reference.id)});
  if(!person)throw new Error('The referenced CRM person is no longer active. Repeat the instruction.');
 }
 await ensureAgentResponsibilitySchema();
 const instruction=String(draft.instruction).slice(0,1750);
 const target=draft.reference;
 const verifiedContact=target?'CRM contact: '+String(target.name).slice(0,160)+' ('+target.kind+
  (target.phone?', '+String(target.phone).slice(0,50):'')+')':'';
 const message=[instruction,verifiedContact].filter(Boolean).join('\n').slice(0,2000);
 const title=instruction.replace(/[.!?]+$/,'').slice(0,160);
 if(draft.channel!=='internal'){
  const ready=channelAvailability(draft.channel);
  if(!ready.available)throw new Error(ready.reason||'External sending is not configured.');
  const result=await createWorkDispatch({createdBy:issuer,action:{
   type:'work_dispatch',recipientId:Number(recipient.id),channel:draft.channel,
   senderKey:'primary',instruction:message,subject:title,
   priority:draft.priority,dueAt:draft.dueAt,requireReply:false,requireCompletion:true,
   items:[],attachmentIds:[]
  }});
  return {ok:true,taskId:result.taskId,dispatchId:result.dispatchId,
   text:result.externalResult?.sent?'Message sent to '+recipient.shortName+'. Monitored task #'+result.taskId+' created.':
    'Task #'+result.taskId+' created, but the external message was not delivered: '+(result.externalResult?.error||'Provider unavailable')};
 }
 const identifier=crypto.createHash('sha256').update([issuer,recipient.id,message,draft.dueAt].join('|')).digest('hex').slice(0,36);
 const conn=await db.getConnection();let locked=false;let started=false;
 try{
  const [[lock]]=await conn.execute('SELECT GET_LOCK(:key,5) AS obtained',{key:'t2m-instr-'+identifier});
  locked=Number(lock?.obtained)===1;
  if(!locked)throw new Error('This instruction is already being sent. Check Work in a moment.');
  const [[existing]]=await conn.execute(
   "SELECT t.id task_id,c.id chat_id FROM staff_tasks t JOIN staff_chat_messages c ON c.related_task_id=t.id WHERE t.created_by=:issuer AND t.assigned_to=:recipient AND t.title=:title AND t.message=:message AND t.due_at=:due AND t.created_at>=DATE_SUB(NOW(), INTERVAL 10 MINUTE) LIMIT 1",
   {issuer,recipient:Number(recipient.id),title,message,due:draft.dueAt});
  if(existing)return {ok:true,duplicate:true,taskId:Number(existing.task_id),messageId:Number(existing.chat_id),
   text:'This message was already sent to '+recipient.shortName+'. Task #'+existing.task_id+' is being monitored.'};
  await conn.beginTransaction();started=true;
  const task=await createAgentInstructionInTransaction(conn,{
   issuedBy:issuer,assignedTo:Number(recipient.id),title,message,dueAt:draft.dueAt,priority:draft.priority,
   relatedClientId:draft.reference?.kind==='client'?Number(draft.reference.id):null
  });
  const lo=Math.min(issuer,Number(recipient.id)),hi=Math.max(issuer,Number(recipient.id));
  const [chat]=await conn.execute(
   "INSERT INTO staff_chat_messages (conversation_key,sender_staff_id,message_type,body,related_client_id,related_task_id) VALUES (:key,:sender,'text',:body,:client,:task)",
   {key:'direct:'+lo+':'+hi,sender:issuer,body:message,
    client:draft.reference?.kind==='client'?Number(draft.reference.id):null,task:Number(task.taskId)});
  await conn.commit();started=false;
  return {ok:true,taskId:Number(task.taskId),messageId:Number(chat.insertId),
   text:'Sent to '+recipient.shortName+' in Talk2Me Messages. Task #'+task.taskId+
    ' is monitored until '+draft.dueAt.slice(0,16).replace(' ',' at ')+'.'};
 }catch(error){if(started)try{await conn.rollback();}catch(_){}throw error;}
 finally{
  if(locked)try{await conn.execute('SELECT RELEASE_LOCK(:key) AS released',{key:'t2m-instr-'+identifier});}catch(_){}
  conn.release();
 }
}
module.exports={sendNaturalCommand};
