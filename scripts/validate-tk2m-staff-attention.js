'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {chatToken,composeAlerts,positiveId,pendingAlerts,acknowledgeAlert}=
  require('../src/services/tk2m-staff-attention');

async function main(){
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
      if(sql.includes('FROM staff_tasks WHERE id='))return [[{id:12}]];
      if(sql.includes('FROM staff_task_notifications WHERE id='))return [[{id:13}]];
      if(sql.includes('INSERT IGNORE INTO staff_attention_acknowledgments')) {
        assert.equal(values.staffId,4);
        assert.ok(['dismiss','open'].includes(values.method));
        insertCount++;
        return [{affectedRows:1}];
      }
      if(sql.includes('FROM staff_chat_messages m'))return [[{id:9,conversation_key:'direct:4:7',sender_name:'Gerda',message_type:'text',body:'Phone',created_at:'2026-11-19T08:00:00Z'}]];
      if(sql.includes('FROM staff_tasks t'))return [[{id:12,type:'task',sender_name:'Johnny',message:'Task',priority:'urgent',created_at:'2026-11-19T06:00:00Z'}]];
      if(sql.includes('FROM staff_task_notifications n'))return [[{id:13,task_id:12,sender_name:'Anzel',notification_text:'Progress',action_required:1,created_at:'2026-11-19T09:00:00Z'}]];
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
  assert.match(shell,/tk2m-staff-attention\.js/);
  assert.match(route,/requireAuth/);
  assert.match(route,/if\(!live\) return res\.sendStatus\(404\)/);
  assert.match(widgets,/async function openConversation\(token\)/);
  assert.match(read('public/js/task-workflow-notifications.js'),/window\.location\.hostname==='crm\.tk2m\.co\.za'/);
  const sql=read('migrations/038_tk2m_staff_attention_acknowledgments_20261119.sql');
  assert.match(sql,/UNIQUE KEY uq_staff_attention_source/);
  console.log('TK2M_STAFF_ATTENTION_REGRESSION_PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1});
