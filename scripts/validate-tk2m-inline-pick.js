'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ejs=require('ejs');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const merge=require('../src/services/tk2m-merge-planner');
const pageTemplate=read('views/tk2m-review-portal.ejs');
const route=read('src/routes/tk2m-data-review.js');
const css=read('public/css/tk2m-review.css');
const script=read('public/js/tk2m-review-quickpick.js');
const rows=[
  {id:702,client_name:'Customer A',first_name:'A',surname:'Person',
   account_id:10,account_number:'B10',cell_number:'0821234567',cell_number_normalised:'27821234567',
   email:'',id_number:'',birthday:null,alt_number:null,city_town:'Saldanha',
   main_contact_name:null,main_contact_number:null,company_name:null,notes:null,
   is_active:1,next_upgrade_date:'2025-07-30',previous_upgrade_date:'2023-07-30',
   package_name:'Business VIP 50GB',line_status:'active',updated_at:'2026-07-14 11:09:00',assigned_staff_name:'QA Manager'},
  {id:765,client_name:'Customer B',first_name:'B',surname:'Person',
   account_id:10,account_number:'B10',cell_number:'0821234567',cell_number_normalised:'27821234567',
   email:'latest@example.test',id_number:'',birthday:'1984-05-09',alt_number:null,city_town:'Saldanha',
   main_contact_name:null,main_contact_number:null,company_name:null,notes:null,
   is_active:1,next_upgrade_date:'2027-07-30',previous_upgrade_date:'2025-07-30',
   package_name:'18GB Unlimited',line_status:'active',updated_at:'2026-10-27 11:08:00',assigned_staff_name:'QA Manager'},
  {id:800,client_name:'Another contract',first_name:'Other',surname:'Customer',
   account_id:11,account_number:'B11',cell_number:'0821234567',cell_number_normalised:'27821234567',
   email:'other@example.test',id_number:'',birthday:null,alt_number:null,city_town:'Vredenburg',
   main_contact_name:null,main_contact_number:null,company_name:null,notes:null,
   is_active:1,next_upgrade_date:'2027-12-20',previous_upgrade_date:'2025-12-20',
   package_name:'Other tariff',line_status:'active',updated_at:'2026-10-27 11:09:00',assigned_staff_name:'QA Manager'},
  {id:801,client_name:'Another possible customer',first_name:'Fourth',surname:'Customer',
   account_id:12,account_number:'B12',cell_number:'0821234567',cell_number_normalised:'27821234567',
   email:'fourth@example.test',id_number:'',birthday:null,alt_number:null,city_town:'Vredenburg',
   main_contact_name:null,main_contact_number:null,company_name:null,notes:null,
   is_active:1,next_upgrade_date:'2028-01-01',previous_upgrade_date:'2026-01-01',
   package_name:'Fourth tariff',line_status:'active',updated_at:'2026-10-27 11:10:00',assigned_staff_name:'QA Manager'}
];
function ctx(candidates,members){
 const fields=merge.FIELDS.filter(f=>candidates.some(r=>merge.formatted(r[f.key]).trim()));
 return {
   title:'Review Case',basePath:'',assetVersion:'test',
   listing:[],kinds:{identity:'Identity to verify'},kind:'identity',view:'open',
   q:'',page:1,pages:1,listTotal:1,currentUser:{id:3,role:'manager',full_name:'Reviewer'},
   canManage:true,csrf:'a'.repeat(64),notice:'',
   totals:{total:1,pending:1,stale:0,done:0,kinds:{}},
   history:[],selected:{
     id:'b'.repeat(64),kind:'identity',kindLabel:'Identity to verify',label:'Review sample',
     description:'Case with several customer records',details:{caseId:14,reason:'different names',priorNotes:''},
     state:'pending',review:null,members,lines:[]
   },
   quickMerge:{candidates,fields,sourceHash:'c'.repeat(64)},
   quickMergeWarning:'',formatMergeValue:merge.formatted
 };
}
const page2=ejs.render(pageTemplate,ctx(rows.slice(0,2),rows.slice(0,2)));
assert.match(page2,/Tick the correct information to keep/);
assert.match(page2,/Customer A/);
assert.match(page2,/Customer B/);
assert.match(page2,/data-review\/case\/[a-f0-9]{64}\/merge\/preview/);
assert.match(page2,/name="donor\[birthday\]"/);
assert.match(page2,/name="donor\[client_name\]"/);
assert.match(page2,/name="donor\[email\]"/);
assert.match(page2,/name="primary"/);
assert.match(page2,/data-pick-primary required/);
assert.match(page2,/review-pick-selected-count/);
assert.match(page2,/tk2m-review-quickpick\.js/);
assert.match(page2,/value="702"[\s\S]{0,110}data-pick-selected checked/);
assert.match(page2,/value="765"[\s\S]{0,110}data-pick-selected checked/);
assert.match(page2,/Last updated: 2026-10-27 11:08/);
assert.match(page2,/Next upgrade date/);
assert.match(page2,/Preserved for this contract/);
assert.doesNotMatch(page2,/name="donor\[next_upgrade_date\]"/);
assert.doesNotMatch(page2,/name="donor\[previous_upgrade_date\]"/);
assert.doesNotMatch(page2,/name="donor\[account_id\]"/);
assert.doesNotMatch(page2,/name="donor\[updated_at\]"/);
const fieldDonors=Object.fromEntries(merge.FIELDS
 .filter(f=>rows.slice(0,2).some(r=>merge.formatted(r[f.key]).trim()))
 .map(f=>[f.key,['birthday','email'].includes(f.key)?'765':'702']));
const proposal=merge.makePlan({
  candidates:rows,lines:[],fields:merge.FIELDS.filter(f=>rows.some(r=>merge.formatted(r[f.key]).trim())),
  linkedCaseId:'b'.repeat(64),caseKind:'identity',sourceHash:'c'.repeat(64)
 },{selected:['702','765'],primary:'702',donor:Object.fromEntries(
   merge.FIELDS.filter(f=>rows.some(r=>merge.formatted(r[f.key]).trim()))
   .map(f=>[f.key,['birthday','email'].includes(f.key)?'765':'702']))});
assert.deepEqual(proposal.selectedIds,[702,765]);
assert.deepEqual(proposal.excludedIds,[800,801]);
assert.equal(proposal.fields.find(f=>f.key==='birthday').value,'1984-05-09');
assert.equal(proposal.fields.find(f=>f.key==='email').value,'latest@example.test');
assert.equal(proposal.fields.find(f=>f.key==='client_name').value,'Customer A');
assert.equal(proposal.actualMergeExecuted,false);

const page4=ejs.render(pageTemplate,ctx(rows,rows));
assert.equal((page4.match(/data-pick-selected/g)||[]).length,4);
assert.equal((page4.match(/data-pick-primary required/g)||[]).length,4);
assert.match(page4,/Customer A/);assert.match(page4,/Another possible customer/);
const single=ejs.render(pageTemplate,{...ctx(rows.slice(0,2),[rows[0]]),quickMerge:null});
assert.doesNotMatch(single,/id="review-quick-merge-form"/);
assert.match(single,/This case does not currently have at least two eligible related records/);
assert.match(route,/candidatesForCase\(selected,req\.session\.user\)/);
assert.match(route,/quickMerge,quickMergeWarning,formatMergeValue/);
assert.match(script,/distinct|values\.size===1/);
assert.match(script,/selected\.size>=2&&primary&&undecided===0/);
assert.match(script,/preview\.disabled=!ready/);
assert.match(css,/review-pick-choice\.is-picked/);
assert.match(css,/review-pick-contract-row/);
console.log('TK2M_INLINE_TICK_CHOICES=PASS two and four records, birthday/email, contract dates protected, preview-only');
