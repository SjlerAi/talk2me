'use strict';
const express=require('express');
const multer=require('multer');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {trackEvent}=require('../services/usage-telemetry');
const {bookCommunication,pendingForSender,cancelCommunication}=require('../services/tk2m-scheduled-communications');
const router=express.Router();
const enabled=process.env.CRM_LIVE_MODE==='true';
const attachmentsDir=path.join(String(process.env.PRIVATE_UPLOAD_DIR||''),'tasks','attachments');
const allowedTypes=new Map([
 ['.pdf',['application/pdf']],
 ['.doc',['application/msword']],
 ['.docx',['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
 ['.xls',['application/vnd.ms-excel']],
 ['.xlsx',['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
 ['.ppt',['application/vnd.ms-powerpoint']],
 ['.pptx',['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
 ['.csv',['text/csv','application/csv','application/vnd.ms-excel','text/plain']],
 ['.txt',['text/plain']],
 ['.rtf',['application/rtf','text/rtf']],
 ['.jpg',['image/jpeg']],['.jpeg',['image/jpeg']],
 ['.png',['image/png']],['.webp',['image/webp']]
]);
const uploader=multer({
 storage:multer.diskStorage({
  destination(req,file,cb){try{
   if(!enabled||!String(process.env.PRIVATE_UPLOAD_DIR||'').startsWith('/home/talk/crm-live/'))throw Error('Scheduled uploads are unavailable.');
   fs.mkdirSync(attachmentsDir,{recursive:true,mode:0o700});
   cb(null,attachmentsDir);
  }catch(error){cb(error)}},
  filename(req,file,cb){
   const ext=path.extname(String(file.originalname||'')).toLowerCase();
   cb(null,Date.now()+'-'+crypto.randomBytes(16).toString('hex')+ext);
  }
 }),
 limits:{files:5,fileSize:15*1024*1024},
 fileFilter(req,file,cb){
  const ext=path.extname(String(file.originalname||'')).toLowerCase();
  const allow=allowedTypes.get(ext)||[];
  const valid=allow.includes(String(file.mimetype||'').toLowerCase());
  cb(valid?null:Error('Unsupported attachment. Use PDF, Office, CSV, text or image files.'),valid);
 }
}).array('attachments',5);
const removeFiles=files=>Promise.allSettled((files||[]).map(f=>{
 const filename=path.basename(String(f.filename||f.stored_filename||''));
 return filename?fs.promises.unlink(path.join(attachmentsDir,filename)):Promise.resolve();
}));
function safeUpload(req,res,next){
 if(!enabled)return res.sendStatus(404);
 uploader(req,res,error=>{
  if(error){
   void removeFiles(req.files);
   return res.status(400).json({ok:false,error:error.message||'Upload failed'});
  }
  next();
 });
}
async function auditSafe(args){try{await trackEvent(args)}catch(error){
 console.error('[schedule-audit]',error.message);
}}
router.get('/api/tk2m/communications/scheduled',requireAuth,async(req,res,next)=>{
 if(!enabled)return res.sendStatus(404);
 res.set('Cache-Control','private, no-store');
 try{
  res.json({ok:true,timezone:'Africa/Johannesburg',
   pending:await pendingForSender(db,req.session.user.id)});
 }catch(error){next(error)}
});
router.post('/api/tk2m/communications/scheduled',requireAuth,safeUpload,async(req,res,next)=>{
 res.set('Cache-Control','private, no-store');
 let persisted=false;
 try{
  const result=await bookCommunication(db,{
   senderId:req.session.user.id,
   recipientId:req.body?.assigned_to,
   message:req.body?.message,
   scheduledFor:req.body?.scheduled_for,
   files:req.files||[]
  });
  persisted=true;
  await auditSafe({staffId:req.session.user.id,eventType:'communication_scheduled',
    screenKey:'communications-quick-send',routePath:'/api/tk2m/communications/scheduled',
    moduleName:'communications',httpMethod:'POST',httpStatus:201,
    metadata:{scheduleId:result.id,recipientId:Number(req.body.assigned_to),
      scheduledFor:result.scheduledFor,attachments:result.attachmentCount}});
  res.status(201).json({ok:true,pending:true,...result});
 }catch(error){
  if(!persisted)await removeFiles(req.files);
  if(/Choose|Enter|schedule|date|time|recipient|attachment|valid|future|staff|colleague|year/i.test(error.message))
   return res.status(400).json({ok:false,error:error.message});
  next(error);
 }
});
router.post('/api/tk2m/communications/scheduled/:id/cancel',requireAuth,async(req,res,next)=>{
 if(!enabled)return res.sendStatus(404);
 res.set('Cache-Control','private, no-store');
 try{
  const result=await cancelCommunication(db,{senderId:req.session.user.id,id:req.params.id});
  if(!result.ok)return res.status(409).json({ok:false,error:'Already sent or cancelled. Refresh the scheduled list.'});
  await removeFiles(result.files.map(stored_filename=>({stored_filename})));
  await auditSafe({staffId:req.session.user.id,eventType:'communication_schedule_cancelled',
    screenKey:'communications-quick-send',routePath:'/api/tk2m/communications/scheduled/cancel',
    moduleName:'communications',httpMethod:'POST',httpStatus:200,
    metadata:{scheduleId:Number(req.params.id)}});
  res.json({ok:true,cancelled:true});
 }catch(error){next(error)}
});
module.exports=router;
