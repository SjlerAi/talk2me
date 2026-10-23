'use strict';

// Presentation-only duplicate grouping. Never archives, deletes, reassigns or selects a
// "current" customer line. Every original record and source history remains visible.
const crypto = require('crypto');

const normaliseName = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
function normalisePhone(value) {
  let x=String(value||'').replace(/\D/g,'');
  if (/^0[6-8]\d{8}$/.test(x)) x='27'+x.slice(1);
  return /^27[6-8]\d{8}$/.test(x)?x:'';
}
function normaliseEmail(value) {
  const x=String(value||'').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(x)) return '';
  if (['noemail','noreply','@example.','notavailable','unknown@'].some(part=>x.includes(part))) return '';
  return x;
}
function validSaId(value) {
  const x=String(value||'').replace(/\D/g,'');
  if (!/^\d{13}$/.test(x) || Number(x.slice(2,4))<1 || Number(x.slice(2,4))>12 ||
    Number(x.slice(4,6))<1 || Number(x.slice(4,6))>31) return '';
  let sum=0;
  [...x].reverse().forEach((char,i)=>{
    const n=Number(char)*(i%2?2:1);
    sum+=Math.floor(n/10)+n%10;
  });
  return sum%10===0?x:'';
}
const nonemptyDistinct = (rows,project) =>
  [...new Set(rows.map(project).filter(Boolean))];
function groupingEvidence(rows) {
  const active=rows.length>1 && rows.every(r=>Number(r.is_active)===1);
  const accounts=nonemptyDistinct(rows,r=>Number(r.account_id)||null);
  const phones=nonemptyDistinct(rows,r=>normalisePhone(r.cell_number_normalised||r.cell_number));
  const names=nonemptyDistinct(rows,r=>normaliseName(r.client_name));
  const ids=nonemptyDistinct(rows,r=>validSaId(r.id_number));
  const emails=nonemptyDistinct(rows,r=>normaliseEmail(r.email));
  const staff=nonemptyDistinct(rows,r=>Number(r.account_staff_id)||null);
  rows.forEach(r=>(r._allocations||[]).filter(a=>Number(a.is_active)===1).forEach(a=>{
    const id=Number(a.assigned_staff_id);
    if (id && !staff.includes(id)) staff.push(id);
  }));
  const reasons=[];
  if(!active) reasons.push('record_archived_or_missing');
  if(accounts.length!==1 || rows.some(r=>!Number(r.account_id))) reasons.push('account_not_unique');
  if(phones.length!==1 || rows.some(r=>!normalisePhone(r.cell_number_normalised||r.cell_number))) reasons.push('cellphone_not_unique');
  if(names.length!==1 || rows.some(r=>!normaliseName(r.client_name))) reasons.push('customer_name_conflict');
  if(ids.length>1) reasons.push('id_number_conflict');
  if(emails.length>1) reasons.push('email_conflict');
  if(staff.length>1) reasons.push('staff_owner_conflict');
  return {safe:reasons.length===0,reasons,accountId:accounts[0]||null,phone:phones[0]||null};
}
function rowFingerprint(rows) {
  const values=rows.slice().sort((a,b)=>Number(a.id)-Number(b.id)).map(r=>({
    id:Number(r.id),account_id:Number(r.account_id)||null,client_name:String(r.client_name||''),
    phone:String(r.cell_number_normalised||r.cell_number||''),email:String(r.email||''),
    id_number:String(r.id_number||''),is_active:Number(r.is_active),
    package_name:String(r.package_name||''),next_upgrade_date:String(r.next_upgrade_date||''),
    previous_upgrade_date:String(r.previous_upgrade_date||''),upgrade_date:String(r.upgrade_date||''),
    updated_at:String(r.updated_at||''),
    allocations:(r._allocations||[]).map(a=>[a.id,a.assigned_staff_id,a.is_active]).sort((a,b)=>Number(a[0])-Number(b[0]))
  }));
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
function reviewRevision(item) {
  return crypto.createHash('sha256').update(JSON.stringify({
    id:item.id,status:item.status,source_hash:item.source_hash,
    reviewed_at:item.reviewed_at||null,updated_at:item.updated_at||null
  })).digest('hex');
}
function decodeIds(value) {
  let ids;
  try{ids=JSON.parse(value);}catch(_){return [];}
  if(!Array.isArray(ids)||ids.length>80)return [];
  const clean=ids.map(Number);
  return clean.every(x=>Number.isSafeInteger(x)&&x>0) && new Set(clean).size===clean.length?clean:[];
}
function decodeReasons(value) {
  try{const v=JSON.parse(value);return Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,12):[];}
  catch(_){return [];}
}
function prettyReason(value) {
  const dict={
    conflicting_customer_names:'Different customer names',
    same_phone_multiple_accounts:'Same cellphone on different accounts',
    missing_account_link:'Missing account link',
    email_or_id_only_ambiguous:'Shared ID or email needs confirmation',
    account_link_issue:'Account mismatch',
    staff_assignment_conflict:'Different assigned staff',
    different_sa_id:'Different SA ID',
    different_email:'Different email',
    unclassified:'Unclassified identity conflict'
  };
  return dict[value]||String(value||'').replace(/_/g,' ');
}
module.exports={normaliseName,normalisePhone,normaliseEmail,validSaId,groupingEvidence,
  rowFingerprint,reviewRevision,decodeIds,decodeReasons,prettyReason};
