'use strict';
// Run ONLY against the explicit loopback synthetic visual QA server.
// Production hosts cannot be targeted by this test.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const BASE='http://127.0.0.1:38187';
const fixtureRoot=process.env.TK2M_QA_DIRNAME||'tk2m-account-intelligence-qa-synthetic';
if(!/^tk2m-account-intelligence-qa-[a-z0-9-]+$/.test(fixtureRoot))throw new Error('Bad QA fixture root');
const files=path.join(os.tmpdir(),fixtureRoot,'fixtures');
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
 verify(page.body.includes('Synthetic Business One')&&page.body.includes('October 2026')&&page.body.includes('November 2026'),'Customer holder and readable dates visible');
 verify(page.body.includes('Demo Staff Member')&&page.body.includes('Confirm this exact CRM account'),'Internal staff allocation and confirmation action shown');
 const unmatched=await owner.get('/backoffice/account-intelligence/customer-report?account=B0000001&month=2026-11');
 verify(unmatched.body.includes('CRM account confirmation pending')&&!unmatched.body.includes('Demo Fibre 50Mbps'),'Unconfirmed CRM lines withheld from customer report');
 verify(unmatched.body.includes('Customer name')&&unmatched.body.includes('Synthetic Business One')&&
   unmatched.body.includes('Staff member responsible for this account')&&
   unmatched.body.includes('Pending CRM account confirmation')&&!unmatched.body.includes('Demo Staff Member'),
   'Unconfirmed client report shows source customer name but does not disclose a possible staff assignment');
 const conflicting=new URLSearchParams({csrf,account:'B0000001',crm_account_id:'102',month:'2026-11'});
 const rejectedLink=await owner.post('/backoffice/account-intelligence/confirm-account',conflicting);
 verify(rejectedLink.status===409,'Wrong account identifier cannot be confirmed');
 const exact=new URLSearchParams({csrf,account:'B0000001',crm_account_id:'101',month:'2026-11'});
 const confirmed=await owner.post('/backoffice/account-intelligence/confirm-account',exact);
 verify(confirmed.status===303,'Exact CRM account confirmation is saved');
 page=await owner.get('/backoffice/account-intelligence?account=B0000001&month=2026-11');
 verify(page.body.includes('CRM account identity confirmed'),'CRM confirmation persists in management view');
 verify(page.body.includes('Demo Fibre 50Mbps')&&page.body.includes('0791111101'),'CRM mobile and fixed service sections render');
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'statement'},[['synthetic-statement.jsp']]));
 page=await owner.get('/backoffice/account-intelligence');
 verify(page.body.includes('identical duplicates skipped'),'Genuine PDF supplied as .jsp accepted and duplicate skipped');
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'statement'},[['synthetic-second-account.pdf']]));
 page=await owner.get('/backoffice/account-intelligence?account=B0000002&month=2026-11');
 verify(page.body.includes('B0000002')&&page.body.includes('R30.00'),'Second account upload and selection works');
 const secondUnconfirmed=await owner.get('/backoffice/account-intelligence/customer-report?account=B0000002&month=2026-11');
 verify(secondUnconfirmed.body.includes('Pending CRM account confirmation')&&
   !secondUnconfirmed.body.includes('Demo Staff Member'),'Unconfirmed second account does not inherit another customer staff contact');
 const secondConfirm=new URLSearchParams({csrf,account:'B0000002',crm_account_id:'102',month:'2026-11'});
 const secondResult=await owner.post('/backoffice/account-intelligence/confirm-account',secondConfirm);
 const secondConfirmed=await owner.get('/backoffice/account-intelligence/customer-report?account=B0000002&month=2026-11');
 verify(secondResult.status===303&&secondConfirmed.body.includes('No active staff member assigned in TK2M')&&
   !secondConfirmed.body.includes('Demo Staff Member'),'Confirmed account without staff displays explicit unassigned state');
 await owner.post('/backoffice/account-intelligence/upload',form({csrf,kind:'invoice'},[['synthetic-invoice.pdf']]));
 page=await owner.get('/backoffice/account-intelligence?account=B0000001&month=2026-11');
 verify(page.body.includes('Supporting detailed invoice checks')&&page.body.includes('VT2-FAKE01'),'Supporting supplier invoice listed');
 verify(page.body.includes('R290.00')&&page.body.includes('R72.71'),'Supporting invoice is NOT double-counted as statement charge');
 let preview=await owner.get('/backoffice/account-intelligence/customer-report?account=B0000001&month=2026-11');
 verify(preview.status===200&&preview.body.includes('Monthly Account Review')&&preview.body.includes('Demo Fibre 50Mbps'),'Customer report includes actual mobile and fixed inventory');
 verify(preview.body.includes('October 2026 compared with November 2026')&&
   preview.body.includes('Customer name')&&preview.body.includes('Synthetic Business One')&&
   preview.body.includes('Staff member responsible for this account')&&preview.body.includes('Demo Staff Member'),
   'Customer report labels customer name and confirmed assigned staff member');
 let editor=await owner.get('/backoffice/account-intelligence/email-draft?account=B0000001&month=2026-11');
 verify(editor.status===200&&editor.body.includes('Gerda&#39;s email editor')||editor.status===200&&editor.body.includes("Gerda's email editor"),'Customer email editor opens');
 verify(editor.body.includes('Your account review: November 2026 compared with October 2026'),'Standard email subject generated');
 const savedDraft=new URLSearchParams({csrf,account:'B0000001',month:'2026-11',recipient:'synthetic@example.invalid',subject:'QA draft for synthetic account',body:'Synthetic manager-written email body'});
 const savedResponse=await owner.post('/backoffice/account-intelligence/email-draft',savedDraft);
 editor=await owner.get('/backoffice/account-intelligence/email-draft?account=B0000001&month=2026-11');
 verify(savedResponse.status===303&&editor.body.includes('Synthetic manager-written email body'),'Edited email draft saved without sending');
 const badDraft=new URLSearchParams({csrf,account:'B0000001',month:'2026-11',recipient:'broken-address',subject:'Invalid',body:'Test'});
 const badDraftResponse=await owner.post('/backoffice/account-intelligence/email-draft',badDraft);
 verify(badDraftResponse.status===400,'Invalid recipient rejected');
 const invalidReview=new URLSearchParams({csrf,account:'B0000001',month:'2026-11',prior:'2026-10',key:'LINE:999111114',status:'verified',reason:''});
 const rr=await owner.post('/backoffice/account-intelligence/review',invalidReview);
 verify(rr.status===400,'Verification with blank reason denied');
 const validReview=new URLSearchParams({csrf,account:'B0000001',month:'2026-11',prior:'2026-10',key:'LINE:999111114',status:'verified',reason:'SYNTHETIC REVIEW: source evidence checked'});
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
 page=await staff.get('/backoffice/account-intelligence/email-draft?account=B0000001&month=2026-11');
 verify(page.status===403,'Staff denied management-only email editor');
 const noCsrf=new URLSearchParams({account:'B0000001',month:'2026-11',prior:'2026-10',key:'LINE:999111114',status:'verified',reason:'bad'});
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
 verify(j.documents===3&&j.reviews===1&&j.confirmedLinks===2&&j.emailDrafts===1&&j.audits>=4,'Rejected files do not modify fake documents/reviews');
 console.log('SCREEN_ROUTE_MATRIX_PASS count='+passes+' synthetic=true; passed='+JSON.stringify(passed));
}
run().catch(e=>{console.error('SCREEN_ROUTE_MATRIX_FAIL',e.stack||e);process.exitCode=1});
