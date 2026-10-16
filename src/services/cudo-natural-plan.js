'use strict';
const db=require('../config/db');
const crypto=require('crypto');
const {parseDeadline,priorityFor,bulkCommand}=require('./quick-task-commands');
const {channelAvailability}=require('./work-dispatch');
const {normal,taskWords,staffMatches,referencedName,pronounKind,rankPeople,pickMatch}=require('./cudo-natural-parser');

async function crmStaff(){
 const [rows]=await db.execute('SELECT id,full_name,first_name,username,email,contact_number,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
 return rows;
}
async function crmClients(name){
 const term=normal(name).slice(0,60);
 if(term.length<3)return [];
 const alternative=term.replace(/f/g,'ph'),inverse=term.replace(/ph/g,'f');
 const [rows]=await db.execute('SELECT id,client_name,cell_number,account_number FROM clients WHERE is_active=1 AND (client_name LIKE :term OR client_name LIKE :alternate OR client_name LIKE :inverse) ORDER BY client_name LIMIT 30',{
  term:'%'+term+'%',alternate:'%'+alternative+'%',inverse:'%'+inverse+'%'
 });
 return rows;
}
function draftResponse(action){
 const person=action.assignee;
 const channelName=action.channel==='internal'?'Talk2Me Messages':action.channel==='email'?'email':'WhatsApp';
 const target=action.reference?'; concerning '+action.reference.name+' ('+action.reference.kind+')':'';
 const verification=action.assigneeNear?'Name check: "'+action.heardAssignee+'" matched '+person.name+'. ':'';
 const availability=channelAvailability(action.channel);
 const disabled=!availability.available;
 return {handled:true,intent:'natural_instruction_preview',
  text:verification+'To: '+person.shortName+' (staff)'+target+'. Channel: '+channelName+
   '. Deadline: '+action.dueAt.slice(0,16).replace(' ',' at ')+'. '+(disabled?'Cannot send: '+availability.reason:'Can I send the message?'),
  preview:{assignee:{id:person.id,name:person.name,displayName:person.shortName,heard:action.heardAssignee},
   reference:action.reference?{id:action.reference.id,kind:action.reference.kind,name:action.reference.name,phone:action.reference.phone||null}:null,
   instruction:action.instruction,channel:action.channel,dueAt:action.dueAt,priority:action.priority,
   confirmName:Boolean(action.source==='voice'||action.assigneeNear)},
  actions:disabled?['cancel_action']:['confirm_natural_instruction','cancel_action'],
  pendingAction:disabled?null:action,rows:[]};
}
function staffAsPerson(row){
 if(!row)return null;
 const name=String(row.full_name||row.first_name||row.username||'').trim();
 return {id:Number(row.id),name,shortName:String(row.first_name||name).split(/\s+/)[0],
  kind:'staff',phone:row.contact_number||null,score:100};
}
function sessionPerson(staff,requesterId){
 return staffAsPerson(staff.find(row=>Number(row.id)===Number(requesterId)));
}
function namePrompt(role,query,choice,original,source,chosen={},requesterId=null){
 const missing=choice.error==='not_found';
 const choices=(choice.choices||[]).map(x=>({id:x.id,kind:x.kind,name:x.name,
  label:x.name+' ('+(x.kind==='staff'?'staff':'client')+')'}));
 return {handled:true,intent:'natural_name_check',
  text:missing?'I cannot find "'+query+'" in the CRM. Nothing has been sent.':
   'I found several CRM records for "'+query+'". Choose the correct '+(role==='assignee'?'staff member':'person')+'. Nothing has been sent.',
  choices,actions:[],rows:[],pendingAction:missing?null:{
   type:'natural_name_choice',role,message:original,source,requesterId:Number(requesterId)||null,
   createdAt:Date.now(),...chosen,choices
  }};
}
function pronounPrompt({role,message,source,chosen,requesterId,assignee,subject}){
 const phone=/\b(?:phone|call|bel|skakel)\b/i.test(message);
 const text=role==='assignee'
   ? phone&&pronounKind(subject)==='self'
     ? 'Who should I ask to phone you?'
     : 'Who should receive this instruction?'
   :phone&&assignee
     ? 'Who should '+assignee.shortName+' phone?'
     : 'Who does "'+subject+'" refer to?';
 return {handled:true,intent:'natural_pronoun_clarification',
  text,choices:[],rows:[],actions:[],
  pendingAction:{type:'natural_pronoun_question',role,message,source,
   requesterId:Number(requesterId)||null,createdAt:Date.now(),chosen}};
}
function personUnavailable(){
 return {handled:true,intent:'natural_instruction_error',
  text:'I could not identify your signed-in account as an active CRM staff member. Nothing was sent.',
  rows:[],actions:[],pendingAction:null};
}
function naturalNameReply(message){
 const value=String(message||'').trim();
 return Boolean(value&&value.length<=100&&!/[\n!?]/.test(value)&&
  !/^(?:ask|tell|send|stuur|give|gee|vra|find|soek|show|wys|who|what|how|waar|wie|please\s+ask)\b/i.test(value)&&
  normal(value).split(' ').length<=5);
}
async function prepareNaturalCommand({message,source='text',chosen={},requesterId=null}={}){
 const parsed=taskWords(message);
 if(parsed.kind==='none'||parsed.kind==='instruction'&&bulkCommand(message))return {handled:false};
 const staff=await crmStaff();
 if(parsed.kind==='lookup'){
  const records=rankPeople(parsed.name,staff,await crmClients(parsed.name)).slice(0,30);
  return {handled:true,intent:'natural_name_search',actions:[],
   text:records.length?'Found '+records.length+' CRM record'+(records.length===1?'':'s')+' matching "'+parsed.name+'".':'No staff or customer matching "'+parsed.name+'" was found in the CRM.',
   rows:records.map((x,i)=>({id:i+1,title:x.name,detail:x.kind==='staff'?'Staff member':'Customer',
    meta:x.score===100?'Name match':'Similar name'})),pendingAction:null};
 }
 const self=sessionPerson(staff,requesterId),assigneePronoun=pronounKind(parsed.assignee);
 // "my" is Afrikaans for "me", but in "call my customer" it is English possessive.
// Never resolve an unspecified third party to the logged-in person by accident.
 const possessive=/(?:\b(?:phone|call|contact|bel|skakel|kontak|met|with|vir)\s+my\s+)([\p{L}'-]+)/iu.exec(parsed.instruction);
 const uncertainMy=possessive&&!/^(?:te|today|tomorrow|vandag|more|morre|now|nou|later|please|asseblief|again)$/i.test(possessive[1]);
 const subject=referencedName(parsed.instruction),
  subjectPronoun=uncertainMy&&normal(subject)==='my'?'unresolved':pronounKind(subject);
 let person=null;
 if(chosen.assigneeId){
  person=staffAsPerson(staff.find(row=>Number(row.id)===Number(chosen.assigneeId)));
  if(!person)return namePrompt('assignee',parsed.assignee,{error:'not_found'},parsed.raw,source,chosen,requesterId);
 }else if(assigneePronoun==='self'){
  if(!self)return personUnavailable();
  person=self;
 }else if(assigneePronoun==='unresolved'){
  return pronounPrompt({role:'assignee',message:parsed.raw,source,chosen,requesterId,subject});
 }else{
  const matches=staffMatches(parsed.assignee,staff);
  const choice=pickMatch(matches);
  if(!choice.person)return namePrompt('assignee',parsed.assignee,choice,parsed.raw,source,chosen,requesterId);
  person=choice.person;
 }
 let reference=null;
 if(subject){
  if(chosen.referenceId){
   if(chosen.referenceKind==='staff'){
    reference=staffAsPerson(staff.find(row=>Number(row.id)===Number(chosen.referenceId)));
   }else if(chosen.referenceKind==='client'){
    const [rows]=await db.execute('SELECT id,client_name,cell_number,account_number FROM clients WHERE id=:id AND is_active=1 LIMIT 1',{id:Number(chosen.referenceId)});
    const row=rows[0];
    if(row)reference={id:Number(row.id),name:row.client_name,shortName:row.client_name,
      kind:'client',phone:row.cell_number||null,score:100};
   }
   if(!reference)return namePrompt('reference',subject,{error:'not_found'},parsed.raw,source,chosen,requesterId);
  }else if(subjectPronoun==='self'){
   if(!self)return personUnavailable();
   reference=self;
  }else if(subjectPronoun==='unresolved'){
   return pronounPrompt({role:'reference',message:parsed.raw,source,chosen,requesterId,assignee:person,subject});
  }else{
   const records=rankPeople(subject,staff,await crmClients(subject));
   const target=pickMatch(records);
   if(!target.person)return namePrompt('reference',subject,target,parsed.raw,source,
    {...chosen,assigneeId:person.id},requesterId);
   reference=target.person;
  }
 }
 const due=parseDeadline(parsed.raw);
 if(due.error)return {handled:true,intent:'natural_instruction_error',text:due.error+' Nothing has been sent.',actions:[],rows:[],pendingAction:null};
 const action={type:'natural_instruction',assignee:person,
  assigneeNear:!chosen.assigneeId&&assigneePronoun===null&&person.score<100,
  heardAssignee:parsed.assignee,instruction:parsed.instruction,reference,channel:parsed.channel,
  dueAt:due.dueAt,priority:priorityFor(parsed.raw),source,
  requesterId:Number(requesterId)||null,
  createdAt:Date.now(),nonce:crypto.randomBytes(12).toString('hex')};
 return draftResponse(action);
}
async function chooseNaturalCommand(pending,choice,{requesterId=null}={}){
 if(!pending||pending.type!=='natural_name_choice')throw new Error('There is no name waiting for selection.');
 if(pending.requesterId&&Number(pending.requesterId)!==Number(requesterId))throw new Error('This selection belongs to a different session.');
 if(Date.now()-Number(pending.createdAt)>10*60*1000)throw new Error('Name selection expired. Repeat the instruction.');
 const id=Number(choice?.id),kind=String(choice?.kind||'');
 if(!Number.isSafeInteger(id)||id<1||!['staff','client'].includes(kind))throw new Error('Choose a valid CRM name.');
 if(!pending.choices.some(c=>c.id===id&&c.kind===kind))throw new Error('That CRM record was not offered as a choice.');
 if(pending.role==='assignee'&&kind!=='staff')throw new Error('Tasks can only be assigned to staff.');
 const chosen={assigneeId:pending.assigneeId,referenceId:pending.referenceId,referenceKind:pending.referenceKind};
 if(pending.role==='assignee')chosen.assigneeId=id;
 else {chosen.referenceId=id;chosen.referenceKind=kind;}
 return prepareNaturalCommand({message:pending.message,source:pending.source,chosen,requesterId});
}
async function continueNaturalPronoun(pending,reply,{requesterId=null}={}){
 if(!pending||pending.type!=='natural_pronoun_question'||!naturalNameReply(reply))return {handled:false};
 if(!pending.requesterId||Number(pending.requesterId)!==Number(requesterId))
  return {handled:true,intent:'natural_instruction_error',text:'Your session changed. Repeat the instruction.',
   rows:[],actions:[],pendingAction:null};
 if(Date.now()-Number(pending.createdAt)>5*60*1000)
  return {handled:true,intent:'natural_instruction_error',text:'That instruction expired. Please say it again.',
   rows:[],actions:[],pendingAction:null};
 const staff=await crmStaff();
 const role=pending.role,kind=pronounKind(reply);
 if(kind)return {handled:true,intent:'natural_pronoun_clarification',
  text:role==='assignee'?'Please give the staff member’s name.':'Please give the person’s name.',
  rows:[],actions:[],pendingAction:pending};
 const candidates=role==='assignee'?staffMatches(reply,staff):
  rankPeople(reply,staff,await crmClients(reply));
 const chosenPerson=pickMatch(candidates);
 if(!chosenPerson.person){
  if(chosenPerson.error==='ambiguous')return namePrompt(role,reply,chosenPerson,
   pending.message,pending.source,pending.chosen,requesterId);
  return {handled:true,intent:'natural_pronoun_clarification',
   text:role==='assignee'?'I could not find that staff member. Which staff member should I ask?':
    'I could not find that CRM person. Which person should be contacted?',
   rows:[],actions:[],pendingAction:pending};
 }
 const chosen={...pending.chosen};
 if(role==='assignee')chosen.assigneeId=chosenPerson.person.id;
 else{chosen.referenceId=chosenPerson.person.id;chosen.referenceKind=chosenPerson.person.kind;}
 return prepareNaturalCommand({message:pending.message,source:pending.source,chosen,requesterId});
}
module.exports={prepareNaturalCommand,chooseNaturalCommand,continueNaturalPronoun,naturalNameReply,draftResponse,crmStaff,crmClients};
