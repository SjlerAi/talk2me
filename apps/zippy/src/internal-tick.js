'use strict';
const crypto=require('crypto');
const {tick}=require('./tick');
const {syncAll}=require('./activity');
let running=false;
function attach(app){
 app.post('/api/internal/tick',async(req,res)=>{
  const secret=String(process.env.ZIPPY_CRON_SECRET||'');
  const supplied=String(req.get('x-zippy-cron')||'');
  if(secret.length<48||supplied.length!==secret.length||
   !crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(supplied))){
   return res.status(404).json({ok:false,error:'Not found'});
  }
  if(running)return res.status(202).json({ok:true,alreadyRunning:true});
  running=true;
  try{
   const result=await tick();
   // Poll only Zippy-tracked tasks. Failed CRM lookup must never stop
   // personal reminder scheduling or make its heartbeat unreliable.
   let crmSync={checked:0,updates:0,failed:0};
   try{crmSync=await syncAll();}catch(error){crmSync={checked:0,updates:0,failed:1};console.error('[zippy] background CRM sync unavailable',error.code||error.message);}
   res.set('Cache-Control','no-store');
   res.json({ok:true,...result,crmSync});
  }catch(error){
   console.error('[zippy] protected scheduler failed',error.code||error.message);
   res.status(503).json({ok:false,error:'Reminder scheduler unavailable'});
  }finally{running=false;}
 });
}
module.exports={attach};
