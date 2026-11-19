'use strict';
const express=require('express');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {dailyBrief,acknowledgeDailyBrief}=require('../services/tk2m-communications-brief');
const {listInbox}=require('../services/tk2m-unified-inbox');
const {positiveId,chatToken}=require('../services/tk2m-staff-attention');
const {trackEvent}=require('../services/usage-telemetry');
const router=express.Router();
const enabled=String(process.env.CRM_LIVE_MODE||'').toLowerCase()==='true';
router.post('/api/tk2m/communications/hide-team',requireAuth,async(req,res,next)=>{
 if(!enabled)return res.sendStatus(404);
 res.set('Cache-Control','private, no-store');
 try{
   const viewerId=positiveId(req.session.user.id),id=positiveId(req.body?.id);
   const role=String(req.session.user.role||'').toLowerCase();
   if(!viewerId||!id||req.body?.kind!=='task')
     return res.status(400).json({ok:false,error:'Invalid communication'});
   if(!['owner','manager','admin'].includes(role))
     return res.status(403).json({ok:false,error:'Only management can hide team items'});
   const [[task]]=await db.execute(
     `SELECT id,created_by,assigned_to FROM staff_tasks
       WHERE id=:id AND type='task' AND status IN ('unread','seen','in_progress')
       AND created_at>=DATE_SUB(NOW(),INTERVAL 2 DAY) LIMIT 1`,{id});
   if(!task)return res.status(404).json({ok:false,error:'Communication not in active list'});
   if(Number(task.created_by)===viewerId||Number(task.assigned_to)===viewerId)
     return res.status(403).json({ok:false,error:'Your own instructions remain until completed'});
   // Manager's personal Team overview only. The original instruction, staff
   // inboxes, reminders, sender approvals and audit history are untouched.
   await db.execute(`INSERT IGNORE INTO staff_attention_acknowledgments
     (staff_id,source_kind,source_id,source_key,ack_method)
     VALUES (:viewerId,'hide_team_task',:id,'communications-team','hide')`,{viewerId,id});
   await trackEvent({staffId:viewerId,eventType:'communications_hidden',
     screenKey:'communications-inbox',routePath:'/api/tk2m/communications/hide-team',
     moduleName:'communications',httpMethod:'POST',httpStatus:200,
     metadata:{kind:'team_task'}});
   res.json({ok:true,hidden:true});
 }catch(error){next(error);}
});
router.post('/api/tk2m/communications/clear',requireAuth,async(req,res,next)=>{
 if(!enabled)return res.sendStatus(404);
 res.set('Cache-Control','private, no-store');
 try{
   const staffId=positiveId(req.session.user.id);
   const id=positiveId(req.body?.id);
   if(!staffId||!id||req.body?.kind!=='legacy_chat')
     return res.status(400).json({ok:false,error:'Invalid communication'});
   const [[msg]]=await db.execute(
     'SELECT id,conversation_key FROM staff_chat_messages WHERE id=:id LIMIT 1',{id});
   if(!msg||!chatToken(staffId,msg.conversation_key))
     return res.status(404).json({ok:false,error:'Communication not available'});
   // A recipient or sender may hide ONLY their own view of a historical
   // chat. No message is deleted, modified, marked read or completed.
   await db.execute(`INSERT IGNORE INTO staff_attention_acknowledgments
     (staff_id,source_kind,source_id,source_key,ack_method)
     VALUES (:staffId,'hide_chat',:id,:key,'clear')`,
     {staffId,id,key:String(msg.conversation_key).slice(0,80)});
   await trackEvent({staffId,eventType:'communications_cleared',
     screenKey:'communications-inbox',routePath:'/api/tk2m/communications/clear',
     moduleName:'communications',httpMethod:'POST',httpStatus:200,
     metadata:{kind:'legacy_chat'}});
   res.json({ok:true,cleared:true});
 }catch(error){next(error);}
});
router.get('/api/tk2m/communications/inbox',requireAuth,async(req,res,next)=>{
 if(!enabled)return res.sendStatus(404);
 res.set('Cache-Control','private, no-store');
 try{
   const role=String(req.session.user.role||'').toLowerCase();
   const canSeeTeam=['owner','admin','manager'].includes(role);
   const scope=req.query.scope==='team'&&canSeeTeam?'team':'mine';
   res.json(await listInbox(db,req.session.user.id,{scope}));
 }catch(error){next(error);}
});
router.get('/api/tk2m/communications/people',requireAuth,async(req,res,next)=>{
 if(!enabled)return res.sendStatus(404);
 res.set('Cache-Control','private, no-store');
 try{
  const staffId=Number(req.session.user.id);
  const [rows]=await db.execute(
   `SELECT id,full_name,first_name,role
    FROM staff_users
    WHERE is_active=1 AND id<>:staffId AND password_hash IS NOT NULL
      AND COALESCE(username,'')<>'chatgpt_crm_test'
    ORDER BY full_name ASC`,{staffId});
  res.json({ok:true,staff:rows.map(p=>({
   id:Number(p.id),name:String(p.first_name||p.full_name||'Staff').trim().split(/\s+/).slice(0,2).join(' '),
   fullName:String(p.full_name||'Staff'),role:p.role
  }))});
 }catch(error){next(error);}
});
router.get('/api/tk2m/communications/brief',requireAuth,async(req,res,next)=>{
 if(!enabled)return res.sendStatus(404);
 res.set('Cache-Control','private, no-store');
 try{res.json(await dailyBrief(db,req.session.user.id));}catch(error){next(error);}
});
router.post('/api/tk2m/communications/brief/ack',requireAuth,async(req,res,next)=>{
 if(!enabled)return res.sendStatus(404);
 res.set('Cache-Control','private, no-store');
 try{
  const result=await acknowledgeDailyBrief(db,req.session.user.id,req.body?.kind);
  if(result.status!==200)return res.status(result.status).json({ok:false,error:'Brief unavailable'});
  await trackEvent({staffId:req.session.user.id,eventType:'communications_brief_reviewed',
    screenKey:'communications-briefing',routePath:'/api/tk2m/communications/brief/ack',
    moduleName:'communications',httpMethod:'POST',httpStatus:200,metadata:{kind:String(req.body?.kind||'').slice(0,12)}});
  res.json({ok:true});
 }catch(error){next(error);}
});
module.exports=router;
