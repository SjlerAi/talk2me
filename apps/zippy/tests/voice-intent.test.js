'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {interpret}=require('../src/commands');
const {normalizeOfficeSpeech,stripCourtesy}=require('../src/speech');
const {available,validate}=require('../src/ai');
const {taskWords,referencedName,incompleteInstruction}=require('../../../src/services/cudo-natural-parser');

const spoken=[
 ['vra Gerda my bel asseblief','Vra Gerda om my te bel'],
 ['Vra Gerda om my te bel asseblief','Vra Gerda om my te bel'],
 ['Ask vraag Gerda my bel asseblief','Vra Gerda om my te bel'],
 ['vra Gerda om my bel asb','Vra Gerda om my te bel'],
 ['Vra vir Gerda my te bel, asseblief.','Vra Gerda om my te bel'],
 ['sê vir Gerda om my te bel asseblief','Vra Gerda om my te bel'],
 ['Vra Gerda bel my please','Vra Gerda om my te bel'],
 ['ask Gerda to call me please','ask Gerda to call me'],
 ['Please ask Gerda to phone me','ask Gerda to phone me'],
 ['Gerda moet my bel asseblief','Gerda moet my bel']
];
test('Afrikaans and mixed voice transcripts remove courtesy but keep assignee and caller',()=>{
 for(const [utterance,expected] of spoken){
  const actual=normalizeOfficeSpeech(utterance);
  assert.equal(actual,expected,utterance);
  const intent=interpret(utterance);
  assert.equal(intent.kind,'office',utterance);
  assert.equal(intent.original,utterance);
  assert.equal(intent.crmMessage,expected,utterance);
  const crm=taskWords(actual);
  assert.equal(crm.kind,'instruction',actual);
  assert.equal(crm.assignee.toLowerCase(),'gerda',actual);
  const person=referencedName(crm.instruction);
  assert.equal(person,actual.toLowerCase().includes('call me')||actual.toLowerCase().includes('phone me')?'me':'my',actual);
  assert.equal(incompleteInstruction(crm.instruction),false,actual);
 }
});
test('Do not search CRM for politeness words or time adverbs',()=>{
 for(const word of ['asseblief','please','asb','later','nou','vandag','again']){
  assert.equal(referencedName('bel '+word),null,'Do not query CRM name '+word);
 }
 assert.equal(referencedName('my te bel asseblief'),'my');
 assert.equal(referencedName('Gerda te bel asseblief'),'Gerda');
 assert.equal(referencedName('call my mother'),'my'); // existing planner asks to identify possessive relation
 assert.equal(incompleteInstruction('bel asseblief'),true);
 assert.equal(incompleteInstruction('phone please'),true);
});
test('Personal reminders remain private even when they mention staff',()=>{
 const now=new Date('2026-10-16T07:30:00Z');
 const items=[
  'Zippy, remind me tomorrow at 12 to phone Gerda',
  'Herinner my môre om twaalfuur om Gerda te bel',
  'Every Friday remind me to call my mother at 12'
 ];
 for(const s of items)assert.equal(interpret(s,{now}).kind,'personal',s);
 assert.equal(interpret('Ask Gerda to call me please').kind,'office');
});
test('Unrelated free-form CRM instructions are not overwritten by a canned phone task',()=>{
 const instructions=[
  'Ask Johnny to prepare a completely new pricing strategy',
  'Tell Johanna to review these upgrades tomorrow',
  'Vra Gerda om die nuwe plan te ontwikkel, asseblief'
 ];
 for(const s of instructions){
  const p=interpret(s);
  assert.equal(p.kind,'office',s);
  assert.equal(p.crmMessage,stripCourtesy(s));
  assert.equal(taskWords(p.crmMessage).kind,'instruction',s);
 }
});
test('AI conversation is a suggestion only and cannot create CRM records',()=>{
 const value=validate({route:'conversation',answer:'Here is a simple explanation.',title:'',dueAt:'',recurrence:'',entryType:'reminder',question:''},'What is AI?');
 assert.deepEqual(value,{kind:'conversation',text:'Here is a simple explanation.'});
 const office=validate({route:'office'},'vra Gerda my bel');
 assert.equal(office.kind,'office');
 assert.equal(office.original,'vra Gerda my bel');
 assert.equal(validate({route:'unsupported'},'hello'),null);
 // No AI provider is implicitly enabled merely because Zippy handles voice.
 if(!process.env.ZIPPY_AI_ENABLED)assert.equal(available(),false);
});
