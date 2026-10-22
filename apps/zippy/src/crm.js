'use strict';
const crypto=require('crypto');
function configured(){return Boolean(process.env.ZIPPY_CRM_BASE_URL&&process.env.ZIPPY_CRM_BRIDGE_SECRET&&process.env.ZIPPY_CRM_BRIDGE_SECRET.length>=32);}
async function bridgeCall(action,payload){
 if(!configured())throw new Error('CRM connection is not configured yet. Your personal Zippy reminders still work.');
 if(!['preview','confirm','updates','lookup'].includes(action))throw Error('Unsupported CRM operation');
 const path='/api/integrations/zippy/'+action;
 const base=String(process.env.ZIPPY_CRM_BASE_URL).replace(/\/+$/,'');
 const url=new URL(base+path);
 if(url.protocol!=='https:')throw Error('Talk2Me CRM integration requires HTTPS.');
 const body=JSON.stringify(payload),when=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex');
 const contentHash=crypto.createHash('sha256').update(body).digest('hex');
 const signed=[when,nonce,path,contentHash].join('\n');
 const signature=crypto.createHmac('sha256',process.env.ZIPPY_CRM_BRIDGE_SECRET).update(signed).digest('hex');
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),Math.min(15000,Number(process.env.ZIPPY_CRM_TIMEOUT_MS)||8000));
 try{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Zippy-Time':when,'X-Zippy-Nonce':nonce,'X-Zippy-Signature':signature},body,signal:controller.signal,redirect:'error'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'CRM rejected the request');
  return data;
 }finally{clearTimeout(timeout);}
}
module.exports={configured,bridgeCall};
