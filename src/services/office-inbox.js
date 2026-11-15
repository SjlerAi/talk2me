'use strict';
// Owner-isolated, READ-ON-DEMAND IMAP mailbox. The remote inbox remains
// authoritative; never mirror, delete or auto-mark emails read.
const fs=require('node:fs'),crypto=require('node:crypto');
const dotenv=require('dotenv');
// Load the private pinned IMAP runtime only when a configured mailbox is accessed.
const imapRuntime=()=>require('/home/talk/crm-live/mail-runtime/node_modules/imapflow').ImapFlow;
const mimeParser=()=>require('/home/talk/crm-live/mail-runtime/node_modules/mailparser').simpleParser;
const mail=require('./office-mail');
const CONFIG='/home/talk/crm-live/private-mail/b4s-imap.env';
const ID='info@b4s.co.za',HOST='mail.b4s.co.za';
function guard(actor){
 const i=mail.identity(actor);
 if(i.id!==9||i.from!==ID)throw Error('Only Stephan may access the B4S mailbox');
 return i;
}
function settings(actor){
 guard(actor);
 if(!fs.existsSync(CONFIG))return {ready:false,reason:'B4S mailbox login has not been connected. SMTP sending can still work.'};
 const stat=fs.statSync(CONFIG);
 if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('Mailbox secret file permissions are unsafe');
 const data=dotenv.parse(fs.readFileSync(CONFIG));
 if(data.B4S_IMAP_HOST!==HOST||data.B4S_IMAP_USER!==ID||data.B4S_IMAP_PORT!=='993'||
    data.B4S_IMAP_ENABLED!=='true'||String(data.B4S_IMAP_PASSWORD||'').length<4)
  return {ready:false,reason:'B4S secure IMAP connection is not configured'};
 return {ready:true,host:HOST,user:ID,pass:data.B4S_IMAP_PASSWORD};
}
async function open(actor){
 const s=settings(actor);
 if(!s.ready)throw Error(s.reason);
 const Client=imapRuntime();
 const client=new Client({host:HOST,port:993,secure:true,
  auth:{user:ID,pass:s.pass},logger:false,disableAutoIdle:true,
  tls:{rejectUnauthorized:true,servername:HOST},
  connectionTimeout:8500,greetingTimeout:8500,socketTimeout:12000});
 try{await client.connect();return client}
 catch(e){try{await client.logout()}catch(_){}
  if(['AUTHENTICATIONFAILED','AUTHENTICATIONFAILEDERR'].includes(e.code))throw Error('B4S mailbox credentials were rejected');
  throw Error('B4S secure inbox connection failed; verify mailbox access');
 }
}
async function withInbox(actor,fn,{readOnly=true}={}){
 const client=await open(actor);
 let lock;
 try{
  lock=await client.getMailboxLock('INBOX',{readOnly});
  return await fn(client);
 }finally{try{lock?.release()}catch(_){}
  try{await client.logout()}catch(_){}}
}
async function status(actor){
 const s=settings(actor);
 if(!s.ready)return {connected:false,mailbox:ID,reason:s.reason};
 try{await withInbox(actor,async()=>{});return {connected:true,mailbox:ID,host:HOST};}
 catch(e){return {connected:false,mailbox:ID,reason:e.message}}
}
function uid(raw){
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<1||n>4294967295||String(n)!==String(raw))
  throw Error('Invalid inbox message number');
 return n;
}
const limited=s=>String(s||'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
function address(list){
 const first=(Array.isArray(list)?list:[]).find(x=>x?.address);
 return first?.address?limited(first.address).slice(0,254):'';
}
async function list(actor){
 return withInbox(actor,async client=>{
  const all=await client.search({all:true},{uid:true})||[];
  const latest=all.filter(n=>Number.isSafeInteger(n)&&n>0).slice(-40);
  if(!latest.length)return {mailbox:ID,messages:[]};
  const received=await client.fetchAll(latest.join(','),{uid:true,envelope:true,flags:true,internalDate:true,size:true},{uid:true});
  return {mailbox:ID,messages:received.map(m=>({
   uid:m.uid,from:address(m.envelope?.from),replyTo:address(m.envelope?.replyTo),
   subject:limited(m.envelope?.subject||'(no subject)').slice(0,220),
   date:m.internalDate?new Date(m.internalDate).toISOString():null,
   unread:!m.flags?.has('\\Seen'),bytes:Number(m.size||0)
  })).sort((a,b)=>b.uid-a.uid)};
 });
}
async function parse(actor,id){
 const n=uid(id);
 return withInbox(actor,async client=>{
  const meta=await client.fetchOne(n,{uid:true,size:true,envelope:true},{uid:true});
  if(!meta)return null;
  if(Number(meta.size||0)>3500000)throw Error('Message is too large for the Office inbox viewer');
  const raw=await client.fetchOne(n,{source:true},{uid:true});
  if(!raw?.source)return null;
  const parsed=await mimeParser()(raw.source,{skipHtmlToText:false,maxHtmlLength:100000});
  const originalFrom=parsed.from?.value?.[0]?.address||'';
  const reply=parsed.replyTo?.value?.[0]?.address||originalFrom;
  const items=(parsed.attachments||[]).slice(0,20);
  return {uid:n,from:limited(originalFrom).slice(0,254),replyTo:limited(reply).slice(0,254),
   subject:limited(parsed.subject||'(no subject)').slice(0,220),
   date:parsed.date?.toISOString()||null,
   messageId:limited(parsed.messageId||'').slice(0,254),
   text:String(parsed.text||'').slice(0,25000),
   attachments:items.map((a,index)=>({index,filename:limited(a.filename||('attachment-'+(index+1))).slice(0,140),
    type:limited(a.contentType||'application/octet-stream').slice(0,120),size:a.size||a.content?.length||0})),
   _attachmentData:items};
 });
}
async function read(actor,id){
 const m=await parse(actor,id);
 if(!m)return null;
 const {_attachmentData,...plain}=m;return plain;
}
async function attachment(actor,id,index){
 const idx=Number(index);
 if(!Number.isSafeInteger(idx)||idx<0||idx>19||String(idx)!==String(index))
  throw Error('Invalid attachment index');
 const m=await parse(actor,id);
 if(!m||!m._attachmentData[idx])return null;
 const a=m._attachmentData[idx];
 if(!Buffer.isBuffer(a.content)||a.content.length>2000000)throw Error('Attachment exceeds the 2MB safe-download limit');
 return {filename:limited(a.filename||'attachment').replace(/[^A-Za-z0-9._-]/g,'-').slice(0,135),
  buffer:a.content,contentType:'application/octet-stream'};
}
async function markSeen(actor,id){
 const n=uid(id);
 return withInbox(actor,async client=>{
  const found=await client.fetchOne(n,{uid:true},{uid:true});
  if(!found)return false;
  await client.messageFlagsAdd(n,['\\Seen'],{uid:true});
  return true;
 },{readOnly:false});
}
const attempts=new Map();
async function connectMailbox(actor,password){
 guard(actor);
 const secret=String(password||'');
 if(secret.length<6||secret.length>256||/[\r\n\x00]/.test(secret))throw Error('Enter the valid B4S mailbox password');
 const key='owner9',now=Date.now(),rate=attempts.get(key)||{first:now,count:0};
 if(now-rate.first>60*60*1000){rate.first=now;rate.count=0}
 if(rate.count>=5)throw Error('Too many mailbox connection attempts. Try again later.');
 rate.count++;attempts.set(key,rate);
 const Client=imapRuntime();
 const client=new Client({host:HOST,port:993,secure:true,auth:{user:ID,pass:secret},
  logger:false,disableAutoIdle:true,tls:{rejectUnauthorized:true,servername:HOST},
  connectionTimeout:8500,greetingTimeout:8500,socketTimeout:12000});
 let lock;
 try{
  await client.connect();
  lock=await client.getMailboxLock('INBOX',{readOnly:true});
 }catch(_){throw Error('B4S mailbox sign-in was not accepted. Check the mailbox password or app password.');}
 finally{try{lock?.release()}catch(_){}try{await client.logout()}catch(_){}}
 const folder='/home/talk/crm-live/private-mail';
 if((fs.statSync(folder).mode&0o077)!==0)throw Error('Unsafe private mailbox directory');
 const config=['B4S_IMAP_ENABLED=true','B4S_IMAP_HOST='+HOST,'B4S_IMAP_PORT=993',
  'B4S_IMAP_USER='+ID,'B4S_IMAP_PASSWORD='+JSON.stringify(secret),''].join('\n');
 const temp=CONFIG+'.tmp-'+crypto.randomBytes(8).toString('hex');
 try{fs.writeFileSync(temp,config,{mode:0o600,flag:'wx'});fs.renameSync(temp,CONFIG);}
 finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 attempts.delete(key);
 return {connected:true,mailbox:ID};
}
function disconnectMailbox(actor){
 guard(actor);
 if(fs.existsSync(CONFIG))fs.unlinkSync(CONFIG);
 return {connected:false,mailbox:ID};
}
module.exports={ID,HOST,CONFIG,guard,settings,status,uid,list,read,attachment,markSeen,connectMailbox,disconnectMailbox};
