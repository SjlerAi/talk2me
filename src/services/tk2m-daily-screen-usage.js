'use strict';
// Read-only daily/7-day/30-day usage report. Production DATETIME is SAST.
// Catalog measures observed screen views/launcher selections; "no recorded use"
// is not a recommendation to delete functionality or proof that it was unused.
const db=require('../config/db');

const CATALOG=Object.freeze([
  {key:'workspace',category:'Daily workspace',label:'My Day / Workspace',path:'/workspace',match:/^\/(?:workspace|dashboard|)$/},
  {key:'queue',category:'Workspace tools',label:'Queue launcher',feature:'queue'},
  {key:'work',category:'Workspace tools',label:'Work / Tasks launcher',feature:'work'},
  {key:'messages',category:'Workspace tools',label:'Messages / chat controls',feature:'messages'},
  {key:'calendar-launcher',category:'Workspace tools',label:'Calendar launcher',feature:'calendar'},
  {key:'notes',category:'Workspace tools',label:'Notes launcher',feature:'notes'},
  {key:'calculator',category:'Workspace tools',label:'Calculator launcher',feature:'calculator'},
  {key:'customers-launcher',category:'Workspace tools',label:'Customers launcher',feature:'customers'},
  {key:'reports-launcher',category:'Workspace tools',label:'Reports launcher',feature:'reports'},
  {key:'customer-centre',category:'Customers',label:'Customer administration / lists',path:'/backoffice/clients',match:/^\/(?:backoffice\/clients|clients\/search)$/},
  {key:'customer-360',category:'Customers',label:'Customer 360 detail',path:'/customers/:id/360',match:/^\/(?:customers\/:id\/(?:360|:id)|clients\/:id\/snapshot)$/},
  {key:'customer-edit',category:'Customers',label:'Customer details / edit',path:'/customers/:id/details',match:/^\/(?:customers\/:id\/(?:details|add-mobile|add-fixed|notes\/new|propose-change|request-mobile-line)|backoffice\/clients\/:id\/edit)$/},
  {key:'customer-assignment',category:'Customers',label:'Customer assignments',path:'/clients/assignment-centre',match:/^\/clients\/assignment-centre$/},
  {key:'master-register',category:'Customer reconciliation',label:'Master customer register',path:'/master-register',match:/^\/master-register$/},
  {key:'master-service',category:'Customer reconciliation',label:'Master service / account review',path:'/master-register/service/:key',match:/^\/master-register\/(?:service|customer)\/[^/]+$/},
  {key:'mobile-base',category:'Customer reconciliation',label:'Mobile base detail',path:'/mobile-base/:id',match:/^\/mobile-base\/:id$/},
  {key:'fixed-accounts',category:'Fixed services',label:'Fixed account detail / list',path:'/fixed/accounts',match:/^\/fixed\/accounts(?:\/:id(?:\/edit)?)?$/},
  {key:'fixed-services',category:'Fixed services',label:'Fixed services',path:'/fixed/services',match:/^\/fixed\/services(?:\/(?:new|:id\/edit|request-new))?$/},
  {key:'grouped-accounts',category:'Account reviews',label:'Grouped upgrade accounts',path:'/grouped-upgrade-accounts',match:/^\/grouped-upgrade-accounts$/},
  {key:'grouped-lines',category:'Account reviews',label:'Grouped line review',path:'/grouped-upgrade-accounts/line/:id/review',match:/^\/grouped-upgrade-accounts\/line\/:id\/review$/},
  {key:'grouped-customer',category:'Account reviews',label:'Grouped customer review',path:'/grouped-upgrade-accounts/account/:id/customer',match:/^\/grouped-upgrade-accounts\/account\/:id\/customer$/},
  {key:'grouped-master',category:'Account reviews',label:'Grouped master review',path:'/grouped-upgrade-accounts/master-review',match:/^\/grouped-upgrade-accounts\/master-review$/},
  {key:'my-work',category:'Tasks and messages',label:'My Work / follow-ups',path:'/os/my-work/follow-ups',match:/^\/os\/my-work\/(?:[^/]+|:section)$/},
  {key:'task-centre',category:'Tasks and messages',label:'Task list / task detail',path:'/tasks',match:/^\/tasks(?:\/(?:new|:id))?$/},
  {key:'work-centre',category:'Tasks and messages',label:'Work Centre',path:'/work-centre',match:/^\/work-centre$/},
  {key:'inquiries',category:'Customer service',label:'Inquiries and walk-ins',path:'/backoffice/inquiries',match:/^\/(?:backoffice\/inquiries(?:\/:id)?|queries\/new|os\/potential-client\/new)$/},
  {key:'approvals',category:'Management',label:'Approval Centre',path:'/approvals',match:/^\/approvals$/},
  {key:'command-centre',category:'Management',label:'Command Centre',path:'/command-centre',match:/^\/command-centre$/},
  {key:'administration',category:'Administration',label:'Administration Centre',path:'/backoffice',match:/^\/backoffice$/},
  {key:'staff',category:'Administration',label:'Staff and access management',path:'/backoffice/staff',match:/^\/backoffice\/staff(?:\/(?:new|:id))?$/},
  {key:'attendance',category:'Administration',label:'Attendance / staff login history',path:'/backoffice/attendance',match:/^\/(?:backoffice\/attendance|attendance(?:\/my)?)$/},
  {key:'staff-weekly-audit',category:'Administration',label:'Weekly usage audit',path:'/backoffice/staff-usage',match:/^\/backoffice\/staff-usage$/},
  {key:'staff-daily-audit',category:'Administration',label:'Daily screen usage report',path:'/backoffice/staff-usage/daily',match:/^\/backoffice\/staff-usage\/daily$/},
  {key:'data-review',category:'Administration',label:'Data Review Centre',path:'/data-review',match:/^\/data-review(?:\/(?:history|case\/:id(?:\/merge)?))?$/},
  {key:'imports',category:'Administration',label:'Data Import Centre',path:'/backoffice/data-import',match:/^\/backoffice\/(?:data-import|monthly-import-management|legacy-client-claim-reconciliation)$/},
  {key:'upgrade-centre',category:'Commercial',label:'Upgrade Centre',path:'/upgrade-centre',match:/^\/upgrade-centre$/},
  {key:'deals',category:'Commercial',label:'Black Friday / Deals',path:'/black-friday',match:/^\/(?:black-friday|uat\/deals)$/},
  {key:'reporting',category:'Management',label:'Reporting Centre',path:'/reports',match:/^\/(?:reports|backoffice\/reports(?:\/[^/]+)?)$/},
  {key:'office-intelligence',category:'Management',label:'Office Intelligence',path:'/office-intelligence',match:/^\/office-intelligence$/},
  {key:'office-tools',category:'Administration',label:'Back-office email, Word and Excel',path:'/backoffice/office-tools',match:/^\/backoffice\/office-tools$/},
  {key:'launchers-admin',category:'Administration',label:'Launcher configuration',path:'/backoffice/os-launchers',match:/^\/backoffice\/os-launchers$/},
  {key:'library',category:'Documents',label:'Document Library',path:'/uat/library',match:/^\/uat\/library$/},
  {key:'calendar',category:'Daily workspace',label:'Calendar page',path:'/calendar',match:/^\/calendar(?:\/items\/:id)?$/},
  {key:'weekly-stats',category:'Reporting',label:'Weekly staff statistics',path:'/weekly-stats',match:/^\/weekly-stats$/}
]);

function isoDay(d){return d.toISOString().slice(0,10);}
function addDays(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return isoDay(d);}
function todaySast(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const obj=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return obj.year+'-'+obj.month+'-'+obj.day;
}
function selection(query={},now=new Date()){
 const today=todaySast(now),day=String(query.day||today);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||isoDay(new Date(day+'T12:00:00Z'))!==day||day<'2025-01-01'||day>today)throw Error('Choose a valid South African reporting day');
 const days=Number(query.days||1);
 if(![1,7,30].includes(days))throw Error('Choose 1, 7 or 30 days');
 const raw=String(query.staff||'');
 if(raw&&!/^[1-9]\d{0,9}$/.test(raw))throw Error('Invalid staff filter');
 const staffId=raw?Number(raw):null;
 const first=addDays(day,1-days);
 return {day,days,staffId,from:first+' 00:00:00',to:addDays(day,1)+' 00:00:00',
  first,last:day,today,yesterday:addDays(today,-1)};
}
function canonicalRoute(raw){
 let route=String(raw||'').split('?')[0].replace(/^\/talk2me(?=\/|$)/i,'')||'/';
 route=route.replace(/\/\d+(?=\/|$)/g,'/:id');
 return route.slice(0,255);
}
function matchedKey(eventType,screenKey,routePath){
 if(eventType==='feature_open' || eventType==='ui_action'){
   const feature=CATALOG.find(x=>x.feature===screenKey);
   if(feature)return feature.key;
   if(screenKey!=='route')return null;
 }
 const route=canonicalRoute(routePath);
 const match=CATALOG.find(x=>x.match&&x.match.test(route));
 return match?.key||null;
}
function safeNumber(x){return Number(x)||0;}
function makeOverviewRow(staff){
 return {...staff,id:Number(staff.id),active:Number(staff.is_active)===1,
  views:0,launches:0,windows:0,external:0,buttons:0,httpRequests:0,
  chatRefreshes:0,changes:0,messagesSent:0,reads:0,replies:0,tasksSeen:0,tasksCompleted:0};
}
function newest(a,b){return a&&b?(new Date(a)>new Date(b)?a:b):(a||b||null);}
async function report(input={},options={}){
 const filter=selection(input,options.now||new Date());
 const [peopleRaw]=await db.query('SELECT id,full_name,role,is_active FROM staff_users ORDER BY is_active DESC,role,full_name');
 const allStaff=peopleRaw.map(makeOverviewRow);
 if(filter.staffId&&!allStaff.some(x=>x.id===filter.staffId))throw Error('Unknown staff member');
 const visibleStaff=allStaff.filter(x=>!filter.staffId||x.id===filter.staffId);
 const byId=new Map(visibleStaff.map(x=>[x.id,x]));
 const [events]=await db.query(
  "SELECT staff_id,event_type,COALESCE(route_path,'') route_path,COALESCE(screen_key,'') screen_key,"+
  "COUNT(*) n,MAX(occurred_at) last_at FROM crm_usage_events WHERE occurred_at>=? AND occurred_at<? "+
  "AND event_type IN ('screen_view','feature_open','window_open','external_open','ui_action','http_action','work_chat_opened') "+
  "GROUP BY staff_id,event_type,route_path,screen_key",
  [filter.from,filter.to]);
 const screenMap=new Map(CATALOG.map(c=>[c.key,{...c,views:0,launches:0,windows:0,buttons:0,lastAt:null,users:new Map()}]));
 const fields={screen_view:'views',feature_open:'launches',window_open:'windows',external_open:'external',ui_action:'buttons',http_action:'httpRequests',work_chat_opened:'chatRefreshes'};
 for(const event of events){
  const staff=byId.get(Number(event.staff_id));
  if(!staff)continue;
  const count=safeNumber(event.n),field=fields[event.event_type];
  if(field)staff[field]+=count;
  const key=matchedKey(event.event_type,event.screen_key,event.route_path);
  if(!key)continue;
  const screen=screenMap.get(key);
  if(!screen||!['screen_view','feature_open','window_open','ui_action'].includes(event.event_type))continue;
  const metric=fields[event.event_type];
  screen[metric]+=count;
  screen.lastAt=newest(screen.lastAt,event.last_at);
  screen.users.set(staff.id,(screen.users.get(staff.id)||0)+count);
 }
 // These tables are authoritative for actions. No rows are inserted/updated.
 const lookups=[
  ['changes',"SELECT staff_id,COUNT(*) n FROM audit_log WHERE created_at>=? AND created_at<? GROUP BY staff_id"],
  ['messagesSent',"SELECT sender_staff_id staff_id,COUNT(*) n FROM staff_chat_messages WHERE created_at>=? AND created_at<? GROUP BY sender_staff_id"],
  ['reads',"SELECT staff_id,COUNT(*) n FROM staff_chat_read_receipts WHERE read_at>=? AND read_at<? GROUP BY staff_id"],
  ['replies',"SELECT replying_staff_id staff_id,COUNT(*) n FROM staff_chat_reply_links WHERE linked_at>=? AND linked_at<? GROUP BY replying_staff_id"],
  ['tasksSeen',"SELECT assigned_to staff_id,COUNT(*) n FROM staff_tasks WHERE seen_at>=? AND seen_at<? GROUP BY assigned_to"],
  ['tasksCompleted',"SELECT COALESCE(w.completed_by,t.assigned_to) staff_id,COUNT(*) n FROM staff_tasks t LEFT JOIN staff_task_workflow w ON w.task_id=t.id WHERE t.status='completed' AND t.completed_at>=? AND t.completed_at<? GROUP BY staff_id"]
 ];
 for(const [field,sql] of lookups){
  const [rows]=await db.query(sql,[filter.from,filter.to]);
  for(const row of rows){const staff=byId.get(Number(row.staff_id));if(staff)staff[field]+=safeNumber(row.n);}
 }
 const screens=[...screenMap.values()].map(screen=>{
  const tracked=screen.views+screen.launches+screen.windows+screen.buttons;
  const staffNames=[...screen.users.entries()].sort((a,b)=>b[1]-a[1]).map(([id,n])=>{
   const person=byId.get(id);return {name:person?.full_name||'Other staff',count:n};
  });
  return {...screen,tracked,status:tracked?'Observed':'No recorded use',staffNames,users:staffNames.length};
 }).sort((a,b)=>b.tracked-a.tracked||a.label.localeCompare(b.label));
 return {filter,allStaff,visibleStaff,screens,
  observed:screens.filter(s=>s.tracked>0).length,
  unobserved:screens.filter(s=>s.tracked===0).length,
  totalScreens:screens.length,
  summary:visibleStaff.reduce((acc,p)=>{
   for(const key of ['views','launches','windows','external','buttons','httpRequests','chatRefreshes','changes','messagesSent','reads','replies','tasksSeen','tasksCompleted'])acc[key]=(acc[key]||0)+p[key];
   return acc;
  },{})
 };
}
module.exports={CATALOG,todaySast,selection,canonicalRoute,matchedKey,report};
