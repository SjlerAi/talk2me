'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const root=path.resolve(__dirname,'..');
const load=p=>fs.readFileSync(path.join(root,p),'utf8');
const svc=require('../src/services/tk2m-merge-planner');
const FIELDS=svc.FIELDS;
assert.ok(FIELDS.some(x=>x.key==='birthday'));
assert.ok(FIELDS.some(x=>x.key==='email'));
assert.ok(FIELDS.some(x=>x.key==='notes'));
for(const key of ['account_id','account_number','updated_at','upgrade_date','next_upgrade_date','previous_upgrade_date','line_status']){
 assert.ok(!FIELDS.some(x=>x.key===key), 'Contract/timestamp cannot be a donor field: '+key);
}
const base=(id,account,staff,birthday,email,updated)=>({
 id,account_id:account,account_number:'ACC'+account,first_name:'First'+id,
 surname:'Surname',company_name:'',client_name:'Customer '+id,cell_number:'0821000000',
 cell_number_normalised:'27821000000',alt_number:'',
 email,city_town:'Cape Town',id_number:'',customer_type:'individual',birthday,
 main_contact_name:'',main_contact_number:'',notes:'',package_name:'Package'+id,
 line_status:'active',previous_upgrade_date:'2024-10-21',next_upgrade_date:'2026-10-21',
 upgrade_date:'2024-10-21',is_active:1,updated_at:updated,assigned_staff_id:staff,
 assigned_staff_name:'Staff '+staff,assignment_count:1
});
const four=[
 base(1,20,5,null,'original@example.com','2026-10-21 10:00:00'),
 base(2,20,5,null,'two@example.com','2026-10-22 10:00:00'),
 base(3,20,5,'1980-02-19','latest@example.com','2026-10-27 10:00:00'),
 base(4,20,6,'1975-01-01','different@example.com','2026-10-26 10:00:00')
];
const lines=[
 {id:100,client_id:1,account_id:20,msisdn_normalised:'27821000001',last_upgrade_date:'2024-05-01',eligible_upgrade_date:'2026-05-01',contract_status:'active',updated_at:'2026-10-20 00:00:00'},
 {id:101,client_id:3,account_id:20,msisdn_normalised:'27821000002',last_upgrade_date:'2025-05-01',eligible_upgrade_date:'2027-05-01',contract_status:'active',updated_at:'2026-10-20 00:00:00'},
 {id:102,client_id:4,account_id:20,msisdn_normalised:'27821000003',last_upgrade_date:'2023-05-01',eligible_upgrade_date:'2025-05-01',contract_status:'active',updated_at:'2026-10-20 00:00:00'}
];
function mockConn(){
 return {query:async(sql)=>{
  if(sql.includes('FROM clients c LEFT JOIN'))return [four.slice()];
  if(sql.includes('FROM mobile_base_current WHERE client_id IN'))return [lines.slice()];
  throw Error('Unexpected SQL '+sql.slice(0,80));
 }};
}
const item={kind:'duplicate_phone',id:'a'.repeat(64),fingerprint:'f'.repeat(64),
 members:[four[0],four[1],four[2]],details:{phone:'27821000000'}};
async function run(){
 const manager={id:9,role:'manager'};
 const data=await svc.candidatesForCase(item,manager,mockConn());
 assert.equal(data.candidates.length,4);
 assert.equal(data.lines.length,3);
 assert.equal(data.sourceHash.length,64);
 const wanted={selected:['1','3'],primary:'1',donor:{}};
 for(const f of data.fields)wanted.donor[f.key]=String(f.key==='birthday'||f.key==='email'?'3':'1');
 const plan=svc.makePlan(data,wanted);
 assert.deepEqual(plan.selectedIds,[1,3]);
 assert.deepEqual(plan.excludedIds,[2,4]);
 assert.equal(plan.primaryId,1);
 assert.equal(plan.fields.find(f=>f.key==='birthday').value,'1980-02-19');
 assert.equal(plan.fields.find(f=>f.key==='birthday').fromId,3);
 assert.equal(plan.fields.find(f=>f.key==='email').value,'latest@example.com');
 assert.deepEqual(plan.linkedLines.map(x=>x.id),[100,101]);
 assert.equal(plan.actualMergeExecuted,false);
 assert.equal(plan.reviewOnly,true);
 assert.ok(plan.preservedLineFields.includes('eligible_upgrade_date'));
 const seal=svc.previewSeal(plan,'csrf-test-key');
 assert.ok(svc.compareSeal(seal,seal));
 assert.ok(!svc.compareSeal(seal,'e'.repeat(64)));
 const changed=JSON.parse(JSON.stringify(four));
 changed[2].birthday='1980-02-20';
 assert.notEqual(svc.signature(changed,lines,item.fingerprint),data.sourceHash,
  'Record changes after preview must invalidate approval');
 assert.throws(()=>svc.makePlan(data,{...wanted,selected:['1']}),/at least two/);
 assert.throws(()=>svc.makePlan(data,{...wanted,selected:['1','3'],primary:'2'}),/primary/);
 assert.throws(()=>svc.makePlan(data,{...wanted,selected:['1','2','3','9']}),/not available/);
 assert.throws(()=>svc.makePlan(data,{...wanted,donor:{...wanted.donor,birthday:'4'}}),/selected/);
 assert.throws(()=>svc.makePlan(data,{...wanted,donor:{...wanted.donor,birthday:'1'}}),/blank/);
 const staff={id:5,role:'staff'};
 const staffCase=await svc.candidatesForCase(item,staff,mockConn());
 assert.equal(staffCase.candidates.length,3);
 assert.ok(!staffCase.candidates.some(x=>x.id===4));
 const memberMix={...item,members:[four[0],four[3]]};
 assert.equal(await svc.candidatesForCase(memberMix,staff,mockConn()),null,
  'Cross-assigned cases should never be exposed to one staff member');
 const view=load('views/tk2m-merge-planner.ejs');
 const ctx={
  title:'Selective Merge Plan',basePath:'',assetVersion:'qa',currentUser:manager,
  item,data,caseId:item.id,isManager:true,csrf:'d'.repeat(64),
  proposals:[],selectedProposal:null,preview:{plan,seal},
  posted:{selected:wanted.selected,primary:'1',donor:wanted.donor,note:'Verified birthday and email against paperwork.'},
  error:'',notice:'',formatted:svc.formatted
 };
 const html=ejs.render(view,ctx);
 for(const txt of ['Select only','merge-builder-form','data-merge-selected','data-merge-primary',
  'donor[birthday]','Merge proposal','#2, #4','1980-02-19',
  'latest@example.com','Save merge proposal for approval','No records are merged']){
  assert.ok(html.toLowerCase().includes(txt.toLowerCase()),'Missing UI text: '+txt);
 }
 const script=load('public/js/tk2m-merge-planner.js');
 assert.ok(script.includes('data-merge-selected'));
 assert.ok(script.includes('validSelection()'));
 assert.ok(script.includes('radio.disabled=!selected.has(radio.value)'));
 assert.ok(html.includes('type="radio" name="donor[birthday]"'));
 assert.ok(html.includes('data-merge-donor'));
 assert.ok(html.includes('Tick the correct value'));
 assert.ok(!html.includes('data-merge-donor data-field='));
 assert.ok(load('public/css/tk2m-review.css').includes('.merge-field-tick.is-chosen'));
 const routes=load('src/routes/tk2m-merge-plans.js');
 assert.ok(routes.includes('crypto.timingSafeEqual'));
 assert.ok(routes.includes('tk2m_merge_case_locks'));
 assert.ok(routes.includes('submitted'));
 assert.ok(routes.includes('A different manager or owner must approve'));
 assert.ok(routes.includes('changeStatus'));
 assert.ok(!/UPDATE clients SET|DELETE FROM clients|UPDATE mobile_base_current|UPDATE monthly_import/.test(routes));
 const server=load('server.js');
 assert.ok(server.includes("const mergePlans = require('./src/routes/tk2m-merge-plans')"));
 assert.ok(server.includes('if (CRM_STAGE_MODE)'));
 const schema=load('scripts/install-tk2m-merge-proposal-schema.js');
 for(const table of ['tk2m_merge_case_locks','tk2m_merge_proposals','tk2m_merge_proposal_history'])
  assert.ok(schema.includes(table));
 assert.ok(schema.includes("process.env.DB_NAME!=='talk_crm_stage'"));
 console.log('TK2M_SELECTIVE_MERGE_PROPOSAL_VALIDATION=PASS records',data.candidates.length,
  'subset',plan.selectedIds,'unselected',plan.excludedIds,'birthday',plan.fields.find(x=>x.key==='birthday').fromId);
}
run().catch(error=>{console.error(error);process.exitCode=1;});
