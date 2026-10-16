'use strict';
// Parse the shape of a spoken instruction; NEVER choose its task from a preset list.
function normal(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function phonetic(value){return normal(value).replace(/ph/g,'f').replace(/ck/g,'k').replace(/y/g,'i');}
function taskWords(message){
 const raw=String(message||'').trim().replace(/^cudo[\s,:-]*/i,'').replace(/^(please|asseblief)\s+/i,'');
 const lookup=raw.match(/^(?:find(?:\s+me)?|search(?:\s+for)?|look up|locate|soek(?:\s+vir)?|wys\s+(?:vir\s+)?my|show\s+me)\s+(.+)$/i);
 if(lookup){
  const name=lookup[1].replace(/\s+(?:on|in)\s+(?:the\s+)?(?:crm|database)\.?$/i,'')
   .replace(/^(?:(?:the|die|person|persoon|staff|customer|client|klient|kliënt)\s+)+/i,'').trim();
  const topic=normal(name);
  // Broad CRM reports keep their existing analytics paths; only named people go here.
  if(!name||/\b(?:tasks?|work|overdue|outstanding|upgrades?|deals?|reports?|unallocated|followups?|queries|activities|everyone|everybody|all|how|who|what|clients?|customers?|today|yesterday|weeks?|months?)\b/.test(topic))
   return {kind:'none'};
  return {kind:'lookup',name};
 }
 const patterns=[
  /^(?:send|stuur)\s+(?:(?:a|an|the|die|n|'n)\s+)?(?:message|boodskap|whatsapp|e-?mail|epos)\s+(?:to|for|aan|vir)\s+(.+?)\s+(?:to|om|that|wat|sodat)\s+(.+)$/i,
  /^(?:ask|tell|instruct|vra|laat|sê|se)\s+(?:vir\s+)?(.+?)\s+(?:to|om|that|wat|must|moet|should)\s+(.+)$/i,
  /^(?:give|gee)\s+(?:vir\s+)?(.+?)\s+(?:(?:a|an|the|die|n|'n|new|nuwe)\s+)?(?:task|taak|opdrag)\s+(?:to|om)\s+(.+)$/i,
  /^(.+?)\s+(?:must|moet|should|needs?\s+to|has\s+to)\s+(.+)$/i
 ];
 for(const re of patterns){
  const m=raw.match(re);
  if(m)return {kind:'instruction',assignee:m[1].trim(),instruction:m[2].trim(),raw,
   channel:/\bwhats\s*app\b/i.test(raw)?'whatsapp':/\b(?:e-?mail|epos)\b/i.test(raw)?'email':'internal'};
 }
 return {kind:'none'};
}
function staffNames(row){
 const all=[row.full_name,row.first_name,row.username,String(row.email||'').split('@')[0]];
 if(row.full_name){const parts=String(row.full_name).split(/\s+/).filter(Boolean);all.push(parts[0],parts[parts.length-1]);}
 return [...new Set(all.filter(Boolean).map(normal))];
}
function staffMatches(name,rows){
 const wanted=normal(name);
 if(wanted.length<3)return [];
 return rows.map(row=>{
   const aliases=staffNames(row),exact=aliases.includes(wanted);
   const phoneticMatch=!exact&&wanted.length>=4&&aliases.some(a=>phonetic(a)===phonetic(wanted));
   return {id:Number(row.id),name:row.full_name||row.first_name||row.username,
     shortName:String(row.first_name||row.full_name||row.username||'').split(/\s+/)[0],
     kind:'staff',phone:row.contact_number||null,score:exact?100:phoneticMatch?88:0};
 }).filter(m=>m.score).sort((a,b)=>b.score-a.score);
}
// Spoken pronouns are references, not CRM names. The planner resolves "me"
// against the authenticated staff ID, never by searching for a client named "me".
const SELF_WORDS=new Set(['me','myself','my','ek']);
const OTHER_WORDS=new Set(['her','him','she','he','haar','hom','sy','hy','them','they','hulle','us','ons','you','yourself']);
function pronounKind(value){
 const word=normal(value);
 if(SELF_WORDS.has(word))return 'self';
 if(OTHER_WORDS.has(word))return 'unresolved';
 return null;
}
function referencedName(text){
 const raw=String(text||'');
 const honor=raw.match(/\b(?:mr|mnr|mrs|ms|mev|mevrou)\.?\s+([\p{L}'-]+)/iu);
 if(honor)return honor[1];
 const prefix=raw.match(/\b(?:phone|call|contact|visit|meet|bel|skakel|kontak|besoek|with|met|vir|about|oor)\s+([\p{L}'-]+)/iu);
 if(prefix&&!['the','die','a','n','client','customer','klient','kliente','staff','someone','anyone'].includes(normal(prefix[1])))return prefix[1];
 const af=raw.match(/^([\p{L}'-]+)\s+(?:te\s+)?(?:bel|skakel|kontak)\b/iu);
 return af?af[1]:null;
}
function rankPeople(name,staff,clients){
 const a=normal(name);
 return [...staffMatches(name,staff),...clients.map(c=>({
  id:Number(c.id),name:String(c.client_name||''),shortName:String(c.client_name||''),
  kind:'client',phone:c.cell_number||null,accountNumber:c.account_number||null,score:normal(c.client_name)===a||normal(c.client_name).split(/\s+/).includes(a)?100:0
 })).filter(c=>c.score)].sort((x,y)=>y.score-x.score||x.name.localeCompare(y.name));
}
function pickMatch(candidates){
 if(!candidates.length)return {error:'not_found'};
 const best=candidates[0].score;
 const ties=candidates.filter(x=>x.score===best||x.score>=88&&best>=88);
 if(ties.length>1)return {error:'ambiguous',choices:ties.slice(0,8)};
 return {person:candidates[0],near:best<100};
}
module.exports={normal,taskWords,staffMatches,referencedName,pronounKind,rankPeople,pickMatch};
