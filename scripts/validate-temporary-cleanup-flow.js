'use strict';
// Read-only integration check against isolated UAT data; never saves customer changes.
const assert=require('assert'),fs=require('fs'),cp=require('child_process'),path=require('path');
const pid=cp.execSync("pgrep -f '^lsnode:/home/uent/public_html/talk2me/[[:space:]]*$' | head -n 1").toString().trim();
const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ').toString().split('\0')
 .filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
assert.equal(env.UAT_MODE,'true');
assert.equal(env.DB_NAME,'uent_Crm');
assert.equal(env.DB_USER,'uent_Crm-Uat');
for(const k of ['UAT_MODE','DB_NAME','DB_USER','DB_HOST','DB_PASSWORD','OUTBOUND_EMAIL_ENABLED','PRIVATE_UPLOAD_DIR'])process.env[k]=env[k];
const {safeCleanupReturn}=require('../src/services/cleanup-login-return');
const express=require('express'),db=require('../src/config/db');
const {businessDate}=require('../src/middleware/auth');
const {queueProgress}=require('../src/services/temporary-cleanup-queue');
const PREFIX='/talk2me';
const cases=[
 ['/talk2me/temporary-cleanup','/talk2me/temporary-cleanup'],
 ['/talk2me/temporary-cleanup/next?type=same_account_phone','/talk2me/temporary-cleanup/next?type=same_account_phone'],
 ['/talk2me/temporary-cleanup/report','/talk2me/temporary-cleanup/report']
];
for(const [input,expected] of cases)assert.strictEqual(safeCleanupReturn(input,PREFIX),expected);
for(const bad of ['https://evil.example/','//evil.example/','/talk2me/temporary-cleanup.evil',
 '/talk2me/temporary-cleanup/../../other','/talk2me/temporary-cleanup%2fwrong',
 '/talk2me/temporary-cleanup%5cwrong','/talk2me/workspace','/talk2me/temporary-cleanup#foo']){
 assert.strictEqual(safeCleanupReturn(bad,PREFIX),null,'Unsafe login redirect accepted '+bad);
}
async function main(){
 const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../views'));
 app.use(express.urlencoded({extended:true}));
 app.use((req,res,next)=>{const usr=req.headers['x-test-user'];
  req.session={loginDate:businessDate(),tempCleanupToken:'b'.repeat(64)};
  if(usr!=='anonymous')req.session.user=usr==='staff'?{id:7,role:'manager',email:'sias@talk-online.co.za'}:
   {id:4,role:'manager',email:'jonathan@talk-online.co.za',full_name:'Jonathan'};
  res.locals.basePath=PREFIX;
  res.locals.appVersion='test';res.locals.appBuild='test';
  next();
 });
 app.use(PREFIX,require('../src/routes/temporary-cleanup-flow'));
 app.use(PREFIX,require('../src/routes/temporary-cleanup'));
 app.use(PREFIX,require('../src/routes/index'));
 const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject)});
 const base='http://127.0.0.1:'+server.address().port+PREFIX;
 try{
  const unauth=await fetch(base+'/temporary-cleanup/next?type=same_account_phone',{redirect:'manual',headers:{'x-test-user':'anonymous'}});
  assert.equal(unauth.status,302);
  const location=unauth.headers.get('location');
  assert(location.startsWith('/talk2me/login?return_to='));
  const returned=new URLSearchParams(location.split('?')[1]).get('return_to');
  assert.strictEqual(returned,'/talk2me/temporary-cleanup/next?type=same_account_phone');
  console.log('LOGIN_RETURN_TO_ORIGINAL_DEEP_LINK_OK');
  const target='/talk2me/temporary-cleanup/next?type=same_account_phone';
  const loginGet=await fetch(base+'/login?return_to='+encodeURIComponent(target),{headers:{'x-test-user':'anonymous'},redirect:'manual'});
  const loginHtml=await loginGet.text();
  assert.equal(loginGet.status,200,loginHtml.slice(0,200));
  assert(loginHtml.includes('name="return_to"'));
  assert(loginHtml.includes('Customer Cleanup Centre'));
  const invalidLogin=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-test-user':'anonymous'},
    body:new URLSearchParams({email:'invalid@example.com',password:'invalid',return_to:target}),redirect:'manual'});
  const failedHtml=await invalidLogin.text();
  assert.equal(invalidLogin.status,401,failedHtml.slice(0,240));
  assert(failedHtml.includes('name="return_to"'),'Return link was lost after invalid login');
  console.log('LOGIN_FORM_PRESERVES_DESTINATION_OK');

  const forbidden=await fetch(base+'/temporary-cleanup',{redirect:'manual',headers:{'x-test-user':'staff'}});
  assert.strictEqual(forbidden.status,404);
  const progress=await queueProgress('same_account_phone');
  assert(progress.pending>0 && progress.total>=progress.pending);
  console.log('UAT_QUEUE_METRICS',progress);
  for(const view of ['pending','followup','reviewed','all']){
   const res=await fetch(base+'/temporary-cleanup?view='+view,{redirect:'manual'});
   const page=await res.text();
   assert.strictEqual(res.status,200,'Queue '+view+' failed '+res.status+' '+page.slice(0,300));
   assert(page.includes('Next unreviewed customer')&&page.includes('Reviewed'));
   console.log('QUEUE_VIEW_OK',view,res.status);
  }
  const next=await fetch(base+'/temporary-cleanup/next?type=same_account_phone',{redirect:'manual'});
  assert.strictEqual(next.status,302);
  const nextLocation=next.headers.get('location');
  assert(nextLocation.startsWith('/talk2me/temporary-cleanup/review/same_account_phone/'));
  const phone=decodeURIComponent(nextLocation.split('/').pop().split('?')[0]);
  const [[has]]=await db.execute('SELECT COUNT(*) n FROM temporary_cleanup_decisions WHERE case_type=:type AND case_key=:phone',{type:'same_account_phone',phone});
  assert.strictEqual(Number(has.n),0,'Next case was already reviewed');
  console.log('AUTO_NEXT_UNREVIEWED_OK',phone.slice(0,3)+'********');
  const pendingReview=await fetch(new URL(nextLocation,base),{redirect:'manual'});
  const pendingHtml=await pendingReview.text();
  assert.equal(pendingReview.status,200);
  assert(pendingHtml.includes('name="review_revision"'),'Optimistic approval version is missing');
  assert(pendingHtml.includes('Save decision &amp; open next customer'),'Approval / next control missing');
  const afterSave=await fetch(base+'/temporary-cleanup/next?type=same_account_phone&done=approved',{redirect:'manual'});
  assert(afterSave.headers.get('location').includes('done=approved'),'Next-customer confirmation not forwarded');
  console.log('AUTO_NEXT_REVIEW_APPROVAL_FLOW_OK');

  const [approved]=await db.query("SELECT case_key FROM temporary_cleanup_decisions WHERE case_type='same_account_phone' AND decision='approved_grouping' ORDER BY reviewed_at DESC LIMIT 1");
  if(approved.length){
   const prior=await fetch(base+'/temporary-cleanup/review/same_account_phone/'+approved[0].case_key,{redirect:'manual'});
   const html=await prior.text();
   assert.strictEqual(prior.status,200,html.slice(0,300));
   assert(html.includes('Continue to next unreviewed customer'));
   assert(!html.includes('Confirm & apply safe consolidation in UAT'),'Already approved case still displays consolidation action');
   assert(!html.includes('Save decision &amp; open next customer'),'Already approved case still displays approval form');
   console.log('APPROVED_CASE_READ_ONLY_OK');
  }
  const report=await fetch(base+'/temporary-cleanup/report?status=approved_grouping',{redirect:'manual'});
  const reportHtml=await report.text();
  assert.strictEqual(report.status,200,reportHtml.slice(0,350));
  assert(reportHtml.includes('Reviewed and Approved Cases'));
  console.log('APPROVED_HISTORY_OK');
  const csv=await fetch(base+'/temporary-cleanup/report.csv?status=approved_grouping',{redirect:'manual'});
  assert.strictEqual(csv.status,200);
  assert(csv.headers.get('content-type').includes('text/csv'));
  assert((await csv.text()).includes('case_type'));
  console.log('REVIEW_REPORT_CSV_OK');
 } finally {await new Promise(done=>server.close(done));}
}
main().catch(e=>{console.error('FLOW_TEST_FAILED',e.stack||e.message);process.exitCode=1}).finally(()=>db.end().catch(()=>{}));
