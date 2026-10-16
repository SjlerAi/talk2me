'use strict';
const assert=require('assert');
const fs=require('fs');
const {normal,taskWords,staffMatches,referencedName,rankPeople,pickMatch}=require('../src/services/cudo-natural-parser');
const {draftResponse}=require('../src/services/cudo-natural-plan');
const read=path=>fs.readFileSync(path,'utf8');

const staff=[
 {id:1,first_name:'Johnny',full_name:'Jonathan Olivier',username:'johnny',email:'johnny@example.test'},
 {id:2,first_name:'Stephan',full_name:'Stephan Le Roux',username:'stephan',email:'stephan@example.test'},
 {id:3,first_name:'Gerda',full_name:'Gerda Le Roux',username:'gerda',email:'gerda@example.test'}
];
const clients=[{id:45,client_name:'Stefan Botha'},{id:88,client_name:'Johnny Thomas'}];
const a=taskWords('Ask Johnny to phone Stefan');
const b=taskWords('Stefan must phone Johnny');
const c=taskWords('Send a message to Johnny to phone Stefan');
const af=taskWords("Stuur 'n boodskap vir Johnny om Stefan te bel");
assert.deepEqual([a.kind,a.assignee,a.instruction],['instruction','Johnny','phone Stefan']);
assert.deepEqual([b.kind,b.assignee,b.instruction],['instruction','Stefan','phone Johnny']);
assert.deepEqual([c.kind,c.assignee,c.instruction],['instruction','Johnny','phone Stefan']);
assert.deepEqual([af.kind,af.assignee,af.instruction],['instruction','Johnny','Stefan te bel']);
assert.deepEqual([taskWords('Vra Johnny om Stefan te bel').assignee,taskWords('Stefan moet Johnny bel').assignee],['Johnny','Stefan']);
assert.equal(taskWords('Find me Stefan on the CRM').kind,'lookup');
assert.equal(taskWords('Soek vir Stefan').kind,'lookup');
assert.equal(taskWords('Find me Stefan on the CRM').name,'Stefan');
assert.equal(taskWords('Show me Stephan').kind,'lookup');
assert.equal(taskWords('Give Johnny a task to prepare a completely new pricing strategy').instruction,
 'prepare a completely new pricing strategy','The task body must be free-form.');
assert.equal(taskWords('Who has overdue tasks today?').kind,'none');
assert.equal(referencedName(a.instruction),'Stefan');
assert.equal(referencedName(b.instruction),'Johnny');
assert.equal(referencedName(af.instruction),'Stefan');
assert.equal(referencedName('call Mr Botha'),'Botha');
assert.equal(referencedName('call the customer'),null);
assert.equal(normal('Môre'),'more');

assert.equal(pickMatch(staffMatches(a.assignee,staff)).person.id,1,'Johnny must be the recipient in the first instruction');
const stefan=pickMatch(staffMatches(b.assignee,staff));
assert.equal(stefan.person.id,2,'Stefan must match the staff spelling Stephan');
assert(stefan.near,'Close spoken name must be shown for verification');
assert.equal(pickMatch(staffMatches('Johnny',staff)).person.id,1,'Name order must not change role');
const cross=rankPeople('Stefan',staff,clients);
assert.equal(pickMatch(cross).error,'ambiguous','Do not silently choose staff vs customer with overlapping names');
assert.equal(pickMatch(staffMatches('Johnny',staff.concat([{id:9,full_name:'Johnny Smit',first_name:'Johnny',username:'johnnys'}]))).error,
 'ambiguous','Duplicate staff names require a choice');

const route=read('src/routes/cudo-ai.js');
const workRoute=read('src/routes/uat-work-widgets.js');
const widget=read('public/js/cudo-widget.js');
const workWidget=read('public/js/uat-work-widgets.js');
const plan=read('src/services/cudo-natural-plan.js');
const send=read('src/services/cudo-natural-send.js');
assert(route.includes('prepareNaturalCommand'),'Cudo chat must interpret names before generic CRM analytics');
assert(!route.includes('executeSimpleTaskCommand'),'Cudo chat must never create a task without confirming.');
assert(route.includes("actionName==='confirm_natural_instruction'"),'Cudo send requires an explicit confirmation action');
assert(route.includes("actionName==='choose_natural_name'"),'Ambiguous names must be selectable');
assert(workRoute.includes("router.post('/api/uat/tasks/command/confirm'"),'Work send must require confirmation');
assert(workRoute.includes("router.post('/api/uat/tasks/command/choice'"),'Work must allow name selection');
assert(widget.includes('cudo-command-preview')&&widget.includes('data-cudo-confirm-name'),'Cudo must preview who/what before sending');
assert(widget.includes('sendMessage(full)'),'Voice must open preview immediately');
assert(workWidget.includes('t2m-quick-command-preview')&&workWidget.includes('/api/uat/tasks/command/confirm'),
 'Work must preview before sending');
assert(workWidget.includes('form.requestSubmit()'),'Voice in Work must prepare a draft');
assert(plan.includes('crmStaff()')&&plan.includes('crmClients('),'Actor and referenced people must come from CRM records');
assert(plan.includes('staffMatches(parsed.assignee,staff)'),'Assignee is resolved independently from target');
assert(plan.includes('rankPeople(subject,staff'),'Referenced CRM person is resolved independently');
assert(send.includes('createAgentInstructionInTransaction'),'Confirmed messages must generate monitored tasks');
assert(send.includes('INSERT INTO staff_chat_messages'),'Confirmed instructions must enter Work Messages');
assert(send.includes("related_task_id"),'Internal message and task must be linked');
assert(send.includes('beginTransaction')&&send.includes('rollback'),'Internal task and message must be atomic');
assert(send.includes('GET_LOCK')&&send.includes('existing.task_id'),'Repeated confirmations must not duplicate work');
assert(send.includes("draft.source==='voice'"),'Voice assignment must require staff-name confirmation');
assert(plan.includes('channelAvailability'),'External channels must be gated by actual provider readiness');
console.log('CUDO_NATURAL_CRM_COMMANDS=PASS');
