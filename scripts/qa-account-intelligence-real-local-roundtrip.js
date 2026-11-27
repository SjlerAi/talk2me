'use strict';
// Owner-supplied documents remain entirely on the owner's authorised computer.
// Real PDF-backed JSP files are read in memory and exercised ONLY against the
// deliberately isolated, loopback-bound synthetic QA server. No production API,
// external upload, customer data logging, or copy of source content is created.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {extractPdfText}=require('../src/services/account-intelligence-pdf');
const core=require('../src/services/account-intelligence-core');
const root=process.env.TK2M_DOCS;
const port=Number(process.env.TK2M_QA_PORT||38189);
assert(root&&path.isAbsolute(root)&&fs.existsSync(root),'Local documents path required');
assert(Number.isInteger(port)&&port>=1024&&port<=65535,'Explicit local test port required');
const base='http://127.0.0.1:'+port;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
let cookie='';
async function get(relative,binary=false) {
 assert(relative.startsWith('/'),'Loopback-only relative path required');
 const res=await fetch(base+relative,{headers:cookie?{Cookie:cookie}:{},redirect:'manual'});
 const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
 return{status:res.status,body:binary?Buffer.from(await res.arrayBuffer()):await res.text(),
  disposition:res.headers.get('content-disposition')||''};
}
function documentLinks(html){
 const out=new Map();
 const re=/<tr>\s*<td>[^<]*<\/td>\s*<td>([^<]+)<\/td>\s*<td>statement<\/td>\s*<td>[^<]*<\/td>\s*<td><a href="([^"]+\/source\/\d+)"/g;
 for(const m of html.matchAll(re))out.set(m[1].replaceAll('&amp;','&'),m[2]);
 return out;
}
(async()=>{
 const status=await get('/__qa/status');
 assert.equal(status.status,200);
 const initial=JSON.parse(status.body);
 assert.equal(initial.synthetic,true,'This script must NEVER target a live host');
 const names=fs.readdirSync(root).filter(n=>/\.jsp$/i.test(n)).sort();
 assert(names.length>0&&names.length<=6,'Expected 1 to 6 explicitly provided PDFs');
 await get('/__qa/login/owner');
 let page=await get('/backoffice/account-intelligence');
 assert.equal(page.status,200);
 const links=documentLinks(page.body);
 assert.equal(links.size,names.length,'All original PDFs must be listed in the register');
 let checkedRows=0;
 for(const name of names){
  const link=links.get(name);
  assert(link,'Missing original PDF register row for '+name);
  const original=fs.readFileSync(path.join(root,name));
  const source=await get(link,true);
  assert.equal(source.status,200,'Source download must be authorized');
  assert.equal(sha(source.body),sha(original),'Source file changed between upload and download');
  assert(/filename\*?=/i.test(source.disposition),'Original download must name a source');
  const extracted=await extractPdfText(original);
  const parsed=core.parseStatement(extracted);
  assert(parsed.accountNumber&&parsed.entries.length,'Document not parsed');
  const compare=core.compareMonths(parsed.entries,'2026-10','2026-11');
  const query='?account='+encodeURIComponent(parsed.accountNumber)+'&month=2026-11';
  const view=await get('/backoffice/account-intelligence'+query);
  assert.equal(view.status,200,'Account view must open');
  assert(view.body.includes('Billing position for '+parsed.accountNumber),'Wrong account shown');
  assert(view.body.includes('R'+core.rand(compare.previous.invoices)),'Previous invoice amount mismatched');
  assert(view.body.includes('R'+core.rand(compare.current.invoices)),'Current invoice amount mismatched');
  assert(view.body.includes('Top 10 monetary differences'),'Top-ten card missing');
  const report=await get('/backoffice/account-intelligence/customer-report'+query);
  assert.equal(report.status,200,'Customer report preview must open');
  assert(report.body.includes('Monthly Account Review'),'Customer report missing');
  assert(report.body.includes('R'+core.rand(compare.current.invoices)),'Report amount mismatched');
  assert(report.body.includes('Nothing has been sent'),'Report must remain unsent');
  checkedRows+=parsed.entries.length;
  console.log('REAL_DOC_LOOPBACK_PASS '+JSON.stringify({filename:name,months:[...new Set(parsed.entries.map(e=>e.month))].length,
   entries:parsed.entries.length,sourceSHA256Match:true,accountPage:true,reportPreview:true,
   monthlyAmountsMatch:true,differences:compare.changeCount,displayed:compare.top.length}));
 }
 const tokenMatch=page.body.match(/name="csrf" value="([0-9a-f]{64})"/);
 assert(tokenMatch,'CSRF missing');
 const form=new FormData();
 form.append('csrf',tokenMatch[1]);form.append('kind','statement');
 for(const name of names)form.append('documents',new Blob([fs.readFileSync(path.join(root,name))],
  {type:'application/pdf'}),name);
 const post=await fetch(base+'/backoffice/account-intelligence/upload',{method:'POST',
  headers:cookie?{Cookie:cookie}:{},body:form,redirect:'manual'});
 assert.equal(post.status,303,'Duplicate upload must redirect safely');
 const subsequent=await get('/backoffice/account-intelligence');
 assert(subsequent.body.includes(names.length+' identical duplicates skipped'),'Duplicate detection failed');
 const final=JSON.parse((await get('/__qa/status')).body);
 assert.equal(final.documents,names.length,'Duplicate upload changed document count');
 assert.equal(final.entries,checkedRows,'Reconciliation rows changed unexpectedly');
 assert.equal(final.distinctAccounts,names.length,'Accounts were incorrectly combined');
 await get('/__qa/login/staff');
 const staff=await get('/backoffice/account-intelligence');
 assert.equal(staff.status,403,'Staff must be denied');
 await get('/__qa/login/manager');
 const manager=await get('/backoffice/account-intelligence');
 assert.equal(manager.status,200,'Manager must be allowed');
 console.log('REAL_DOCUMENT_LOCAL_QA_PASS '+JSON.stringify({documents:names.length,
   transactions:checkedRows,duplicateReuploadSkipped:true,privateSourcesByteIdentical:true,
   perAccountScreen:true,perAccountReport:true,ownerAccess:true,managerAccess:true,staffDenied:true,
   productionUsed:false,syntheticDatabase:true}));
})().catch(e=>{console.error('REAL_DOCUMENT_LOCAL_QA_FAIL '+String(e.message||e).slice(0,220));process.exitCode=1});
