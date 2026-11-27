'use strict';
const MONTHS=Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December']);
function monthLabel(value){
 const m=String(value||'').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
 return m?MONTHS[Number(m[2])-1]+' '+m[1]:'Period not recognised';
}
function accountHolderFromText(text){
 const m=String(text||'').match(/^\s*Account\s+Holder\s*:\s*([^\r\n]{2,140})/im);
 if(!m)return null;
 const name=m[1].replace(/[\x00-\x1f<>]/g,'').replace(/\s+/g,' ').trim();
 if(name.length<2||name.length>140||/^\d+$/.test(name))return null;
 return name;
}
function displayName(value){
 const name=String(value||'').trim();
 if(!name)return null;
 return name===name.toLowerCase()?name.replace(/\b[a-z]/g,ch=>ch.toUpperCase()):name;
}
function customerName(crm,sourceName){
 const confirmed=crm?.status==='linked'&&crm.account?.display_name;
 if(confirmed)return displayName(confirmed);
 return displayName(sourceName)||'Customer name awaiting confirmation';
}
function defaultEmail({customer,account,previousMonth,currentMonth,netChangeCents,rand}){
 const prior=monthLabel(previousMonth),current=monthLabel(currentMonth);
 const positive=Number(netChangeCents)>0;
 const negative=Number(netChangeCents)<0;
 const amount='R'+rand(Math.abs(Number(netChangeCents)||0));
 const movement=positive?'increased by '+amount:negative?'decreased by '+amount:'remained unchanged';
 const subject='Your account review: '+current+' compared with '+prior+' — '+account;
 const body='Dear Customer,\n\n'+
  'We have reviewed the monthly charges for your '+customer+' account ('+account+').\n\n'+
  'Your invoice charges for '+current+' '+movement+' compared with '+prior+'.\n\n'+
  'Please see the attached account review for the largest billing differences and any explanations that have been confirmed. Credit notes and payments are shown separately; this comparison does not independently establish the amount outstanding.\n\n'+
  'If you would like us to check a specific line or service, please reply to this email and we will assist.\n\n'+
  'Kind regards,\nGerda\nTalk2Me Customer Support';
 return {subject,body};
}
module.exports={monthLabel,accountHolderFromText,displayName,customerName,defaultEmail};
