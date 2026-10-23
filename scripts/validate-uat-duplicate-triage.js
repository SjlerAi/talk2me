'use strict';
const assert=require('assert').strict;
const fs=require('fs');
const path=require('path');
const ejs=require('ejs');
const lib=require('../src/services/temporary-duplicate-triage');
const line=(id,fields={})=>({
  id,account_id:42,account_number:'A100',client_name:'JOHN SMITH',
  cell_number:'0821234567',cell_number_normalised:'27821234567',
  email:'john@fixture.co.za',id_number:'',is_active:1,
  package_name:'Old Package',next_upgrade_date:'2026-10-01',
  previous_upgrade_date:'2024-01-01',upgrade_date:'',updated_at:'2026-10-01',
  account_staff_id:2,_allocations:[],...fields
});
const original=[line(1),line(2,{package_name:'New Package',next_upgrade_date:'2027-11-20'})];
assert.equal(lib.groupingEvidence(original).safe,true,
  'different package/upgrade history must be retained, not treated as customer conflict');
assert.equal(lib.groupingEvidence([line(1),line(2,{client_name:'DIFFERENT PERSON'})]).safe,false);
assert.equal(lib.groupingEvidence([line(1),line(2,{account_id:99})]).safe,false);
assert.equal(lib.groupingEvidence([line(1),line(2,{cell_number_normalised:'27821111111'})]).safe,false);
assert.equal(lib.groupingEvidence([line(1),line(2,{email:'other@fixture.co.za'})]).safe,false);
assert.equal(lib.groupingEvidence([line(1),line(2,{account_staff_id:3})]).safe,false);
assert.equal(lib.groupingEvidence([line(1),line(2,{is_active:0})]).safe,false);
assert.equal(lib.groupingEvidence([line(1),line(2,{_allocations:[{id:90,assigned_staff_id:3,is_active:1}]})]).safe,false);
assert.equal(lib.normalisePhone('082 123 4567'),'27821234567');
assert.equal(lib.normalisePhone('27821234567'),'27821234567');
assert.equal(lib.normaliseEmail('UNKnown@example.com'),'');
assert.equal(lib.decodeIds('[1,2,2]').length,0);
assert.deepEqual(lib.decodeIds('[1,2]'),[1,2]);
assert.equal(lib.rowFingerprint(original),lib.rowFingerprint(original.slice().reverse()));
assert.notEqual(lib.rowFingerprint(original),lib.rowFingerprint([line(1),line(2)]));
assert.equal(lib.reviewRevision({id:1,status:'pending',source_hash:'test'}),
             lib.reviewRevision({id:1,status:'pending',source_hash:'test'}));
const template=fs.readFileSync(path.join(__dirname,'../views/temporary-duplicate-triage.ejs'),'utf8');
const local={
  basePath:'/talk2me',currentUser:{role:'owner'},summary:{grouped:131,manual:57,pending:57,followup:0,completed:0},
  type:'manual_identity',status:'pending',q:'',page:1,pageCount:1,total:0,cases:[],item:null,
  csrf:'a'.repeat(64),saved:false,prettyReason:lib.prettyReason
};
const empty=ejs.render(template,local);
assert(empty.includes('Manual identity review (57)'), 'list render must show manual group count');
assert(empty.includes('No cases match this filter.'), 'empty state should render');
const review=ejs.render(template,{...local,item:{
  id:1,case_type:'manual_identity',status:'pending',clientIds:[1,2],
  reasons:['conflicting_customer_names'],rows:original,reviewer_name:'',review_notes:'',
  snapshot:'a'.repeat(64),revision:'b'.repeat(64)
}});
assert(review.includes('Original record #1'), 'detail must show original source');
assert(review.includes('Needs correction'), 'manual review choices visible');
const safe=ejs.render(template,{...local,type:'safe_line_group',item:{
  id:1,case_type:'safe_line_group',status:'auto_grouped',clientIds:[1,2],
  reasons:[],rows:original,state:{safe:true,reasons:[]}
}});
assert(safe.includes('every original client record'), 'safe grouping preserves source history');
assert(!safe.includes('name="status"'), 'safe groups must have no manual status mutation form');
console.log('PASS safe duplicate triage: evidence guards, no data-loss selection, manual decision UI and EJS rendering');
