'use strict';
// TK2M staging-only proposal calculator. NO changes to CRM operational data.
const crypto=require('node:crypto');
const db=require('../config/db');
const {canManage,normPhone,hash}=require('./tk2m-review-cases');
const FIELDS=Object.freeze([
 {key:'client_name',label:'Customer display name'},
 {key:'first_name',label:'First name'},
 {key:'surname',label:'Surname'},
 {key:'company_name',label:'Company name'},
 {key:'birthday',label:'Birthday'},
 {key:'email',label:'Email address'},
 {key:'id_number',label:'Identity number'},
 {key:'cell_number',label:'Contact cellphone'},
 {key:'alt_number',label:'Alternative phone'},
 {key:'city_town',label:'City / town'},
 {key:'main_contact_name',label:'Business main contact'},
 {key:'main_contact_number',label:'Business contact number'},
 {key:'notes',label:'Customer notes'}
]);
// A customer can have many contract lines. Never silently truncate the line list.
const MAX_CANDIDATES=40,MAX_SELECTED=12,MAX_LINKED_LINES=500;
const fieldLabel=key=>FIELDS.find(x=>x.key===key)?.label||String(key);
const formatted=x=>x==null?'':x instanceof Date?x.toISOString().slice(0,10):String(x);
const populated=x=>formatted(x).trim()!=='';
const validId=x=>{const v=Number(x);return Number.isSafeInteger(v)&&v>0?v:null;};
const parseIds=value=>{
 const arr=Array.isArray(value)?value:[value];
 if(arr.length>MAX_SELECTED)throw Error('Choose no more than 12 records in one proposal.');
 const ids=arr.map(validId);
 if(ids.some(x=>x===null)||new Set(ids).size!==ids.length)
  throw Error('Choose two or more different valid customer records.');
 return ids;
};
const stamp=x=>x instanceof Date?x.toISOString():x==null?'':String(x);
const CASE_TYPES=new Set(['duplicate_phone','identity','migration']);
function signature(candidates,lines,caseHash){
 const rows=candidates.slice().sort((a,b)=>a.id-b.id).map(r=>[
  r.id,r.account_id,r.account_number,r.is_active,r.client_name,r.first_name,r.surname,
  r.company_name,r.birthday,r.email,r.id_number,r.cell_number,r.cell_number_normalised,
  r.alt_number,r.city_town,r.main_contact_name,r.main_contact_number,r.notes,
  r.package_name,r.line_status,r.previous_upgrade_date,r.next_upgrade_date,
  r.upgrade_date,r.assigned_staff_id,r.assignment_count,r.updated_at
 ].map(stamp));
 const links=lines.slice().sort((a,b)=>a.id-b.id).map(r=>[
  r.id,r.client_id,r.account_id,r.msisdn_normalised,r.last_upgrade_date,
  r.eligible_upgrade_date,r.contract_status,r.updated_at
 ].map(stamp));
 return hash(JSON.stringify([caseHash,rows,links]));
}
async function candidatesForCase(item,user,conn=db){
 if(!CASE_TYPES.has(item?.kind))return null;
 const seedIds=[...new Set(item.members.map(c=>validId(c.id)).filter(Boolean))];
 if(!seedIds.length)return null;
 const phones=[...new Set(item.members.map(x=>normPhone(x.cell_number_normalised||x.cell_number)).filter(Boolean))];
 if(item.details?.phone&&normPhone(item.details.phone))phones.push(normPhone(item.details.phone));
 const accounts=[...new Set(item.members.map(x=>validId(x.account_id)).filter(Boolean))];
 const accountNumbers=[...new Set(item.members.map(x=>String(x.account_number||'').trim()).filter(Boolean))];
 const manager=canManage(user);
 const clause=manager?'c.id IN (?) OR c.cell_number_normalised IN (?) OR c.account_id IN (?) OR c.account_number IN (?)':'c.id IN (?)';
 const args=manager?[seedIds,phones.length?phones:['__not_a_phone__'],accounts.length?accounts:[0],
  accountNumbers.length?accountNumbers:['__not_an_account__']]:[seedIds];
 const sql=[
  'SELECT c.id,c.account_id,c.account_number,c.first_name,c.surname,c.company_name,',
  'c.client_name,c.cell_number,c.cell_number_normalised,c.alt_number,c.email,',
  'c.city_town,c.id_number,c.customer_type,c.birthday,c.main_contact_name,',
  'c.main_contact_number,c.notes,c.package_name,c.line_status,c.previous_upgrade_date,',
  'c.next_upgrade_date,c.upgrade_date,c.is_active,c.updated_at,',
  'a.assigned_staff_id,a.assignment_count,s.full_name assigned_staff_name ',
  'FROM clients c LEFT JOIN ',
  '(SELECT client_id,MIN(assigned_staff_id) assigned_staff_id,COUNT(DISTINCT assigned_staff_id) assignment_count ',
  'FROM client_assignments WHERE is_active=1 GROUP BY client_id) a ON a.client_id=c.id ',
  'LEFT JOIN staff_users s ON s.id=a.assigned_staff_id ',
  'WHERE (',clause,') ORDER BY c.id LIMIT ?'
 ].join('');
 const [found]=await conn.query(sql,[...args,MAX_CANDIDATES+1]);
 if(found.length>MAX_CANDIDATES)
  throw Error('More than 40 related records. Ask management to split this review.');
 let candidates=[...new Map(found.map(r=>[validId(r.id),r])).values()];
 if(!manager)candidates=candidates.filter(r=>
  Number(r.assigned_staff_id)===Number(user.id)&&Number(r.assignment_count)===1);
 if(!manager&&seedIds.some(id=>!candidates.some(r=>r.id===id)))return null;
 if(candidates.length<2)return null;
 // First collect every line explicitly linked to the reviewable customer records.
 // Management also sees UNASSIGNED lines on matching customer account IDs;
 // these are flagged as requiring confirmation and are NEVER automatically
 // assumed to belong to the customer being merged. Staff see linked lines only.
 const candidateIds=candidates.map(x=>x.id);
 const accountIds=manager?[...new Set(candidates.map(x=>validId(x.account_id)).filter(Boolean))]:[];
 const includeUnassigned=accountIds.length>0;
 const scope=includeUnassigned
  ? 'client_id IN (?) OR (account_id IN (?) AND (client_id IS NULL OR client_id=0))'
  : 'client_id IN (?)';
 const lineArgs=includeUnassigned
  ? [candidateIds,accountIds,MAX_LINKED_LINES+1]
  : [candidateIds,MAX_LINKED_LINES+1];
 const [foundLines]=await conn.query(
  'SELECT id,client_id,account_id,msisdn_normalised,last_upgrade_date,eligible_upgrade_date,'+
  'contract_status,updated_at FROM mobile_base_current WHERE ('+scope+') ORDER BY id LIMIT ?',
  lineArgs);
 if(foundLines.length>MAX_LINKED_LINES)
  throw Error('More than 500 associated mobile-line records. Full line inventory could not be verified. Ask management to review the account before approving any combination.');
 const available=new Set(candidateIds.map(Number));
 const lines=foundLines.map(line=>({
  ...line,relation:available.has(Number(line.client_id))?'linked_customer':'unassigned_account'
 }));
 return {
  candidates,lines,sourceHash:signature(candidates,lines,item.fingerprint),
  fields:FIELDS.filter(f=>candidates.some(r=>populated(r[f.key]))),
  linkedCaseId:item.id,caseKind:item.kind
 };
}
function makePlan(data,request){
 if(!data)throw Error('This case has fewer than two reviewable records.');
 const ids=parseIds(request.selected);
 if(ids.length<2)throw Error('Select at least two records to combine.');
 const selected=new Set(ids);
 const byId=new Map(data.candidates.map(r=>[r.id,r]));
 if(ids.some(id=>!byId.has(id)))throw Error('Selected record is not available to your account.');
 const primary=validId(request.primary);
 if(!selected.has(primary))throw Error('Choose a primary record from the selected set.');
 const donors=request.donor||{};
 if(!donors||typeof donors!=='object'||Array.isArray(donors))
  throw Error('Choose a record for each customer field.');
 const chosen=ids.map(id=>byId.get(id)),master=byId.get(primary);
 const fields=[];
 for(const f of data.fields){
  const from=validId(donors[f.key]);
  if(!from||!selected.has(from))throw Error('Choose a selected source for '+f.label+'.');
  const donor=byId.get(from);
  if(!populated(donor[f.key])&&chosen.some(r=>populated(r[f.key])))
   throw Error('Do not replace '+f.label+' with a blank value.');
  fields.push({key:f.key,label:f.label,fromId:from,toId:primary,
   value:formatted(donor[f.key]),primaryValue:formatted(master[f.key]),
   changed:formatted(donor[f.key])!==formatted(master[f.key])});
 }
 const links=data.lines.filter(r=>selected.has(Number(r.client_id))).map(r=>({
  id:r.id,clientId:r.client_id,number:r.msisdn_normalised,accountId:r.account_id,
  lastUpgrade:formatted(r.last_upgrade_date),nextEligible:formatted(r.eligible_upgrade_date),
  contractStatus:r.contract_status
 }));
 // "Contact cellphone" is a profile field. It is NEVER an instruction to
 // delete or deduplicate other mobile lines associated with the customer.
 // Keep separate customer-record contract dates even when a mobile-base line
 // duplicates the contact number. Do not collapse line data based on MSISDN.
 const recordLine=person=>({
  clientId:person.id,contactNumber:person.cell_number_normalised||person.cell_number||'',
  accountId:person.account_id,accountNumber:person.account_number,
  packageName:person.package_name,lineStatus:person.line_status,
  previousUpgrade:formatted(person.previous_upgrade_date),
  nextUpgrade:formatted(person.next_upgrade_date),
  upgradeDate:formatted(person.upgrade_date)
 });
 const selectedContractRecords=chosen.map(recordLine);
 const excludedContractRecords=data.candidates.filter(r=>!selected.has(r.id)).map(recordLine);
 const unassignedAccountLines=data.lines.filter(r=>!r.client_id||Number(r.client_id)===0).map(r=>({
  id:r.id,accountId:r.account_id,number:r.msisdn_normalised,
  lastUpgrade:formatted(r.last_upgrade_date),nextEligible:formatted(r.eligible_upgrade_date),
  contractStatus:r.contract_status,requiresManualLinkVerification:true
 }));
 return {
  caseId:data.linkedCaseId,kind:data.caseKind,sourceHash:data.sourceHash,
  primaryId:primary,selectedIds:ids,
  excludedIds:data.candidates.map(r=>r.id).filter(id=>!selected.has(id)),
  fields,linkedLines:links,selectedContractRecords,excludedContractRecords,
  unassignedAccountLines,
  lineDataPolicy:'preserve_every_valid_line_and_each_individual_upgrade_date',
  lineRecordsCaptured:links.length,accountOnlyLinesRequiringReview:unassignedAccountLines.length,
  reviewOnly:true,actualMergeExecuted:false,
  preservedContractFields:['account_id','account_number','package_name','line_status','previous_upgrade_date','next_upgrade_date','upgrade_date'],
  preservedLineFields:['last_upgrade_date','eligible_upgrade_date','contract_status']
 };
}
function signatureForPlan(plan){
 return hash(JSON.stringify([plan.caseId,plan.sourceHash,plan.primaryId,plan.selectedIds,
  plan.fields.map(f=>[f.key,f.fromId,f.value])]));
}
const previewSeal=(plan,key)=>crypto.createHmac('sha256',String(key)).update(signatureForPlan(plan)).digest('hex');
const compareSeal=(a,b)=>/^[a-f0-9]{64}$/.test(String(b||''))&&
 crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const statusOf=(proposal,sourceHash)=>proposal.source_hash===sourceHash?proposal.status:'stale';
async function existingPlans(caseId,conn=db){
 const [rows]=await conn.query('SELECT id,case_id,status,source_hash,plan_json,note,proposed_by,'+
  'approved_by,revision,proposed_at,approved_at FROM tk2m_merge_proposals '+
  'WHERE case_id=? ORDER BY id DESC LIMIT 35',[caseId]);
 return rows.map(row=>{
  let plan={};try{plan=JSON.parse(row.plan_json||'{}');}catch(_){}
  return {...row,plan};
 });
}
module.exports={FIELDS,CASE_TYPES,MAX_SELECTED,MAX_LINKED_LINES,makePlan,candidatesForCase,
 previewSeal,compareSeal,statusOf,existingPlans,canManage,formatted,validId,parseIds,
 signature,signatureForPlan,hash,fieldLabel};
