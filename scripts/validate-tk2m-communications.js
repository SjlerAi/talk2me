'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {saClock,dailyBrief,acknowledgeDailyBrief}=require('../src/services/tk2m-communications-brief');
const read=path=>fs.readFileSync(require('node:path').join(root,path),'utf8');
const morning=new Date('2026-11-19T06:00:00Z');
const afternoon=new Date('2026-11-19T14:30:00Z');
function dbMock(options={}){
 const seen=[],writes=[],commits=[];
 const db={async execute(sql,values){
   seen.push(sql);
   if(sql.includes('MAX(CASE WHEN source_kind='))return [[{chatId:0,notificationTaskId:0,workflowId:0}]];
   if(sql.includes('FROM staff_tasks t')&&sql.includes('COUNT(*) total'))return [[{total:options.taskCount??3,carryover:options.carryTasks??2,received_today:1}]];
   if(sql.includes('FROM staff_chat_messages m')&&sql.includes('COUNT(*) total'))return [[{total:options.messageCount??2,carryover:options.carryMessages??1,received_today:1}]];
   if(sql.includes('FROM staff_tasks t')&&sql.includes('ORDER BY t.created_at'))return [[{id:31,title:'Call client',created_at:'2026-11-18 16:00:00',due_at:null,status:'unread',sender:'Gerda'}]];
   if(sql.includes('FROM staff_chat_messages m')&&sql.includes('ORDER BY m.created_at'))return [[{id:44,body:'Please call',created_at:'2026-11-18 12:30:00',sender:'Johnny'}]];
   if(sql.includes('SELECT source_kind FROM staff_attention_acknowledgments'))return [(options.acknowledged||[]).map(source_kind=>({source_kind}))];
   if(sql.includes('INSERT IGNORE INTO staff_attention_acknowledgments')){
     writes.push(values);return [{affectedRows:1}];
   }
   throw Error('Unknown SQL '+sql.slice(0,100));
 }};
 return {db,seen,writes,commits};
}
async function main(){
 assert.equal(saClock(morning).day,'2026-11-19');
 assert.equal(saClock(morning).minutes,480);
 assert.equal(saClock(afternoon).minutes,990);
 assert.equal(saClock(afternoon).dayId,20261119);
 const x=dbMock();
 const start=await dailyBrief(x.db,9,morning);
 assert.equal(start.counts.carriedTasks,2);
 assert.equal(start.counts.carriedMessages,1);
 assert.equal(start.prompts.morning.pending,true);
 assert.equal(start.prompts.afternoon.pending,false);
 assert.equal(start.tasks[0].title,'Call client');
 assert.equal(start.messages[0].sender,'Johnny');
 assert.equal(x.seen.length,process.env.CRM_LIVE_MODE==='true'?6:5);
 const evening=await dailyBrief(x.db,9,afternoon);
 assert.equal(evening.prompts.afternoon.pending,true);
 assert.equal(evening.prompts.morning.pending,false);
 const result=await acknowledgeDailyBrief(x.db,9,'afternoon',afternoon);
 assert.equal(result.status,200);
 assert.deepEqual(x.writes[0],{staffId:9,kind:'afternoon',sourceId:20261119});
 assert.equal((await acknowledgeDailyBrief(x.db,9,'invalid',afternoon)).status,400);
 assert.equal((await acknowledgeDailyBrief(x.db,0,'morning',morning)).status,400);
 assert.equal((await acknowledgeDailyBrief(x.db,9,'morning',afternoon)).status,409);
 const acked=await dailyBrief(dbMock({acknowledged:['morning']}).db,9,morning);
 assert.equal(acked.prompts.morning.pending,false);
 const clear=await dailyBrief(dbMock({carryTasks:0,carryMessages:0}).db,9,morning);
 assert.equal(clear.prompts.morning.eligible,false);
 const noTasks=await dailyBrief(dbMock({taskCount:0,messageCount:0,carryTasks:0,carryMessages:0}).db,9,afternoon);
 assert.equal(noTasks.prompts.afternoon.pending,false);
 const service=read('src/services/tk2m-communications-brief.js');
 assert.match(service,/Africa\/Johannesburg/);
 assert.match(service,/staff_chat_reads/);
 assert.match(service,/staff_attention_acknowledgments/);
 assert.doesNotMatch(service,/UPDATE staff_tasks/);
 assert.doesNotMatch(service,/UPDATE staff_chat_messages/);
 const route=read('src/routes/tk2m-communications-brief.js');
 assert.match(route,/requireAuth/);
 assert.match(route,/password_hash IS NOT NULL/);
 assert.match(route,/CRM_LIVE_MODE/);
 const client=read('public/js/tk2m-quick-communications.js');
 assert.match(client,/data-tk2m-quick-recipient/);
 assert.match(client,/data-tk2m-quick-text/);
 assert.doesNotMatch(client,/data-tk2m-quick-action/);
 assert.match(client,/SEND COMMUNICATION/);
 assert.match(client,/new FormData/);
 assert.doesNotMatch(client,/api\/uat\/chat\/messages/);
 assert.match(read('src/routes/tk2m-communications-brief.js'),/communications\/inbox/);
 assert.match(client,/api\/uat\/tasks/);
 assert.match(client,/api\/tk2m\/communications\/brief\/ack/);
 assert.match(client,/window\.setInterval\(pollBrief,30000\)/);
 const thread=read('public/js/tk2m-quick-task-thread.js');
 assert.match(thread,/Talk2MeQuickTaskThread/);
 assert.match(thread,/status:'completed'/);
 assert.match(thread,/completion_note:reply\|\|'Completed'/);
 assert.match(thread,/api\/uat\/tasks\//);
 assert.match(read('public/js/tk2m-staff-attention.js'),/Talk2MeQuickTaskThread\.open/);
 assert.match(read('public/js/tk2m-quick-task-thread.js'),/open_task_reply/);
 assert.match(read('public/js/tk2m-quick-chat-reply.js'),/open_chat_reply/);
 assert.match(read('public/js/uat-work-widgets.js'),/return window\.Talk2MeQuickTaskThread\.open\(id\)/);
 assert.doesNotMatch(client,/data\.set\('due_at'/);
 assert.match(read('public/js/calendar-home-uat.js'),/data-home-quick-send/);
 assert.match(read('public/js/uat-work-widgets.js'),/Talk2MeCommunications/);
 assert.match(read('public/js/uat-work-widgets.js'),/Talk2MeUnifiedInbox/);
 assert.match(read('public/js/calendar-home-uat.js'),/Communications<\/button>/);
 assert.match(html,/tk2m-unified-communications-inline-bootstrap/);
 assert.match(html,/tk2m-unified-communications\.css/);
 const unified=read('public/js/tk2m-unified-communications.js');
 require('node:vm').compileFunction(unified,[]);
 assert.match(unified,/Communications/);
 assert.match(unified,/data-tk2m-unified-list/);
 assert.match(unified,/api\/tk2m\/communications\/inbox/);
 assert.match(read('public/js/uat-work-widgets.js'),/<strong>\+ Send<\/strong>/);
 assert.match(read('public/js/tk2m-staff-attention.js'),/completeNow/);
 assert.match(read('public/js/tk2m-staff-attention.js'),/Received/);
 assert.match(read('src/routes/tk2m-staff-attention.js'),/work_alert_acknowledged/);
 assert.match(read('src/routes/tk2m-communications-brief.js'),/communications_brief_reviewed/);
 const ejs=require('ejs'),shell=read('views/os-shell.ejs');
 const html=ejs.render(shell,{
   title:'Talk2Me OS',basePath:'',appVersion:'6',assetVersion:'6-test',
   currentUser:{id:9,full_name:'Owner Demo',role:'owner'},
   isLive:true,isStaging:true,isUat:true,isManagement:true,cudoDisabled:true,
   status:{queueCount:0,taskCount:0,unreadMessageCount:0,overdueTaskCount:0,dueTodayTaskCount:0,
     followUpTodayCount:0,birthdaysTodayCount:0,upgradesDueCount:0,callbacksTodayCount:0,newProspectsCount:0},
   osLaunchers:[],approvalCentreCount:0,unassignedClientCount:0,attendanceState:null
 },{filename:path.join(root,'views/os-shell.ejs')});
 assert.match(html,/tk2m-quick-communications-inline-bootstrap/);
 assert.match(html,/tk2m-quick-communication-modal/);
 assert.match(html,/api\/tk2m\/communications\/brief/);
 assert.match(html,/tk2m-attention-inline-bootstrap/);
 assert.match(html,/tk2m-quick-task-thread-inline-bootstrap/);
 assert.match(html,/tk2m-quick-chat-inline-bootstrap/);
 assert.match(read('public/js/tk2m-staff-attention.js'),/Talk2MeQuickChat\.open/);
 const chatSource=read('public/js/tk2m-quick-chat-reply.js');
 require('node:vm').compileFunction(chatSource,[]);
 assert.match(chatSource,/Talk2MeQuickChat=/);
 assert.match(html,/tk2m-quick-task-thread/);
 assert.match(html,/tk2m-quick-communications\.css/);
 assert.match(read('server.js'),/require\('\.\/src\/routes\/tk2m-communications-brief'\)/);
 console.log('TK2M_FAST_COMMUNICATIONS_AND_BRIEFINGS_PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
