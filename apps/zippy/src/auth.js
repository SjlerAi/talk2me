'use strict';
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {query,ownerKey,utcSql}=require('./db');
const crmAuth=require('./live-crm-auth');
const MAX_AGE=7*24*60*60*1000;
const COOKIE='zippy.sid';
const attempts=new Map();
const PASSWORD_FILE=path.join(__dirname,'../.owner-password.hash');
function currentPasswordHash(){
 try{return fs.readFileSync(PASSWORD_FILE,'utf8').trim();}
 catch(e){if(e.code==='ENOENT')return process.env.ZIPPY_PASSWORD_HASH||'';throw e;}
}
function hashPassword(password,salt=crypto.randomBytes(18).toString('hex')){
 const derived=crypto.scryptSync(String(password),salt,64,{N:16384,r:8,p:1}).toString('hex');
 return 'scrypt:'+salt+':'+derived;
}
function verifyPassword(password,encoded){
 const pieces=String(encoded||'').split(':');
 if(pieces.length!==3||pieces[0]!=='scrypt'||!pieces[1]||!pieces[2])return false;
 try{
  const expected=Buffer.from(pieces[2],'hex');
  if(expected.length!==64)return false;
  const actual=crypto.scryptSync(String(password||''),pieces[1],expected.length,{N:16384,r:8,p:1});
  return crypto.timingSafeEqual(actual,expected);
 }catch(_){return false;}
}
function parseCookies(raw){
 return Object.fromEntries(String(raw||'').split(';').map(v=>v.trim()).filter(Boolean)
  .map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
}
function cookie(value,maxAge){
 return COOKIE+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+Math.floor(maxAge/1000);
}
function bearerHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function loginAllowed(ip){
 const now=Date.now(),state=attempts.get(ip);
 if(state&&state.until>now&&state.count>=6)return false;
 if(!state||state.until<=now)attempts.set(ip,{count:0,until:now+15*60000});
 return true;
}
function noteFailure(ip){
 const x=attempts.get(ip)||{count:0,until:Date.now()+15*60000};
 x.count++;attempts.set(ip,x);
 if(attempts.size>300)for(const [key,value] of attempts)if(value.until<Date.now())attempts.delete(key);
}
async function logIn({email,password,ip}={}){
 if(!loginAllowed(ip))return {ok:false,error:'Too many attempts. Try again in 15 minutes.'};
 const key=crmAuth.normalizedEmail(email);
 const pass=typeof password==='string'?password:'';
 let account=null;
 // Gerda's existing private Zippy password keeps working. She may also use
 // her live CRM credentials, without losing or moving personal reminders.
 if(key===ownerKey()&&verifyPassword(pass,currentPasswordHash())){
  account={email:key,firstName:process.env.ZIPPY_OWNER_NAME||'Gerda',role:'owner',source:'local',marker:null};
 }else{
  try{
   const crm=await crmAuth.verifyLogin(key,pass);
   if(crm)account={email:crm.email,firstName:crm.firstName,role:crm.role,source:'crm',marker:crm.credentialMarker};
  }catch(err){
   console.error('[zippy] Live CRM login unavailable:',err.code||err.message);
   return {ok:false,unavailable:true,error:'Live CRM sign-in is temporarily unavailable.'};
  }
 }
 if(!account){noteFailure(ip);return {ok:false,error:'Incorrect email or password.'};}
 attempts.delete(ip);
 const token=crypto.randomBytes(32).toString('base64url');
 const keyHash=bearerHash(token),expires=new Date(Date.now()+MAX_AGE);
 await query('INSERT INTO zippy_sessions(token_hash,owner_key,created_at,expires_at) VALUES(?,?,UTC_TIMESTAMP(3),?)',
  [keyHash,account.email,utcSql(expires)]);
 try{
  await query('INSERT INTO zippy_auth_sessions(token_hash,auth_source,credential_marker) VALUES(?,?,?)',
   [keyHash,account.source,account.marker]);
 }catch(err){
  await query('DELETE FROM zippy_sessions WHERE token_hash=?',[keyHash]).catch(()=>{});
  throw err;
 }
 return {ok:true,cookie:cookie(token,MAX_AGE),name:account.firstName,email:account.email,authSource:account.source};
}
async function getUser(req){
 if(req.zippyIdentity!==undefined)return req.zippyIdentity;
 if(req.zippyIdentityPromise)return req.zippyIdentityPromise;
 req.zippyIdentityPromise=(async()=>{
  const raw=parseCookies(req.headers.cookie)[COOKIE];
  if(!raw||raw.length>100)return null;
  const [rows]=await query(
   "SELECT s.owner_key,a.auth_source,a.credential_marker FROM zippy_sessions s "+
   "LEFT JOIN zippy_auth_sessions a ON a.token_hash=s.token_hash "+
   "WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3) LIMIT 1",
   [bearerHash(raw)]);
  if(rows.length!==1)return null;
  const email=String(rows[0].owner_key||'').toLowerCase();
  const kind=rows[0].auth_source||'local'; // Older Gerda sessions remain valid.
  if(kind==='local'&&email===ownerKey())
   return {email,firstName:process.env.ZIPPY_OWNER_NAME||'Gerda',role:'owner',source:'local'};
  if(kind!=='crm')return null;
  const verified=await crmAuth.verifySession(email,rows[0].credential_marker);
  return verified?{email:verified.email,firstName:verified.firstName,role:verified.role,source:'crm'}:null;
 })();
 try{return req.zippyIdentity=await req.zippyIdentityPromise;}
 finally{req.zippyIdentityPromise=null;}
}
async function authenticated(req){return Boolean(await getUser(req));}
async function logOut(req){
 const raw=parseCookies(req.headers.cookie)[COOKIE];
 if(raw&&raw.length<=100){
  const hash=bearerHash(raw);
  await query('DELETE FROM zippy_auth_sessions WHERE token_hash=?',[hash]);
  await query('DELETE FROM zippy_sessions WHERE token_hash=?',[hash]);
 }
 return cookie('',0);
}
function requireMutation(req,res,next){
 if(req.method==='GET'||req.method==='HEAD')return next();
 const header=req.get('x-zippy-action'),origin=req.get('origin');
 if(header!=='1'||origin&&(()=>{try{return new URL(origin).host!==req.get('host');}catch(_){return true;}})())
  return res.status(403).json({ok:false,error:'Request verification failed.'});
 next();
}
async function changePassword({currentPassword,newPassword,user}={}){
 if(!user||user.source!=='local'||user.email!==ownerKey())
  return {ok:false,error:'Change your password in the Talk2Me CRM back office.'};
 const a=String(currentPassword||''),b=String(newPassword||'');
 if(b.length<14||b.length>160||a===b)return {ok:false,error:'Choose a new password of at least 14 characters.'};
 if(!verifyPassword(a,currentPasswordHash()))return {ok:false,error:'Current password is not correct.'};
 const temp=PASSWORD_FILE+'.'+crypto.randomBytes(7).toString('hex')+'.tmp';
 fs.writeFileSync(temp,hashPassword(b)+'\n',{mode:0o600,flag:'wx'});
 fs.renameSync(temp,PASSWORD_FILE);
 try{fs.unlinkSync(path.join(__dirname,'../.owner-login-initial'));}
 catch(error){if(error.code!=='ENOENT')console.error('[zippy] onboarding cleanup:',error.code||'failed');}
 await query('DELETE FROM zippy_auth_sessions WHERE token_hash IN (SELECT token_hash FROM zippy_sessions WHERE owner_key=?)',[user.email]);
 await query('DELETE FROM zippy_sessions WHERE owner_key=?',[user.email]);
 return {ok:true};
}
module.exports={logIn,getUser,authenticated,logOut,requireMutation,hashPassword,verifyPassword,parseCookies,COOKIE,changePassword};
