'use strict';
require('dotenv').config();
const path=require('path');const crypto=require('crypto');const express=require('express');const helmet=require('helmet');
const db=require('./src/db');const auth=require('./src/auth');const {interpret}=require('./src/commands');const push=require('./src/push');const crm=require('./src/crm');
const {optionalAICommand}=require('./src/ai');const {normalizeOfficeSpeech}=require('./src/speech');
const activity=require('./src/activity');const {resetRetriesForDevice}=require('./src/push-retry');
const {answerTrackedWork}=require('./src/questions');
const conversation=require('./src/conversation');
const speech=require('./src/voice-transcribe');
const {recognise:recogniseCrm}=require('./src/crm-intents');
const {detectLanguage}=require('./src/language');
const publicDir=path.join(__dirname,'public');const app=express();
app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:'],fontSrc:["'self'"],connectSrc:["'self'"],workerSrc:["'self'"],manifestSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use(express.json({limit:'24kb'}));
app.use((req,res,next)=>{if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');next();});
const asyncHandler=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const isAuth=asyncHandler(async(req,res,next)=>{req.zippyIdentity=await auth.getUser(req);if(!req.zippyIdentity)return res.status(401).json({ok:false,error:'Please sign in to Zippy.'});next();});
app.post('/api/login',auth.requireMutation,asyncHandler(async(req,res)=>{const result=await auth.logIn({email:req.body?.email,password:req.body?.password,ip:req.ip});if(!result.ok)return res.status(result.unavailable?503:401).json({ok:false,error:result.error});res.setHeader('Set-Cookie',result.cookie);res.json({ok:true,name:result.name});}));
app.get('/api/me',asyncHandler(async(req,res)=>{const user=await auth.getUser(req);res.json({ok:true,authenticated:Boolean(user),name:user?.firstName||null,email:user?.email||null,role:user?.role||null,authSource:user?.source||null,timezone:'Africa/Johannesburg',crmConnected:crm.configured(),pushConfigured:push.enabled(),voiceConfigured:speech.available(),aiConfigured:optionalAICommand&&require('./src/ai').available(),vapidPublicKey:push.enabled()?process.env.ZIPPY_VAPID_PUBLIC_KEY:null});}));

// Zippy 2.0 records short audio only on the user's device. This endpoint
// transcribes on demand through OpenAI and discards the audio buffer afterward.
app.post('/api/voice/transcribe',isAuth,auth.requireMutation,
 express.raw({type:req=>/^audio\/(webm|mp4|ogg|wav|mpeg)(?:;|$)/i.test(String(req.headers['content-type']||'')),limit:'4mb'}),
 asyncHandler(async(req,res)=>{
  const length=Buffer.isBuffer(req.body)?req.body.length:0;
  const check=speech.validateAudio(req.get('content-type'),length);
  if(!check.ok)return res.status(400).json({ok:false,error:check.error});
  if(!speech.available())return res.status(503).json({ok:false,error:'Multilingual voice transcription is not configured yet. Please type or choose a browser language.'});
  if(!speech.allow(req.zippyIdentity.email))return res.status(429).json({ok:false,error:'Too many voice requests. Please try again shortly.'});
  const mode=['auto','en-ZA','af-ZA'].includes(req.get('x-zippy-language'))?req.get('x-zippy-language'):'auto';
  try{
   const result=await speech.transcribe(req.body,req.get('content-type'),{language:mode});
   return res.json({ok:true,text:result.text,language:detectLanguage(result.text,mode)});
  }catch(error){
   return res.status(error.status||503).json({ok:false,error:error.message||'Voice transcription is unavailable.'});
  }
 })
);
app.get('/api/conversation',isAuth,asyncHandler(async(req,res)=>{
 res.json({ok:true,messages:await conversation.recent(req.zippyIdentity.email,60)});
}));

app.post('/api/logout',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{res.setHeader('Set-Cookie',await auth.logOut(req));res.json({ok:true});}));
app.post('/api/password/change',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{const result=await auth.changePassword({currentPassword:req.body?.currentPassword,newPassword:req.body?.newPassword,user:req.zippyIdentity});if(!result.ok)return res.status(400).json(result);res.setHeader('Set-Cookie','zippy.sid=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');res.json({ok:true,message:'Password changed. Please sign in again.'});}));
app.get('/api/reminders',isAuth,asyncHandler(async(req,res)=>{
 const [rows]=await db.query("SELECT id,title,notes,entry_type,due_at,recurrence,state FROM zippy_reminders WHERE owner_key=? AND state<>'cancelled' ORDER BY CASE WHEN state='open' THEN 0 WHEN state='fired' THEN 1 ELSE 2 END,due_at ASC LIMIT 200",[req.zippyIdentity.email]);
 res.json({ok:true,reminders:rows.map(r=>({...r,dueAt:db.toIso(r.due_at)}))});
}));
app.post('/api/reminders',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const {title,notes='',dueAt,recurrence=null,entryType='reminder'}=req.body||{};
 if(typeof title!=='string'||title.trim().length<2||title.length>160||typeof notes!=='string'||notes.length>2000)return res.status(400).json({ok:false,error:'Add a short reminder title.'});
 const date=new Date(dueAt);if(!Number.isFinite(date.getTime())||date<=new Date())return res.status(400).json({ok:false,error:'Choose a future reminder time.'});
 if(recurrence&&!/^(daily|weekdays|monthly|weekly:[0-6])$/.test(recurrence))return res.status(400).json({ok:false,error:'Unsupported recurrence.'});
 if(!['reminder','appointment'].includes(entryType))return res.status(400).json({ok:false,error:'Invalid item type.'});
 const [result]=await db.query('INSERT INTO zippy_reminders(owner_key,title,notes,entry_type,due_at,recurrence) VALUES(?,?,?,?,?,?)',[req.zippyIdentity.email,title.trim(),notes.trim(),entryType,db.utcSql(date),recurrence]);
 try{await activity.logReminder(req.zippyIdentity.email,Number(result.insertId),title.trim(),date);}catch(e){console.error('[zippy] Could not append saved reminder to timeline',e.code||e.message);}
 res.status(201).json({ok:true,id:Number(result.insertId),text:'Saved. I will remind you '+new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(date)+'.'});
}));
app.post('/api/reminders/:id/action',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const id=Number(req.params.id),action=String(req.body?.action||'');if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({ok:false,error:'Invalid reminder.'});
 let result;
 if(action==='done'||action==='cancel'){
  const [items]=await db.query('SELECT recurrence,state FROM zippy_reminders WHERE id=? AND owner_key=? LIMIT 1',
   [id,req.zippyIdentity.email]);
  if(!items.length)return res.status(404).json({ok:false,error:'Reminder not found.'});
  if(action==='done'&&items[0].recurrence){
   // Acknowledge this occurrence without cancelling future repeats.
   await db.query('UPDATE zippy_alerts SET read_at=UTC_TIMESTAMP(3) WHERE reminder_id=? AND owner_key=? AND read_at IS NULL',
    [id,req.zippyIdentity.email]);
   return res.json({ok:true,recurring:true,text:'Done for now. Your repeating reminder stays scheduled.'});
  }
  const next=action==='done'?'done':'cancelled';
  [result]=await db.query('UPDATE zippy_reminders SET state=?,lease_id=NULL,lease_until=NULL WHERE id=? AND owner_key=?',
   [next,id,req.zippyIdentity.email]);
  await db.query('UPDATE zippy_alerts SET read_at=UTC_TIMESTAMP(3) WHERE reminder_id=? AND owner_key=? AND read_at IS NULL',
   [id,req.zippyIdentity.email]);
 }
 else if(action==='snooze'){const mins=Number(req.body?.minutes||10);if(![5,10,15,30,60,1440].includes(mins))return res.status(400).json({ok:false,error:'Choose a supported snooze interval.'});[result]=await db.query('UPDATE zippy_reminders SET due_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),state=\'open\',lease_id=NULL,lease_until=NULL WHERE id=? AND owner_key=?',[mins,id,req.zippyIdentity.email]);await db.query('UPDATE zippy_alerts SET read_at=UTC_TIMESTAMP(3) WHERE reminder_id=? AND owner_key=? AND read_at IS NULL',[id,req.zippyIdentity.email]);}
 else return res.status(400).json({ok:false,error:'Unsupported action.'});
 if(!result.affectedRows)return res.status(404).json({ok:false,error:'Reminder not found.'});res.json({ok:true});
}));
app.post('/api/activity/sync',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 // An explicit Refresh can check signed CRM work immediately; the minute-by-
 // minute background scheduler also does this when the app is closed.
 const info=await activity.syncOwner(req.zippyIdentity.email);
 res.json({ok:true,...info});
}));
app.get('/api/activity',isAuth,asyncHandler(async(req,res)=>{
 const items=await activity.getFeed(req.zippyIdentity.email,50);
 res.json({ok:true,items});
}));
app.get('/api/system/status',isAuth,asyncHandler(async(req,res)=>{
 const [[heartbeat]]=await db.query('SELECT last_tick_at,processed,failed FROM zippy_scheduler_status WHERE id=1 LIMIT 1');
 const [[sub]]=await db.query('SELECT COUNT(*) total FROM zippy_push_subscriptions WHERE owner_key=?',
  [req.zippyIdentity.email]);
 const last=heartbeat?.last_tick_at?db.toIso(heartbeat.last_tick_at):null;
 const fresh=Boolean(last&&Date.now()-new Date(last).getTime()<180000);
 res.json({ok:true,scheduler:{running:fresh,lastTickAt:last,processed:Number(heartbeat?.processed||0),
  failures:Number(heartbeat?.failed||0)},push:{configured:push.enabled(),deviceSubscriptions:Number(sub?.total||0)},
  crmConnected:crm.configured()});
}));
app.get('/api/crm/pending',isAuth,asyncHandler(async(req,res)=>{
 const [rows]=await db.query(
  'SELECT id,preview_json,expires_at FROM zippy_crm_drafts '+
  'WHERE owner_key=? AND confirmed_at IS NULL AND expires_at>UTC_TIMESTAMP(3) '+
  'ORDER BY created_at DESC LIMIT 1',[req.zippyIdentity.email]);
 const r=rows[0];
 res.json({ok:true,draft:r?{draftId:r.id,preview:JSON.parse(r.preview_json),expiresAt:db.toIso(r.expires_at)}:null});
}));
app.post('/api/crm/cancel',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const id=String(req.body?.draftId||'');
 if(!/^[\da-f-]{36}$/i.test(id))return res.status(400).json({ok:false,error:'Invalid message preview.'});
 await db.query('DELETE FROM zippy_crm_drafts WHERE id=? AND owner_key=? AND confirmed_at IS NULL',
  [id,req.zippyIdentity.email]);
 res.json({ok:true,text:'Cancelled. Nothing was sent.'});
}));
app.get('/api/alerts',isAuth,asyncHandler(async(req,res)=>{
 const [rows]=await db.query('SELECT id,reminder_id,title,scheduled_at,created_at,read_at FROM zippy_alerts WHERE owner_key=? ORDER BY id DESC LIMIT 70',[req.zippyIdentity.email]);res.json({ok:true,alerts:rows.map(r=>({...r,createdAt:db.toIso(r.created_at),scheduledAt:r.scheduled_at?db.toIso(r.scheduled_at):null}))});
}));
app.post('/api/alerts/:id/read',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{await db.query('UPDATE zippy_alerts SET read_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_key=?',[Number(req.params.id),req.zippyIdentity.email]);res.json({ok:true});}));
app.get('/api/contacts',isAuth,asyncHandler(async(req,res)=>{
 const [rows]=await db.query('SELECT id,name,relationship,phone,email,notes FROM zippy_contacts WHERE owner_key=? ORDER BY name LIMIT 300',[req.zippyIdentity.email]);res.json({ok:true,contacts:rows});
}));
app.post('/api/contacts',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const {name,relationship='',phone='',email='',notes=''}=req.body||{};if(typeof name!=='string'||name.trim().length<2||name.length>160||[relationship,phone,email,notes].some(x=>typeof x!=='string')||relationship.length>96||phone.length>64||email.length>200||notes.length>1500)return res.status(400).json({ok:false,error:'Check the contact details.'});
 const [saved]=await db.query('INSERT INTO zippy_contacts(owner_key,name,relationship,phone,email,notes) VALUES(?,?,?,?,?,?)',[req.zippyIdentity.email,name.trim(),relationship.trim(),phone.trim(),email.trim(),notes.trim()]);res.status(201).json({ok:true,id:Number(saved.insertId)});
}));
app.delete('/api/contacts/:id',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{await db.query('DELETE FROM zippy_contacts WHERE id=? AND owner_key=?',[Number(req.params.id),req.zippyIdentity.email]);res.json({ok:true});}));
app.post('/api/push/subscribe',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{if(!push.enabled())return res.status(503).json({ok:false,error:'Push notifications are not configured yet.'});await push.saveSubscription(req.body?.subscription,req.zippyIdentity.email);await resetRetriesForDevice(req.zippyIdentity.email);res.json({ok:true});}));
app.post('/api/interpret',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const command=String(req.body?.message||'').trim().slice(0,2500);
 if(!command)return res.status(400).json({ok:false,error:'Please speak or type a message.'});
 const owner=req.zippyIdentity.email;
 const chosen=['auto','af-ZA','en-ZA'].includes(req.body?.language)?req.body.language:'auto';
 const language=detectLanguage(command,chosen);
 await conversation.append(owner,'user',command,'message');
 const reply=async payload=>{
  const text=String(payload.text||payload.question||'').trim();
  if(text)await conversation.append(owner,'assistant',text,payload.status||'chat');
  return res.json({ok:true,language,...payload});
 };
 const trackedAnswer=await answerTrackedWork(command,owner);
 if(trackedAnswer)return reply({status:'chat',text:trackedAnswer.text});
 let plan=interpret(command);
 // Only bounded read-only questions may access CRM without confirmation.
 // Never ask an AI model to invent CRM data or to send staff instructions.
 if(plan.kind!=='office'&&plan.kind!=='personal'){
  const intent=recogniseCrm(command);
  if(intent){
   if(!crm.configured())return reply({status:'crm_unavailable',
    text:language==='af-ZA'?'Talk2Me CRM is nie gekoppel nie. Ek kan nog jou persoonlike herinneringe help bestuur.':
     'Talk2Me CRM is not connected. Your private reminders still work.'});
   try{
    const data=await crm.bridgeCall('lookup',{intent:intent.intent,month:intent.month,
     staff:intent.staff,language,actorEmail:owner});
    return reply({status:'crm_report',text:data.text,source:data.source,asOf:data.asOf,
     count:data.count,more:Boolean(data.more)});
   }catch(error){
    console.error('[zippy] Read-only CRM lookup failed:',error.code||error.message);
    return reply({status:'crm_unavailable',
     text:language==='af-ZA'?'Ek kon nie nou die CRM nagaan nie. Geen data is verander nie.':
      'I could not check the CRM right now. No data was changed.'});
   }
  }
 }
 if(plan.kind==='question'){const ai=await optionalAICommand(command,{user:req.zippyIdentity,language});if(ai)plan=ai;}
 if(plan.kind==='conversation')return reply({status:'chat',text:plan.text});
 if(plan.kind==='question')return reply({status:'question',text:plan.question,question:plan.question,original:command});
 if(plan.kind==='agenda')return reply({status:'agenda',
  text:language==='af-ZA'?'Hier is jou persoonlike agenda en herinneringe.':'Here are your personal reminders and agenda.'});
 if(plan.kind==='office'){
  if(!crm.configured())return reply({status:'connection_pending',text:'The secure Talk2Me connection is not ready. Nothing has been sent.'});
  const interpreted=normalizeOfficeSpeech(plan.crmMessage||plan.original);
  const draft=await crm.bridgeCall('preview',{message:interpreted,
   source:req.body?.source==='voice'?'voice':'text',actorEmail:owner});
  if(!draft.pendingToken)return reply({status:'crm_clarification',
   text:draft.text||'I need one more CRM detail.',choices:draft.choices||[],heard:command,interpreted});
  const id=crypto.randomUUID();
  await db.query('INSERT INTO zippy_crm_drafts(id,owner_key,remote_token,preview_json,expires_at) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))',
   [id,owner,draft.pendingToken,JSON.stringify(draft.preview||{})]);
  const text=draft.text||'Your CRM instruction is ready for review. Nothing has been sent.';
  return reply({status:'crm_preview',text,draftId:id,preview:draft.preview,
   heard:command,interpreted,expiresAt:new Date(Date.now()+10*60*1000).toISOString()});
 }
 const [saved]=await db.query(
  'INSERT INTO zippy_reminders(owner_key,title,entry_type,due_at,recurrence) VALUES(?,?,?,?,?)',
  [owner,plan.title,plan.entryType,db.utcSql(plan.dueAt),plan.recurrence]);
 try{await activity.logReminder(owner,Number(saved.insertId),plan.title,plan.dueAt);}
 catch(error){console.error('[zippy] Reminder history unavailable',error.code||error.message);}
 return reply({status:'saved',id:Number(saved.insertId),title:plan.title,dueAt:plan.dueAt,
  recurrence:plan.recurrence,text:language==='af-ZA'?'Herinnering gestoor: '+plan.title:
   'Saved: '+plan.title+'. I will remind you at the scheduled time.'});
}));
app.post('/api/crm/confirm',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const id=String(req.body?.draftId||'');if(!/^[\da-f-]{36}$/i.test(id))return res.status(400).json({ok:false,error:'Invalid message preview.'});
 const [rows]=await db.query('SELECT remote_token,confirmed_at FROM zippy_crm_drafts WHERE id=? AND owner_key=? AND expires_at>UTC_TIMESTAMP(3) LIMIT 1',[id,req.zippyIdentity.email]);
 if(!rows.length||rows[0].confirmed_at)return res.status(409).json({ok:false,error:'This CRM preview has expired or was already confirmed.'});
 const message=req.body?.editedMessage;
 if(message!==undefined&&(typeof message!=='string'||message.trim().length<3||message.length>1750))
  return res.status(400).json({ok:false,error:'Review and enter a message of 3 to 1,750 characters.'});
 const sent=await crm.bridgeCall('confirm',{
  token:rows[0].remote_token,typedName:String(req.body?.typedName||''),
  editedMessage:message,approvalMode:req.body?.approvalMode==='voice'?'voice':'button',
  actorEmail:req.zippyIdentity.email
 });
 await db.query('UPDATE zippy_crm_drafts SET confirmed_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_key=?',[id,req.zippyIdentity.email]);
 const [previews]=await db.query('SELECT preview_json FROM zippy_crm_drafts WHERE id=? AND owner_key=? LIMIT 1',
  [id,req.zippyIdentity.email]);
 try{await activity.trackSent(req.zippyIdentity.email,sent.taskId,
  previews[0]?JSON.parse(previews[0].preview_json):{},message);}
 catch(e){console.error('[zippy] CRM task was sent but timeline tracking failed',e.code||e.message);}
 res.json({ok:true,status:'sent',taskId:sent.taskId||null,
  text:sent.text||'The Talk2Me CRM instruction was sent.'});
}));
require('./src/internal-tick').attach(app);
app.get('/api/health',asyncHandler(async(_req,res)=>{try{await db.query('SELECT 1 AS ok');res.json({status:'ok',service:'zippy-standalone',database:'connected',crmBridge:crm.configured()});}catch(_){res.status(503).json({status:'error',service:'zippy-standalone',database:'unavailable'});}}));
app.use(express.static(publicDir,{index:'index.html',maxAge:'1h',setHeaders(res,file){if(/(?:service-worker|sw\.js|index\.html)$/.test(file))res.set('Cache-Control','no-cache');}}));
app.use((_req,res)=>res.status(404).json({ok:false,error:'Not found.'}));
app.use((err,req,res,next)=>{console.error('[zippy] request error',err.code||err.message);if(res.headersSent)return next(err);res.status(500).json({ok:false,error:'Zippy could not complete that request. Please try again.'});});
async function start(){for(const key of ['ZIPPY_OWNER_EMAIL','ZIPPY_PASSWORD_HASH','ZIPPY_DB_PASSWORD'])if(!process.env[key])throw Error('Missing required '+key);await db.bootstrap();const port=Number(process.env.PORT||3109);app.listen(port,()=>console.log('[zippy] Standalone assistant listening on '+port));}
if(require.main===module)start().catch(e=>{console.error('[zippy] Startup aborted:',e.message);process.exitCode=1;});
module.exports={app,start};
