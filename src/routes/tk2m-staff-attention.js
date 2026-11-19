'use strict';
const express = require('express');
const db = require('../config/db');
const {requireAuth} = require('../middleware/auth');
const {pendingAlerts,acknowledgeAlert} = require('../services/tk2m-staff-attention');
const {trackEvent}=require('../services/usage-telemetry');

const router = express.Router();
const live = String(process.env.CRM_LIVE_MODE || '').toLowerCase() === 'true';
router.get('/api/staff-attention/pending',requireAuth,async(req,res,next)=>{
  if(!live) return res.sendStatus(404);
  res.set('Cache-Control','private, no-store');
  try {
    const alerts=await pendingAlerts(db,req.session.user.id);
    res.json({ok:true,alerts});
  } catch(error) {next(error);}
});

router.post('/api/staff-attention/ack',requireAuth,async(req,res,next)=>{
  if(!live) return res.sendStatus(404);
  res.set('Cache-Control','private, no-store');
  try {
    const body=req.body||{};
    const result=await acknowledgeAlert(db,req.session.user.id,
      body.kind,body.id,body.method);
    if(result.status!==200) return res.status(result.status).json({ok:false,error:'Alert unavailable'});
    await trackEvent({staffId:req.session.user.id,eventType:'work_alert_acknowledged',
      screenKey:'communications-alert',routePath:'/api/staff-attention/ack',
      moduleName:'communications',httpMethod:'POST',httpStatus:200,
      metadata:{kind:String(body.kind||'').slice(0,12),method:String(body.method||'').slice(0,12)}});
    return res.json({ok:true});
  } catch(error) {next(error);}
});
module.exports=router;
