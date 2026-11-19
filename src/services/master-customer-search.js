'use strict';
// One-result-per-service search from the active master register.
// CRM/Vodacom/fixed tables are joined for current display details only.
// Staff visibility is calculated in two small batched queries, not a costly
// correlated subquery for every candidate line.
const db=require('../config/db');
const ADMIN=new Set(['owner','manager','admin']);
const clean=v=>String(v??'').trim().slice(0,100);
function normalPhone(v){
 let s=String(v||'').replace(/\D/g,'');
 if(s.length===11&&s.startsWith('27'))s='0'+s.slice(2);
 if(s.length===9&&/^[678]/.test(s))s='0'+s;
 return /^0\d{9}$/.test(s)?s:null;
}
async function visibleToStaff(rows,userId){
 if(!rows.length||!Number.isSafeInteger(userId)||userId<1)return [];
 const activeRun=Number(rows[0].run_id);
 const candidates=rows.filter(r=>r.master_customer_key&&r.link_state!=='needs_conflict_review'&&
  (r.crm_client_id||r.mobile_base_id||r.fixed_service_id));
 if(!candidates.length)return [];
 const keys=[...new Set(candidates.map(x=>x.service_key))];
 const accounts=[...new Set(candidates.map(x=>x.official_account).filter(Boolean))];
 const [clientOwners]=await db.query(
  'SELECT src.service_key,ca.assigned_staff_id FROM crm_master_service_sources src '+
  "JOIN client_assignments ca ON ca.client_id=CAST(src.source_id AS UNSIGNED) AND ca.is_active=1 "+
  "WHERE src.run_id=? AND src.source_type='client' AND src.service_key IN (?)",
  [activeRun,keys]);
 const [accountOwners]=accounts.length?
  await db.query('SELECT account_number,assigned_staff_id FROM client_assignments WHERE is_active=1 AND account_number IN (?)',
   [accounts]):[[]];
 const byLine=new Map(),byAccount=new Map();
 for(const a of clientOwners){
  if(!byLine.has(a.service_key))byLine.set(a.service_key,new Set());
  byLine.get(a.service_key).add(Number(a.assigned_staff_id));
 }
 for(const a of accountOwners){
  if(!byAccount.has(a.account_number))byAccount.set(a.account_number,new Set());
  byAccount.get(a.account_number).add(Number(a.assigned_staff_id));
 }
 return candidates.filter(r=>{
  const fixedOwner=Number(r.fixed_assigned_staff_id||0);
  const accountOwner=Number(r.crm_account_staff_id||0);
  if(fixedOwner&&fixedOwner!==userId)return false;
  if(accountOwner&&accountOwner!==userId)return false;
  if(accountOwner===userId||fixedOwner===userId)return true;
  const owners=new Set([...(byLine.get(r.service_key)||[]),
    ...(byAccount.get(r.official_account)||[])]);
  return !owners.size||owners.has(userId);
 });
}
// Query the same master-aware client view used by Customer Administration.
// A CRM line can exist without an active service link: never equate those cases
// with a non-existent customer. This lookup does not create or merge records.
async function searchCrmLines({q,canon,userId,management,basePath}){
 const params={like:'%'+q+'%',starts:q+'%',exact:q,phoneSuffix:canon?'%'+canon.slice(1)+'%':null};
 const access=management?'1=1':`
   COALESCE(c.master_link_state,'')<>'needs_conflict_review'
   AND NOT EXISTS (
     SELECT 1 FROM client_assignments denied
     WHERE denied.is_active=1 AND denied.assigned_staff_id<>:staffId
       AND (denied.client_id=c.id OR
         (c.account_number IS NOT NULL AND c.account_number<>''
          AND denied.account_number=c.account_number))
   )
   AND NOT EXISTS (
     SELECT 1 FROM customer_accounts accountOwner
     WHERE c.account_number IS NOT NULL AND c.account_number<>''
       AND accountOwner.account_number_normalised=UPPER(REPLACE(TRIM(c.account_number),' ',''))
       AND accountOwner.assigned_staff_id IS NOT NULL
       AND accountOwner.assigned_staff_id<>:staffId
   )`;
 if(!management)params.staffId=userId;
 const [clients]=await db.execute(`
   SELECT c.id,c.client_name,c.cell_number,c.email,c.account_number,
     c.handset,c.package_name,c.master_customer_key,c.master_service_key,c.master_link_state
   FROM crm_v_master_clients c
   WHERE c.is_active=1
     AND (c.client_name LIKE :like OR c.cell_number LIKE :like
       OR c.email LIKE :like OR c.account_number LIKE :like OR c.id_number LIKE :like
       OR (:phoneSuffix IS NOT NULL AND c.cell_number LIKE :phoneSuffix))
     AND (${access})
   ORDER BY CASE WHEN c.client_name=:exact THEN 0
                 WHEN :phoneSuffix IS NOT NULL AND c.cell_number LIKE :phoneSuffix THEN 1
                 WHEN c.client_name LIKE :starts THEN 2 ELSE 3 END,
            c.client_name,c.id LIMIT 40`,params);
 // A view or later schema revision must never duplicate one physical line.
 const seen=new Set();
 return clients.filter(c=>{
  const id=Number(c.id);
  if(!Number.isSafeInteger(id)||seen.has(id))return false;
  seen.add(id);return true;
 }).map(c=>({
  id:c.id,linked_crm_client_id:c.id,record_type:'crm',service_type:'mobile',
  service_key:c.master_service_key||'crm:'+c.id,
  verification_status:c.master_link_state==='needs_conflict_review'
    ?'needs_conflict_review':c.master_service_key
      ?(c.master_link_state||'crm_master_linked'):'crm_unmapped',
  master_customer_key:c.master_customer_key||null,
  account_number:c.account_number||null,client_name:c.client_name,
  cell_number:c.cell_number||null,email:c.email||null,
  handset:c.handset||null,package_name:c.package_name||null,
  url:basePath+'/customers/'+c.id+'/360'
 }));
}

async function searchMaster({query,user,basePath='/talk2me'}){
 const q=clean(query);if(q.length<2)return [];
 const management=ADMIN.has(String(user?.role||'').toLowerCase());
 const userId=Number(user?.id);
 if(!management&&(!Number.isSafeInteger(userId)||userId<1))return [];
 const canon=normalPhone(q),like='%'+q+'%';
 const sql=[
  "SELECT s.run_id,s.service_key,s.phone,s.service_type,s.master_customer_key,",
  "s.link_state,s.crm_client_id,s.mobile_base_id,s.fixed_service_id,s.display_name master_line_name,",
  "m.account_number official_account,m.display_name master_customer_name,",
  "acct.assigned_staff_id crm_account_staff_id,",
  "c.client_name crm_name,c.account_number crm_account,c.cell_number crm_phone,",
  "c.email crm_email,c.handset crm_handset,c.package_name crm_package,",
  "b.msisdn_original base_phone,b.account_code base_account,b.account_name base_name,",
  "b.email_address base_email,b.tariff_name base_tariff,b.price_plan base_price_plan,",
  "b.device_manufacturer,b.device_name,fa.id fixed_account_id,",
  "fa.account_number fixed_account,fa.customer_name fixed_name,",
  "fa.contact_number fixed_contact,fa.email fixed_email,fa.assigned_staff_id fixed_assigned_staff_id,",
  "fs.router_model,fs.package_name fixed_package,fs.branch_name,fs.solution_id",
  "FROM crm_master_active active",
  "JOIN crm_master_runs run ON run.id=active.run_id AND run.state='ready'",
  "JOIN crm_master_services s ON s.run_id=active.run_id",
  "LEFT JOIN crm_master_customers m ON m.run_id=s.run_id AND m.customer_key=s.master_customer_key",
  "LEFT JOIN customer_accounts acct ON acct.id=m.crm_account_id",
  "LEFT JOIN clients c ON c.id=s.crm_client_id",
  "LEFT JOIN mobile_base_current b ON b.id=s.mobile_base_id",
  "LEFT JOIN fixed_services fs ON fs.id=s.fixed_service_id",
  "LEFT JOIN fixed_accounts fa ON fa.id=fs.fixed_account_id",
  "WHERE active.singleton=1 AND (",
  "(:phone IS NOT NULL AND s.phone=:phone)",
  "OR s.phone LIKE :like OR s.display_name LIKE :like",
  "OR m.display_name LIKE :like OR m.account_number LIKE :like",
  "OR c.client_name LIKE :like OR c.email LIKE :like OR c.id_number LIKE :like",
  "OR b.account_name LIKE :like OR b.account_code LIKE :like",
  "OR b.email_address LIKE :like OR b.icc_id LIKE :like OR b.imsi LIKE :like",
  "OR fa.customer_name LIKE :like OR fa.account_number LIKE :like",
  "OR fs.branch_name LIKE :like OR fs.solution_id LIKE :like",
  ")",
  "ORDER BY CASE WHEN :phone IS NOT NULL AND s.phone=:phone THEN 0 ELSE 1 END,",
  "CASE s.link_state WHEN 'verified_crm_supplier_link' THEN 0",
  "WHEN 'crm_customer_linked' THEN 1 WHEN 'account_only_no_customer' THEN 2 ELSE 3 END,",
  "COALESCE(m.display_name,s.display_name),s.phone",
  "LIMIT "+(management?20:140)
 ].join(' ');
 const [found]=await db.execute(sql,{phone:canon,like});
 const rows=management?found:await visibleToStaff(found,userId);
 const crmLines=await searchCrmLines({q,canon,userId,management,basePath});
 const masterResults=rows.slice(0,20).map(r=>{
  const fixed=r.service_type==='fixed';
  const relatedType=fixed?'fixed':r.crm_client_id?'mobile':r.mobile_base_id?'mobile_base':'unverified';
  const directId=fixed?r.fixed_account_id:r.crm_client_id||r.mobile_base_id||r.service_key;
  const url=fixed&&r.fixed_account_id?basePath+'/fixed/accounts/'+r.fixed_account_id:
    r.crm_client_id&&r.link_state!=='needs_conflict_review'
      ?basePath+'/customers/'+r.crm_client_id+'/360':
    r.mobile_base_id?basePath+'/mobile-base/'+r.mobile_base_id:
    basePath+'/master-register/service/'+encodeURIComponent(r.service_key);
  return {
   id:directId,service_key:r.service_key,record_type:relatedType,
   service_type:r.service_type,verification_status:r.link_state,
   master_customer_key:r.master_customer_key,
   account_number:r.official_account||r.crm_account||r.base_account||r.fixed_account||null,
   client_name:r.crm_name||r.master_customer_name||r.base_name||r.fixed_name||r.master_line_name,
   cell_number:r.phone||r.fixed_contact||null,
   email:r.crm_email||r.base_email||r.fixed_email||null,
   handset:r.crm_handset||[r.device_manufacturer,r.device_name].filter(Boolean).join(' ')||r.router_model||null,
   package_name:r.crm_package||r.base_tariff||r.base_price_plan||r.fixed_package||null,
   branch_name:r.branch_name||null,solution_id:r.solution_id||null,url
  };
 });
 // Deduplicate only the master rows actually returned: the master's earlier
 // candidate LIMIT must not suppress a CRM line found independently.
 const linkedIds=new Set(rows.slice(0,20).map(r=>Number(r.crm_client_id)).filter(Number.isSafeInteger));
 const fallback=crmLines.filter(r=>!linkedIds.has(Number(r.id)));
 // A full phone lookup is also used to authorize Base Details service access.
 // Put its verified exact master service first, then missing CRM lines, then
 // other source results; do not let CRM duplicates displace an exact service.
 const exact=canon?masterResults.filter(r=>r.cell_number===canon):[];
 const remaining=canon?masterResults.filter(r=>r.cell_number!==canon):masterResults;
 return [...exact,...fallback,...remaining].slice(0,20);
}
module.exports={searchMaster,normalPhone};
