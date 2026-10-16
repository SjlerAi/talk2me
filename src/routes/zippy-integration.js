'use strict';
const express=require('express');
const fs=require('fs');
const crypto=require('crypto');
const db=require('../config/db');
const {verifySigned}=require('../services/zippy-bridge-security');
const {prepareNaturalCommand}=require('../services/cudo-natural-plan');
const {sendNaturalCommand}=require('../services/cudo-natural-send');
const {ensureSchema:ensureWorkSchema}=require('./uat-work-widgets');
const router=express.Router();
const UAT_ONLY=String(process.env.UAT_MODE||'').toLowerCase()==='true';
const OWNER_EMAIL='gerda@talk-online.co.za';
const AUTHORIZED_OWNERS=new Set([OWNER_EMAIL,'info@b4s.co.za']);
const SECRET_FILE='/home/uent/.zippy-t2m-uat-bridge-key';
let readyPromise=null;
const fail=(res,status,text)=>res.status(status).set('Cache-Control','no-store').json({ok:false,error:text});
async function ensureBridgeTables(){
 if(!readyPromise)readyPromise=(async()=>{
  await db.execute("CREATE TABLE IF NOT EXISTS zippy_bridge_nonces (nonce CHAR(32) PRIMARY KEY,issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at DATETIME NOT NULL,INDEX idx_zippy_nonce_expires(expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await db.execute("CREATE TABLE IF NOT EXISTS zippy_bridge_drafts (token_hash CHAR(64) PRIMARY KEY,owner_id BIGINT NOT NULL,payload_json MEDIUMTEXT NOT NULL,state ENUM('ready','sending','sent') NOT NULL DEFAULT 'ready',created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at DATETIME NOT NULL,completed_at DATETIME NULL,task_id BIGINT NULL,INDEX idx_zippy_draft_owner(owner_id,expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
 })().catch(error=>{readyPromise=null;throw error;});
 return readyPromise;
}
async function requireSignedGerda(req,res,next){
 if(!UAT_ONLY)return fail(res,404,'Not found');
 if(!['preview','confirm','updates'].includes(String(req.params.action||'')))
  return fail(res,404,'Not found');
 let secret='';
 try{secret=fs.readFileSync(SECRET_FILE,'utf8').trim();}catch(_){return fail(res,503,'The Zippy CRM connection has not been configured.');}
 const pathname='/api/integrations/zippy/'+req.params.action;
 const validated=verifySigned({
  timestamp:req.get('x-zippy-time'),nonce:req.get('x-zippy-nonce'),
  signature:req.get('x-zippy-signature'),path:pathname,payload:req.body
 },secret);
 if(!validated.ok)return fail(res,401,'The Zippy request could not be verified.');
 if(JSON.stringify(req.body||{}).length>8192)return fail(res,413,'Command too long.');
 try{
  const actorEmail=String(req.body?.actorEmail||OWNER_EMAIL).trim().toLowerCase();
  if(!AUTHORIZED_OWNERS.has(actorEmail))
   return fail(res,403,'This Talk2Me account is not authorised for Zippy.');
  const [users]=await db.execute("SELECT id,role,first_name,is_active FROM staff_users WHERE LOWER(email)=:email AND is_active=1 LIMIT 2",{email:actorEmail});
  if(users.length!==1||String(users[0].role).toLowerCase()!=='owner')
   return fail(res,403,'That owner account is not active in Talk2Me UAT.');
  req.zippyOwnerId=Number(users[0].id);
  req.zippyOwnerEmail=actorEmail;
  await ensureBridgeTables();
  try{
   await db.execute('INSERT INTO zippy_bridge_nonces(nonce,expires_at) VALUES(:nonce,DATE_ADD(NOW(),INTERVAL 10 MINUTE))',{nonce:req.get('x-zippy-nonce')});
  }catch(err){
   if(err.code==='ER_DUP_ENTRY')return fail(res,409,'Duplicate Zippy request rejected.');
   throw err;
  }
  next();
 }catch(err){console.error('[zippy-bridge] authentication setup failed',err.code||err.message);
  return fail(res,503,'Zippy CRM is temporarily unavailable.');}
}
router.post('/api/integrations/zippy/:action',requireSignedGerda,async(req,res)=>{
 res.set('Cache-Control','no-store');
 const ownerId=req.zippyOwnerId;
 try{
  if(req.params.action==='updates'){
   // Only tasks actually issued by this signed-in owner are visible. Staff chat
   // replies must explicitly reference those tasks; unrelated conversations
   // and WhatsApp replies are not treated as evidence of completion.
   const ids=[...new Set((Array.isArray(req.body?.taskIds)?req.body.taskIds:[])
    .map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))].slice(0,25);
   if(ids.length===0)return res.json({ok:true,tasks:[],replies:[]});
   const params={owner:ownerId};
   const where=ids.map((id,i)=>{params['task'+i]=id;return ':task'+i;}).join(',');
   const [tasks]=await db.execute(
    'SELECT t.id,t.title,t.status,t.due_at,t.updated_at,t.completed_at,t.completion_note,'+
    ' s.first_name AS recipient_name FROM staff_tasks t JOIN staff_users s ON s.id=t.assigned_to '+
    ' WHERE t.created_by=:owner AND t.id IN ('+where+') ORDER BY t.id DESC LIMIT 25',params);
   if(!tasks.length)return res.json({ok:true,tasks:[],replies:[]});
   const taskSet=new Set(tasks.map(t=>Number(t.id)));
   const [messages]=await db.execute(
    'SELECT m.id,m.related_task_id AS task_id,m.body,m.created_at,s.first_name AS sender_name '+
    'FROM staff_chat_messages m JOIN staff_tasks t ON t.id=m.related_task_id '+
    'JOIN staff_users s ON s.id=m.sender_staff_id WHERE t.created_by=:owner '+
    'AND m.related_task_id IN ('+where+') AND m.sender_staff_id<>:owner '+
    "AND m.message_type='text' ORDER BY m.id DESC LIMIT 75",params);
   return res.json({ok:true,tasks:tasks.map(t=>({
    id:Number(t.id),title:String(t.title||'').slice(0,160),
    status:String(t.status||'unread'),dueAt:t.due_at,updatedAt:t.updated_at,
    completedAt:t.completed_at,completionNote:String(t.completion_note||'').slice(0,1200),
    recipientName:String(t.recipient_name||'staff')
   })),replies:messages.filter(m=>taskSet.has(Number(m.task_id))).map(m=>({
    id:Number(m.id),taskId:Number(m.task_id),senderName:String(m.sender_name||'staff'),
    body:String(m.body||'').slice(0,1800),createdAt:m.created_at
   }))});
  }
  if(req.params.action==='preview'){
   const message=String(req.body?.message||'').trim().slice(0,2500);
   const source=req.body?.source==='voice'?'voice':'text';
   if(!message)return fail(res,400,'An instruction is required.');
   const plan=await prepareNaturalCommand({message,source,requesterId:ownerId});
   if(!plan.handled)return res.json({ok:true,text:'Tell me who should do what in Talk2Me. Nothing has been sent.',pendingToken:null,choices:[]});
   const action=plan.pendingAction;
   if(!action||action.type!=='natural_instruction')
    return res.json({ok:true,intent:plan.intent,text:plan.text,pendingToken:null,choices:plan.choices||[],rows:plan.rows||[]});
   // The initial Zippy integration sends only internal CRM messages and monitored
   // staff tasks; external email/WhatsApp remain disabled until configured and tested.
   if(action.channel!=='internal')
    return res.json({ok:true,text:'External delivery is not enabled for Zippy yet. No message was sent.',pendingToken:null,choices:[]});
   if(!plan.actions?.includes('confirm_natural_instruction'))
    return res.json({ok:true,text:plan.text,pendingToken:null,choices:[]});
   const token=crypto.randomBytes(32).toString('base64url');
   const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
   await db.execute("INSERT INTO zippy_bridge_drafts(token_hash,owner_id,payload_json,expires_at) VALUES(:token,:owner,:payload,DATE_ADD(NOW(),INTERVAL 10 MINUTE))",{
    token:tokenHash,owner:ownerId,payload:JSON.stringify(action)
   });
   return res.json({ok:true,intent:plan.intent,text:plan.text,preview:plan.preview,pendingToken:token});
  }
  const token=String(req.body?.token||'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return fail(res,400,'Invalid confirmation token.');
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  const [updated]=await db.execute("UPDATE zippy_bridge_drafts SET state='sending' WHERE token_hash=:hash AND owner_id=:owner AND state='ready' AND expires_at>NOW()",{hash,owner:ownerId});
  if(updated.affectedRows!==1)return fail(res,409,'This message was already confirmed or has expired. Please prepare it again.');
  let sent=false;
  try{
   const [rows]=await db.execute('SELECT payload_json FROM zippy_bridge_drafts WHERE token_hash=:hash AND owner_id=:owner LIMIT 1',{hash,owner:ownerId});
   if(rows.length!==1)throw Error('Prepared message missing');
   const draft=JSON.parse(rows[0].payload_json);
   const edited=req.body?.editedMessage;
   if(edited!==undefined){
    if(typeof edited!=='string'||edited.trim().length<3||edited.length>1750)
     throw new Error('Message must contain 3 to 1,750 characters.');
    draft.instruction=edited.trim();
   }
   if(draft.channel!=='internal'||draft.type!=='natural_instruction'||Number(draft.requesterId)!==ownerId)
    throw Error('Prepared CRM action did not pass verification');
   await ensureWorkSchema();
   // A distinct spoken "send" or Send-button approval after a visible draft
   // is sufficient for an exact CRM name. A fuzzy name still requires typing.
   const approvedByVoice=req.body?.approvalMode==='voice'
     &&draft.source==='voice'&&!draft.assigneeNear;
   const typedName=approvedByVoice?draft.assignee.shortName:req.body?.typedName||'';
   const result=await sendNaturalCommand({draft,actorId:ownerId,typedName});
   sent=true;
   await db.execute("UPDATE zippy_bridge_drafts SET state='sent',completed_at=NOW(),task_id=:taskId WHERE token_hash=:hash AND owner_id=:owner",{
    hash,owner:ownerId,taskId:Number(result.taskId)||null
   });
   return res.json({ok:true,text:result.text,taskId:result.taskId||null,duplicate:Boolean(result.duplicate)});
  }catch(error){
   // Internal messages and tasks are transactional. Reset only when the send
   // has definitely failed; never auto-resend if a save may have succeeded.
   if(!sent)await db.execute("UPDATE zippy_bridge_drafts SET state='ready' WHERE token_hash=:hash AND owner_id=:owner AND state='sending'",{hash,owner:ownerId}).catch(()=>{});
   console.error('[zippy-bridge] confirmation not completed',error.code||error.message);
   return fail(res,sent?503:400,sent?'Check CRM Messages: the instruction may already have been sent.':'Could not send that CRM instruction. Check the recipient and try again.');
  }
 }catch(error){
  console.error('[zippy-bridge] request failed',error.code||error.message);
  return fail(res,503,'Zippy could not complete the CRM request. No new instruction was confirmed.');
 }
});
module.exports=router;
