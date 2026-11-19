'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {RECENT_ALERT_DAYS,chatToken,composeAlerts,positiveId,pendingAlerts,acknowledgeAlert}=
  require('../src/services/tk2m-staff-attention');

async function main(){
  assert.equal(RECENT_ALERT_DAYS,2);
  assert.equal(positiveId(4),4);
  assert.equal(positiveId(0),null);
  assert.equal(chatToken(4,'direct:4:7'),'direct:7');
  assert.equal(chatToken(7,'direct:4:7'),'direct:4');
  assert.equal(chatToken(9,'direct:4:7'),null);
  assert.equal(chatToken(4,'direct:7:4'),null);
  const alerts=composeAlerts(4,[
    {id:9,conversation_key:'direct:4:7',sender_name:'Gerda',message_type:'text',body:'Please phone',created_at:'2026-11-19T08:00:00Z'},
    {id:8,conversation_key:'direct:4:7',sender_name:'Gerda',message_type:'text',body:'Prior',created_at:'2026-11-19T07:00:00Z'},
    {id:10,conversation_key:'office',sender_name:'Stefan',message_type:'voice',created_at:'2026-11-19T09:00:00Z'},
    {id:11,conversation_key:'direct:7:9',sender_name:'Private',created_at:'2026-11-19T10:00:00Z'}
  ],[
    {id:12,type:'task',sender_name:'Johnny',message:'Urgent work',priority:'urgent',created_at:'2026-11-19T06:00:00Z'}
  ],[
    {id:13,task_id:12,sender_name:'Anzel',notification_text:'Follow up',action_required:1,created_at:'2026-11-19T08:30:00Z'}
  ]);
  assert.equal(alerts.length,4);
  assert.equal(alerts[0].kind,'task');
  assert.equal(alerts[1].kind,'update');
  assert.equal(alerts.filter(a=>a.conversation==='direct:7').length,1);
  assert.equal(alerts.find(a=>a.conversation==='office').preview,'New voice message');
  let insertCount=0;
  const db={
    async execute(sql,values){
      if(sql.includes('FROM staff_chat_messages WHERE id='))return [[{conversation_key:'direct:4:7',sender_staff_id:7}]];
      if(sql.includes('MAX(CASE WHEN source_kind='))return [[{chatId:0,notificationTaskId:0,workflowId:0}]];
      if(sql.includes('FROM staff_tasks WHERE id='))return [[{id:12}]];
      if(sql.includes('FROM staff_task_notifications WHERE id='))return [[{id:13}]];
      if(sql.includes('INSERT IGNORE INTO staff_attention_acknowledgments')) {
        assert.equal(values.staffId,4);
        assert.ok(['dismiss','open'].includes(values.method));
        insertCount++;
        return [{affectedRows:1}];
      }
      if(sql.includes('FROM staff_chat_messages m')){
        assert.match(sql,/m\.created_at >= DATE_SUB\(NOW\(\), INTERVAL 2 DAY\)/);
        return [[{id:9,conversation_key:'direct:4:7',sender_name:'Gerda',message_type:'text',body:'Phone',created_at:'2026-11-19T08:00:00Z'}]];
      }
      if(sql.includes('FROM staff_tasks t')){
        assert.match(sql,/t\.created_at >= DATE_SUB\(NOW\(\), INTERVAL 2 DAY\)/);
        return [[{id:12,type:'task',sender_name:'Johnny',message:'Task',priority:'urgent',created_at:'2026-11-19T06:00:00Z'}]];
      }
      if(sql.includes('FROM staff_task_notifications n')){
        assert.match(sql,/n\.event_type<>'assigned'/);
        assert.match(sql,/n\.created_at >= DATE_SUB\(NOW\(\), INTERVAL 2 DAY\)/);
        return [[{id:13,task_id:12,sender_name:'Anzel',notification_text:'Progress',action_required:1,created_at:'2026-11-19T09:00:00Z'}]];
      }
      throw Error('Unexpected SQL: '+sql.slice(0,90));
    }
  };
  assert.equal((await pendingAlerts(db,4)).length,3);
  assert.equal((await acknowledgeAlert(db,4,'chat',9,'dismiss')).status,200);
  assert.equal((await acknowledgeAlert(db,4,'task',12,'open')).status,200);
  assert.equal((await acknowledgeAlert(db,4,'update',13,'dismiss')).status,200);
  assert.equal(insertCount,3);
  assert.equal((await acknowledgeAlert(db,4,'chat',0,'dismiss')).status,400);
  assert.equal((await acknowledgeAlert(db,4,'unknown',5,'dismiss')).status,400);
  assert.equal((await acknowledgeAlert(db,4,'chat',9,'fake')).status,400);
  assert.equal((await acknowledgeAlert(db,8,'chat',9,'open')).status,404);
  assert.equal((await acknowledgeAlert(db,4,'task',12,'open')).status,200);

  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const ui=read('public/js/tk2m-staff-attention.js');
  const css=read('public/css/tk2m-staff-attention.css');
  const layout=read('views/layout.ejs');
  const shell=read('views/os-shell.ejs');
  const route=read('src/routes/tk2m-staff-attention.js');
  const widgets=read('public/js/uat-work-widgets.js');
  assert.match(ui,/acknowledge\('dismiss'\)/);
  assert.match(ui,/acknowledge\('open'\)/);
  assert.match(ui,/window\.setInterval\(refresh, 8000\)/);
  assert.match(ui,/window\.top !== window/);
  assert.match(ui,/event\.key === 'Escape'/);
  assert.match(css,/z-index:2147483000/);
  assert.match(css,/backdrop\[hidden\]/);
  assert.match(layout,/tk2m-staff-attention\.js/);
  assert.match(shell,/tk2m-attention-inline-bootstrap/);
  assert.match(shell,/include\('\.\.\/public\/js\/tk2m-staff-attention\.js'\)/);
  assert.match(read('public/js/calendar-home-uat.js'),/data-home-attention-strip/);
  assert.match(read('public/js/calendar-home-uat.js'),/state\.focus\.openWork/);
  assert.match(read('public/css/tk2m-workspace-preview.css'),/t2m-home-attention-actions/);
  assert.match(ui,/Red alert connection failed/);
  assert.match(ui,/last 7 days/);
  const ejs=require('ejs');
  const html=ejs.render(shell,{
    title:'Talk2Me OS',basePath:'',appVersion:'6.0-test',assetVersion:'6.0-test-merged',
    currentUser:{id:9,full_name:'Owner Demo',role:'owner'},
    isLive:true,isStaging:true,isUat:true,isManagement:true,cudoDisabled:true,
    status:{queueCount:0,taskCount:57,unreadMessageCount:18,overdueTaskCount:55,dueTodayTaskCount:1,
      followUpTodayCount:0,birthdaysTodayCount:0,upgradesDueCount:0,callbacksTodayCount:0,newProspectsCount:0},
    osLaunchers:[],approvalCentreCount:10,unassignedClientCount:0,attendanceState:null
  },{filename:path.join(root,'views/os-shell.ejs')});
  assert.match(html,/tk2m-attention-backdrop/);
  assert.match(html,/api\/staff-attention\/pending/);
  assert.match(html,/TK2M LIVE/);
  assert.doesNotMatch(html,/tk2m-uat-myday/);
  assert.match(route,/requireAuth/);
  assert.match(route,/if\(!live\) return res\.sendStatus\(404\)/);
  assert.match(widgets,/async function openConversation\(token\)/);
  assert.match(read('public/js/task-workflow-notifications.js'),/window\.location\.hostname==='crm\.tk2m\.co\.za'/);
  const sql=read('migrations/038_tk2m_staff_attention_acknowledgments_20261119.sql');
  assert.match(sql,/UNIQUE KEY uq_staff_attention_source/);
  console.log('TK2M_STAFF_ATTENTION_REGRESSION_PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1});
