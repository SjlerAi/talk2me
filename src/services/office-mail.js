'use strict';
// Controlled, single-recipient Office email for the two verified Talk2Me owners.
// Never infer the sender from AI text or a request body.
const crypto=require('node:crypto'),fs=require('node:fs');
const nodemailer=require('nodemailer');
const db=require('../config/db');
const docs=require('./office-artifacts');
const FROM='gerda@tk2m.co.za',REPLY_TO='gerda@talk-online.co.za';
const IDENTITIES=Object.freeze({
 1:Object.freeze({id:1,email:'gerda@talk-online.co.za',from:FROM,replyTo:REPLY_TO,flag:'OFFICE_EMAIL_ENABLED',name:'Gerda via Talk2Me'}),
 9:Object.freeze({id:9,email:'info@b4s.co.za',from:'info@b4s.co.za',replyTo:'info@b4s.co.za',flag:'OFFICE_B4S_EMAIL_ENABLED',name:'Stephan via Talk2Me'})
});
let schemaPromise;
function identity(actor){
 const id=Number(actor?.id),item=IDENTITIES[id];
 if(process.env.CRM_LIVE_MODE!=='true'||process.env.APP_URL!=='https://crm.tk2m.co.za')
  throw Error('Only the verified live TK2M CRM can send Office email');
 if(!item||String(actor?.role)!=='owner'||String(actor?.email||'').trim().toLowerCase()!==item.email)
  throw Error('Approved owner account is required for this sender');
 return item;
}
const guard=identity;
const allowed=actor=>{
 try{return identity(actor)}catch(_){return null}
};
function cleanEmail(raw){
 const email=String(raw||'').trim().toLowerCase();
 if(email.length>254||!(/^[^@\s\x00-\x1f]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/).test(email)||email.includes('..'))
  throw Error('A valid single recipient email is required');
 return email;
}
function cleanSubject(raw){
 const subject=String(raw||'').trim();
 if(!subject||subject.length>180||/[\r\n\x00-\x1f]/.test(subject))throw Error('Email subject must be 1 to 180 characters, one line');
 return subject;
}
function cleanBody(raw){
 const body=String(raw||'').trim();
 if(!body||body.length>6000)throw Error('Email body must contain 1 to 6,000 characters');
 return body;
}
async function ensureSchema(){
 if(!schemaPromise)schemaPromise=db.execute(`CREATE TABLE IF NOT EXISTS crm_office_email_outbox(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 request_id CHAR(64) NOT NULL UNIQUE,
 actor_staff_id INT NOT NULL,
 from_email VARCHAR(255) NOT NULL,
 to_email VARCHAR(255) NOT NULL,
 subject VARCHAR(180) NOT NULL,
 body_sha256 CHAR(64) NOT NULL,
 attachment_id BIGINT UNSIGNED NULL,
 state VARCHAR(20) NOT NULL,
 provider_status VARCHAR(80) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at DATETIME NULL,
 INDEX idx_office_email_actor (actor_staff_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(e=>{schemaPromise=null;throw e});
 await schemaPromise;
}
function transporter(){
 return nodemailer.createTransport({host:'127.0.0.1',port:25,secure:false,ignoreTLS:true,
  connectionTimeout:8000,greetingTimeout:8000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
}
async function verify(actor){
 const i=identity(actor);
 if(process.env[i.flag]!=='true')return {ready:false,from:i.from,replyTo:i.replyTo,reason:'This sender is not enabled'};
 const mail=transporter();
 try{await mail.verify();return {ready:true,from:i.from,replyTo:i.replyTo};}
 catch(_){return {ready:false,from:i.from,replyTo:i.replyTo,reason:'The mail relay did not verify'};}
 finally{try{mail.close()}catch(_){}}
}
async function senderCurrent(actor,i){
 const [rows]=await db.execute('SELECT id,email,role,is_active FROM staff_users WHERE id=? LIMIT 1',[i.id]);
 if(rows.length!==1||Number(rows[0].is_active)!==1||rows[0].role!=='owner'||
    String(rows[0].email||'').trim().toLowerCase()!==i.email)
  throw Error('CRM owner identity is no longer active');
}
async function send({actor,to,subject,body,requestId,attachmentId=0}){
 const i=identity(actor);
 if(process.env[i.flag]!=='true')throw Error('This Office sender has not been enabled');
 if(!/^[a-f0-9]{64}$/.test(String(requestId)))throw Error('Invalid email confirmation token');
 const recipient=cleanEmail(to),title=cleanSubject(subject),content=cleanBody(body);
 await senderCurrent(actor,i);
 const smtp=await verify(actor);if(!smtp.ready)throw Error(smtp.reason||'Mail relay unavailable');
 await ensureSchema();
 const [[hour]]=await db.execute(
  "SELECT COUNT(*) n FROM crm_office_email_outbox WHERE actor_staff_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL 1 HOUR) AND state IN ('sending','accepted','unknown')",
  [i.id]);
 if(Number(hour.n)>=20)throw Error('Office mail safety limit reached for this sender');
 let attachment=null;
 if(attachmentId){
  attachment=await docs.find(i.id,attachmentId);
  if(!attachment||attachment.size_bytes>2000000)throw Error('Selected document is not authorised for this email');
 }
 const hash=crypto.createHash('sha256').update(content).digest('hex');
 try{
  await db.execute('INSERT INTO crm_office_email_outbox(request_id,actor_staff_id,from_email,to_email,subject,body_sha256,attachment_id,state) VALUES(?,?,?,?,?,?,?,?)',
   [requestId,i.id,i.from,recipient,title,hash,attachment?.id||null,'sending']);
 }catch(e){if(e.code==='ER_DUP_ENTRY')throw Error('This email was already confirmed or attempted. Do not send twice.');throw e}
 let mail;
 try{
  mail=transporter();
  const attachments=attachment?[{filename:attachment.filename,content:fs.readFileSync(attachment.filepath),contentType:attachment.mime}]:[];
  const result=await mail.sendMail({from:{name:i.name,address:i.from},replyTo:i.replyTo,to:recipient,subject:title,text:content,
   envelope:{from:i.from,to:[recipient]},attachments,disableFileAccess:true,disableUrlAccess:true});
  const accepted=(result.accepted||[]).map(s=>String(s).toLowerCase()).includes(recipient);
  const state=accepted?'accepted':'unknown';
  await db.execute('UPDATE crm_office_email_outbox SET state=?,provider_status=?,completed_at=NOW() WHERE request_id=?',
   [state,accepted?'smtp:250':'smtp:unverified',requestId]);
  return {state,to:recipient,subject:title,from:i.from,replyTo:i.replyTo,accepted};
 }catch(e){
  const beforeData=['EAUTH','ECONNREFUSED','EENVELOPE'].includes(String(e.code||''))||
   ['CONN','EHLO','HELO','MAIL FROM','RCPT TO'].includes(String(e.command||''));
  const state=beforeData?'failed':'unknown';
  await db.execute('UPDATE crm_office_email_outbox SET state=?,provider_status=?,completed_at=NOW() WHERE request_id=?',
   [state,state==='failed'?'smtp:pre-data-failed':'smtp:unverified',requestId]).catch(()=>{});
  return {state,to:recipient,subject:title,from:i.from,replyTo:i.replyTo,accepted:false,
   message:state==='unknown'?'SMTP acceptance could not be verified; do not send this draft again.':'The mail relay rejected the email before it was sent.'};
 }finally{try{mail?.close()}catch(_){}}
}
async function recent(actor){
 const i=identity(actor);await ensureSchema();
 const [rows]=await db.execute('SELECT id,to_email,subject,state,created_at,completed_at FROM crm_office_email_outbox WHERE actor_staff_id=? ORDER BY id DESC LIMIT 30',[i.id]);
 return rows;
}
module.exports={FROM,REPLY_TO,IDENTITIES,identity,allowed,cleanEmail,cleanSubject,cleanBody,guard,verify,send,recent,ensureSchema};
