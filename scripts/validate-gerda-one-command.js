'use strict';
const assert=require('assert');
const fs=require('fs');
const {norm,parseDeadline,priorityFor,bulkCommand,looksLikeSimpleTask,
  staffTarget,customerHint,aliasesFor}=require('../src/services/quick-task-commands');
const now=new Date('2026-10-16T07:30:00.000Z'); // Fri, 09:30 in Johannesburg
const staff=[
  {id:1,first_name:'Johanna',full_name:'Johanna Peterson',username:'johanna',email:'johanna@example.test'},
  {id:2,first_name:'Brabant',full_name:'Brabant Van Onselen',username:'brabant',email:'brabant@example.test'},
  {id:3,first_name:'Gertruida',full_name:'Gertruida Smith',username:'gertruida',email:'gerda@talk-online.co.za'},
  {id:4,first_name:'Jonathan',full_name:'Jonathan Olivier',username:'johnny',email:'johnny@example.test'}
];
const due=(text,at=now)=>parseDeadline(text,{now:at});
assert.equal(norm('Môre, DRINGEND'),'more, dringend');
assert.equal(due('Give Johanna a task to call Mr Botha').dueAt,'2026-10-19 16:00:00','No date defaults to next working Monday at 16:00');
assert.equal(due('tomorrow at 2pm').dueAt,'2026-10-17 14:00:00');
assert.equal(due('môre voor vieruur').dueAt,'2026-10-17 16:00:00');
assert.equal(due('vandag teen 15:30').dueAt,'2026-10-16 15:30:00');
assert.equal(due('by Friday at 15:00').dueAt,'2026-10-23 15:00:00');
assert.equal(due('next task 2026-11-04 at 14h30').dueAt,'2026-11-04 14:30:00');
assert.equal(due('19/10/2026 at 10:00').dueAt,'2026-10-19 10:00:00');
assert(due('vandag teen 08:00').error,'past deadline must not create a task');
assert(due('2026-02-30 at 14:00').error,'invalid date must not be accepted');
assert.equal(priorityFor('dringend'),'urgent');
assert.equal(priorityFor('urgent follow-up'),'urgent');
assert.equal(priorityFor('belangrik'),'high');
assert.equal(priorityFor('normal'),'normal');
assert(looksLikeSimpleTask('Johanna moet meneer Botha bel môre'));
assert(looksLikeSimpleTask("Gee vir Brabet 'n taak om môre voor vieruur op te volg"));
assert(looksLikeSimpleTask('Give Johanna a task to call Mr Botha'));
assert(!looksLikeSimpleTask('Assign these 5 tasks to Gerda'));
assert(!looksLikeSimpleTask('Give everybody a task to call'));
assert(!looksLikeSimpleTask('Send a WhatsApp to Johanna about a task'));
assert(!looksLikeSimpleTask('Email Johanna a task'));
assert.equal(bulkCommand('Assign the first five clients to Gerda'),true);
let recipient=staffTarget('Give Johanna a task to call Mr Botha tomorrow',staff);
assert.equal(recipient.staff.id,1);
assert.equal(recipient.instruction,'call mr botha tomorrow');
recipient=staffTarget("Gee vir Brabet 'n taak om mnr Botha op te volg",staff);
assert.equal(recipient.staff.id,2);
assert.equal(recipient.instruction,'mnr botha op te volg');
recipient=staffTarget('Johanna must contact Mr Botha tomorrow',staff);
assert.equal(recipient.staff.id,1);
assert.equal(recipient.instruction,'contact mr botha tomorrow');
recipient=staffTarget('Give Gerda a task to check the office tomorrow',staff);
assert.equal(recipient.staff.id,3);
assert.equal(recipient.instruction,'check the office tomorrow');
assert(aliasesFor(staff[1]).includes('brabet'),'Known spoken alias must be stable');
assert(staffTarget('Give Johanna a task to call customer',staff.concat([{...staff[0],id:5}])).error,'Duplicate first name must require clarification');
assert(staffTarget('Give Nonexistent a task to call the customer',staff).error,'Unknown staff must be rejected');
assert.equal(customerHint('Call Mr Botha about upgrades'),'botha');

const service=fs.readFileSync('src/services/quick-task-commands.js','utf8');
const route=fs.readFileSync('src/routes/uat-work-widgets.js','utf8');
const cudo=fs.readFileSync('src/routes/cudo-ai.js','utf8');
const taskUi=fs.readFileSync('public/js/uat-work-widgets.js','utf8');
const cudoUi=fs.readFileSync('public/js/cudo-widget.js','utf8');
const css=fs.readFileSync('public/css/uat-work-widgets.css','utf8');
const monitor=fs.readFileSync('src/services/office-intelligence-agent.js','utf8');
assert(service.includes('GET_LOCK')&&service.includes('RELEASE_LOCK'),'Duplicate requests must be serialized');
assert(service.includes('sendAgentInstruction'),'Command must create an existing monitored task');
assert(service.includes("DATE_SUB(NOW(),INTERVAL 10 MINUTE)"),'Accidental repeats must not create duplicates');
assert(service.includes("relatedClientId:client.clientId"),'Resolved customer must link to task');
assert(monitor.includes('agent_task_watches'),'Existing agent watches must monitor new tasks');
assert(route.includes("router.post('/api/uat/tasks/command',requireAuth"),'Unified Work task command endpoint is required');
assert(route.includes('if(!management(req.session.user))'),'Direct task assignment must be management only');
assert(cudo.includes('executeSimpleTaskCommand'),'Cudo must share exactly the same safe command path');
assert(cudo.includes("req.session.cudoPendingAction=null;"),'Cudo command must clear previous pending action');
assert(taskUi.includes('data-quick-task-form'),'Work Inbox must show one instruction field');
assert(taskUi.includes('data-quick-task-language'),'Speech must allow the user to select language');
assert(taskUi.includes("window.SpeechRecognition||window.webkitSpeechRecognition"),'Work Inbox microphone must support browser speech recognition');
assert(taskUi.includes("source:quickVoiceSource?'voice':'text'"),'Command source must be recorded');
assert(taskUi.includes("field.focus();"),'User can review the speech transcript before the action is sent');
assert(cudoUi.includes('cudo-voice-language')&&cudoUi.includes('recognition.lang=voiceLanguage'), 'Cudo must allow Afrikaans/English voice selection');
assert(cudoUi.includes("text:'Voice transcript is ready in the box."),'Cudo voice must still require transcript review');
assert(css.includes('.t2m-quick-task-form'),'New Task commander must have responsive styles');
console.log('GERDA_ONE_COMMAND_TASKS_AND_VOICE=PASS');
