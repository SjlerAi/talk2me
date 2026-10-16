'use strict';
const crypto=require('crypto');const fs=require('fs');const path=require('path');
const {query,ownerKey,utcSql}=require('./db');
const MAX_AGE=7*24*60*60*1000;
const COOKIE='zippy.sid';const attempts=new Map();
const PASSWORD_FILE=path.join(__dirname,'../.owner-password.hash');
function currentPasswordHash(){try{return fs.readFileSync(PASSWORD_FILE,'utf8').trim();}catch(e){if(e.code==='ENOENT')return process.env.ZIPPY_PASSWORD_HASH||'';throw e;}}
function hashPassword(password,salt=crypto.randomBytes(18).toString('hex')){
 const derived=crypto.scryptSync(String(password),salt,64,{N:16384,r:8,p:1}).toString('hex');return `scrypt:${salt}:${derived}`;
}
function verifyPassword(password,encoded){const pieces=String(encoded||'').split(':');if(pieces.length!==3||pieces[0]!=='scrypt'||!pieces[1]||!pieces[2])return false;
 try{const expected=Buffer.from(pieces[2],'hex');const actual=crypto.scryptSync(String(password||''),pieces[1],expected.length,{N:16384,r:8,p:1});return expected.length===64&&crypto.timingSafeEqual(actual,expected);}catch(_){return false;}}
function parseCookies(raw){return Object.fromEntries(String(raw||'').split(';').map(v=>v.trim()).filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));}
function cookie(value,maxAge){return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAge/1000)}`;}
function bearerHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function loginAllowed(ip){const now=Date.now();const state=attempts.get(ip);if(state&&state.until>now&&state.count>=6)return false;if(!state||state.until<=now)attempts.set(ip,{count:0,until:now+15*60000});return true;}
function noteFailure(ip){const x=attempts.get(ip)||{count:0,until:Date.now()+15*60000};x.count++;attempts.set(ip,x);if(attempts.size>300)for(const [k,v] of attempts)if(v.until<Date.now())attempts.delete(k);}
async function logIn({email,password,ip}){
 if(!loginAllowed(ip))return {ok:false,error:'Too many attempts. Try again in 15 minutes.'};
 const goodEmail=String(email||'').trim().toLowerCase()===ownerKey();const goodPassword=verifyPassword(password,currentPasswordHash());
 if(!goodEmail||!goodPassword){noteFailure(ip);return {ok:false,error:'Incorrect email or password.'};}
 attempts.delete(ip);const token=crypto.randomBytes(32).toString('base64url');const expires=new Date(Date.now()+MAX_AGE);
 await query('INSERT INTO zippy_sessions (token_hash,owner_key,created_at,expires_at) VALUES (?,?,UTC_TIMESTAMP(3),?)',[bearerHash(token),ownerKey(),utcSql(expires)]);
 return {ok:true,cookie:cookie(token,MAX_AGE)};
}
async function authenticated(req){const raw=parseCookies(req.headers.cookie)[COOKIE];if(!raw||raw.length>100)return false;
 const [rows]=await query('SELECT owner_key FROM zippy_sessions WHERE token_hash=? AND owner_key=? AND expires_at>UTC_TIMESTAMP(3) LIMIT 1',[bearerHash(raw),ownerKey()]);return rows.length>0;}
async function logOut(req){const raw=parseCookies(req.headers.cookie)[COOKIE];if(raw)await query('DELETE FROM zippy_sessions WHERE token_hash=? AND owner_key=?',[bearerHash(raw),ownerKey()]);return cookie('',0);}
function requireMutation(req,res,next){if(req.method==='GET'||req.method==='HEAD')return next();
 const header=req.get('x-zippy-action');const origin=req.get('origin');
 if(header!=='1'||origin&&(()=>{try{return new URL(origin).host!==req.get('host')}catch(_){return true}})())return res.status(403).json({ok:false,error:'Request verification failed.'});next();}
async function changePassword({currentPassword,newPassword}={}){
 const a=String(currentPassword||''),b=String(newPassword||'');
 if(b.length<14||b.length>160||a===b)return {ok:false,error:'Choose a new password of at least 14 characters.'};
 if(!verifyPassword(a,currentPasswordHash()))return {ok:false,error:'Current password is not correct.'};
 const temp=PASSWORD_FILE+'.'+crypto.randomBytes(7).toString('hex')+'.tmp';
 fs.writeFileSync(temp,hashPassword(b)+'\n',{mode:0o600,flag:'wx'});
 fs.renameSync(temp,PASSWORD_FILE);
 // Discard the one-time initial password when Gerda chooses her own password.
 try{fs.unlinkSync(path.join(__dirname,'../.owner-login-initial'));}catch(error){if(error.code!=='ENOENT')console.error('[zippy] onboarding cleanup:',error.code||'failed');}
 await query('DELETE FROM zippy_sessions WHERE owner_key=?',[ownerKey()]);
 return {ok:true};
}
module.exports={logIn,authenticated,logOut,requireMutation,hashPassword,verifyPassword,parseCookies,COOKIE,changePassword};
