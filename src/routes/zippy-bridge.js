'use strict';
// Optional, UAT-only bridge for the standalone Zippy service. Service HMAC,
// nonce and time-window checks happen before any CRM person resolution.
const express=require('express');
const crypto=require('crypto');
const db=require('../config/db');
const {prepareNaturalCommand}=require('../services/cudo-natural-plan');
const {sendNaturalCommand}=require('../services/cudo-natural-send');
const router=express.Router();
const BASE='/api/integrations/zippy';
const IS_UAT=String(process.env.UAT_MODE||'').toLowerCase()==='true';
function configured(){return IS_UAT&&String(process.env.ZIPPY_BRIDGE_SECRET||'').length>=32&&Number.isSafeInteger(Number(process.env.ZIPPY_BRIDGE_GERDA_STAFF_ID))&&Number(process.env.ZIPPY_BRIDGE_GERDA_STAFF_ID)>0;}
let schemaPromise;
function ensureSchema(){if(!schemaPromise){schemaPromise=(async()=>{
 await db.execute('CREATE TABLE IF NOT EXISTS zippy_bridge_nonces (nonce CHAR(32) PRIMARY KEY, used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
 await db.execute("CREATE TABLE IF NOT EXISTS zippy_bridge_drafts (id CHAR(36) PRIMARY KEY, issued_by INT NOT NULL, action_json MEDIUMTEXT NOT NULL, status ENUM('pending','processing','sent') NOT NULL DEFAULT 'pending', expires_at DATETIME NOT NULL, result_json TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_expiry (expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
 })().catch(err=>{schemaPromise=null;throw err});}return schemaPromise;}
function sign({when,nonce,path,body,secret}){
 const hash=crypto.createHash('sha256').update(JSON.stringify(body??{})).digest('hex');
 return crypto.createHmac('sha256',secret).update([when,nonce,path,hash].join('\n')).digest('hex');
}
function compare(a,b){if(!/^[a-f\d]{64}$/i.test(String(a||''))||!/^[a-f\d]{64}$/i.test(String(b||'')))return false;
 return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
async function authenticate(req,res,next){try{
 if(!configured())return res.status(404).json({ok:false,error:'Zippy bridge disabled.'});
 if(req.method!=='POST'||!req.is('application/json'))return res.status(415).json({ok:false,error:'JSON POST required.'});
 const when=String(req.get('x-zippy-time')||''),nonce=String(req.get('x-zippy-nonce')||''),signature=req.get('x-zippy-signature');
 if(!/^\d{13}$/.test(when)||Math.abs(Date.now()-Number(when))>60000||!/^[a-f\d]{32}$/i.test(nonce))return res.status(401).json({ok:false,error:'Stale or invalid service request.'});
 const expected=sign({when,nonce,path:req.path,body:req.body,secret:process.env.ZIPPY_BRIDGE_SECRET});
 if(!compare(expected,signature))return res.status(401).json({ok:false,error:'Service signature rejected.'});
 await ensureSchema();
 try{await db.execute('INSERT INTO zippy_bridge_nonces(nonce) VALUES(:nonce)',{nonce});}catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({ok:false,error:'Request already received.'});throw e;}
 const id=Number(process.env.ZIPPY_BRIDGE_GERDA_STAFF_ID);
 const [[person]]=await db.execute('SELECT id,role,is_active FROM staff_users WHERE id=:id LIMIT 1',{id});
 if(!person||!Number(person.is_active)||!['owner','manager'].includes(String(person.role||'').toLowerCase()))return res.status(403).json({ok:false,error:'Configured Gerda CRM identity is not authorised.'});
 req.zippyStaffId=id;res.set('Cache-Control','no-store');next();
 }catch(err){next(err);}}
router.post(BASE+'/preview',authenticate,async(req,res,next)=>{try{
 const message=String(req.body?.message||'').trim().slice(0,2500);
 if(message.length<6)return res.status(400).json({ok:false,error:'A staff instruction is required.'});
 const plan=await prepareNaturalCommand({message,source:req.body?.source==='voice'?'voice':'text',requesterId:req.zippyStaffId});
 if(!plan.handled)return res.json({ok:true,text:'This command did not describe a clear CRM staff action. Please give the staff name and instruction.',choices:[],pendingToken:null});
 if(!plan.pendingAction||plan.pendingAction.type!=='natural_instruction')return res.json({ok:true,text:plan.text,choices:plan.choices||[],pendingToken:null});
 if(plan.pendingAction.channel!=='internal')return res.json({ok:true,text:'External messaging is not available through Zippy yet. Use a Talk2Me internal staff message.',pendingToken:null});
 const token=crypto.randomUUID();await db.execute("INSERT INTO zippy_bridge_drafts(id,issued_by,action_json,expires_at) VALUES(:token,:id,:action,DATE_ADD(NOW(),INTERVAL 10 MINUTE))",{token,id:req.zippyStaffId,action:JSON.stringify(plan.pendingAction)});
 res.json({ok:true,text:plan.text,preview:plan.preview,pendingToken:token});
 }catch(err){next(err);}});
router.post(BASE+'/confirm',authenticate,async(req,res,next)=>{try{
 const token=String(req.body?.token||'');if(!/^[\da-f-]{36}$/i.test(token))return res.status(400).json({ok:false,error:'Invalid Zippy approval.'});
 const [[row]]=await db.execute('SELECT id,action_json,status,result_json FROM zippy_bridge_drafts WHERE id=:token AND issued_by=:id AND expires_at>NOW() LIMIT 1',{token,id:req.zippyStaffId});
 if(!row)return res.status(410).json({ok:false,error:'Message preview expired. Please repeat the instruction.'});
 if(row.status==='sent')return res.json({ok:true,...JSON.parse(row.result_json||'{}')});
 if(row.status==='processing')return res.status(409).json({ok:false,error:'The message is already being sent. Please wait.'});
 const [changed]=await db.execute("UPDATE zippy_bridge_drafts SET status='processing' WHERE id=:token AND issued_by=:id AND status='pending'",{token,id:req.zippyStaffId});
 if(!changed.affectedRows)return res.status(409).json({ok:false,error:'The message is already being processed.'});
 try{
  const draft=JSON.parse(row.action_json);
  if(draft.requesterId&&Number(draft.requesterId)!==req.zippyStaffId)throw Error('CRM requester does not match Gerda.');
  if(draft.channel!=='internal')throw Error('External sending is disabled for the Zippy bridge.');
  const result=await sendNaturalCommand({draft,actorId:req.zippyStaffId,typedName:req.body?.typedName});
  await db.execute("UPDATE zippy_bridge_drafts SET status='sent',result_json=:result WHERE id=:token AND issued_by=:id",{result:JSON.stringify(result),token,id:req.zippyStaffId});
  return res.json({ok:true,...result});
 }catch(err){await db.execute("UPDATE zippy_bridge_drafts SET status='pending' WHERE id=:token AND issued_by=:id AND status='processing'",{token,id:req.zippyStaffId});throw err;}
 }catch(err){res.status(400).json({ok:false,error:String(err.message||'Sending failed').slice(0,180)});}});
router.use((err,req,res,next)=>{console.error('[zippy bridge]',err.code||err.message);res.status(503).json({ok:false,error:'CRM bridge is temporarily unavailable.'});});
module.exports={router,sign,compare,configured};
