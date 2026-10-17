'use strict';
// Local-only UAT integration checks. No successful POST and no data modification.
const fs=require('fs'),cp=require('child_process'),path=require('path'),assert=require('assert');
const pid=cp.execSync("pgrep -f '^lsnode:/home/uent/public_html/talk2me/[[:space:]]*$' | head -n 1").toString().trim();
const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ').toString().split('\0').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
assert.equal(env.DB_NAME,'uent_Crm');
assert.equal(env.DB_USER,'uent_Crm-Uat');
assert.equal(env.UAT_MODE,'true');
for(const k of ['DB_NAME','DB_USER','DB_HOST','DB_PASSWORD','UAT_MODE','OUTBOUND_EMAIL_ENABLED','PRIVATE_UPLOAD_DIR'])process.env[k]=env[k];
process.env.T2M_TEMP_CLEANUP_ENABLED='true';
const express=require('express'),ejs=require('ejs'),db=require('../src/config/db');
const {businessDate}=require('../src/middleware/auth');
const {canUseTemporaryCleanup,isCleanupEnabled}=require('../src/services/temporary-cleanup-access');
const {formValues,rowHash}=require('../src/services/temporary-cleanup-correction');
const TOKEN='a'.repeat(64);
async function main(){
  assert(isCleanupEnabled());
  assert(canUseTemporaryCleanup({id:9,role:'owner',email:'info@b4s.co.za'}));
  assert(canUseTemporaryCleanup({id:4,role:'manager',email:'jonathan@talk-online.co.za'}));
  assert(canUseTemporaryCleanup({id:1,role:'owner',email:'gerda@talk-online.co.za'}));
  assert(!canUseTemporaryCleanup({id:7,role:'manager',email:'sias@talk-online.co.za'}));
  assert(!isCleanupEnabled(Date.parse('2026-11-02T00:00:00Z')));
  assert.equal(formValues({client_name:'Test',account_number:'ABC12',cell_number:'0821234567',email:'test@example.com',line_status:'active'}).cell_number_normalised,'27821234567');
  assert.throws(()=>formValues({client_name:'Test',account_number:'ABC',cell_number:'123',line_status:'active'}));
  assert.notEqual(rowHash({id:1,client_name:'A',cell_number_normalised:'27820000001'}),rowHash({id:1,client_name:'B',cell_number_normalised:'27820000001'}));
  ejs.compile(fs.readFileSync(path.join(__dirname,'../views/temporary-cleanup.ejs'),'utf8'));
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../views'));
  app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{const other=req.headers['x-test-user']==='sias';req.session={user:other?{id:7,role:'manager',email:'sias@talk-online.co.za'}:{id:4,full_name:'Jonathan',role:'manager',email:'jonathan@talk-online.co.za'},loginDate:businessDate(),tempCleanupToken:TOKEN};res.locals.basePath='';next()});
  app.use(require('../src/routes/temporary-cleanup'));
  app.use(require('../src/routes/temporary-cleanup-corrections'));
  app.use(require('../src/routes/temporary-cleanup-consolidate'));
  const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject)});
  try {
    const origin='http://127.0.0.1:'+server.address().port;
    for(const category of ['same_account_phone','cross_account_phone','account_alias','staff_conflict','base_unlinked']){
      const response=await fetch(origin+'/temporary-cleanup?type='+category,{redirect:'manual'});
      const page=await response.text();
      assert.equal(response.status,200,'GET '+category+' returned '+response.status+' '+page.slice(0,300));
      assert(page.includes('Customer Cleanup'));
      console.log('UAT_QUEUE_OK',category,response.status);
    }
    const [conflicts]=await db.query("SELECT UPPER(REPLACE(TRIM(account_number),' ','')) k FROM client_assignments WHERE is_active=1 AND TRIM(COALESCE(account_number,''))<>'' GROUP BY k HAVING COUNT(DISTINCT assigned_staff_id)>1 LIMIT 1");
    if(conflicts.length){
      const staffReview=await fetch(origin+'/temporary-cleanup/review/staff_conflict/'+encodeURIComponent(conflicts[0].k),{redirect:'manual'});
      const html=await staffReview.text();
      assert.equal(staffReview.status,200,'Staff review returned '+staffReview.status+' '+html.slice(0,250));
      assert(html.includes('Correct staff member assigned to this record'));
      console.log('UAT_STAFF_CONFLICT_REVIEW_OK',staffReview.status);
    }
    const [baselines]=await db.query('SELECT id FROM mobile_base_current WHERE client_id IS NULL LIMIT 1');
    if(baselines.length){
      const baseReview=await fetch(origin+'/temporary-cleanup/review/base_unlinked/'+baselines[0].id,{redirect:'manual'});
      const html=await baseReview.text();assert.equal(baseReview.status,200,'Supplier review returned '+baseReview.status+' '+html.slice(0,250));
      assert(html.includes('icc id'));
      console.log('UAT_SUPPLIER_RECORD_REVIEW_OK',baseReview.status);
    }
    const [rows]=await db.query("SELECT cell_number_normalised phone,MIN(id) id FROM clients WHERE account_id IS NOT NULL AND cell_number_normalised REGEXP '^27[0-9]{9}$' GROUP BY cell_number_normalised HAVING COUNT(*)=2 AND COUNT(DISTINCT account_id)=1 LIMIT 1");
    assert(rows.length>0,'No testable duplicate group');
    const phone=rows[0].phone,id=rows[0].id;
    const review=await fetch(origin+'/temporary-cleanup/review/same_account_phone/'+phone,{redirect:'manual'});
    const reviewText=await review.text();
    assert.equal(review.status,200,reviewText.slice(0,380));
    assert(reviewText.includes('Correct this line'));
    assert(reviewText.includes('Consolidate the current line'));
    console.log('UAT_REVIEW_OK',review.status,'review_editor_present');
    const bad=await fetch(origin+'/temporary-cleanup/review/same_account_phone/'+phone,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:'INVALID',decision:'approved_grouping',notes:'Test invalid csrf prevented'}),redirect:'manual'});
    assert.equal(bad.status,403,'Expected invalid CSRF review 403');
    const correction=await fetch(origin+'/temporary-cleanup/correct/same_account_phone/'+phone+'/'+id,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:TOKEN,row_hash:'INVALID',confirm_change:'1',reason:'Test invalid optimistic snapshot',client_name:'Test',account_number:'ABC12',cell_number:phone,email:'',line_status:'active'}),redirect:'manual'});
    assert.equal(correction.status,409,'Expected invalid snapshot correction 409');
    const consolidation=await fetch(origin+'/temporary-cleanup/consolidate/'+phone,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:TOKEN,snapshot:'INVALID',confirm_consolidate:'1',primary_id:String(id),reason:'Test invalid consolidation hash prevented'}),redirect:'manual'});
    assert.equal(consolidation.status,409,'Expected invalid consolidation snapshot 409');
    const blocked=await fetch(origin+'/temporary-cleanup?type=same_account_phone',{headers:{'x-test-user':'sias'},redirect:'manual'});
    assert.equal(blocked.status,404,'Unauthorized manager must be denied');
    console.log('UAT_SAFETY_TESTS_OK',JSON.stringify({bad_csrf:bad.status,bad_correction_snapshot:correction.status,bad_consolidation_snapshot:consolidation.status,unauthorised:blocked.status}));
    const [[totals]]=await db.query('SELECT (SELECT COUNT(*) FROM temporary_cleanup_changes) changes,(SELECT COUNT(*) FROM temporary_cleanup_decisions) decisions');
    console.log('UAT_TRACKING',JSON.stringify(totals));
  }finally{await new Promise(done=>server.close(done));}
}
main().catch(e=>{console.error('TEMP_CLEANUP_TEST_FAILED',e.stack||e.message);process.exitCode=1}).finally(()=>db.end().catch(()=>{}));
