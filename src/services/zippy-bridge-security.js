'use strict';
// Requests from the standalone Zippy site are authenticated independently of
// browser sessions. Every call is signed, time-limited and checked for replay.
const crypto=require('crypto');
const MAX_SKEW_MS=120000;
function bodyHash(payload){return crypto.createHash('sha256').update(JSON.stringify(payload??{})).digest('hex');}
function canonical({timestamp,nonce,path,payload}){
 return [String(timestamp),String(nonce),String(path),bodyHash(payload)].join('\n');
}
function signature({timestamp,nonce,path,payload},secret){
 return crypto.createHmac('sha256',String(secret)).update(canonical({timestamp,nonce,path,payload})).digest('hex');
}
function verifySigned({timestamp,nonce,path,payload,signature:received},secret,now=Date.now()){
 if(!secret||String(secret).length<64)return {ok:false,reason:'bridge_not_configured'};
 if(!/^\d{13}$/.test(String(timestamp))||!Number.isSafeInteger(Number(timestamp))
   ||Math.abs(now-Number(timestamp))>MAX_SKEW_MS)return {ok:false,reason:'expired'};
 if(!/^[0-9a-f]{32}$/.test(String(nonce)))return {ok:false,reason:'invalid_nonce'};
 if(!['/api/integrations/zippy/preview','/api/integrations/zippy/confirm'].includes(path))
   return {ok:false,reason:'invalid_path'};
 if(!/^[a-f0-9]{64}$/.test(String(received)))return {ok:false,reason:'invalid_signature'};
 const expected=signature({timestamp,nonce,path,payload},secret);
 if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(received,'hex')))
   return {ok:false,reason:'invalid_signature'};
 return {ok:true};
}
module.exports={MAX_SKEW_MS,canonical,signature,verifySigned};
