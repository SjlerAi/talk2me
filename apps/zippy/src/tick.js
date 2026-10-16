'use strict';
const crypto=require('crypto');
const {query,utcSql,toIso}=require('./db');
const {nextDue}=require('./clock');
const {queueAlert,retryPushes}=require('./push-retry');
const {event}=require('./activity');
async function tick({onAlert}={}){
 const [due]=await query("SELECT id,owner_key,title,due_at,recurrence FROM zippy_reminders WHERE state='open' AND due_at<=UTC_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3)) ORDER BY due_at LIMIT 25");
 let created=0,failed=0;
 for(const r of due){const owner=r.owner_key,claim=crypto.randomUUID();const [updated]=await query("UPDATE zippy_reminders SET lease_id=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND) WHERE id=? AND owner_key=? AND state='open' AND due_at<=UTC_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3))",[claim,r.id,owner]);if(updated.affectedRows!==1)continue;
  const dueIso=toIso(r.due_at);try{
    const [result]=await query('INSERT IGNORE INTO zippy_alerts(owner_key,reminder_id,title,scheduled_at) VALUES(?,?,?,?)',[owner,r.id,r.title,r.due_at]);
    const [rows]=await query('SELECT id FROM zippy_alerts WHERE reminder_id=? AND scheduled_at=? LIMIT 1',[r.id,r.due_at]);
    const alertId=rows[0]?.id;
    if(result.affectedRows===1){created++;if(onAlert)await onAlert(r);await queueAlert(owner,Number(alertId));await event(owner,'reminder_due:'+r.id+':'+String(r.due_at),'reminder_due','Reminder due: '+r.title,'This reminder is waiting for you.',null);}
    const recurrence=r.recurrence||null;
    const next=recurrence?nextDue(dueIso,recurrence):null;
    await query('UPDATE zippy_reminders SET due_at=COALESCE(?,due_at),state=?,lease_id=NULL,lease_until=NULL WHERE id=? AND owner_key=? AND lease_id=?',[next?utcSql(next):null,next?'open':'fired',r.id,owner,claim]);
  }catch(err){failed++;console.error('[zippy] Reminder delivery failed',r.id,String(err.message).slice(0,160));await query('UPDATE zippy_reminders SET lease_id=NULL,lease_until=NULL WHERE id=? AND owner_key=? AND lease_id=?',[r.id,owner,claim]);}
 }
 const push=await retryPushes({maxItems:10});
 await query('INSERT INTO zippy_scheduler_status(id,last_tick_at,processed,failed) VALUES(1,UTC_TIMESTAMP(3),?,?) ON DUPLICATE KEY UPDATE last_tick_at=VALUES(last_tick_at),processed=VALUES(processed),failed=VALUES(failed)',[due.length,failed+push.failed]);
 return {created,failed,processed:due.length,push};
}
module.exports={tick};
