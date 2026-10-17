'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {parseAttention}=require('../src/services/uat-customer-attention');
const {
  normaliseFilters,buildWorkConditions,monthBounds,todayInSouthAfrica,plusDays
}=require('../src/services/uat-customer-filters');

const ANCHOR=new Date('2026-10-17T06:00:00Z'); // Saturday, Johannesburg
const normal=q=>normaliseFilters(q,ANCHOR);
function makeWork(query,access={management:true,scope:'staff',staffId:7}) {
  return buildWorkConditions(normal(query),access);
}
const oct=normal({upgrade_month:'2026-10',work:'upgrades'});
const octQuery=makeWork({upgrade_month:'2026-10',work:'upgrades'});
assert.deepEqual(monthBounds('2026-12'),{start:'2026-12-01',end:'2027-01-01'});
assert.equal(octQuery.params.monthFrom,'2026-10-01');
assert.equal(octQuery.params.monthTo,'2026-11-01');
assert.match(octQuery.clauses.join(' '),/c\.next_upgrade_date >= :monthFrom/);
assert.doesNotMatch(octQuery.clauses.join(' '),/previous_upgrade_date|upgrade_date=|COALESCE\(c\.next_upgrade_date/);
assert.equal(octQuery.params.workStaffId,7);
assert.equal(oct.error,null);

assert.equal(todayInSouthAfrica(new Date('2026-10-16T22:15:00Z')),'2026-10-17');
assert.equal(plusDays('2026-10-31',1),'2026-11-01');
assert.deepEqual(normal({date:'this_week'}).dateWindow,{from:'2026-10-12',to:'2026-10-18'});
assert.deepEqual(normal({date:'next_week'}).dateWindow,{from:'2026-10-19',to:'2026-10-25'});
assert.deepEqual(normal({date:'next_7'}).dateWindow,{from:'2026-10-17',to:'2026-10-23'});
assert.deepEqual(normal({date:'next_14'}).dateWindow,{from:'2026-10-17',to:'2026-10-30'});
assert.deepEqual(normal({date:'next_30'}).dateWindow,{from:'2026-10-17',to:'2026-11-15'});
assert.deepEqual(normal({date:'custom',from:'2026-10-08',to:'2026-10-31'}).dateWindow,{from:'2026-10-08',to:'2026-10-31'});
assert.ok(normal({date:'custom',from:'2026-11-02',to:'2026-10-01'}).error);
assert.ok(normal({date:'custom',from:'2026-02-30',to:'2026-03-02'}).error);
assert.ok(normal({upgrade_month:'not-a-month'}).error);
assert.equal(normal({work:'upgrades',status:'overdue'}).status,'all');

const overdue=makeWork({work:'tasks',status:'overdue',date:'this_week'});
assert.match(overdue.clauses.join(' '),/t\.due_at<NOW\(\)/);
assert.match(overdue.clauses.join(' '),/t\.status IN \('unread','seen','in_progress'\)/);
assert.match(overdue.clauses.join(' '),/t\.assigned_to=:workStaffId/);
assert.equal(overdue.params.workFrom,'2026-10-12');
const completed=makeWork({work:'followups',status:'completed',date:'next_7'});
assert.match(completed.clauses.join(' '),/customer_followups f/);
assert.match(completed.clauses.join(' '),/customer_callbacks cb/);
assert.match(completed.clauses.join(' '),/f\.status='completed'/);
assert.match(completed.clauses.join(' '),/f\.completed_at/);
const staffAll=makeWork({work:'all',date:'this_week'},{management:false,scope:'all',staffId:99});
assert.match(staffAll.clauses.join(' '),/t\.assigned_to=:workStaffId/);
assert.equal(staffAll.params.workStaffId,99);
const managerAll=makeWork({work:'all',date:'this_week'},{management:true,scope:'all',staffId:99});
assert.doesNotMatch(managerAll.clauses.join(' '),/workStaffId/);
for(const sort of ['name_asc','name_desc','recent','new_work','upgrade_soon']) {
  const work=makeWork({sort});
  assert.ok(work.sort.includes('c.' )||sort==='new_work');
  if(sort==='new_work')assert.match(work.join,/latest_work\.client_id=c\.id/);
}
assert.equal(normal({sort:'DROP TABLE clients;'}).sort,'recent');

// Test the actual UAT route without a database connection or any write action.
const sqlCalls=[];
const db={
  async query(sql) {
    if(!sql.includes('FROM staff_users'))throw Error('Unexpected query: '+sql);
    return [[{id:7,full_name:'Jonathan Olivier',email:'jonathan@talk-online.co.za',role:'staff'},
      {id:99,full_name:'Test Staff',email:'staff@example.org',role:'staff'}]];
  },
  async execute(sql,params) {
    sqlCalls.push({sql,params:{...params}});
    if(sql.startsWith('SELECT COUNT(*) total FROM clients'))return [[{total:123}]];
    if(sql.includes('SUM(c.is_active=1)'))return [[{active_count:2134,prospect_count:0,incomplete_count:0,archived_count:0}]];
    if(sql.includes('COUNT(*) total FROM clients c')&&sql.includes('unassignedClause'))throw Error('Unexpected clause');
    if(sql.startsWith('SELECT COUNT(*) total FROM clients c'))return [[{total:0}]];
    if(sql.includes('FROM clients c')&&sql.includes('ORDER BY'))return [[]];
    return [[{total:0}]];
  }
};
const handlers={};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(parent?.filename?.endsWith('/src/routes/uat-client-visibility.js')){
    if(request==='express')return {Router:()=>({get:(route,...functions)=>{handlers[route]=functions.at(-1);}})};
    if(request==='../config/db')return db;
    if(request==='../middleware/auth')return {requireAuth:()=>{}};
  }
  return originalLoad.apply(this,arguments);
};
process.env.UAT_MODE='true';
try {require('../src/routes/uat-client-visibility');}
finally {Module._load=originalLoad;}
assert.equal(typeof handlers['/backoffice/clients'],'function');
async function routeCase(user,query) {
  sqlCalls.length=0;
  let rendered;
  const req={session:{user},query};
  const res={render:(template,locals)=>{rendered={template,locals};return rendered;}};
  await handlers['/backoffice/clients'](req,res,error=>{throw error;});
  assert.ok(rendered,'Route must render');
  return {sqlCalls,rendered};
}
(async()=>{
  const owner={id:100,role:'owner'};
  let result=await routeCase(owner,{scope:'staff',staff_id:'7',work:'upgrades',upgrade_month:'2026-10',sort:'upgrade_soon',page:'2'});
  assert.equal(result.rendered.locals.staffVisibilitySelectedId,7);
  assert.equal(result.rendered.locals.staffVisibilityScope,'staff');
  assert.equal(result.rendered.locals.total,123);
  assert.equal(result.rendered.locals.page,2);
  assert.equal(result.rendered.locals.firstRecord,51);
  assert.ok(result.sqlCalls[0].sql.includes('vis.assigned_staff_id=:visibilityStaffId'));
  assert.equal(result.sqlCalls[0].params.visibilityStaffId,7);
  assert.equal(result.sqlCalls[0].params.monthFrom,'2026-10-01');
  assert.equal(result.sqlCalls[1].params.offset,50);
  assert.match(result.sqlCalls[1].sql,/ORDER BY \(c\.next_upgrade_date IS NULL\)/);
  assert.match(result.rendered.locals.queryStringFor({page:3}),/upgrade_month=2026-10/);
  assert.match(result.rendered.locals.queryStringFor({page:3}),/staff_id=7/);

  result=await routeCase({id:99,role:'staff'},{scope:'staff',staff_id:'7',work:'tasks',status:'overdue',date:'this_week'});
  assert.equal(result.rendered.locals.staffVisibilityScope,'all');
  assert.deepEqual(result.rendered.locals.staff,[]);
  assert.equal(result.sqlCalls[0].params.visibilityStaffId,99);
  assert.equal(result.sqlCalls[0].params.workStaffId,99);
  assert.match(result.sqlCalls[0].sql,/OR \(NOT EXISTS/);
  assert.match(result.sqlCalls[0].sql,/t\.due_at<NOW\(\)/);

  result=await routeCase(owner,{scope:'mine',q:'Bobo',sort:'name_desc'});
  assert.equal(result.rendered.locals.staffVisibilitySelectedId,100);
  assert.equal(result.sqlCalls[0].params.like,'%Bobo%');
  assert.match(result.sqlCalls[1].sql,/ORDER BY c\.client_name DESC/);
  assert.match(result.rendered.locals.queryStringFor({view:'archived'}),/scope=mine/);
  result=await routeCase(owner,{date:'custom',from:'2026-02-30',to:'2026-03-01'});
  assert.ok(result.rendered.locals.filters.error);
  assert.match(result.sqlCalls[0].sql,/1=0/);

  const ejs=require('ejs');
  const template=fs.readFileSync(path.join(__dirname,'../views/clients-admin.ejs'),'utf8');
  ejs.compile(template,{filename:path.join(__dirname,'../views/clients-admin.ejs')});
  const html=ejs.render(template,{
    basePath:'/talk2me',currentUser:{id:100,role:'owner'},
    q:'',view:'all',saved:false,
    clients:[{id:7,client_name:'Example Customer',account_number:'AC1',cell_number:'0801234567',
      email:'example@example.invalid',lifecycle_status:'client',city_town:'Cape Town',
      next_upgrade_date:'2026-10-17',previous_upgrade_date:'2024-10-17',
      assigned_staff_id:7,assigned_staff_name:'Jonathan Olivier'}],
    staff:[{id:7,full_name:'Jonathan Olivier'}],
    counts:{active_count:1,prospect_count:0,incomplete_count:0,unassigned_count:0,archived_count:0},
    staffVisibilityScope:'staff',staffVisibilitySelectedId:7,staffVisibilityManagement:true,
    filters:normal({upgrade_month:'2026-10',work:'upgrades'}),attention:parseAttention({},ANCHOR),total:1,
    page:1,pageCount:1,pageSize:50,firstRecord:1,lastRecord:1,
    queryStringFor:extra=>new URLSearchParams({view:'all',scope:'staff',staff_id:'7',upgrade_month:'2026-10',...extra}).toString()
  });
  assert.match(html,/Example Customer/);
  assert.match(html,/Account: AC1/);
  assert.match(html,/name="return_filters"/);
  assert.match(html,/type="month"/);
  assert.match(html,/1234567/);
  const css=fs.readFileSync(path.join(__dirname,'../public/css/uat-customer-filters.css'),'utf8');
  assert.match(css,/@media\(max-width:740px\)/);
  assert.match(template,/return_filters/);
  assert.match(template,/customer-list-filter-input/);
  assert.match(template,/Show Results/);
  assert.match(template,/Clear Filters/);
  assert.match(template,/c\.next_upgrade_date\?/);
  assert.doesNotMatch(template,/c\.next_upgrade_date\s*\|\|\s*c\.upgrade_date/);
  const assignment=fs.readFileSync(path.join(__dirname,'../src/routes/index.js'),'utf8');
  assert.match(assignment,/preserved\.get\(key\)/);
  console.log('UAT customer advanced filters: date windows, staff scoping, upgrade source, SQL, pagination, sorting, mobile and EJS validation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
