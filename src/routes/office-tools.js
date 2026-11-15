'use strict';
const express=require('express'),crypto=require('node:crypto');
const router=express.Router();
const files=require('../services/office-artifacts'),mail=require('../services/office-mail');
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
const gerda=(user)=>Number(user?.id)===1&&String(user?.role)==='owner'&&String(user?.email||'').toLowerCase()===mail.REPLY_TO;
const notice=(req,text)=>{req.session.tk2mOfficeNotice=String(text||'').slice(0,280)};
router.get(location,manager,async(req,res,next)=>{
 try{
  const user=req.session.user;
  const [documents,emails,smtp]=await Promise.all([
   files.list(user.id),
   gerda(user)?mail.recent(user):Promise.resolve([]),
   gerda(user)?mail.verify(user):Promise.resolve({ready:false,reason:'Email is currently restricted to Gerda owner'})
  ]);
  const pending=req.session.officePendingEmail&&Number(req.session.officePendingEmail.expires)>Date.now()
   ?req.session.officePendingEmail:null;
  if(!pending)delete req.session.officePendingEmail;
  const message=req.session.tk2mOfficeNotice||String(req.query.message||'').slice(0,150);
  delete req.session.tk2mOfficeNotice;
  res.set('Cache-Control','private, no-store');
  res.render('office-tools',{title:'Office Email & Documents',officeCsrf:token(req),documents,emails,smtp,
   emailAllowed:gerda(user),pending,message});
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
  if(!gerda(req.session.user))return res.status(403).type('text/plain').send('Only the verified Gerda owner can send from this mailbox.');
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
  const user=req.session.user;if(!gerda(user))return res.status(403).end();
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
module.exports=router;
