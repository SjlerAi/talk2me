'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const crypto=require('crypto');
const path=require('path');
process.env.ZIPPY_OWNER_EMAIL='gerda@talk-online.co.za';
process.env.ZIPPY_OWNER_NAME='Gerda';
process.env.ZIPPY_COOKIE_SECRET='a'.repeat(80);
const db=require('../src/db');
const crmAuth=require('../src/live-crm-auth');
const sessions=new Map(),markers=new Map();
const oldQuery=db.query,oldVerify=crmAuth.verifyLogin,oldSession=crmAuth.verifySession;
let changed=false;
db.query=async(sql,args=[])=>{
 if(sql.startsWith('INSERT INTO zippy_sessions')){
  sessions.set(args[0],{owner_key:args[1]});return [{affectedRows:1}];
 }
 if(sql.startsWith('INSERT INTO zippy_auth_sessions')){
  markers.set(args[0],{auth_source:args[1],credential_marker:args[2]});return [{affectedRows:1}];
 }
 if(sql.includes('LEFT JOIN zippy_auth_sessions')){
  const row=sessions.get(args[0]),m=markers.get(args[0]);
  return [row?[{...row,...m}]:[]];
 }
 if(sql.startsWith('DELETE FROM zippy_auth_sessions WHERE token_hash=')){
  markers.delete(args[0]);return [{affectedRows:1}];
 }
 if(sql.startsWith('DELETE FROM zippy_sessions WHERE token_hash=')){
  sessions.delete(args[0]);return [{affectedRows:1}];
 }
 throw Error('Unexpected mocked database query: '+sql);
};
const auth=require('../src/auth');
const stephanEmail='info@b4s.co.za',gerdaEmail='gerda@talk-online.co.za';
const gerdaPassword='gerda-private-test-passphrase';
process.env.ZIPPY_PASSWORD_HASH=auth.hashPassword(gerdaPassword);
crmAuth.verifyLogin=async(email,password)=>email===stephanEmail&&password==='live-crm-staff-password'
 ?{email:stephanEmail,firstName:'Stephan',role:'owner',credentialMarker:'a'.repeat(64)}:null;
crmAuth.verifySession=async(email,marker)=>!changed&&email===stephanEmail&&marker==='a'.repeat(64)
 ?{email:stephanEmail,firstName:'Stephan',role:'owner'}:null;
function cookieFrom(result){return result.cookie.split(';')[0];}
function request(cookie){return {headers:{cookie}};}
test('Gerda and Stephan have independent Zippy sessions',async()=>{
 const g=await auth.logIn({email:gerdaEmail,password:gerdaPassword,ip:'ip-1'});
 const s=await auth.logIn({email:stephanEmail,password:'live-crm-staff-password',ip:'ip-2'});
 assert(g.ok&&s.ok);
 assert.notEqual(cookieFrom(g),cookieFrom(s));
 assert.equal(g.authSource,'local');
 assert.equal(s.authSource,'crm');
 assert.equal((await auth.getUser(request(cookieFrom(g)))).email,gerdaEmail);
 assert.equal((await auth.getUser(request(cookieFrom(s)))).email,stephanEmail);
 assert.equal((await auth.getUser(request(cookieFrom(s)))).firstName,'Stephan');
 assert.equal(sessions.size,2);
 assert.equal(markers.size,2);
 const wrong=await auth.logIn({email:stephanEmail,password:'incorrect-password',ip:'ip-3'});
 assert.equal(wrong.ok,false);
 assert.equal(sessions.size,2);
 await auth.logOut(request(cookieFrom(s)));
 assert.equal(await auth.getUser(request(cookieFrom(s))),null);
 assert.equal((await auth.getUser(request(cookieFrom(g)))).email,gerdaEmail);
});
test('CRM password changes revoke Stephan session without harming Gerda',async()=>{
 const s=await auth.logIn({email:stephanEmail,password:'live-crm-staff-password',ip:'ip-4'});
 assert.equal(s.ok,true);
 changed=true;
 assert.equal(await auth.getUser(request(cookieFrom(s))),null);
 const g=await auth.logIn({email:gerdaEmail,password:gerdaPassword,ip:'ip-5'});
 assert.equal(g.ok,true);
 assert.equal((await auth.getUser(request(cookieFrom(g)))).email,gerdaEmail);
 changed=false;
});
test('Stephan cannot change his CRM password via private Zippy API',async()=>{
 const result=await auth.changePassword({currentPassword:'any',newPassword:'new-secure-passphrase',
  user:{email:stephanEmail,source:'crm'}});
 assert.equal(result.ok,false);
 assert.match(result.error,/Talk2Me CRM/i);
});
test('private endpoints use the authenticated email, not a single global user',()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const tick=fs.readFileSync(path.join(__dirname,'../src/tick.js'),'utf8');
 const push=fs.readFileSync(path.join(__dirname,'../src/push.js'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 const sw=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
 assert(!server.includes('db.ownerKey()'));
 assert(server.includes('req.zippyIdentity.email'));
 assert(server.includes('actorEmail:req.zippyIdentity.email'));
 assert(tick.includes('const owner=r.owner_key'));
 assert(!tick.includes('ownerKey()'));
 assert(push.includes('owner_key=?'));
 assert(push.includes('ownerEmail:owner'));
 assert(sw.includes('payload.ownerEmail')&&sw.includes('user.authenticated'));
 assert(ui.includes('profile.name')&&ui.includes('state.reminders=[]'));
});
test('signed CRM bridge can only act as the account it receives',()=>{
 const route=fs.readFileSync(path.resolve(__dirname,'../../../src/routes/zippy-integration.js'),'utf8');
 assert(route.includes('AUTHORIZED_OWNERS'));
 assert(route.includes("'info@b4s.co.za'"));
 assert(route.includes('actorEmail=String(req.body?.actorEmail'));
 assert(route.includes('req.zippyOwnerId=Number(users[0].id)'));
 assert(route.includes('owner_id=:owner'));
});
test('approved login list does not grant access to other CRM users',()=>{
 assert.deepEqual([...crmAuth.ALLOWED].sort(),[gerdaEmail,stephanEmail].sort());
 assert.equal(crmAuth.ALLOWED.has('johnny@example.com'),false);
 assert.equal(crmAuth.normalizedEmail(' INFO@B4S.CO.ZA '),stephanEmail);
});
test.after(()=>{db.query=oldQuery;crmAuth.verifyLogin=oldVerify;crmAuth.verifySession=oldSession;});
