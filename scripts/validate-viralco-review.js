'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ejs=require('ejs');
const {
  OPTIONS,buildIssues,issueByKey,validateChoice,assessIssues,
  ensureReviewSchema,loadDecisions,saveDecision
}=require('../src/services/viralco-review');

const account={id:1511,account_number:'NM000904',display_name:'ROELOF DEDNAM'};
const report={customerName:'NATIONAL REAL ESTATE (PTY) LTD',accountNumber:'NM000904'};
const results={
  nameMismatch:true,
  rows:[
    {action:'conflict',sourceRow:11,phone:'27825551111',packDesc:'Business 20',subscriberName:'Person A',
      crmMatches:[{id:91,clientName:'Other Person',accountNumber:'OTHER123',accountId:8}]},
    {action:'ambiguous',sourceRow:12,phone:'27825552222',packDesc:'Business 50',subscriberName:'Person B',
      crmMatches:[{id:98,clientName:'Person X',accountNumber:'NM000904'},
        {id:99,clientName:'Person Y',accountNumber:'NM000904'}]},
    {action:'new',sourceRow:13,phone:'27825553333',packDesc:'Business 99',subscriberName:'Person C',
      crmMatches:[]},
    {action:'update',sourceRow:14,phone:'27825554444',packDesc:'Changed Package'}
  ],
  missingLines:[{clientId:83,phone:'27825555555',clientName:'Legacy client',accountNumber:'NM000904',packageName:'Old Package'}]
};
const issues=buildIssues(results,report,account);
assert.deepEqual(issues.map(i=>i.number),[1,2,3,4,5]);
assert.deepEqual(issues.map(i=>i.type),['account_name','cross_account','duplicate','new_number','missing_number']);
assert.deepEqual(issues.map(i=>i.key),['account-name','line-11','line-12','line-13','missing-83']);
assert.equal(issues[1].sourceRow,11);
assert.equal(issues[1].phone,'27825551111');
assert.equal(issues[1].crmMatches[0].accountNumber,'OTHER123');
assert.equal(issues[4].sourceRow,null);
assert.ok(issues[4].reason.includes('Never delete'));
assert.equal(issueByKey(issues,'line-12')?.number,3);
assert.equal(issueByKey(issues,'line-999'),null);
assert.equal(assessIssues(issues,new Map()).unresolved,5);

assert.throws(()=>validateChoice(issues[0],'verify_account','staff','approved'),/owner or manager/);
assert.throws(()=>validateChoice(issues[3],'create_line','staff','create it'),/owner or manager/);
assert.throws(()=>validateChoice(issues[1],'create_line','owner','yes'),/not allowed/);
assert.throws(()=>validateChoice(issues[1],'hold','staff',''),/explanation/);
assert.throws(()=>validateChoice(null,'hold','owner','reason'),/Unknown/);
assert.throws(()=>validateChoice(issues[1],'hold','staff','x'.repeat(901)),/900/);
assert.deepEqual(validateChoice(issues[1],'refer_manager','staff','Please investigate'),
  {choice:'refer_manager',status:'referred',note:'Please investigate'});
assert.deepEqual(validateChoice(issues[3],'create_line','manager','Verified number'),
  {choice:'create_line',status:'resolved',note:'Verified number'});

const decisions=new Map([
  ['account-name',{choice:'verify_account',status:'resolved',note:'Account number verified'}],
  ['line-11',{choice:'hold',status:'held',note:'Different owner'}],
  ['line-12',{choice:'refer_manager',status:'referred',note:'Duplicate CRM identity'}],
  ['line-13',{choice:'create_line',status:'resolved',note:'Verified globally unique'}],
  ['missing-83',{choice:'keep_crm',status:'resolved',note:'Keep line'}]
]);
const summary=assessIssues(issues,decisions);
assert.deepEqual(summary,{total:5,unresolved:0,held:1,referred:1,resolved:3,ready:true,accountBlocked:false});
const referredName=new Map(decisions);
referredName.set('account-name',{choice:'refer_manager',status:'referred',note:'Needs approval'});
assert.equal(assessIssues(issues,referredName).ready,false);
assert.equal(assessIssues(issues,referredName).accountBlocked,true);
const withMissing=new Map(decisions);withMissing.delete('line-12');
assert.equal(assessIssues(issues,withMissing).unresolved,1);
assert.equal(assessIssues(issues,withMissing).ready,false);
const invalidChoice=new Map(decisions);invalidChoice.set('line-11',{choice:'create_line'});
assert.equal(assessIssues(issues,invalidChoice).ready,false);

// The review state is stored independently from CRM clients; decisions are version-linked at publication.
(async()=>{
  const ddl=[];
  await ensureReviewSchema({query:async sql=>{ddl.push(sql);return [[]];}});
  assert.equal(ddl.length,2);
  for(const sql of ddl){
    assert.match(sql,/^CREATE TABLE IF NOT EXISTS viralco_review_/);
    assert.doesNotMatch(sql,/\bDROP\b|\bUPDATE clients\b/i);
  }
  assert.match(ddl[0],/UNIQUE KEY uq_vc_preview_issue/);
  const called=[];
  const db={
    async execute(sql,params){
      called.push({sql,params});
      if(sql.startsWith('SELECT id,choice FROM'))return [[{id:81,choice:'hold'}]];
      if(sql.startsWith('SELECT id FROM viralco_review_issues'))return [[{id:81}]];
      if(sql.startsWith('SELECT id,issue_key'))return [[{id:81,issue_key:'line-11',choice:'refer_manager',status:'referred'}]];
      return [{affectedRows:1}];
    }
  };
  await saveDecision(db,{accountId:1511,previewId:'f'.repeat(36),issue:issues[1],
    ...validateChoice(issues[1],'refer_manager','staff','Manager needs to verify'),
    actorId:4});
  assert.ok(called.some(x=>x.sql.includes('ON DUPLICATE KEY UPDATE')));
  assert.ok(called.some(x=>x.sql.includes('INSERT INTO viralco_review_audit')));
  const audit=called.find(x=>x.sql.includes('INSERT INTO viralco_review_audit'));
  assert.equal(audit.params.old,'hold');
  assert.equal(audit.params.actorId,4);
  const loaded=await loadDecisions(db,1511,'f'.repeat(36));
  assert.equal(loaded.get('line-11').status,'referred');

  const template=fs.readFileSync('views/viralco-account-sync.ejs','utf8');
  const locals={
    basePath:'/talk2me',appVersion:'test',assetVersion:'test',client:{id:3049,client_name:'Sample'},
    account,versions:[],current:null,preview:null,manager:true,ownerManager:true,
    lines:[],outstanding:[],managerRequests:[],totalRows:0,page:1,pageCount:1,
    csrfToken:'a'.repeat(64),message:'',error:''
  };
  const preview={id:'f'.repeat(36),filename:'ViralCo.xlsx',report,
    nameMismatch:true,accountMatches:true,canConfirmName:true,baselineChanged:false,
    versionChanged:false,total:5,matched:1,changed:1,unchanged:0,safeNew:1,conflicts:2,missingCount:1,eligible:0,
    mismatchEligibility:0,issues:issues.map(i=>({...i,decision:decisions.get(i.key)||null})),
    review:summary,rows:[...results.rows].map(row=>({...row,upgradable:'N',avgSpend:null,
      subscriberName:row.subscriberName||'Sample',previous:{package_name:'Old'},changeDecision:null}))};
  const html=ejs.render(template,{...locals,preview},
    {filename:'views/viralco-account-sync.ejs'});
  assert.match(html,/Conflict 1 — Business account identity/);
  assert.match(html,/Conflict 2 — Mobile number belongs to another account/);
  assert.match(html,/Excel row: <b>11<\/b>/);
  assert.match(html,/OTHER123/);
  assert.match(html,/Keep current CRM \/ no change/);
  assert.match(html,/Send to manager/);
  assert.match(html,/verify_account/);
  assert.match(html,/create_line/);
  assert.match(html,/0<\/strong> unresolved/);
  assert.match(html,/issue_key" value="line-11"/);
  assert.match(html,/name="confirm_updates"/);
  assert.match(html,/name="choice"/);
  assert.doesNotMatch(html,/name="create_new"|name="verify_company"/);
  const blocked=ejs.render(template,{...locals,preview:{...preview,review:assessIssues(issues,new Map())}},
    {filename:'views/viralco-account-sync.ejs'});
  assert.match(blocked,/Confirm & Update CRM<\/button>|Confirm &amp; Update CRM<\/button>/);
  assert.match(blocked,/disabled>Confirm/);

  const managerQueue=ejs.render(template,{...locals,managerRequests:[
    {preview_id:'f'.repeat(36),issue_number:2,issue_type:'cross_account',
      phone_normalised:'27825551111',uploaded_by:4,filename:'ViralCo.xlsx'}
  ]},{filename:'views/viralco-account-sync.ejs'});
  assert.match(managerQueue,/Referred to Manager — Upload Reviews/);
  assert.match(managerQueue,/#review-issue-2/);

  const route=fs.readFileSync('src/routes/uat-viralco-sync.js','utf8');
  assert.match(route,/assessIssues\(issues,decisions\)/);
  assert.match(route,/if\(!review.ready\)/);
  assert.match(route,/readPreview\(conn,req.body.preview_id,lockedCtx,req.session.user.id,true,loggedInManager/);
  assert.match(route,/saveDecision\(conn/);
  assert.match(route,/viralco-sync\/outstanding\/:issueId/);
  assert.match(route,/UPDATE viralco_review_issues SET version_id/);
  assert.match(route,/changedDecision\?\.choice==='keep_crm'/);
  assert.doesNotMatch(route,/String\(req.body.create_new/);
  const css=fs.readFileSync('public/css/viralco-sync.css','utf8');
  assert.match(css,/vc-issue-comparison/);
  assert.match(css,/@media\(max-width:700px\)/);
  console.log('PASS ViralCo numbered review: distinct MSISDN/Excel row, decisions, role gates, manager referral, blocking, audit, responsive page.');
})().catch(error=>{console.error(error);process.exitCode=1;});
