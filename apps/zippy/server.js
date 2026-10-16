'use strict';
require('dotenv').config();
const path=require('path');const crypto=require('crypto');const express=require('express');const helmet=require('helmet');
const db=require('./src/db');const auth=require('./src/auth');const {interpret}=require('./src/commands');const push=require('./src/push');const crm=require('./src/crm');
const {optionalAICommand}=require('./src/ai');
const publicDir=path.join(__dirname,'public');const app=express();
app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:'],fontSrc:["'self'"],connectSrc:["'self'"],workerSrc:["'self'"],manifestSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use(express.json({limit:'24kb'}));
app.use((req,res,next)=>{if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');next();});
const asyncHandler=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const isAuth=asyncHandler(async(req,res,next)=>{req.zippyIdentity=await auth.getUser(req);if(!req.zippyIdentity)return res.status(401).json({ok:false,error:'Please sign in to Zippy.'});next();});
app.post('/api/login',auth.requireMutation,asyncHandler(async(req,res)=>{const result=await auth.logIn({email:req.body?.email,password:req.body?.password,ip:req.ip});if(!result.ok)return res.status(result.unavailable?503:401).json({ok:false,error:result.error});res.setHeader('Set-Cookie',result.cookie);res.json({ok:true,name:result.name});}));
app.get('/api/me',asyncHandler(async(req,res)=>{const user=await auth.getUser(req);res.json({ok:true,authenticated:Boolean(user),name:user?.firstName||null,email:user?.email||null,role:user?.role||null,authSource:user?.source||null,timezone:'Africa/Johannesburg',crmConnected:crm.configured(),pushConfigured:push.enabled(),vapidPublicKey:push.enabled()?process.env.ZIPPY_VAPID_PUBLIC_KEY:null});}));
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
 res.status(201).json({ok:true,id:Number(result.insertId),text:'Saved. I will remind you '+new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(date)+'.'});
}));
app.post('/api/reminders/:id/action',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const id=Number(req.params.id),action=String(req.body?.action||'');if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({ok:false,error:'Invalid reminder.'});
 let result;
 if(action==='done'||action==='cancel'){const state=action==='done'?'done':'cancelled';[result]=await db.query('UPDATE zippy_reminders SET state=?,lease_id=NULL,lease_until=NULL WHERE id=? AND owner_key=?',[state,id,req.zippyIdentity.email]);}
 else if(action==='snooze'){const mins=Number(req.body?.minutes||10);if(![5,10,15,30,60,1440].includes(mins))return res.status(400).json({ok:false,error:'Choose a supported snooze interval.'});[result]=await db.query('UPDATE zippy_reminders SET due_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),state=\'open\',lease_id=NULL,lease_until=NULL WHERE id=? AND owner_key=?',[mins,id,req.zippyIdentity.email]);}
 else return res.status(400).json({ok:false,error:'Unsupported action.'});
 if(!result.affectedRows)return res.status(404).json({ok:false,error:'Reminder not found.'});res.json({ok:true});
}));
app.get('/api/alerts',isAuth,asyncHandler(async(req,res)=>{
 const [rows]=await db.query('SELECT id,reminder_id,title,created_at,read_at FROM zippy_alerts WHERE owner_key=? ORDER BY id DESC LIMIT 70',[req.zippyIdentity.email]);res.json({ok:true,alerts:rows.map(r=>({...r,createdAt:db.toIso(r.created_at)}))});
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
app.post('/api/push/subscribe',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{if(!push.enabled())return res.status(503).json({ok:false,error:'Push notifications are not configured yet.'});await push.saveSubscription(req.body?.subscription,req.zippyIdentity.email);res.json({ok:true});}));
app.post('/api/interpret',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const command=String(req.body?.message||'').slice(0,2500);let plan=interpret(command);
 if(plan.kind==='question'){const ai=await optionalAICommand(command);if(ai)plan=ai;}
 if(plan.kind==='question')return res.json({ok:true,status:'question',question:plan.question,original:command});
 if(plan.kind==='agenda')return res.json({ok:true,status:'agenda',text:'Here is your Zippy agenda.'});
 if(plan.kind==='office'){
  if(!crm.configured())return res.json({ok:true,status:'connection_pending',text:'This is a Talk2Me office instruction. The secure CRM connection still needs to be activated; nothing has been sent.'});
  const draft=await crm.bridgeCall('preview',{message:plan.original,source:req.body?.source==='voice'?'voice':'text',actorEmail:req.zippyIdentity.email});
  if(!draft.pendingToken)return res.json({ok:true,status:'crm_clarification',text:draft.text||'I need one more CRM detail.',choices:draft.choices||[]});
  const id=crypto.randomUUID();await db.query('INSERT INTO zippy_crm_drafts(id,owner_key,remote_token,preview_json,expires_at) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))',[id,req.zippyIdentity.email,draft.pendingToken,JSON.stringify(draft.preview||{})]);
  return res.json({ok:true,status:'crm_preview',draftId:id,text:draft.text,preview:draft.preview});
 }
 const [result]=await db.query('INSERT INTO zippy_reminders(owner_key,title,entry_type,due_at,recurrence) VALUES(?,?,?,?,?)',[req.zippyIdentity.email,plan.title,plan.entryType,db.utcSql(plan.dueAt),plan.recurrence]);
 return res.status(201).json({ok:true,status:'saved',id:Number(result.insertId),title:plan.title,dueAt:plan.dueAt,recurrence:plan.recurrence,text:'Saved: '+plan.title+'. I will remind you at the scheduled time.'});
}));
app.post('/api/crm/confirm',isAuth,auth.requireMutation,asyncHandler(async(req,res)=>{
 const id=String(req.body?.draftId||'');if(!/^[\da-f-]{36}$/i.test(id))return res.status(400).json({ok:false,error:'Invalid message preview.'});
 const [rows]=await db.query('SELECT remote_token,confirmed_at FROM zippy_crm_drafts WHERE id=? AND owner_key=? AND expires_at>UTC_TIMESTAMP(3) LIMIT 1',[id,req.zippyIdentity.email]);
 if(!rows.length||rows[0].confirmed_at)return res.status(409).json({ok:false,error:'This CRM preview has expired or was already confirmed.'});
 const sent=await crm.bridgeCall('confirm',{token:rows[0].remote_token,typedName:String(req.body?.typedName||''),actorEmail:req.zippyIdentity.email});
 await db.query('UPDATE zippy_crm_drafts SET confirmed_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_key=?',[id,req.zippyIdentity.email]);
 res.json({ok:true,status:'sent',text:sent.text||'The Talk2Me CRM instruction was sent.'});
}));
require('./src/internal-tick').attach(app);
app.get('/api/health',asyncHandler(async(_req,res)=>{try{await db.query('SELECT 1 AS ok');res.json({status:'ok',service:'zippy-standalone',database:'connected',crmBridge:crm.configured()});}catch(_){res.status(503).json({status:'error',service:'zippy-standalone',database:'unavailable'});}}));
app.use(express.static(publicDir,{index:'index.html',maxAge:'1h',setHeaders(res,file){if(/(?:service-worker|sw\.js|index\.html)$/.test(file))res.set('Cache-Control','no-cache');}}));
app.use((_req,res)=>res.status(404).json({ok:false,error:'Not found.'}));
app.use((err,req,res,next)=>{console.error('[zippy] request error',err.code||err.message);if(res.headersSent)return next(err);res.status(500).json({ok:false,error:'Zippy could not complete that request. Please try again.'});});
async function start(){for(const key of ['ZIPPY_OWNER_EMAIL','ZIPPY_PASSWORD_HASH','ZIPPY_DB_PASSWORD'])if(!process.env[key])throw Error('Missing required '+key);await db.bootstrap();const port=Number(process.env.PORT||3109);app.listen(port,()=>console.log('[zippy] Standalone assistant listening on '+port));}
if(require.main===module)start().catch(e=>{console.error('[zippy] Startup aborted:',e.message);process.exitCode=1;});
module.exports={app,start};
