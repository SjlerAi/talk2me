'use strict';
const express=require('express'),crypto=require('node:crypto');
const router=express.Router();
const files=require('../services/office-artifacts'),mail=require('../services/office-mail'),inbox=require('../services/office-inbox');
const location='/backoffice/office-tools';
const live=()=>process.env.CRM_LIVE_MODE==='true'&&process.env.APP_URL==='https://crm.tk2m.co.za';
function manager(req,res,next){
 if(!live())return res.status(404).end();
 const user=req.session?.user;
 if(!user)return res.redirect('/login');
 if(!['owner','manager'].includes(String(user.role||'')))return res.status(403).type('text/plain').send('Management permission required');
 next();
}
function token(req){
 if(!req.session.tk2mOfficeCsrf)req.session.tk2mOfficeCsrf=crypto.randomBytes(32).toString('hex');
 return req.session.tk2mOfficeCsrf;
}
function checkForm(req,res,next){
 const a=String(req.session?.tk2mOfficeCsrf||''),b=String(req.body?.office_csrf||'');
 if(a.length!==64||b.length!==64||!(/^[0-9a-f]{64}$/).test(b)||
   !crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex')))
   return res.status(403).type('text/plain').send('Expired Office form. Reload and try again.');
 next();
}
const ownerMail=(user)=>mail.allowed(user);
const b4sOwner=(user)=>ownerMail(user)?.id===9;
const notice=(req,text)=>{req.session.tk2mOfficeNotice=String(text||'').slice(0,280)};
router.get(location,manager,async(req,res,next)=>{
 try{
  const user=req.session.user;
  const sender=ownerMail(user);
  const [documents,emails,smtp,inboxStatus]=await Promise.all([
   files.list(user.id),
   sender?mail.recent(user):Promise.resolve([]),
   sender?mail.verify(user):Promise.resolve({ready:false,reason:'Email is restricted to approved CRM owners'}),
   b4sOwner(user)?inbox.status(user):Promise.resolve(null)
  ]);
  let inboxList=null;
  if(b4sOwner(user)&&inboxStatus?.connected&&req.query.inbox==='1'){
    try{inboxList=await inbox.list(user);}catch(e){inboxList={error:'Inbox temporarily unavailable. Try again.'};}
  }
  const pending=req.session.officePendingEmail&&Number(req.session.officePendingEmail.expires)>Date.now()
   ?req.session.officePendingEmail:null;
  if(!pending)delete req.session.officePendingEmail;
  const message=req.session.tk2mOfficeNotice||String(req.query.message||'').slice(0,150);
  delete req.session.tk2mOfficeNotice;
  res.set('Cache-Control','private, no-store');
  res.render('office-tools',{title:'Office Email & Documents',officeCsrf:token(req),documents,emails,smtp,
   emailAllowed:Boolean(sender),senderIdentity:sender,inboxStatus,inboxList,pending,message});
 }catch(e){next(e)}
});
router.post(location+'/document',manager,checkForm,express.urlencoded({extended:false}),async(req,res,next)=>{
 try{
  const format=String(req.body?.format||'');
  const title=String(req.body?.title||'');
  const body=String(req.body?.body||'');
  const rows=format==='xlsx'
   ?body.replace(/\r/g,'').split('\n').filter(x=>x.trim()).slice(0,250).map(x=>x.split('\t').slice(0,15))
   :[];
  const doc=await files.create({staffId:req.session.user.id,source:'backoffice',format,title,body,rows});
  notice(req,'Created '+doc.filename+'. Select Download in your document list.');
  res.redirect(303,location);
 }catch(e){notice(req,'Document not created: '+String(e.message||'Error').slice(0,150));res.redirect(303,location)}
});
router.post(location+'/email/prepare',manager,checkForm,async(req,res,next)=>{
 try{
  if(!ownerMail(req.session.user))return res.status(403).type('text/plain').send('A verified CRM Owner email account is required.');
  const to=mail.cleanEmail(req.body?.to),subject=mail.cleanSubject(req.body?.subject),body=mail.cleanBody(req.body?.body);
  let attachmentId=Number(req.body?.attachment_id||0);
  if(!Number.isSafeInteger(attachmentId)||attachmentId<0)throw Error('Invalid document attachment');
  if(attachmentId && !await files.find(req.session.user.id,attachmentId))throw Error('Attached document not available');
  req.session.officePendingEmail={to,subject,body,attachmentId,
   token:crypto.randomBytes(32).toString('hex'),expires:Date.now()+10*60*1000};
  notice(req,'Email prepared for review. No message has been sent.');
  res.redirect(303,location);
 }catch(e){notice(req,'Email not prepared: '+String(e.message||'Error').slice(0,145));res.redirect(303,location)}
});
router.post(location+'/email/cancel',manager,checkForm,(req,res)=>{
 delete req.session.officePendingEmail;
 notice(req,'Email cancelled without sending.');
 res.redirect(303,location);
});
router.post(location+'/email/confirm',manager,checkForm,async(req,res,next)=>{
 try{
  const user=req.session.user;if(!ownerMail(user))return res.status(403).end();
  const pending=req.session.officePendingEmail;
  const supplied=String(req.body?.confirmation||'');
  if(!pending||pending.expires<Date.now()||supplied.length!==64||
      !(/^[a-f0-9]{64}$/).test(supplied)||
      !crypto.timingSafeEqual(Buffer.from(pending.token,'hex'),Buffer.from(supplied,'hex')))
    return res.status(403).type('text/plain').send('Email confirmation expired or invalid. Prepare a new preview.');
  delete req.session.officePendingEmail;
  await new Promise((ok,reject)=>req.session.save(e=>e?reject(e):ok()));
  const sent=await mail.send({actor:user,to:pending.to,subject:pending.subject,body:pending.body,
    requestId:pending.token,attachmentId:pending.attachmentId});
  notice(req,sent.accepted?'TK2M SMTP accepted email to '+sent.to+'. Inbox delivery is not yet confirmed.':
    (sent.message||'Email not confirmed as delivered; check history before doing anything else.'));
  res.redirect(303,location);
 }catch(e){notice(req,'Sending stopped: '+String(e.message||'Unknown').slice(0,145));res.redirect(303,location)}
});
router.get('/api/office-files/:id',manager,async(req,res,next)=>{
 try{
  const doc=await files.find(req.session.user.id,req.params.id);
  if(!doc)return res.status(404).type('text/plain').send('Document not found');
  res.set('Cache-Control','private, no-store');
  res.set('X-Content-Type-Options','nosniff');
  return res.download(doc.filepath,doc.filename,{headers:{'Content-Type':doc.mime}},err=>{if(err&&!res.headersSent)next(err)});
 }catch(e){next(e)}
});
router.post(location+'/inbox/connect',manager,checkForm,async(req,res)=>{
 if(!b4sOwner(req.session.user))return res.status(403).end();
 try{
  const result=await inbox.connectMailbox(req.session.user,req.body?.mailbox_password);
  notice(req,result.connected?'B4S incoming mailbox connected securely. Open Refresh Inbox.':'Mailbox not connected.');
 }catch(e){notice(req,'Inbox connection was not completed: '+String(e.message||'Check the mailbox credentials').slice(0,160));}
 if(req.body)delete req.body.mailbox_password;
 res.redirect(303,location+'?inbox=1');
});
router.post(location+'/inbox/disconnect',manager,checkForm,(req,res)=>{
 if(!b4sOwner(req.session.user))return res.status(403).end();
 try{inbox.disconnectMailbox(req.session.user);notice(req,'B4S inbox disconnected from TK2M. Existing emails remain at B4S.');}
 catch(_){notice(req,'Mailbox connection could not be removed.');}
 res.redirect(303,location);
});
router.get(location+'/inbox/:uid',manager,async(req,res,next)=>{
 try{
  if(!b4sOwner(req.session.user))return res.status(403).type('text/plain').send('B4S owner access required');
  const message=await inbox.read(req.session.user,req.params.uid);
  if(!message)return res.status(404).type('text/plain').send('Inbox message not found');
  res.set('Cache-Control','private, no-store');
  res.render('office-inbox-message',{title:'B4S Inbox Message',message,officeCsrf:token(req)});
 }catch(e){notice(req,'Inbox unavailable: '+String(e.message||'Connection error').slice(0,145));res.redirect(303,location);}
});
router.get(location+'/inbox/:uid/attachment/:index',manager,async(req,res,next)=>{
 try{
  if(!b4sOwner(req.session.user))return res.status(403).end();
  const attachment=await inbox.attachment(req.session.user,req.params.uid,req.params.index);
  if(!attachment)return res.status(404).end();
  res.set('Cache-Control','private, no-store');
  res.set('X-Content-Type-Options','nosniff');
  res.set('Content-Type','application/octet-stream');
  res.set('Content-Disposition','attachment; filename="'+attachment.filename+'"');
  return res.send(attachment.buffer);
 }catch(e){return res.status(404).type('text/plain').send('Attachment unavailable');}
});
router.post(location+'/inbox/:uid/mark-read',manager,checkForm,async(req,res)=>{
 if(!b4sOwner(req.session.user))return res.status(403).end();
 try{const changed=await inbox.markSeen(req.session.user,req.params.uid);
  notice(req,changed?'Message marked read in the B4S mailbox.':'Message not found');
 }catch(e){notice(req,'Could not change mailbox status');}
 res.redirect(303,location+'?inbox=1');
});
module.exports=router;
