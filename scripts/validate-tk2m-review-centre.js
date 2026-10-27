'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const root=path.resolve(__dirname,'..');
const read=x=>fs.readFileSync(path.join(root,x),'utf8');
const {loadCases,TYPES,canManage,summarize,hash}=require('../src/services/tk2m-review-cases');
const {safeLoginReturn,safeReviewReturn,safeCleanupReturn}=require('../src/services/cleanup-login-return');
const server=read('server.js');
const routes=read('src/routes/tk2m-data-review.js');
const schema=read('scripts/install-tk2m-review-schema.js');
const loginRoute=read('src/routes/index.js');
const loginView=read('views/login.ejs');
const view=read('views/tk2m-review-portal.ejs');
const browserCss=read('public/css/tk2m-review.css');
assert.match(read('src/services/tk2m-review-cases.js'),/SELECT case_id,source_hash,status,note,reviewer_staff_id,revision,reviewed_at FROM tk2m_review_decisions/);
const calendar=read('public/js/calendar-home-uat.js');

assert.equal(safeReviewReturn('/data-review','',true),'/data-review');
assert.equal(safeReviewReturn('/data-review','/talk2me',true),null);
assert.equal(safeReviewReturn('//evil.com','',true),null);
assert.equal(safeReviewReturn('/data-review/other','',true),null);
assert.equal(safeReviewReturn('/data-review','',false),null);
assert.equal(safeLoginReturn('/data-review','',true),'/data-review');
assert.equal(safeLoginReturn('https://evil.com','',true),null);
assert.equal(safeCleanupReturn('/temporary-cleanup',''),'/temporary-cleanup');
assert.ok(loginRoute.includes("const reviewAllowed=res.locals.isStaging && returnTo===res.locals.basePath+'/data-review'"));
assert.ok(loginView.includes("returnTo.endsWith('/data-review')"));
assert.match(server,/if \(CRM_STAGE_MODE\) \{\s+const dataReview = require\('\.\/src\/routes\/tk2m-data-review'\)/);
assert.match(calendar,/data-os-route="\$\{basePath\}\/data-review"/);
assert.match(read('views/backoffice-home.ejs'),/Data Review Centre/);
assert.match(routes,/function reviewSession\(req,res,next\)/);
assert.match(routes,/return requireAuth\(req,res,next\)/);
assert.match(routes,/csrfValid\(req\)/);
assert.match(routes,/crypto\.timingSafeEqual/);
assert.match(routes,/SELECT revision FROM tk2m_review_decisions WHERE case_id=\? FOR UPDATE/);
assert.match(routes,/await conn\.beginTransaction\(\)/);
assert.match(routes,/await conn\.commit\(\)/);
assert.match(routes,/INSERT INTO tk2m_review_history/);
assert.match(routes,/reviewer_staff_id/);
assert.doesNotMatch(routes,/UPDATE clients SET|DELETE FROM clients|UPDATE monthly_import_matches SET/);
assert.ok(schema.includes("process.env.CRM_STAGE_MODE!=='true'"));
assert.ok(schema.includes("process.env.DB_NAME!=='talk_crm_stage'"));
assert.ok(schema.includes("tk2m_review_decisions"));
assert.ok(schema.includes("tk2m_review_history"));
assert.ok(schema.includes("tk2m_review_source_deltas"));
assert.match(browserCss,/@media\(max-width:760px\)/);

const client=(id,staff,phone,account)=>({
  id,client_name:'QA Customer '+id,account_id:account,account_number:'ACC'+account,
  cell_number_normalised:phone,cell_number:phone,email:null,id_number:null,
  next_upgrade_date:'2026-11-01',previous_upgrade_date:'2024-11-01',
  upgrade_date:'2024-11-02',package_name:'Test',line_status:'active',
  is_active:1,updated_at:'2026-10-26 09:00:00',assigned_staff_id:staff,
  assigned_staff_name:'QA Staff '+staff
});
const fixture=[client(1,5,'27821234567',10),client(2,5,'27821234567',10),client(3,6,'27831234567',11)];
const triage=[{id:14,status:'pending',case_type:'manual_identity',case_key:'QA',phone_normalised:'27821234567',
 client_ids_json:'[1,2]',reason_codes_json:'["CHECK_ACCOUNT"]',source_hash:'a'.repeat(64),review_notes:'',
 updated_at:'2026-10-26 09:00:00'}];
const imports=[
 {match_id:50,classification:'conflict',review_status:'pending',match_domain:'mobile',match_reason:'Two CRM matches',
 proposed_client_id:1,proposed_account_id:10,updated_at:'2026-10-27 10:00:00',row_id:40,row_fingerprint:'b'.repeat(64),
 source_row_number:12,batch_id:2,customer_name:'QA Conflict',phone_normalised:'27821234567',phone_original:'0821234567',account_number:'ACC10',warning_text:'Check'},
 {match_id:51,classification:'possible_match',review_status:'pending',match_domain:'mobile',match_reason:'Possible',
 proposed_client_id:1,proposed_account_id:10,updated_at:'2026-10-27 10:00:00',row_id:41,row_fingerprint:'c'.repeat(64),
 source_row_number:13,batch_id:2,customer_name:'QA Possible',phone_normalised:'27821234567',phone_original:'0821234567',account_number:'ACC10',warning_text:'Check'}
];
const deltas=[{entity_type:'client',entity_id:2,field_key:'is_active',source_value:'active',stage_value:'inactive',
 source_hash:'d'.repeat(64),checked_at:'2026-10-27 10:00:00'}];
function conn(rows){
 return {query:async sql=>{
  if(sql.includes('FROM clients c LEFT JOIN client_assignments'))return [rows];
  if(sql.includes('FROM temporary_duplicate_triage'))return [triage];
  if(sql.includes('FROM monthly_import_matches m INNER JOIN'))return [imports];
  if(sql.includes('FROM tk2m_review_source_deltas'))return [deltas];
  if(sql.includes('FROM tk2m_review_decisions'))return [[]];
  throw Error('Unexpected test SQL: '+sql.slice(0,100));
 }};
}
(async()=>{
 const owner={id:1,role:'owner',full_name:'QA Owner'};
 const staff={id:5,role:'staff',full_name:'QA Staff'};
 const unassigned={id:6,role:'staff'};
 const manager={id:9,role:'manager'};
 const all=await loadCases(owner,conn(fixture));
 assert.deepEqual(Object.entries(summarize(all).kinds).map(([k,v])=>[k,v.total]),
  [['migration',1],['duplicate_phone',1],['identity',1],['import_conflict',1],['import_possible',1]]);
 assert.equal(all.length,5);
 assert.equal(canManage(owner),true);assert.equal(canManage(manager),true);assert.equal(canManage(staff),false);
 assert.equal((await loadCases(staff,conn(fixture))).length,4);
 assert.equal((await loadCases(unassigned,conn(fixture))).length,0);
 const crossStaff=[...fixture];crossStaff[1]={...crossStaff[1],assigned_staff_id:6};
 assert.equal((await loadCases(staff,conn(crossStaff))).filter(x=>x.kind==='duplicate_phone').length,0);
 assert.equal((await loadCases(staff,conn(crossStaff))).filter(x=>x.kind==='identity').length,0);
 const sample=all[1];assert.equal(sample.id.length,64);assert.equal(sample.fingerprint.length,64);
 assert.equal(hash('abc'),hash('abc'));
 const shared={title:'Review Case',currentUser:owner,basePath:'',assetVersion:'qa',canManage:true,
  listing:[],totals:summarize(all),kinds:TYPES,kind:'all',view:'open',q:'',page:1,pages:1,listTotal:5,
  csrf:'e'.repeat(64),history:[],notice:''};
 const page=ejs.render(view,{...shared,selected:{...sample,lines:[]}});
 assert.ok(page.includes('Record your decision'));
 assert.ok(page.includes('QA Customer 1'));
 assert.ok(page.includes('QA Staff 5'));
 assert.ok(page.includes('Identity / Email'));
 assert.ok(routes.includes('m.account_number,m.id_number,m.email'))
 assert.ok(page.includes('source_hash'));
 assert.ok(page.includes('No customer records'));
 const queue=ejs.render(view,{...shared,selected:null,history:null,listing:all});
 assert.ok(queue.includes('Review queue')&&queue.includes('Source vs test'));
 const staffPage=ejs.render(view,{...shared,currentUser:staff,canManage:false,selected:{...sample,lines:[]}});
 assert.ok(!staffPage.includes('value="verified"')&&!staffPage.includes('value="keep_separate"'));
 console.log('TK2M_REVIEW_CENTRE_REGRESSION=PASS',{
  owner_cases:all.length,assigned_staff_cases:4,unassigned_staff_cases:0,
  mixed_staff_cases_hidden:true,login_allowlist:true,csrf:true,optimistic_lock:true});
})().catch(err=>{console.error(err);process.exitCode=1;});
