'use strict';
// TK2M staged staff authentication hardening; no effect on UENT CRM.
const crypto=require('node:crypto');
const {businessDate}=require('./auth');

const LIMIT_MS=15*60*1000;
const failures=new Map();
const hash=(v)=>crypto.createHash('sha256').update(String(v)).digest('hex');
function touch(key, now, shouldCount) {
  const row=failures.get(key);
  if(!row || row.expires<=now) {
    if(!shouldCount)return 0;
    failures.set(key,{count:1,expires:now+LIMIT_MS});
    return 1;
  }
  if(shouldCount)row.count++;
  return row.count;
}
function clean(now) {
  if(failures.size<=2000)return;
  for(const [k,v] of failures)if(v.expires<=now)failures.delete(k);
  // Do not let the protection map grow unbounded.
  while(failures.size>5000)failures.delete(failures.keys().next().value);
}
function loginKey(req) {
  const ip=String(req.ip||req.socket?.remoteAddress||'unknown').slice(0,128);
  const name=String(req.body?.email||'').trim().toLowerCase().slice(0,256);
  return {ip:'ip:'+hash(ip),account:'account:'+hash(name)};
}
function attempts(req,res,next) {
  if(String(process.env.CRM_STAGE_MODE||'')!=='true')return next();
  const now=Date.now();clean(now);
  const keys=loginKey(req);
  if(touch(keys.ip,now,false)>=40 || touch(keys.account,now,false)>=7) {
    res.set('Retry-After','900');
    return res.status(429).type('text/plain').send('Too many login attempts. Please try again later.');
  }
  req.loginAttemptKeys=keys;
  next();
}
function failed(req) {
  if(String(process.env.CRM_STAGE_MODE||'')!=='true')return;
  const keys=req.loginAttemptKeys||loginKey(req), now=Date.now();
  touch(keys.ip,now,true);
  touch(keys.account,now,true);
}
function succeeded(req) {
  if(String(process.env.CRM_STAGE_MODE||'')!=='true')return;
  const keys=req.loginAttemptKeys||loginKey(req);
  failures.delete(keys.account);
}
function csrf(req) {
  if(!req.session.loginCsrfToken)req.session.loginCsrfToken=crypto.randomBytes(32).toString('hex');
  return req.session.loginCsrfToken;
}
function validCsrf(req) {
  const expected=String(req.session?.loginCsrfToken||''),submitted=String(req.body?.login_csrf||'');
  if(expected.length!==64||submitted.length!==64||!(/^[0-9a-f]{64}$/).test(submitted))return false;
  return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(submitted,'hex'));
}
function protectPrivateRoutes(req,res,next) {
  if(String(process.env.CRM_STAGE_MODE||'')!=='true')return next();
  const p=req.path;
  // These are presentation resources only; no staff/customer exports are under /public.
  if(p==='/login' && (req.method==='GET' || req.method==='POST'))return next();
  if(req.method==='GET' && (p.startsWith('/public/') ||
      p==='/manifest.webmanifest' || p==='/service-worker.js' || p==='/offline'))return next();
  const user=req.session?.user;
  if(user && req.session.loginDate===businessDate())return next();
  res.set('Cache-Control','private, no-store');
  if(req.method==='GET' && !p.startsWith('/api/')) {
    return res.redirect(302,'/login');
  }
  return res.status(401).json({error:'CRM staff login required.'});
}
module.exports={attempts,failed,succeeded,csrf,validCsrf,protectPrivateRoutes};
