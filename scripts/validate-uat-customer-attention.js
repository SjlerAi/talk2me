'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ejs=require('ejs');
const {parseAttention,birthdayPeriod,buildAttentionConditions,reasonLabels}=require('../src/services/uat-customer-attention');
const time=new Date('2026-10-17T06:00:00Z');
const unallocated=()=>"(NOT EXISTS(SELECT 1 FROM client_assignments a WHERE a.client_id=c.id AND a.is_active=1))";
const ctx={management:true,scope:'staff',staffId:4,unassignedClause:unallocated};
const conditions=(query,override={})=>buildAttentionConditions(parseAttention(query,time),{...ctx,...override});

assert.deepEqual(birthdayPeriod('today','2026-10-17'),{start:'2026-10-17',end:'2026-10-17'});
assert.deepEqual(birthdayPeriod('tomorrow','2026-10-17'),{start:'2026-10-18',end:'2026-10-18'});
assert.deepEqual(birthdayPeriod('this_week','2026-10-17'),{start:'2026-10-12',end:'2026-10-18'});
assert.deepEqual(birthdayPeriod('this_month','2026-10-17'),{start:'2026-10-01',end:'2026-10-31'});
assert.deepEqual(birthdayPeriod('missed','2026-10-17'),{start:'2026-10-10',end:'2026-10-16'});
assert.deepEqual(birthdayPeriod('missed','2027-01-03'),{start:'2026-12-27',end:'2027-01-02'});
assert.deepEqual(birthdayPeriod('this_week','2027-01-01'),{start:'2026-12-28',end:'2027-01-03'});
assert.deepEqual(birthdayPeriod('this_month','2028-02-14'),{start:'2028-02-01',end:'2028-02-29'});
assert.equal(parseAttention({focus:"'); DROP TABLE clients;"},time).focus,'all');

const birthdays=conditions({focus:'birthdays',birthday:'missed'});
assert.match(birthdays.clauses[0],/DATE_FORMAT\(c\.birthday,'%m-%d'\)/);
assert.match(birthdays.clauses[0],/agent_responsibility_checks/);
assert.match(birthdays.clauses[0],/status='completed'/);
assert.match(birthdays.clauses[0],/source_key=CONCAT\('client:',c\.id\)/);
assert.equal(birthdays.params.attSelectedBd0,'10-10');
assert.equal(birthdays.params.attSelectedBd6,'10-16');
assert.doesNotMatch(birthdays.clauses[0],/previous_upgrade_date/);
const tomorrow=conditions({focus:'birthdays',birthday:'tomorrow'});
assert.equal(tomorrow.params.attSelectedBd0,'10-18');

const contactNever=conditions({focus:'contact',contact:'no_record'});
assert.match(contactNever.clauses[0],/NOT \(EXISTS/);
assert.match(contactNever.clauses[0],/NULLIF\(TRIM\(i\.action_taken\)/);
assert.doesNotMatch(contactNever.clauses[0],/i\.created_at IS NOT NULL/);
const recent=conditions({focus:'contact',contact:'no_recent'});
assert.equal(recent.params.attRecentFrom,'2026-09-18');
assert.match(recent.clauses[0],/>=:attRecentFrom/);
const contactOverdue=conditions({focus:'contact',contact:'overdue'});
assert.match(contactOverdue.clauses[0],/customer_callbacks/);
assert.match(contactOverdue.clauses[0],/customer_followups/);
assert.match(contactOverdue.clauses[0],/i\.follow_up_at<NOW\(\)/);
assert.match(contactOverdue.clauses[0],/f\.assigned_to=:attStaffId/);
assert.match(contactOverdue.clauses[0],/cb\.assigned_to=:attStaffId/);
assert.equal(contactOverdue.params.attStaffId,4);
const otherStaff=conditions({focus:'needs_attention'},{management:false,scope:'all',staffId:8});
assert.equal(otherStaff.params.attStaffId,8);
assert.match(otherStaff.clauses[0],/t\.assigned_to=:attStaffId/);
const ownerAll=conditions({focus:'needs_attention'},{management:true,scope:'all',staffId:8});
assert.doesNotMatch(ownerAll.clauses[0],/:attStaffId/);
const attention=conditions({focus:'needs_attention'});
assert.match(attention.clauses[0],/c\.next_upgrade_date<:attToday/);
assert.match(attention.clauses[0],/agent_responsibility_checks/);
assert.match(attention.projection,/att_birthday/);
assert.match(attention.projection,/att_unassigned/);
assert.match(attention.sort,/att_followup DESC/);
assert.deepEqual(reasonLabels({att_task:1,att_upgrade:1,att_birthday:1},parseAttention({focus:'needs_attention'},time)),
  ['Overdue task','Upgrade overdue','Birthday contact not recorded']);
const noOwnerWork=conditions({focus:'unallocated',unallocated:'customer_work'});
assert.match(noOwnerWork.clauses[0],/NOT EXISTS\(SELECT 1 FROM client_assignments/);
assert.match(noOwnerWork.clauses[0],/staff_tasks/);
assert.match(noOwnerWork.clauses[0],/customer_followups/);
assert.match(noOwnerWork.clauses[0],/t\.assigned_to=:attStaffId/);
assert.equal(noOwnerWork.params.attStaffId,4);
assert.deepEqual(reasonLabels({},parseAttention({focus:'unallocated',unallocated:'customer_work'},time)),
  ['Customer has no owner','Open work linked to customer']);

const calls=[];
const database={
  async query(sql) {
    assert.match(sql,/FROM staff_users/);
    return [[{id:4,full_name:'Jonathan Olivier',role:'staff'}]];
  },
  async execute(sql,params){
    calls.push({sql,params:{...params}});
    if(sql.startsWith('SELECT COUNT(*) total FROM clients c'))return [[{total:4}]];
    if(sql.includes('SUM(c.is_active=1)'))return [[{active_count:2134,prospect_count:0,archived_count:0,incomplete_count:0}]];
    if(sql.includes('COUNT(*) total FROM clients c'))return [[{total:0}]];
    if(sql.includes('FROM clients c')&&sql.includes('ORDER BY'))return [[{
      id:77,client_name:'Example Only',account_number:'ACC0077',cell_number:'0820000000',
      email:'example@example.invalid',lifecycle_status:'client',
      next_upgrade_date:'2026-10-15',birthday:'1984-10-17',assigned_staff_id:4,
      assigned_staff_name:'Jonathan Olivier',att_upgrade:1,att_birthday:1,att_task:1,att_unassigned:0
    }]];
    throw Error('Unexpected SELECT query '+sql.slice(0,120));
  }
};
const handlers={};const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(parent?.filename?.endsWith('/src/routes/uat-client-visibility.js')){
    if(request==='express')return {Router:()=>({get:(p,...rest)=>handlers[p]=rest.at(-1)})};
    if(request==='../config/db')return database;
    if(request==='../middleware/auth')return {requireAuth:()=>{}};
  }
  return originalLoad.apply(this,arguments);
};
process.env.UAT_MODE='true';
try{require('../src/routes/uat-client-visibility');}finally{Module._load=originalLoad;}
async function runRoute(user,query){
  calls.length=0;let locals;
  await handlers['/backoffice/clients']({session:{user},query},{render:(template,value)=>{assert.equal(template,'clients-admin');locals=value;}},err=>{throw err;});
  assert.ok(locals);
  return {locals,calls:[...calls]};
}
(async()=>{
  const boss={id:100,role:'owner'};
  let r=await runRoute(boss,{scope:'staff',staff_id:'4',focus:'needs_attention'});
  assert.equal(r.locals.attention.focus,'needs_attention');
  assert.equal(r.calls[0].params.visibilityStaffId,4);
  assert.equal(r.calls[0].params.attStaffId,4);
  assert.match(r.calls[0].sql,/client_assignments/);
  assert.match(r.calls[0].sql,/next_upgrade_date/);
  assert.match(r.calls[1].sql,/att_followup DESC/);
  assert.deepEqual(r.locals.clients[0].attentionReasons,['Overdue task','Upgrade overdue','Birthday contact not recorded']);
  assert.match(r.locals.queryStringFor({page:3}),/focus=needs_attention/);
  r=await runRoute({id:10,role:'staff'},{scope:'staff',staff_id:'4',focus:'unallocated',unallocated:'customer_work'});
  assert.equal(r.locals.staffVisibilityScope,'all');
  assert.equal(r.calls[0].params.visibilityStaffId,10);
  assert.equal(r.calls[0].params.attStaffId,10);
  assert.deepEqual(r.locals.staff,[]);
  assert.match(r.calls[0].sql,/vis\.assigned_staff_id=:visibilityStaffId/);
  assert.match(r.calls[0].sql,/t\.assigned_to=:attStaffId/);
  r=await runRoute(boss,{focus:'birthdays',birthday:'missed',scope:'all'});
  assert.equal(r.calls[0].params.attSelectedBd0,'10-10');
  assert.equal(r.locals.clients[0].attentionReasons[0],'Birthday follow-up not recorded');
  assert.ok(r.locals.queryStringFor({page:2}).includes('birthday=missed'));

  const tpl=fs.readFileSync('views/clients-admin.ejs','utf8');
  ejs.compile(tpl,{filename:'views/clients-admin.ejs'});
  const html=ejs.render(tpl,{
    ...r.locals,
    basePath:'/talk2me',currentUser:boss
  },{filename:'views/clients-admin.ejs'});
  for(const marker of ['My Customers Needing Attention','Birthdays','Follow-up Attention','Unallocated','Past 7 Days','customer-attention-badge','customer-attention-field','Birthday follow-up not recorded'])assert.ok(html.includes(marker),'Missing HTML marker '+marker);
  assert.match(html,/scope=mine[^"]*focus=needs_attention/);
  assert.match(html,/scope=all[^"]*focus=unallocated/);
  const css=fs.readFileSync('public/css/uat-customer-filters.css','utf8');
  assert.match(css,/\.customer-attention-action/);
  assert.match(css,/@media\(max-width:740px\)/);
  assert.match(fs.readFileSync('src/routes/index.js','utf8'),/'focus','birthday','contact','unallocated'/);
  console.log('UAT customer daily attention: birthdays, missed evidence, contact history, work-owner boundaries, staff permissions, reasons, UI and responsive tests passed.');
})().catch(err=>{console.error(err);process.exitCode=1;});
