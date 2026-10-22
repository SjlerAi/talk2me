'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {detectLanguage}=require('../src/language');
const {recognise}=require('../src/crm-intents');
const voice=require('../src/voice-transcribe');
const {todaySA,monthBounds,lookupOwnerCrm}=require('../../../src/services/zippy-owner-queries');
const fixed=new Date('2026-10-22T07:30:00.000Z');

test('Afrikaans, English and owner CRM questions are detected without creating actions',()=>{
 assert.equal(detectLanguage('Watter kliënte verjaar vandag?'),'af-ZA');
 assert.equal(detectLanguage('Which customers have birthdays today?'),'en-ZA');
 assert.equal(detectLanguage('Hello','af-ZA'),'af-ZA');
 assert.equal(recognise('Zippy, watter kliënte verjaar vandag?',fixed).intent,'birthdays');
 assert.equal(recognise('Was all staff at work today?',fixed).intent,'attendance');
 const report=recognise('Show Johnny upgrades for October 2026',fixed);
 assert.deepEqual({intent:report.intent,month:report.month,staff:report.staff},
  {intent:'upgrades',month:'2026-10',staff:'johnny'});
 assert.equal(recognise('Remind me to check birthdays tomorrow',fixed),null);
 assert.equal(recognise('Herinner my aan personeel vandag',fixed),null);
});
test('Transcription is opt-in, bounded and uses auto language unless explicitly overridden',async()=>{
 assert.equal(voice.validateAudio('audio/mp4',1024).ok,true);
 assert.equal(voice.validateAudio('audio/webm;codecs=opus',2000).ok,true);
 assert.equal(voice.validateAudio('text/plain',1024).ok,false);
 assert.equal(voice.validateAudio('audio/mp4',voice.MAX_BYTES+1).ok,false);
 const oldFlag=process.env.ZIPPY_STT_ENABLED,oldKey=process.env.ZIPPY_STT_API_KEY;
 try{
  delete process.env.ZIPPY_STT_ENABLED;
  assert.equal(voice.available(),false);
  process.env.ZIPPY_STT_ENABLED='1';
  process.env.ZIPPY_STT_API_KEY='test-only-key';
  const calls=[];
  const fetcher=async(url,options)=>{
   calls.push({url,options});
   return {ok:true,json:async()=>({text:'Watter kliënte verjaar vandag?'})};
  };
  const recording=Buffer.alloc(1000,42);
  const one=await voice.transcribe(recording,'audio/mp4',{fetcher});
  assert.match(one.text,/verjaar/);
  assert.equal(calls[0].options.body.get('language'),null);
  assert.equal(calls[0].options.body.get('model'),'gpt-4o-mini-transcribe');
  assert.equal(calls[0].url,'https://api.openai.com/v1/audio/transcriptions');
  await voice.transcribe(recording,'audio/webm',{language:'af-ZA',fetcher});
  assert.equal(calls[1].options.body.get('language'),'af');
 }finally{
  if(oldFlag===undefined)delete process.env.ZIPPY_STT_ENABLED;else process.env.ZIPPY_STT_ENABLED=oldFlag;
  if(oldKey===undefined)delete process.env.ZIPPY_STT_API_KEY;else process.env.ZIPPY_STT_API_KEY=oldKey;
 }
});
test('Read-only owner CRM reports use bounded SELECTs and explain uncertainty',async()=>{
 const calls=[];
 const db={execute:async(sql,params)=>{
  calls.push({sql,params});
  assert.match(sql,/SELECT/);
  assert.doesNotMatch(sql,/\b(?:UPDATE|INSERT|DELETE)\b/i);
  if(sql.includes("DATE_FORMAT(c.birthday"))return [[{id:1,client_name:'Example Client',cell_number:'',assigned_staff:'Johnny'}]];
  if(sql.includes("attendance_sessions a"))return [[
   {id:2,first_name:'Johnny',clock_in_at:null,login_at:'2026-10-22 08:00:00'},
   {id:3,first_name:'Johanna',clock_in_at:null,login_at:null}
  ]];
  return [[{id:4,client_name:'Sample',next_upgrade_date:'2026-10-30',account_number:'ACC04'}]];
 }};
 assert.equal(todaySA(fixed),'2026-10-22');
 assert.deepEqual(monthBounds('2026-12',fixed),{month:'2026-12',from:'2026-12-01',to:'2027-01-01'});
 const birth=await lookupOwnerCrm(db,{intent:'birthdays',language:'af-ZA'},fixed);
 assert.match(birth.text,/verjaarsdaginskrywings/);assert.match(birth.text,/Example Client/);
 const attendance=await lookupOwnerCrm(db,{intent:'attendance'},fixed);
 assert.match(attendance.text,/do not prove someone was absent/);
 assert.equal(attendance.withoutEvidence,1);
 const upgrades=await lookupOwnerCrm(db,{intent:'upgrades',month:'2026-10',staff:'johnny'},fixed);
 assert.equal(upgrades.count,1);
 assert.equal(calls[2].params.staff,'johnny');
 assert.match(calls[2].sql,/LOWER\(su.first_name\)=:staff/);
 await assert.rejects(()=>lookupOwnerCrm(db,{intent:'unsafe_sql'},fixed),/Unsupported/);
});
test('Compact PWA keeps transcript editable and requires explicit Send',()=>{
 const root=path.resolve(__dirname,'..');
 const app=fs.readFileSync(path.join(root,'public/beta/app.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/beta/index.html'),'utf8');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 for(const id of ['conversation-feed','command-status','command-input','command-send','mic-button'])
  assert(html.includes('id="'+id+'"'));
 assert.match(html,/<textarea id="command-input"/);
 assert.match(html,/option value="auto"/);
 assert.match(html,/href="\/beta\/manifest.webmanifest"/);
 assert.match(app,/register\('\/beta\/sw\.js'\)/);
 assert.match(app,/I heard your message\. Review or edit the words, then tap Send/);
 const voiceSection=app.slice(app.indexOf('async function startVoice()'),app.indexOf('async function enableNotifications()'));
 assert(!/submitCommand\(\)/.test(voiceSection),'voice must not auto-send on microphone stop');
 assert.match(app,/await refreshConversation/);
 assert.match(server,/app\.post\('\/api\/voice\/transcribe'/);
 assert.match(server,/app\.get\('\/api\/conversation'/);
 assert.match(server,/crm\.bridgeCall\('lookup'/);
});
