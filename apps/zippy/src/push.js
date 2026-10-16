'use strict';
const crypto=require('crypto');const {query,ownerKey}=require('./db');
function enabled(){return Boolean(process.env.ZIPPY_VAPID_PUBLIC_KEY&&process.env.ZIPPY_VAPID_PRIVATE_KEY&&process.env.ZIPPY_VAPID_SUBJECT);}
function endpointHash(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
async function saveSubscription(value){const s=value&&typeof value==='object'?value:null;if(!s||!String(s.endpoint||'').startsWith('https://')||!s.keys?.auth||!s.keys?.p256dh)throw Error('Invalid push subscription');const payload=JSON.stringify(s);if(payload.length>8192)throw Error('Subscription too large');await query('INSERT INTO zippy_push_subscriptions(owner_key,endpoint_hash,subscription_json) VALUES(?,?,?) ON DUPLICATE KEY UPDATE subscription_json=VALUES(subscription_json)',[ownerKey(),endpointHash(s.endpoint),payload]);}
async function sendPush({title,body,id}){
 if(!enabled())return {enabled:false,sent:0};
 const webpush=require('web-push');webpush.setVapidDetails(process.env.ZIPPY_VAPID_SUBJECT,process.env.ZIPPY_VAPID_PUBLIC_KEY,process.env.ZIPPY_VAPID_PRIVATE_KEY);
 const [rows]=await query('SELECT id,subscription_json FROM zippy_push_subscriptions WHERE owner_key=? LIMIT 30',[ownerKey()]);let sent=0;
 const payload=JSON.stringify({title,body,tag:'zippy-'+id,url:'/',alertId:id});
 for(const row of rows){try{await webpush.sendNotification(JSON.parse(row.subscription_json),payload,{TTL:3600,urgency:'high'});sent++;}catch(e){if([404,410].includes(Number(e.statusCode)))await query('DELETE FROM zippy_push_subscriptions WHERE id=? AND owner_key=?',[row.id,ownerKey()]);else console.error('[zippy] Push provider error',Number(e.statusCode)||e.code||'unknown');}}
 return {enabled:true,sent};
}
module.exports={enabled,saveSubscription,sendPush,endpointHash};
