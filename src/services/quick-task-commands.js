'use strict';

// UAT only: one unambiguous instruction creates one INTERNAL monitored task.
// Bulk reassignment and external sending continue through Cudo's preview flow.
const crypto=require('crypto');
const db=require('../config/db');
const { sendAgentInstruction }=require('./office-intelligence-agent');
const TZ='Africa/Johannesburg';
const DAYS={sunday:0,sondag:0,monday:1,maandag:1,tuesday:2,dinsdag:2,wednesday:3,woensdag:3,
  thursday:4,donderdag:4,friday:5,vrydag:5,saturday:6,saterdag:6};
const HOURS={one:1,een:1,two:2,twee:2,three:3,drie:3,four:4,vier:4,five:5,vyf:5,six:6,ses:6,
  seven:7,sewe:7,eight:8,agt:8,nine:9,nege:9,ten:10,tien:10,eleven:11,elf:11,twelve:12,twaalf:12};
function norm(value){return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function safe(value,n=5000){return String(value??'').trim().slice(0,n);}
function dayString(date){return [date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,'0'),
  String(date.getUTCDate()).padStart(2,'0')].join('-');}
function nextWorkday(date){const d=new Date(date.getTime());do{d.setUTCDate(d.getUTCDate()+1);}
  while(d.getUTCDay()===0||d.getUTCDay()===6);return d;}
function zaClock(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    hourCycle:'h23'
  }).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  return {day:new Date(Date.UTC(parts.year,parts.month-1,parts.day)),minutes:parts.hour*60+parts.minute};
}
function parseDeadline(message,{now=new Date()}={}){
  const q=norm(message), clock=zaClock(now);
  let day=new Date(clock.day.getTime()), dated=false;
  let date=q.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if(date){
    const y=Number(date[1]),m=Number(date[2]),d=Number(date[3]);
    day=new Date(Date.UTC(y,m-1,d));
    if(day.getUTCFullYear()!==y||day.getUTCMonth()!==m-1||day.getUTCDate()!==d)return {error:'The date is invalid.'};
    dated=true;
  }else if((date=q.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/))){
    const y=Number(date[3]),m=Number(date[2]),d=Number(date[1]);
    day=new Date(Date.UTC(y,m-1,d));
    if(day.getUTCFullYear()!==y||day.getUTCMonth()!==m-1||day.getUTCDate()!==d)return {error:'The date is invalid.'};
    dated=true;
  }else if(/\b(tomorrow|more|morre)\b/.test(q)){day.setUTCDate(day.getUTCDate()+1);dated=true;}
  else if(/\b(today|vandag)\b/.test(q)){dated=true;}
  else for(const [name,weekday] of Object.entries(DAYS)){
    if(new RegExp('\\b'+name+'\\b').test(q)){
      day.setUTCDate(day.getUTCDate()+((weekday-day.getUTCDay()+7)%7||7));dated=true;break;
    }
  }
  let h=16,m=0,timed=false;
  let t=q.match(/\b([01]?\d|2[0-3])[:h.]([0-5]\d)\s*(am|pm)?\b/);
  if(t){h=Number(t[1]);m=Number(t[2]);timed=true;if(t[3]==='pm'&&h<12)h+=12;if(t[3]==='am'&&h===12)h=0;}
  else{
    t=q.match(/\b(?:at|by|before|around|om|teen|voor)\s+(\d{1,2})\s*(am|pm|uur)?\b/)
      ||q.match(/\b(\d{1,2})\s*(am|pm|uur)\b/);
    if(t){h=Number(t[1]);timed=true;if(h>23)return {error:'The time is invalid.'};
      if(t[2]==='pm'&&h<12)h+=12;else if(t[2]==='am'&&h===12)h=0;
      else if(!/am|pm/.test(t[2]||'')&&h>=1&&h<=6)h+=12;}
    else{
      const names=Object.keys(HOURS).join('|');
      t=q.match(new RegExp('\\b(?:at|by|before|om|teen|voor)\\s+('+names+')(?:\\s*uur)?\\b'))
        ||q.match(new RegExp('\\b('+names+')\\s*uur\\b'));
      if(t){h=HOURS[t[1]];if(h<=6)h+=12;timed=true;}
    }
  }
  if(!dated){if(!timed||h*60+m<=clock.minutes)day=nextWorkday(day);}
  if(dayString(day)<dayString(clock.day)||
    (dayString(day)===dayString(clock.day)&&h*60+m<=clock.minutes)){
    return {error:'This deadline has already passed. Please specify a future time.'};
  }
  return {dueAt:dayString(day)+' '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00',
    defaulted:!dated&&!timed,timezone:TZ};
}
function priorityFor(message){const q=norm(message);
  return /\b(urgent|urgently|dringend|spoed|asap|onmiddellik)\b/.test(q)?'urgent':
    /\b(high priority|belangrik|hoe prioriteit)\b/.test(q)?'high':'normal';}
function bulkCommand(message){const q=norm(message);
  return (/\b(first|next|remaining|rest|these|those|each|everybody|everyone|alle|al die|al sy|elkeen)\b/.test(q)
    &&/\b(tasks?|take|clients?|customers?|kliente|upgrades?|outstanding|uitstaande|deals?|results?|items?)\b/.test(q))
    ||/\b(?:assign|gee|give)\s+\d+\s+(?:tasks?|take|clients?|kliente|upgrades?)\b/.test(q);}
function looksLikeSimpleTask(message){
  const q=norm(message).replace(/^cudo[\s,:-]*/,'').replace(/^please\s+/,'');
  if(!q||bulkCommand(q))return false;
  return (/^(?:create|add|make|give|assign|set|send|gee|maak|skep|stel|stuur)\b/.test(q)
      &&/\b(?:task|taak|opdrag|todo|to-do)\b/.test(q))
    ||/\b(?:must|moet|should|needs to)\b/.test(q.slice(0,100))
    ||/^(?:task|taak)\s*[:\-]/.test(q);
}
function aliasesFor(s){
  const names=new Set([s.first_name,s.full_name,s.username,String(s.email||'').split('@')[0]]
    .filter(Boolean).map(norm));
  if(s.full_name)names.add(norm(s.full_name).split(' ')[0]);
  if(String(s.email||'').toLowerCase()==='gerda@talk-online.co.za'||names.has('gertruida')||names.has('gertrudia'))names.add('gerda');
  if([...names].some(x=>x.startsWith('brabant')))names.add('brabet');
  if([...names].some(x=>x.startsWith('jonathan')))names.add('johnny');
  return [...names].filter(x=>x.length>=3).sort((a,b)=>b.length-a.length);
}
function staffTarget(message,staffRows=[]){
  const q=norm(message),matches=[];
  for(const person of staffRows)for(const alias of aliasesFor(person)){
    const ix=q.indexOf(alias);if(ix<0||ix>100)continue;
    if(/[a-z0-9]/.test(q[ix-1]||' ')||/[a-z0-9]/.test(q[ix+alias.length]||' '))continue;
    matches.push({person,alias,ix,end:ix+alias.length});
  }
  matches.sort((a,b)=>a.ix-b.ix||b.alias.length-a.alias.length);
  if(!matches.length)return {error:'Which staff member? Say “Give Johanna a task to phone the customer”.'};
  const first=matches[0];
  if(new Set(matches.filter(x=>x.ix===first.ix&&x.alias===first.alias).map(x=>x.person.id)).size>1)
    return {error:'More than one staff member has that name. Please use the full name.'};
  const prefix=q.slice(0,first.ix),suffix=q.slice(first.end);
  const explicit=/\b(create|add|make|give|assign|set|send|gee|maak|skep|stel|stuur)\b/.test(prefix);
  const instructionStart=/^\s*(?:must|moet|should|needs to|has to)\b/.test(suffix)||/^\s*[:,\-]/.test(suffix)||(/^(?:task|taak)\b/.test(prefix)&&/^\s*(?:to|om)\b/.test(suffix));
  if(!explicit&&!instructionStart)return {error:'Please say who must complete the task.'};
  if(matches.some(x=>x.person.id!==first.person.id&&x.ix<first.end+12))
    return {error:'I found several staff names. Please clarify the recipient.'};
  let instruction=suffix.replace(/^[\s,:\-]+/,'').replace(/^(must|moet|should|needs to|has to)\s+/,'')
    .replace(/^(?:(a|an|the|new|nuwe|'n|n)\s+)?(task|taak|opdrag)\s*(to|om|for)?\s*/,'')
    .replace(/^(to|om|that|wat|dat)\s+/,'').replace(/^[\s,:\-]+/,'').trim();
  if(instruction.length<6)return {error:'Please include what '+safe(first.person.first_name||first.alias,50)+' must do.'};
  return {staff:first.person,instruction,matched:first.alias};
}
function customerHint(instruction){
  const q=norm(instruction);
  const match=q.match(/\b(?:mr|mnr|mrs|ms|mev|mevrou)\.?\s+([a-z][a-z'-]{2,})\b/)
    ||q.match(/\b(?:customer|client|klient)\s+([a-z][a-z'-]{2,})\b/);
  if(!match||['must','moet','about','regarding','with','wat','se'].includes(match[1]))return null;
  return match[1];
}
async function customerLink(instruction){
  const hint=customerHint(instruction);
  if(!hint)return {clientId:null};
  const [rows]=await db.execute('SELECT id,client_name FROM clients WHERE LOWER(client_name) LIKE :hint LIMIT 6',{
    hint:'%'+hint.replace(/[%_]/g,'')+'%'
  });
  return rows.length===1?{clientId:Number(rows[0].id),clientName:rows[0].client_name}:
    {clientId:null,warning:'Customer '+hint+' was not uniquely identified; task was not linked.'};
}
async function executeSimpleTaskCommand({message,userId,source='text',now=new Date()}={}){
  const command=safe(message,3000);
  if(!looksLikeSimpleTask(command))return {handled:false};
  if(!Number(userId))return {handled:true,ok:false,text:'Sign in again. No task was created.'};
  const [people]=await db.execute('SELECT id,full_name,first_name,username,email FROM staff_users WHERE is_active=1 ORDER BY full_name');
  const target=staffTarget(command,people);
  if(target.error)return {handled:true,ok:false,needsClarification:true,text:target.error+' No task was created.'};
  const due=parseDeadline(command,{now});
  if(due.error)return {handled:true,ok:false,needsClarification:true,text:due.error+' No task was created.'};
  const priority=priorityFor(command),client=await customerLink(target.instruction);
  const title=target.instruction.replace(/[.!?]+$/,'').slice(0,110);
  const signature=crypto.createHash('sha256').update([userId,target.staff.id,title,
    target.instruction,due.dueAt,priority].join('|')).digest('hex').slice(0,40);
  const lockName='t2m-task-'+signature;
  const conn=await db.getConnection();
  let acquired=false;
  try{
    const [[locked]]=await conn.execute('SELECT GET_LOCK(:name,5) AS acquired',{name:lockName});
    acquired=Number(locked?.acquired)===1;
    if(!acquired)return {handled:true,ok:false,text:'Task is being saved. Wait a moment and check Tasks.'};
    const [[existing]]=await conn.execute(
      "SELECT id FROM staff_tasks WHERE created_by=:actor AND assigned_to=:recipient AND title=:title AND message=:message AND due_at=:due AND status<>'cancelled' AND created_at>=DATE_SUB(NOW(),INTERVAL 10 MINUTE) ORDER BY id DESC LIMIT 1",{
        actor:Number(userId),recipient:Number(target.staff.id),title,message:target.instruction,due:due.dueAt
      });
    let id,duplicate=false;
    if(existing){id=Number(existing.id);duplicate=true;}
    else{
      const result=await sendAgentInstruction({issuedBy:Number(userId),assignedTo:Number(target.staff.id),
        title,message:target.instruction,dueAt:due.dueAt,priority,relatedClientId:client.clientId});
      id=Number(result.taskId);
    }
    const name=safe(target.staff.first_name||target.staff.full_name||target.staff.username,80).split(/\s+/)[0];
    return {handled:true,ok:true,status:duplicate?'duplicate':'created',
      text:(duplicate?'Already saved':'Task created')+' for '+name+' · '+due.dueAt.slice(0,16)+' · '+priority.toUpperCase()+
        (due.defaulted?' (default: next working day at 16:00)':'')+
        (client.clientName?' · '+client.clientName:'')+'.'+(client.warning?' '+client.warning:''),
      task:{id,staffId:Number(target.staff.id),staffName:name,dueAt:due.dueAt,priority,clientId:client.clientId},
      defaultedDeadline:due.defaulted,source};
  }finally{
    if(acquired)try{await conn.execute('SELECT RELEASE_LOCK(:name) AS released',{name:lockName});}catch(_){}
    conn.release();
  }
}
module.exports={norm,parseDeadline,priorityFor,bulkCommand,looksLikeSimpleTask,
  aliasesFor,staffTarget,customerHint,executeSimpleTaskCommand};
