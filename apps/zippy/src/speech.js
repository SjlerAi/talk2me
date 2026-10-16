'use strict';
// Fix transcription punctuation, courtesy words and missing Afrikaans grammar
// before sending a signed CRM preview. This never performs or authorises work.
// All people are still resolved by the live CRM, not by a local name list.
const COURTESY_END=/(?:[\s,;.!?]+)(?:asseblief|asb|please)(?:[\s,;.!?]*)$/iu;
const COURTESY_START=/^(?:asseblief|asb|please)\s+/iu;
function stripCourtesy(input){
 let result=String(input||'').trim().replace(/[.!?]+\s*$/u,'').trim();
 result=result.replace(COURTESY_START,'').replace(COURTESY_END,'').trim();
 return result.replace(/[.!?]+\s*$/u,'').trim();
}
function normalizeOfficeSpeech(raw){
 const original=String(raw||'').trim().slice(0,2500);
 if(!original)return original;
 let s=stripCourtesy(original)
  .replace(/^(?:hey|hi|hello|hallo)\s+zippy[\s,:-]*/iu,'')
  .replace(/^(?:zippy|cudo)[\s,:-]+/iu,'')
  .trim();
 s=stripCourtesy(s);
 // Afrikaans speech recognition sometimes produces "ask vraag Gerda ..."
 // (English wake phrase + Afrikaans command). Keep the natural task free-form.
 s=s.replace(/^(?:(?:ask|vra|vraag)\s+){2,}/iu,'Vra ');
 // "vra Gerda my bel" is colloquial for "vra Gerda om my te bel".
 // Limit reconstruction to this *instruction shape*, not to a fixed task type.
 // Other tasks are passed through as actually spoken, after courtesy cleanup.
 const speaking=s.match(/^(?:vra|vraag|ask|s[eê]|se)\s+(?:vir\s+)?(.+?)\s+(?:(?:om)\s+)?(my|haar|hom|ons|jou|hulle)\s+(?:te\s+)?(bel|skakel|kontak)\s*$/iu);
 if(speaking){
  const who=speaking[1].trim(),target=speaking[2],verb=speaking[3];
  if(who&&who.split(/\s+/u).length<=5)return 'Vra '+who+' om '+target+' te '+verb;
 }
 const subjectLast=s.match(/^(?:vra|vraag|ask|s[eê]|se)\s+(?:vir\s+)?(.+?)\s+(bel|skakel|kontak)\s+(my|haar|hom|ons|jou|hulle)\s*$/iu);
 if(subjectLast){
  const who=subjectLast[1].trim();
  if(who&&who.split(/\s+/u).length<=5)return 'Vra '+who+' om '+subjectLast[3]+' te '+subjectLast[2];
 }
 return s;
}
module.exports={stripCourtesy,normalizeOfficeSpeech};
