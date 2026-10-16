'use strict';
const {parseWhen,normal}=require('./clock');
const PERSONAL=/^(?:(?:hey|hi)\s+)?(?:zippy[\s,:-]+)?(?:please\s+|asseblief\s+)?(?:remind\s+me|remind\s+myself|remember\s+to|herinner\s+my|herinner\s+vir\s+my|onthou\s+vir\s+my|don't\s+let\s+me\s+forget|moenie\s+dat\s+ek\s+vergeet\s+nie)\b/i;
const CALENDAR=/\b(appointment|afspraak|meeting|vergadering|calendar|kalender)\b/i;
const WORK=/^(?:(?:hey|hi)\s+)?(?:zippy[\s,:-]+)?(?:please\s+|asseblief\s+)?(?:tell|ask|instruct|send\s+(?:a\s+)?message\s+to|vra|s[eê]|stuur\s+(?:'n\s+)?boodskap\s+vir|give\s+\w+\s+a\s+task|gee\s+vir\s+\w+\s+\S+\s+taak|remind\s+(?!me\b|myself\b)\w+\s+to|herinner\s+(?!my\b|vir\s+my\b)(?:vir\s+)?\w+\s+om)\b/i;
function stripCommand(s){return String(s||'').trim().replace(/^(?:(?:hey|hi)\s+)?zippy[\s,:-]*/i,'').replace(/^(?:please|asseblief)\s+/i,'').trim();}
function titleFor(command){let s=stripCommand(command);s=s.replace(/^(?:every|each|elke)\s+\w+\s+/i,'');s=s.replace(/^(?:remind\s+me|remind\s+myself|remember\s+to|herinner\s+my|herinner\s+vir\s+my|onthou\s+vir\s+my|don't\s+let\s+me\s+forget|moenie\s+dat\s+ek\s+vergeet\s+nie)\b\s*/i,'');
 s=s.replace(/^(?:every\s+\w+|elke\s+\w+)\s+/i,'').replace(/^(?:today|tomorrow|vandag|m[oô]re)\s+/i,'');
 s=s.replace(/^(?:at|by|before|om|teen|voor)\s+(?:\d{1,2}(?::\d\d)?(?:am|pm|uur)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|een|twee|drie|vier|vyf|ses|sewe|agt|nege|tien|elf|twaalf)(?:\s*uur)?\s*/i,'');
 s=s.replace(/^(?:to|om|that\s+i\s+(?:must|should)|dat\s+ek\s+moet)\s+/i,'');
 s=s.replace(/\b(?:at|by|om|teen)\s+(?:\d{1,2}(?::\d\d)?(?:\s*(?:am|pm|uur))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|een|twee|drie|vier|vyf|ses|sewe|agt|nege|tien|elf|twaalf)(?:\s*uur)?\b/i,'');
 s=s.replace(/[.!?]+$/,'').trim();return s.slice(0,160);
}
function interpret(message,{now=new Date()}={}){
 const raw=String(message||'').trim().slice(0,2500);if(!raw)return {kind:'question',question:'What would you like Zippy to do?'};
 const normalized=normal(stripCommand(raw));
 if(/^(?:what(?:'s| is)?\s+(?:on\s+)?my\s+(?:calendar|schedule)|wat\s+is\s+op\s+my\s+kalender|my\s+day|my\s+dag|show\s+my\s+(?:reminders|calendar)|wys\s+my\s+(?:herinneringe|kalender))/.test(normalized))return {kind:'agenda'};
 const withoutRepeat=stripCommand(raw).replace(/^(?:every|each|elke)\s+\w+\s+/i,'');
 if(WORK.test(raw)||/^(?:[\p{L}'-]+(?:\s+[\p{L}'-]+){0,2})\s+(?:must|moet|should|has to|needs to)\b/iu.test(withoutRepeat))return {kind:'office',original:raw};
 if(PERSONAL.test(raw)||PERSONAL.test(withoutRepeat)||CALENDAR.test(raw)){
  const when=parseWhen(raw,{now});const title=titleFor(raw);
  if(!title||title.length<2)return {kind:'question',question:'What should I remind you about?',partial:{original:raw}};
  if(!when.ok)return {kind:'question',question:when.question,partial:{original:raw,title}};
  return {kind:'personal',title,dueAt:when.at,recurrence:when.recurrence,entryType:CALENDAR.test(raw)&&!PERSONAL.test(raw)?'appointment':'reminder',original:raw};
 }
 return {kind:'question',question:'Is this a private reminder or a Talk2Me office instruction?',partial:{original:raw}};
}
module.exports={interpret,titleFor,stripCommand};
