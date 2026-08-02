'use strict';

const crypto = require('crypto');

const MUTATING = new Set(['POST','PUT','PATCH','DELETE']);
const buckets = new Map();

function requestId(req,res,next){
  const supplied=String(req.headers['x-request-id']||'').trim();
  req.requestId=/^[A-Za-z0-9._-]{8,64}$/.test(supplied)?supplied:crypto.randomUUID();
  res.setHeader('X-Request-Id',req.requestId);
  next();
}

function securityHeaders(req,res,next){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if(process.env.NODE_ENV==='production') res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  next();
}

function sameOrigin(req,res,next){
  if(!MUTATING.has(req.method)||req.path==='/api/auth/login') return next();
  const origin=String(req.headers.origin||'').trim();
  if(!origin) return next();
  let parsed;
  try{parsed=new URL(origin);}catch{return res.status(403).json({ok:false,error:'INVALID_REQUEST_ORIGIN'});}
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim().toLowerCase();
  if(parsed.host.toLowerCase()!==host) return res.status(403).json({ok:false,error:'CROSS_ORIGIN_REQUEST_BLOCKED'});
  next();
}

function rateLimit({windowMs=60000,max=120,keyPrefix='general'}={}){
  return function(req,res,next){
    const now=Date.now();
    const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
    const key=`${keyPrefix}:${ip}`;
    let item=buckets.get(key);
    if(!item||item.resetAt<=now) item={count:0,resetAt:now+windowMs};
    item.count+=1;buckets.set(key,item);
    res.setHeader('X-RateLimit-Limit',String(max));
    res.setHeader('X-RateLimit-Remaining',String(Math.max(0,max-item.count)));
    res.setHeader('X-RateLimit-Reset',String(Math.ceil(item.resetAt/1000)));
    if(item.count>max) return res.status(429).json({ok:false,error:'RATE_LIMIT_EXCEEDED'});
    next();
  };
}

function hashIdentity(value){return crypto.createHash('sha256').update(String(value||'').trim().toLowerCase()).digest('hex');}
function redact(value){
  if(Array.isArray(value)) return value.map(redact);
  if(!value||typeof value!=='object') return value;
  const hidden=new Set(['password','password_hash','token','session','session_id','authorization','cookie','smtp_pass']);
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,hidden.has(k.toLowerCase())?'[REDACTED]':redact(v)]));
}

async function recordSecurityEvent(pool,req,{eventType,severity='info',staffId=null,details=null}){
  if(!pool) return;
  try{
    await pool.execute(`INSERT INTO os2_security_events
      (event_type,severity,staff_id,session_id,request_id,ip_address,user_agent,route,method,details_json,created_at)
      VALUES (:eventType,:severity,:staffId,:sessionId,:requestId,:ip,:userAgent,:route,:method,:details,NOW())`,{
      eventType,severity,staffId:staffId||req.user?.id||null,sessionId:req.sessionToken||null,
      requestId:req.requestId||null,ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),
      userAgent:String(req.headers['user-agent']||'').slice(0,255),route:String(req.originalUrl||req.url||'').slice(0,255),
      method:req.method,details:details?JSON.stringify(redact(details)):null
    });
  }catch(error){console.error('Security event logging failed',error.code||error.message);}
}

setInterval(()=>{const now=Date.now();for(const [k,v] of buckets) if(v.resetAt<=now) buckets.delete(k);},60000).unref();

module.exports={requestId,securityHeaders,sameOrigin,rateLimit,hashIdentity,redact,recordSecurityEvent};
