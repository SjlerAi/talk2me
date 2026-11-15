'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const file=fs.readFileSync(require('node:path').join(__dirname,'../src/middleware/tk2m-staging-login.js'),'utf8');
const ctx={process:{env:{CRM_STAGE_MODE:'true'}},module:{exports:{}},Buffer,Date,Map,Set,String,console,require(n){
 if(n==='node:crypto')return crypto;
 if(n==='./auth')return {businessDate:()=> '2026-11-15'};
 throw Error('unexpected dependency '+n);
}};
vm.runInNewContext(file,ctx);
const a=ctx.module.exports;
const mkReq=(path,method='GET',user=null)=>({
 path,method,ip:'203.0.113.15',socket:{remoteAddress:'203.0.113.15'},
 session:{...(user?{user,loginDate:'2026-11-15'}:{})},body:{email:'qa-only@example.invalid'}
});
const makeRes=()=>({
 statusCode:200,location:null,body:null,
 set(){return this;},status(v){this.statusCode=v;return this;},
 redirect(code,to){this.statusCode=code;this.location=to;return this;},
 json(v){this.body=v;return this;},
 type(){return this;},send(v){this.body=v;return this;}
});
let next=0;
for(const path of ['/backoffice','/backoffice/staff-usage','/grouped-upgrade-accounts','/api/tasks']){
 const req=mkReq(path),res=makeRes();a.protectPrivateRoutes(req,res,()=>next++);
 assert.equal(res.statusCode,path.startsWith('/api/')?401:302);
}
for(const path of ['/login','/public/images/favicon.ico']){
 const req=mkReq(path),res=makeRes();a.protectPrivateRoutes(req,res,()=>next++);
}
assert.equal(next,2);
const req=mkReq('/login','POST');const token=a.csrf(req);
assert.match(token,/^[a-f0-9]{64}$/);
assert.equal(a.validCsrf(req),false);
req.body.login_csrf=token;
assert.equal(a.validCsrf(req),true);
let blocked=0;
for(let n=0;n<9;n++){
 const res=makeRes(),hit={...req,body:{email:'qa-only@example.invalid'}};
 a.attempts(hit,res,()=>{a.failed(hit)});
 if(res.statusCode===429)blocked++;
}
assert(blocked>=1);
const validUser=mkReq('/backoffice','GET',{id:123,role:'owner'});
const good=makeRes();a.protectPrivateRoutes(validUser,good,()=>next++);
assert.equal(next,3);
console.log('PASS: TK2M one-login route auth, CSRF and rate-limit security contract');
