'use strict';
const express=require('express');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {dailyBrief,acknowledgeDailyBrief}=require('../services/tk2m-communications-brief');
const {trackEvent}=require('../services/usage-telemetry');
const router=express.Router();
const enabled=String(process.env.CRM_LIVE_MODE||'').toLowerCase()==='true';
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
