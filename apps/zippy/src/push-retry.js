'use strict';
const {query}=require('./db');
const {sendPush}=require('./push');
// Push delivery is best effort: a provider acceptance cannot prove a
// notification was displayed or that a phone vibrated.
async function queueAlert(owner,alertId){
 if(!Number.isSafeInteger(Number(alertId))||Number(alertId)<=0)return;
 await query('INSERT IGNORE INTO zippy_push_retries(alert_id,owner_key) VALUES(?,?)',[alertId,owner]);
}
async function retryPushes({maxItems=10}={}){
 const [pending]=await query(
  'SELECT p.alert_id,p.owner_key,p.attempts,a.title FROM zippy_push_retries p '+
  'JOIN zippy_alerts a ON a.id=p.alert_id AND a.owner_key=p.owner_key '+
  'WHERE p.accepted_at IS NULL AND p.attempts<5 AND p.next_attempt_at<=UTC_TIMESTAMP(3) '+
  'ORDER BY p.next_attempt_at ASC LIMIT ?',[Math.max(1,Math.min(20,maxItems))]);
 let accepted=0,failed=0;
 for(const p of pending){
  let ok=false;
  try{
   const result=await sendPush({title:'Zippy reminder',body:p.title,id:p.alert_id,owner:p.owner_key});
   ok=Number(result?.sent)>0;
  }catch(e){
   console.error('[zippy] Retrying phone alert failed:',e.code||e.message);
  }
  const delay=[2,5,15,30,60][Math.min(4,Number(p.attempts)||0)];
  await query('UPDATE zippy_push_retries SET attempts=attempts+1,last_attempt_at=UTC_TIMESTAMP(3),'+
   'next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),'+
   'accepted_at=IF(?,UTC_TIMESTAMP(3),accepted_at) WHERE alert_id=? AND owner_key=?',
   [delay,ok?1:0,p.alert_id,p.owner_key]);
  if(ok){
   accepted++;
   await query('UPDATE zippy_alerts SET delivered_at=UTC_TIMESTAMP(3) WHERE id=? AND owner_key=?',
    [p.alert_id,p.owner_key]);
  }else failed++;
 }
 return {attempted:pending.length,accepted,failed};
}
async function resetRetriesForDevice(owner){
 // When a phone first opts in, try recent unsent alerts again without waiting
 // for the original backoff or deleting the private alert history.
 await query('UPDATE zippy_push_retries p JOIN zippy_alerts a ON a.id=p.alert_id '+
  'SET p.attempts=0,p.next_attempt_at=UTC_TIMESTAMP(3) '+
  'WHERE p.owner_key=? AND a.owner_key=? AND p.accepted_at IS NULL '+
  'AND a.created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)',[owner,owner]);
}
module.exports={queueAlert,retryPushes,resetRetriesForDevice};
