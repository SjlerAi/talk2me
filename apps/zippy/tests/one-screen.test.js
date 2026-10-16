'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const db=require('../src/db');
const crm=require('../src/crm');
const push=require('../src/push');
const originalQuery=db.query,originalBridge=crm.bridgeCall,originalConfigured=crm.configured,originalPush=push.sendPush;
const state={links:new Map(),events:new Map(),replies:new Map(),calls:[],pushes:[]};
db.query=async(sql,params=[])=>{
 if(sql.startsWith('INSERT INTO zippy_crm_tracking')){
  state.links.set(params[0]+':'+params[1],{owner_key:params[0],task_id:params[1],
   recipient_name:params[2],last_status:'unread'});return [{affectedRows:1}];
 }
 if(sql.startsWith('INSERT IGNORE INTO zippy_activity')){
  const id=params[0]+':'+params[1];
  if(state.events.has(id))return [{affectedRows:0}];
  const item={id:state.events.size+1,owner_key:params[0],event_key:params[1],kind:params[2],
   title:params[3],body:params[4],task_id:params[5],created_at:'2026-10-16 12:00:00'};
  state.events.set(id,item);return [{affectedRows:1}];
 }
 if(sql.includes('SELECT task_id,recipient_name,last_status FROM zippy_crm_tracking')||
  sql.includes('SELECT task_id,recipient_name,last_status,last_checked_at FROM zippy_crm_tracking')){
  return [[...state.links.values()].filter(r=>r.owner_key===params[0])];
 }
 if(sql.startsWith('UPDATE zippy_crm_tracking SET last_status=')){
  const key=params[1]+':'+params[2];state.links.get(key).last_status=params[0];
  return [{affectedRows:1}];
 }
 if(sql.startsWith('UPDATE zippy_crm_tracking SET last_checked_at='))return [{affectedRows:1}];
 if(sql.startsWith('SELECT id,kind,title,body,task_id,created_at FROM zippy_activity')){
  const items=[...state.events.values()].filter(r=>r.owner_key===params[0]).reverse();
  return [items];
 }
 if(sql.includes('SELECT DISTINCT owner_key FROM zippy_crm_tracking')){
  return [[...new Set([...state.links.values()].map(r=>r.owner_key))].map(owner_key=>({owner_key}))];
 }
 throw Error('Unexpected test query: '+sql.slice(0,130));
};
crm.configured=()=>true;
crm.bridgeCall=async(action,payload)=>{
 assert.equal(action,'updates');
 state.calls.push(payload);
 assert(['info@b4s.co.za','gerda@talk-online.co.za'].includes(payload.actorEmail));
 if(payload.actorEmail==='info@b4s.co.za')return {tasks:[{
  id:201,title:'Phone customer',status:'completed',recipientName:'Johnny',
  completionNote:'Called the lady and explained the upgrade.',dueAt:'2026-10-16 14:00:00'
 }],replies:[{id:301,taskId:201,senderName:'Johnny',body:'I phoned her and she agreed.',
  createdAt:'2026-10-16 12:05:00'}]};
 return {tasks:[],replies:[]};
};
push.sendPush=async args=>{state.pushes.push(args);return {enabled:true,sent:1}};
const activity=require('../src/activity');
const {staffWorkQuestion,answerTrackedWork}=require('../src/questions');
test('sent staff instruction is persisted in only the issuing user timeline',async()=>{
 await activity.trackSent('info@b4s.co.za',201,{assignee:{displayName:'Johnny'}},
  'Please phone the customer by 14:00');
 await activity.trackSent('gerda@talk-online.co.za',202,{assignee:{displayName:'Johanna'}},
  'Please review the upgrades');
 assert.equal((await activity.getFeed('info@b4s.co.za')).length,1);
 assert.equal((await activity.getFeed('gerda@talk-online.co.za')).length,1);
 assert.match((await activity.getFeed('info@b4s.co.za'))[0].body,/phone the customer/i);
});
test('actual CRM completion and Johnny reply are quoted without inventing proof',async()=>{
 const a=await activity.syncOwner('info@b4s.co.za');
 assert.equal(a.updates,2);
 const feed=await activity.getFeed('info@b4s.co.za');
 assert(feed.some(i=>i.kind==='crm_completed'&&/marked the task complete/.test(i.body)));
 assert(feed.some(i=>i.kind==='crm_reply'&&/I phoned her and she agreed/.test(i.body)));
 assert(state.calls.some(i=>i.actorEmail==='info@b4s.co.za'&&i.taskIds.includes(201)));
 assert(!state.calls.some(i=>i.actorEmail==='info@b4s.co.za'&&i.taskIds.includes(202)));
});
test('background polling is idempotent; no duplicate reply notifications',async()=>{
 const initial=state.events.size,initialPushes=state.pushes.length;
 const b=await activity.syncOwner('info@b4s.co.za');
 assert.equal(b.updates,0);
 assert.equal(state.events.size,initial);
 assert.equal(state.pushes.length,initialPushes);
});
test('staff activity answers distinguish recorded reports from verified phone calls',async()=>{
 assert(staffWorkQuestion('What did Johnny reply?'));
 assert(staffWorkQuestion('Did Johnny complete the phone call?'));
 assert.equal(staffWorkQuestion('Did my mother phone me?'),null);
 const answer=await answerTrackedWork('What did Johnny say?', 'info@b4s.co.za');
 assert.match(answer.text,/I phoned her and she agreed/);
 const completion=await answerTrackedWork('Did Johnny complete the call?', 'info@b4s.co.za');
 assert.match(completion.text,/not independent proof/);
});
test('one-screen action flow requires explicit reviewed approval and account-scoped CRM tracking',()=>{
 const root=path.resolve(__dirname,'..');
 const ui=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const crmRoute=fs.readFileSync(path.resolve(root,'../../src/routes/zippy-integration.js'),'utf8');
 const tick=fs.readFileSync(path.join(root,'src/tick.js'),'utf8');
 for(const marker of ['review-panel','review-message','review-send','review-cancel','activity-list','reminder-popup'])
  assert(html.includes('id="'+marker+'"'),marker);
 for(const marker of ['function officePreview','function sendDraft','function cancelDraft',
   'function speakMessage','function draftSpeech','function dueReminder','setInterval'])
  assert(ui.includes(marker),marker);
 assert(ui.includes("send|send it")&&ui.includes('stuur'));
 assert(server.includes("app.post('/api/crm/confirm'"));
 assert(server.includes("app.post('/api/crm/cancel'"));
 assert(server.includes('editedMessage:message'));
 assert(crmRoute.includes("if(req.params.action==='updates')"));
 assert(crmRoute.includes('t.created_by=:owner'));
 assert(crmRoute.includes("edited=req.body?.editedMessage"));
 assert(crmRoute.includes("approvedByVoice=req.body?.approvalMode==='voice'"));
 assert(tick.includes('zippy_scheduler_status')&&tick.includes('retryPushes'));
});
test.after(()=>{db.query=originalQuery;crm.bridgeCall=originalBridge;crm.configured=originalConfigured;push.sendPush=originalPush;});
