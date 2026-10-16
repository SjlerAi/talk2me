'use strict';
const db=require('../config/db');
const crypto=require('crypto');
const {parseDeadline,priorityFor,bulkCommand}=require('./quick-task-commands');
const {channelAvailability}=require('./work-dispatch');
const {normal,taskWords,staffMatches,referencedName,rankPeople,pickMatch}=require('./cudo-natural-parser');

async function crmStaff(){
 const [rows]=await db.execute('SELECT id,full_name,first_name,username,email,role FROM staff_users WHERE is_active=1 ORDER BY full_name');
 return rows;
}
async function crmClients(name){
 const term=normal(name).slice(0,60);
 if(term.length<3)return [];
 const alternative=term.replace(/f/g,'ph'),inverse=term.replace(/ph/g,'f');
 const [rows]=await db.execute('SELECT id,client_name FROM clients WHERE is_active=1 AND (client_name LIKE :term OR client_name LIKE :alternate OR client_name LIKE :inverse) ORDER BY client_name LIMIT 30',{
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
   reference:action.reference?{id:action.reference.id,kind:action.reference.kind,name:action.reference.name}:null,
   instruction:action.instruction,channel:action.channel,dueAt:action.dueAt,priority:action.priority,
   confirmName:Boolean(action.source==='voice'||action.assigneeNear)},
  actions:disabled?['cancel_action']:['confirm_natural_instruction','cancel_action'],
  pendingAction:disabled?null:action,rows:[]};
}
function namePrompt(role,query,choice,original,source,chosen={}){
 const missing=choice.error==='not_found';
 const choices=(choice.choices||[]).map(x=>({id:x.id,kind:x.kind,name:x.name,
  label:x.name+' ('+(x.kind==='staff'?'staff':'client')+')'}));
 return {handled:true,intent:'natural_name_check',
  text:missing?'I cannot find "'+query+'" in the CRM. Nothing has been sent.':
   'I found several CRM records for "'+query+'". Choose the correct '+(role==='assignee'?'staff member':'person')+'. Nothing has been sent.',
  choices,actions:[],rows:[],pendingAction:missing?null:{
   type:'natural_name_choice',role,message:original,source,...chosen,choices
  }};
}
async function prepareNaturalCommand({message,source='text',chosen={}}={}){
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
 const matches=staffMatches(parsed.assignee,staff);
 const choice=chosen.assigneeId?{person:matches.find(x=>x.id===Number(chosen.assigneeId)),error:'not_found'}:pickMatch(matches);
 if(!choice.person)return namePrompt('assignee',parsed.assignee,choice,parsed.raw,source,chosen);
 const subject=referencedName(parsed.instruction);
 let reference=null;
 if(subject){
  const records=rankPeople(subject,staff,await crmClients(subject));
  const selected=chosen.referenceId?records.find(x=>x.id===Number(chosen.referenceId)&&x.kind===chosen.referenceKind):null;
  const target=chosen.referenceId?{person:selected,error:'not_found'}:pickMatch(records);
  if(!target.person)return namePrompt('reference',subject,target,parsed.raw,source,{...chosen,assigneeId:choice.person.id});
  reference=target.person;
 }
 const due=parseDeadline(parsed.raw);
 if(due.error)return {handled:true,intent:'natural_instruction_error',text:due.error+' Nothing has been sent.',actions:[],rows:[],pendingAction:null};
 const action={type:'natural_instruction',assignee:choice.person,
  assigneeNear:choice.person.score<100,heardAssignee:parsed.assignee,
  instruction:parsed.instruction,reference,channel:parsed.channel,
  dueAt:due.dueAt,priority:priorityFor(parsed.raw),source,
  createdAt:Date.now(),nonce:crypto.randomBytes(12).toString('hex')};
 return draftResponse(action);
}
async function chooseNaturalCommand(pending,choice){
 if(!pending||pending.type!=='natural_name_choice')throw new Error('There is no name waiting for selection.');
 const id=Number(choice?.id),kind=String(choice?.kind||'');
 if(!Number.isSafeInteger(id)||id<1||!['staff','client'].includes(kind))throw new Error('Choose a valid CRM name.');
 if(!pending.choices.some(c=>c.id===id&&c.kind===kind))throw new Error('That CRM record was not offered as a choice.');
 if(pending.role==='assignee'&&kind!=='staff')throw new Error('Tasks can only be assigned to staff.');
 const chosen={assigneeId:pending.assigneeId,referenceId:pending.referenceId,referenceKind:pending.referenceKind};
 if(pending.role==='assignee')chosen.assigneeId=id;
 else {chosen.referenceId=id;chosen.referenceKind=kind;}
 return prepareNaturalCommand({message:pending.message,source:pending.source,chosen});
}
module.exports={prepareNaturalCommand,chooseNaturalCommand,draftResponse,crmStaff,crmClients};
