'use strict';
const {detectLanguage}=require('./language');
function recognise(message,now=new Date()){
 const original=String(message||'').normalize('NFKC').toLowerCase().replace(/^(?:hey|hello|hallo)?\s*zippy[,:\s-]*/,'').trim();
 if(!original)return null;
 if(/^(?:remind|herinner|onthou|remember|please\s+remind|herinner\s+my)/.test(original))return null;
 let intent=null;
 if(/\b(?:birthdays?|birthday|verjaar|verjaarsdag|verjaarsdae|verjaarsdae)\b/u.test(original))intent='birthdays';
 else if(/\b(?:attendance|staff|personeel|werknemers|ingelog|logged in|at work|clocked in|aanwesig|by die werk)\b/u.test(original)&&/\b(?:work|attendance|personeel|werknemers|ingelog|logged|at work|today|vandag|all|almal|aanwesig)\b/u.test(original))intent='attendance';
 else if(/\b(?:upgrades?|opgraderings?|upgradable)\b/u.test(original))intent='upgrades';
 if(!intent)return null;
 const months={jan:1,feb:2,mar:3,apr:4,may:5,mei:5,jun:6,jul:7,aug:8,sep:9,oct:10,okt:10,nov:11,dec:12,des:12};
 const monthMatch=original.match(/\b(jan(?:uary|uarie)?|feb(?:ruary|ruarie)?|mar(?:ch|t)?|apr(?:il)?|may|mei|jun(?:e|ie)?|jul(?:y|ie)?|aug(?:ust|ustus)?|sep(?:tember)?|oct(?:ober)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?|des(?:ember)?)\s*(20\d{2})?\b/u);
 const year=monthMatch?.[2]?Number(monthMatch[2]):Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Johannesburg',year:'numeric'}).format(now));
 const month=monthMatch?String(year)+'-'+String(months[monthMatch[1].slice(0,3)]||months[monthMatch[1].slice(0,3).toLowerCase()]||1).padStart(2,'0'):undefined;
 const staffMatch=original.match(/(?:johnny|johanna|brabet|brabant|annelies|stefan|gerda)\b/u);
 return {intent,language:detectLanguage(original),month,staff:staffMatch?.[0]||null};
}
module.exports={recognise};
