'use strict';
// cPanel one-minute cron only. Never start an unbounded Passenger loop.
const fs=require('node:fs');
const dotenv=require('dotenv');
const envFile='/home/talk/crm-migration/production-runtime.env';
const env=dotenv.parse(fs.readFileSync(envFile));
for(const [key,wanted] of Object.entries({
 CRM_LIVE_MODE:'true',APP_URL:'https://crm.tk2m.co.za',
 DB_NAME:'talk_crm_stage',DB_USER:'talk_crmstg'
}))if(env[key]!==wanted)throw Error('Scheduled communications refused: bad '+key);
Object.assign(process.env,env,{TZ:'Africa/Johannesburg'});
const db=require('../src/config/db');
const {dispatchDue}=require('../src/services/tk2m-scheduled-communications');
const {trackEvent}=require('../src/services/usage-telemetry');
(async()=>{
 try{
  const processed=await dispatchDue(db,{limit:30});
  for(const item of processed){
   console.log('[schedule-dispatch]',JSON.stringify({id:item.id,taskId:item.taskId,
     status:item.status,reason:item.reason||null}));
   try{
    await trackEvent({staffId:item.senderId,
      eventType:item.status==='sent'?'communication_schedule_dispatched':'communication_schedule_failed',
      screenKey:'communications-scheduler',routePath:'/cron/tk2m-communications',
      moduleName:'communications',httpMethod:'POST',httpStatus:200,
      metadata:{scheduleId:item.id,taskId:item.taskId||null,recipientId:item.recipientId}});
   }catch(error){console.error('[schedule-audit]',error.message)}
  }
 }finally{await db.end()}
})().catch(error=>{console.error('[schedule-dispatch-error]',error.message);process.exitCode=1});
