'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const {parseScheduledFor,bookCommunication,pendingForSender,cancelCommunication,dispatchDue}=
 require('../src/services/tk2m-scheduled-communications');
const now=new Date('2026-11-19T12:00:00Z'); // 14:00 SAST
assert.equal(parseScheduledFor('2026-11-19T14:15',now),'2026-11-19 14:15:00');
assert.equal(parseScheduledFor('2026-11-21T09:00',now),'2026-11-21 09:00:00');
for(const raw of ['2026-11-19T13:00','2026-11-19T14:00','2026-02-29T12:00',
 '2026-11-31T12:00','2026-13-01T09:00','2026-11-19T24:00','2027-12-19T09:00','bad']){
 assert.throws(()=>parseScheduledFor(raw,now));
}
const ui=read('public/js/tk2m-quick-communications.js');
const css=read('public/css/tk2m-quick-communications.css');
require('node:vm').compileFunction(ui,[]);
assert.match(ui,/data-tk2m-quick-schedule aria-expanded/);
assert.match(ui,/data-tk2m-quick-send/);
assert.ok(ui.indexOf('data-tk2m-quick-schedule aria-expanded')<ui.indexOf('data-tk2m-quick-send'));
assert.match(ui,/data-tk2m-schedule-date/);
assert.match(ui,/data-tk2m-schedule-time/);
assert.match(ui,/data-tk2m-schedule-confirm/);
assert.match(ui,/data-tk2m-view-scheduled/);
assert.match(ui,/api\/tk2m\/communications\/scheduled/);
assert.match(ui,/api\/uat\/tasks/);
assert.match(css,/tk2m-quick-schedule-options\[hidden\]/);
assert.match(css,/tk2m-quick-schedule/);
assert.match(read('server.js'),/tk2m-scheduled-communications/);
const route=read('src/routes/tk2m-scheduled-communications.js');
assert.match(route,/requireAuth/);
assert.match(route,/status\(201\)/);
assert.match(route,/status\(409\)/);
assert.match(route,/attachment/);
const worker=read('scripts/run-tk2m-scheduled-communications.js');
assert.match(worker,/production-runtime\.env/);
assert.match(worker,/Africa\/Johannesburg/);
assert.match(worker,/dispatchDue/);
const queries=[],tx=[];
const conn={
 async beginTransaction(){tx.push('begin')},
 async commit(){tx.push('commit')},
 async rollback(){tx.push('rollback')},
 release(){tx.push('release')},
 async execute(sql,args){
  queries.push(sql);
  if(sql.includes('INSERT INTO staff_scheduled_communications'))return [{insertId:401}];
  if(sql.includes('INSERT INTO staff_scheduled_communication_attachments'))return [{insertId:1}];
  if(sql.includes('SELECT id FROM staff_scheduled_communications')&&sql.includes('FOR UPDATE'))return [[{id:401}]];
  if(sql.includes('SELECT stored_filename FROM staff_scheduled_communication_attachments'))return [[{stored_filename:'file-a.txt'}]];
  if(sql.includes('UPDATE staff_scheduled_communications'))return [{affectedRows:1}];
  if(sql.includes('DELETE FROM staff_scheduled_communication_attachments'))return [{affectedRows:1}];
  throw Error('Unexpected booking SQL: '+sql.slice(0,110));
 }
};
const fake={
 async query(sql){queries.push(sql);return [[]]},
 async execute(sql,args){
  queries.push(sql);
  if(sql.includes('FROM staff_users')&&sql.includes('password_hash IS NOT NULL'))return [[{id:5,full_name:'Brabant'}]];
  if(sql.includes('FROM staff_scheduled_communications s'))return [[{
    id:401,recipient_staff_id:5,title:'Phone me',scheduled_for:'2026-11-21T09:00',
    recipient_name:'Brabant',attachment_count:1}]];
  throw Error('Unexpected DB SQL: '+sql.slice(0,110));
 },
 async getConnection(){return conn}
};
async function check(){
 // Freeze Date.now to a deterministic 2026 test moment for booking.
 const originalNow=Date.now;
 Date.now=()=>now.getTime();
 try{
  const booked=await bookCommunication(fake,{
    senderId:9,recipientId:5,message:'Phone me',
    scheduledFor:'2026-11-21T09:00',
    files:[{originalname:'attachment.txt',filename:'file-a.txt',mimetype:'text/plain',size:100}]
  });
  assert.equal(booked.id,401);
  assert.equal(booked.attachmentCount,1);
 }finally{Date.now=originalNow}
 const pending=await pendingForSender(fake,9);
 assert.equal(pending.length,1);
 assert.equal(pending[0].scheduledFor,'2026-11-21T09:00');
 assert.equal(pending[0].attachmentCount,1);
 const cancelled=await cancelCommunication(fake,{senderId:9,id:401});
 assert.equal(cancelled.ok,true);
 assert.deepEqual(cancelled.files,['file-a.txt']);
 assert.ok(queries.some(s=>s.includes('CREATE TABLE IF NOT EXISTS staff_scheduled_communications')));
 assert.ok(queries.some(s=>s.includes('CREATE TABLE IF NOT EXISTS staff_scheduled_communication_attachments')));
 assert.ok(queries.some(s=>s.includes('INSERT INTO staff_scheduled_communication_attachments')));
 assert.deepEqual(tx.filter(x=>x==='commit'),['commit','commit']);
 // Cron: one due item, all changes in a single transaction, then no more.
 const sql=[],trace=[];
 let took=false;
 const dispatchConn={
  async beginTransaction(){trace.push('begin')},
  async commit(){trace.push('commit')},
  async rollback(){trace.push('rollback')},
  release(){trace.push('release')},
  async execute(query,args){
   sql.push(query);
   if(query.includes("FROM staff_scheduled_communications")&&query.includes('FOR UPDATE')){
    if(took)return [[]];
    took=true;return [[{id:407,sender_staff_id:9,recipient_staff_id:5,
      title:'Call me',message:'Call me tomorrow'}]];
   }
   if(query.includes('FROM staff_users WHERE id IN'))return [[
     {id:9,full_name:'Stephan',username:'sjler',is_active:1,password_hash:'x'},
     {id:5,full_name:'Brabant',username:'brabant',is_active:1,password_hash:'x'}
   ]];
   if(query.includes('INSERT INTO staff_tasks'))return [{insertId:900}];
   if(query.includes('INSERT INTO staff_task_comments'))return [{insertId:880}];
   if(query.includes('FROM staff_scheduled_communication_attachments'))return [[{
     original_name:'example.txt',stored_filename:'file-a.txt',
     mime_type:'text/plain',file_bytes:100}]];
   return [{affectedRows:1}];
  }
 };
 const dispatched=await dispatchDue({async getConnection(){return dispatchConn}},{limit:2});
 assert.equal(dispatched.length,1);
 assert.equal(dispatched[0].taskId,900);
 assert.equal(dispatched[0].attachmentCount,1);
 for(const q of ['INSERT INTO staff_tasks','INSERT INTO staff_task_workflow',
  'INSERT INTO staff_task_comments','INSERT INTO staff_task_attachments',
  'INSERT INTO staff_task_notifications','SET status=\'sent\'']){
  assert.ok(sql.some(s=>s.includes(q)),'Missing atomic dispatch '+q);
 }
 assert.deepEqual(trace.filter(x=>x==='commit'),['commit']);
 assert.equal(trace.filter(x=>x==='rollback').length,1);
 // Dispatch failure must roll back the entire delivery, not mark it sent.
 let rolledBack=false,committed=false;
 const broken={
  async getConnection(){return {
   async beginTransaction(){},
   async execute(q){
    if(q.includes('FOR UPDATE'))return [[{id:55,sender_staff_id:9,recipient_staff_id:5,
      title:'Fail',message:'Fail'}]];
    if(q.includes('FROM staff_users WHERE id IN'))return [[
      {id:9,full_name:'Stephan',is_active:1},
      {id:5,full_name:'Brabant',is_active:1,password_hash:'yes'}]];
    if(q.includes('INSERT INTO staff_tasks'))throw Error('simulated DB fault');
    return [{affectedRows:1}];
   },
   async commit(){committed=true},
   async rollback(){rolledBack=true},
   release(){}
  }}
 };
 await assert.rejects(()=>dispatchDue(broken,{limit:1}),/simulated DB fault/);
 assert.equal(rolledBack,true);
 assert.equal(committed,false);
 console.log('TK2M_SCHEDULE_DATE_TIMING_AND_ATOMIC_DISPATCH_PASS');
}
check().catch(error=>{console.error(error);process.exitCode=1});
