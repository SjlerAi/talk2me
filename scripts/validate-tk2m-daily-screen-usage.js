'use strict';
// Synthetic-only TK2M daily screen usage checks; NEVER connects to customer DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ejs=require('ejs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sample=[
 {staff_id:1,event_type:'screen_view',route_path:'/workspace',screen_key:'workspace',n:3,last_at:'2026-11-17 08:00:00'},
 {staff_id:2,event_type:'screen_view',route_path:'/customers/:id/:id',screen_key:'customer_detail',n:5,last_at:'2026-11-17 10:00:00'},
 {staff_id:1,event_type:'screen_view',route_path:'/grouped-upgrade-accounts/line/:id/review',screen_key:'grouped-upgrade-accounts_line',n:2,last_at:'2026-11-17 09:00:00'},
 {staff_id:1,event_type:'window_open',route_path:'/customers/:id/:id',screen_key:'customer',n:1,last_at:'2026-11-17 12:00:00'},
 {staff_id:2,event_type:'feature_open',route_path:'/workspace',screen_key:'messages',n:2,last_at:'2026-11-17 13:00:00'},
 {staff_id:2,event_type:'ui_action',route_path:'/workspace',screen_key:'work',n:4,last_at:'2026-11-17 14:00:00'},
 {staff_id:2,event_type:'work_chat_opened',route_path:'/api/uat/chat/messages',screen_key:'work_messages',n:25,last_at:'2026-11-17 14:20:00'},
 {staff_id:1,event_type:'http_action',route_path:'/api/os/notes',screen_key:'os_notes',n:5,last_at:'2026-11-17 11:10:00'}
];
const db={
 async query(sql) {
  if(sql.includes('FROM staff_users'))return [[
    {id:1,full_name:'Synthetic Owner',role:'owner',is_active:1},
    {id:2,full_name:'Synthetic Staff',role:'staff',is_active:1}
  ]];
  if(sql.includes('FROM crm_usage_events'))return [sample];
  if(sql.includes('FROM audit_log'))return [[{staff_id:1,n:2}]];
  if(sql.includes('FROM staff_chat_messages'))return [[{staff_id:2,n:1}]];
  if(sql.includes('FROM staff_chat_read_receipts'))return [[{staff_id:2,n:0}]];
  if(sql.includes('FROM staff_chat_reply_links'))return [[{staff_id:2,n:0}]];
  if(sql.includes('WHERE seen_at'))return [[{staff_id:2,n:1}]];
  if(sql.includes('FROM staff_tasks t LEFT JOIN staff_task_workflow'))return [[{staff_id:2,n:1}]];
  throw Error('Unexpected DB read: '+sql.slice(0,90));
 }
};
const content=read('src/services/tk2m-daily-screen-usage.js');
const ctx={module:{exports:{}},require(n){if(n==='../config/db')return db;throw Error('Unexpected import '+n)},Date,Intl,Map,Set,Number,String,RegExp};
vm.runInNewContext(content,ctx,{filename:'tk2m-daily-screen-usage.js'});
const service=ctx.module.exports;
assert.ok(service.CATALOG.length>=40);
assert.equal(new Set(service.CATALOG.map(x=>x.key)).size,service.CATALOG.length);
assert.equal(service.todaySast(new Date('2026-11-16T22:30:00Z')),'2026-11-17');
assert.equal(service.selection({day:'2026-11-17',days:'30'},new Date('2026-11-17T13:00:00Z')).first,'2026-10-19');
assert.equal(service.matchedKey('screen_view','customer_detail','/customers/:id/:id'),'customer-360');
assert.equal(service.matchedKey('feature_open','messages','/workspace'),'messages');
assert.equal(service.matchedKey('feature_open','customers','/workspace'),'customers-launcher');
assert.equal(service.matchedKey('screen_view','x','/master-register/service/mobile%3A0123456789'),'master-service');
assert.equal(service.canonicalRoute('/talk2me/customers/123/360'),'/customers/:id/:id');
for(const bad of ['2026-02-30','not-a-day','2027-01-01']){
 assert.throws(()=>service.selection({day:bad},new Date('2026-11-17T13:00:00Z')));
}
assert.throws(()=>service.selection({day:'2026-11-17',days:365},new Date('2026-11-17T13:00:00Z')));
assert.throws(()=>service.selection({day:'2026-11-17',staff:'1;DROP'},new Date('2026-11-17T13:00:00Z')));
const now=new Date('2026-11-17T13:00:00Z');
(async()=>{
 const all=await service.report({day:'2026-11-17',days:1},{now});
 assert.equal(all.visibleStaff.length,2);
 assert.equal(all.summary.chatRefreshes,25,'polling retained separately');
 assert.equal(all.summary.views,10);
 assert.equal(all.summary.launches,2);
 assert.equal(all.summary.httpRequests,5);
 const customer=all.screens.find(x=>x.key==='customer-360');
 assert.equal(customer.views,5);
 assert.equal(customer.windows,1);
 assert.equal(customer.users,2);
 const unused=all.screens.find(x=>x.key==='office-tools');
 assert.equal(unused.status,'No recorded use');
 assert.equal(all.observed+all.unobserved,all.totalScreens);
 const staff=await service.report({day:'2026-11-17',staff:'2',days:1},{now});
 assert.equal(staff.visibleStaff.length,1);
 assert.equal(staff.screens.find(x=>x.key==='customer-360').views,5);
 assert.equal(staff.screens.find(x=>x.key==='customer-360').windows,0);
 assert.equal(staff.summary.chatRefreshes,25);
 const template=read('views/staff-usage-daily.ejs');
 const html=ejs.render(template,{data:all,basePath:''},{filename:path.join(root,'views/staff-usage-daily.ejs')});
 assert.match(html,/Daily Screen Usage/);
 assert.match(html,/Screens with no recorded use/);
 assert.match(html,/Synthetic Staff/);
 assert.match(html,/automatic chat polling is excluded/i);
 const routes=read('src/routes/staff-usage-daily.js');
 assert.match(routes,/requireOwner/);
 assert.match(routes,/staff-usage\/daily\.csv/);
 assert.match(routes,/content-Disposition/i);
 const app=read('server.js');
 assert.match(app,/dailyScreenUsage/);
 const layout=read('views/layout.ejs'),admin=read('views/backoffice-home.ejs');
 assert.match(layout,/staff-usage\/daily/);
 assert.match(admin,/Daily Screen Usage/);
 const browser=read('public/js/os-v6-alpha21-17.js');
 assert.match(browser,/trackedWorkButtons/);
 assert.match(browser,/event_type:'ui_action'/);
 assert.doesNotMatch(browser,/body:textarea\.value/);
 const telemetry=read('src/services/usage-telemetry.js');
 assert.match(telemetry,/master-register\\\/\(service\|customer\)/);
 console.log('TK2M_DAILY_SCREEN_USAGE_SYNTHETIC_PASS catalog='+service.CATALOG.length+' observed='+all.observed+' no_use='+all.unobserved);
})().catch(e=>{console.error(e);process.exitCode=1});
