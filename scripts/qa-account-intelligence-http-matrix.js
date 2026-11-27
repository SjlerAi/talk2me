'use strict';
// Run ONLY against the explicit loopback synthetic visual QA server.
// Production hosts cannot be targeted by this test.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const BASE='http://127.0.0.1:38187';
const files=path.join(os.tmpdir(),'tk2m-account-intelligence-qa-synthetic','fixtures');
let passes=0;
const passed=[];
function verify(condition,message){assert.ok(condition,message);passes++;passed.push(message);console.log('PASS',message);}
function client(){
 let cookie='';
 return {
  async get(p){
   const r=await fetch(BASE+p,{headers:cookie?{Cookie:cookie}:{},redirect:'manual'});
   const sc=r.headers.get('set-cookie');
   if(sc)cookie=sc.split(';')[0];
   const loc=r.headers.get('location');
   if([301,302,303,307,308].includes(r.status)&&loc&&loc.startsWith('/'))return this.get(loc);
   return{status:r.status,headers:r.headers,body:await r.text()};
  },
  async post(p,form){
   const r=await fetch(BASE+p,{method:'POST',body:form,headers:cookie?{Cookie:cookie}:{},redirect:'manual'});
   const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
   return{status:r.status,headers:r.headers,body:await r.text()};
  }
 };
}
function form(fields={},pdfs=[]){
 const f=new FormData();
 for(const [k,v] of Object.entries(fields))f.append(k,String(v));
 for(const [name,filename] of pdfs){
  f.append('documents',new Blob([fs.readFileSync(path.join(files,name))],{type:'application/pdf'}),filename||name);
 }
 return f;
}
function extractCsrf(html){
 const m=html.match(/name="csrf" value="([0-9a-f]{64})"/);
 assert.ok(m,'CSRF token present');return m[1];
}
async function run(){
 const plain=await fetch(BASE+'/__qa/status');assert.equal(plain.status,200);
 verify((await plain.json()).synthetic===true,'loopback target confirmed synthetic');
 const owner=client(),manager=client(),staff=client();
 await owner.get('/__qa/login/owner');let page=await owner.get('/__qa/reset');
 verify(page.status===200&&page.body.includes('1. Upload statements')&&page.body.includes('2. Compare billing months'),'Owner opens empty upload and comparison screen');
 let csrf=extractCsrf(page.body);
 let missing=await owner.post('/backoffice/account-intelligence/upload',form({kind:'statement'},[['synthetic-statement.pdf']]));
 verify(missing.status===403,'Invalid/missing CSRF upload denied');
 await owner.get('/__qa/schema/off');
 page=await owner.get('/backoffice/account-intelligence');
 verify(page.status===503&&page.body.includes('Database setup has not been authorised'),'Schema-missing screen opens and fails closed');
 await owner.get('/__qa/schema/on');
 page=await owner.get('/backoffice/account-intelligence');csrf=extractCsrf(page.body);
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'statement'},[['synthetic-fake.pdf']]));
 page=await owner.get('/backoffice/account-intelligence');
 verify(page.body.includes('The file is not a supported PDF'),'Spoofed .pdf rejected visibly');
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'statement'},[['synthetic-no-account.pdf']]));
 page=await owner.get('/backoffice/account-intelligence');
 verify(page.body.includes('Account number not recognised'),'PDF with no account identity rejected visibly');
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'statement'},[['synthetic-statement.pdf']]));
 page=await owner.get('/backoffice/account-intelligence?account=B0000001&month=2026-11');
 verify(page.body.includes('R217.29')&&page.body.includes('R290.00')&&page.body.includes('R72.71'),'Real HTTP PDF upload reconciles month charges');
 verify(page.body.includes('R10.00')&&page.body.includes('R220.00')&&page.body.includes('R280.00'),'Credits/payments/net charges shown separately');
 verify(page.body.includes('Demo Fibre 50Mbps')&&page.body.includes('0791111101'),'CRM mobile and fixed service sections render');
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'statement'},[['synthetic-statement.jsp']]));
 page=await owner.get('/backoffice/account-intelligence');
 verify(page.body.includes('identical duplicates skipped'),'Genuine PDF supplied as .jsp accepted and duplicate skipped');
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'statement'},[['synthetic-second-account.pdf']]));
 page=await owner.get('/backoffice/account-intelligence?account=B0000002&month=2026-11');
 verify(page.body.includes('B0000002')&&page.body.includes('R30.00'),'Second account upload and selection works');
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'invoice'},[['synthetic-invoice.pdf']]));
 page=await owner.get('/backoffice/account-intelligence?account=B0000001&month=2026-11');
 verify(page.body.includes('Supporting detailed invoice checks')&&page.body.includes('VT2-FAKE01'),'Supporting supplier invoice listed');
 verify(page.body.includes('R290.00')&&page.body.includes('R72.71'),'Supporting invoice is NOT double-counted as statement charge');
 let preview=await owner.get('/backoffice/account-intelligence/customer-report?account=B0000001&month=2026-11');
 verify(preview.status===200&&preview.body.includes('Monthly Account Review')&&preview.body.includes('Demo Fibre 50Mbps'),'Customer report includes actual mobile and fixed inventory');
 const invalidReview=new FormData();
 for(const [k,v] of Object.entries({csrf,account:'B0000001',month:'2026-11',prior:'2026-10',key:'LINE:999111114',status:'verified',reason:''}))invalidReview.append(k,v);
 const rr=await owner.post('/backoffice/account-intelligence/review',invalidReview);
 verify(rr.status===400,'Verification with blank reason denied');
 const validReview=new FormData();
 for(const [k,v] of Object.entries({csrf,account:'B0000001',month:'2026-11',prior:'2026-10',key:'LINE:999111114',status:'verified',reason:'SYNTHETIC REVIEW: source evidence checked'}))validReview.append(k,v);
 const okReview=await owner.post('/backoffice/account-intelligence/review',validReview);
 preview=await owner.get('/backoffice/account-intelligence/customer-report?account=B0000001&month=2026-11');
 verify(okReview.status===303&&preview.body.includes('SYNTHETIC REVIEW: source evidence checked'),'Verified reason saved and appears in customer preview');
 const downloaded=await owner.get('/backoffice/account-intelligence/source/1');
 verify(downloaded.status===200&&downloaded.headers.get('content-disposition')?.includes('synthetic-statement.pdf')&&!downloaded.headers.get('content-disposition')?.includes('.pdf.pdf'),'Original PDF downloads with correct filename');
 verify(downloaded.headers.get('x-content-type-options')==='nosniff','Original PDF response has nosniff header');
 await manager.get('/__qa/login/manager');
 page=await manager.get('/backoffice/account-intelligence');
 verify(page.status===200&&page.body.includes('Account Intelligence'),'Manager permitted to open management screen');
 await staff.get('/__qa/login/staff');
 page=await staff.get('/backoffice/account-intelligence');
 verify(page.status===403&&page.body.includes('Owner or manager access required'),'Staff denied management screen');
 page=await staff.get('/backoffice/account-intelligence/source/1');
 verify(page.status===403,'Staff denied original source download');
 page=await staff.get('/backoffice/account-intelligence/customer-report?account=B0000001&month=2026-11');
 verify(page.status===403,'Staff denied customer report preview');
 const noCsrf=new FormData();
 for(const [k,v] of Object.entries({account:'B0000001',month:'2026-11',prior:'2026-10',key:'LINE:999111114',status:'verified',reason:'bad'}))noCsrf.append(k,v);
 const rejected=await owner.post('/backoffice/account-intelligence/review',noCsrf);
 verify(rejected.status===403,'Missing CSRF review denied');
 const many=Array.from({length:7},(_,i)=>['synthetic-statement.pdf','source-'+i+'.pdf']);
 const tooMany=await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'statement'},many));
 verify(tooMany.status===400&&tooMany.body.includes('PDF upload rejected'),'Seven simultaneous files rejected by upload limit');
 const oversized=new FormData();oversized.append('csrf',csrf);oversized.append('kind','statement');
 oversized.append('documents',new Blob([Buffer.alloc(8*1024*1024+1,0)],{type:'application/pdf'}),'too-large.pdf');
 const rejectedSize=await owner.post('/backoffice/account-intelligence/upload',oversized);
 verify(rejectedSize.status===400&&rejectedSize.body.includes('PDF upload rejected'),'File exceeding 8MB limit rejected');
 const status=await owner.get('/__qa/status'),j=JSON.parse(status.body);
 verify(j.documents===3&&j.reviews===1&&j.audits>=4,'Rejected files do not modify fake documents/reviews');
 console.log('SCREEN_ROUTE_MATRIX_PASS count='+passes+' synthetic=true; passed='+JSON.stringify(passed));
}
run().catch(e=>{console.error('SCREEN_ROUTE_MATRIX_FAIL',e.stack||e);process.exitCode=1});
