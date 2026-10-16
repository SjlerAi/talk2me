'use strict';
const TIMEZONE='Africa/Johannesburg';
const ZONE_OFFSET_MS=2*60*60*1000;
const DAY=86400000;
function clean(x){return String(x??'').trim();}
function normal(s){return clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function dateParts(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 return {year:parts.year,month:parts.month,day:parts.day,hour:parts.hour,minute:parts.minute};
}
function localDayDate(parts){return new Date(Date.UTC(parts.year,parts.month-1,parts.day));}
function localToUtc(day,hour,minute){return new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),hour,minute)-ZONE_OFFSET_MS);}
const DAYS={sunday:0,sondag:0,monday:1,maandag:1,tuesday:2,dinsdag:2,wednesday:3,woensdag:3,thursday:4,donderdag:4,friday:5,vrydag:5,saturday:6,saterdag:6};
const HOURS={one:1,een:1,two:2,twee:2,three:3,drie:3,four:4,vier:4,five:5,vyf:5,six:6,ses:6,seven:7,sewe:7,eight:8,agt:8,nine:9,nege:9,ten:10,tien:10,eleven:11,elf:11,twelve:12,twaalf:12};
function readTime(q){
 let m=q.match(/\b([01]?\d|2[0-3])[:h.]([0-5]\d)\s*(am|pm)?\b/);let hour,minute=0,ampm='';
 if(m){hour=Number(m[1]);minute=Number(m[2]);ampm=m[3]||'';}
 else{
  m=q.match(/\b(?:at|by|before|around|om|teen|voor|van|after|na)\s+(\d{1,2})(?:\s*(am|pm|uur|o'clock))?\b/)||q.match(/\b(\d{1,2})\s*(am|pm|uur)\b/);
  if(m){hour=Number(m[1]);ampm=m[2]||'';}
  else{
   const word=Object.keys(HOURS).join('|');
   m=q.match(new RegExp('\\b(?:at|by|before|om|teen|voor|van)\\s+('+word+')(?:\\s*uur|\\s*oclock)?\\b'))||q.match(new RegExp('\\b('+word+')\\s*uur\\b'));
   if(!m){if(/\b(noon|middag|midday)\b/.test(q))return {hour:12,minute:0};if(/\b(midnight|middernag)\b/.test(q))return {hour:0,minute:0};return null;}
   hour=HOURS[m[1]];
  }
 }
 if(!Number.isInteger(hour)||hour>23)return {error:'invalid_time'};
 if(ampm==='pm'&&hour<12)hour+=12;
 else if(ampm==='am'&&hour===12)hour=0;
 else if(!/am|pm/.test(ampm)&&hour>=1&&hour<=6){
  if(!/\b(morning|oggend|vm|am)\b/.test(q))hour+=12;
 }
 return {hour,minute};
}
function readRecurrence(q){
 if(/\b(every day|daily|daagliks|elke dag)\b/.test(q))return 'daily';
 if(/\b(every weekday|weekdays|weeksdae|elke weeksdag)\b/.test(q))return 'weekdays';
 const m=q.match(/\b(?:every|each|elke)\s+(monday|maandag|tuesday|dinsdag|wednesday|woensdag|thursday|donderdag|friday|vrydag|saturday|saterdag|sunday|sondag)\b/);
 if(m)return 'weekly:'+DAYS[m[1]];
 if(/\b(every month|monthly|maandeliks|elke maand)\b/.test(q))return 'monthly';
 return null;
}
function parseWhen(message,{now=new Date()}={}){
 const q=normal(message),p=dateParts(now);let d=localDayDate(p),hasDay=false;
 const recurrence=readRecurrence(q);let weekday=null;
 if(/\b(tomorrow|more|morre)\b/.test(q)){d.setUTCDate(d.getUTCDate()+1);hasDay=true;}
 else if(/\b(today|vandag)\b/.test(q)){hasDay=true;}
 else{
  const exact=q.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)||q.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if(exact){const y=exact[1].length===4&&Number(exact[1])>31?Number(exact[1]):Number(exact[3]);const month=Number(exact[2]);const date=exact[1].length===4&&Number(exact[1])>31?Number(exact[3]):Number(exact[1]);d=new Date(Date.UTC(y,month-1,date));if(d.getUTCFullYear()!==y||d.getUTCMonth()!==month-1||d.getUTCDate()!==date)return {ok:false,question:'That date is invalid. What date did you mean?'};hasDay=true;}
  else for(const [name,index] of Object.entries(DAYS)){
   if(new RegExp('\\b'+name+'\\b').test(q)){weekday=index;let delta=(index-d.getUTCDay()+7)%7;if(delta===0&&/\bnext\b/.test(q))delta=7;d.setUTCDate(d.getUTCDate()+delta);hasDay=true;break;}
  }
 }
 const t=readTime(q);
 if(t?.error)return {ok:false,question:'What time should I use?'};
 if(!t)return {ok:false,question:'What time should I remind you?',partial:{recurrence,hasDay}};
 let due=localToUtc(d,t.hour,t.minute);
 if(due<=now){if(hasDay&&!recurrence)return {ok:false,question:'That time has already passed. What future time should I use?'};
  if(recurrence?.startsWith('weekly:'))d.setUTCDate(d.getUTCDate()+7);
  else if(recurrence==='weekdays'){do{d.setUTCDate(d.getUTCDate()+1)}while([0,6].includes(d.getUTCDay()));}
  else if(recurrence==='monthly')d.setUTCMonth(d.getUTCMonth()+1);
  else d.setUTCDate(d.getUTCDate()+1);
  due=localToUtc(d,t.hour,t.minute);
 }
 if(recurrence==='weekdays'&&[0,6].includes(d.getUTCDay())){do{d.setUTCDate(d.getUTCDate()+1)}while([0,6].includes(d.getUTCDay()));due=localToUtc(d,t.hour,t.minute);}
 return {ok:true,at:due.toISOString(),zone:TIMEZONE,recurrence};
}
function nextDue(currentIso,recurrence){if(!recurrence)return null;const d=new Date(currentIso);if(!Number.isFinite(d.getTime()))throw Error('Invalid due date');const local=new Date(d.getTime()+ZONE_OFFSET_MS);let day=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()));const h=local.getUTCHours(),m=local.getUTCMinutes();
 if(recurrence==='daily')day.setUTCDate(day.getUTCDate()+1);
 else if(recurrence==='weekdays'){do{day.setUTCDate(day.getUTCDate()+1);}while([0,6].includes(day.getUTCDay()));}
 else if(recurrence.startsWith('weekly:'))day.setUTCDate(day.getUTCDate()+7);
 else if(recurrence==='monthly'){const prev=day.getUTCDate(),month=day.getUTCMonth();day.setUTCDate(1);day.setUTCMonth(month+1);const last=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,0)).getUTCDate();day.setUTCDate(Math.min(prev,last));}
 else throw Error('Unknown recurrence');
 return localToUtc(day,h,m).toISOString();
}
module.exports={TIMEZONE,normal,parseWhen,readRecurrence,readTime,dateParts,nextDue,localToUtc};
