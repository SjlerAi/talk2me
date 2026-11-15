'use strict';
// An owner or manager may choose the canonical account for ONE telephone line after
// comparing the CRM and September supplier records. No generic merge/delete.
// Source account codes, Vodacom snapshots, phone, contracts and work are retained.
const crypto=require('crypto');
const {ResolutionBlocked}=require('./grouped-upgrade-resolver');
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const clean=(v,max=1500)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const phone=v=>{
 let s=String(v??'').replace(/\D/g,'');
 if(s.length===11&&s.startsWith('27'))s='0'+s.slice(2);
 return /^0\d{9}$/.test(s)?s:'';
};
function sourceSignature(serviceKey,client,base){
 return crypto.createHash('sha256').update(JSON.stringify({
  service_key:serviceKey,
  client_id:Number(client?.id)||null,
  crm_account_id:Number(client?.account_id)||null,
  crm_account_number:norm(client?.account_number),
  client_phone:phone(client?.cell_number_normalised||client?.cell_number),
  client_active:Number(client?.is_active)||0,
  base_id:Number(base?.id)||null,
  supplier_account_id:Number(base?.account_id)||null,
  supplier_client_id:Number(base?.client_id)||null,
  supplier_code:norm(base?.account_code_core||base?.account_code),
  supplier_phone:phone(base?.msisdn_normalised||base?.msisdn_original)
 })).digest('hex');
}
function validateContext(service,evidence,client,base,crmAccount,supplierAccount){
 const issues=evidence.issues||[];
 if(service?.link_state!=='needs_conflict_review')
  return 'This line is no longer waiting for an account conflict decision.';
 if(issues.length!==1||issues[0]!=='different_account_relationships')
  return 'This conflict includes other issues. Use the specific duplicate or source review before changing the account.';
 if(service.service_type!=='mobile')return 'Only individual mobile line account conflicts can be resolved here.';
 if((evidence.candidate_active_client_ids||[]).length!==1 ||
    (evidence.supplier_client_ids||[]).length!==1)
  return 'More than one customer record or supplier link needs checking first.';
 if((evidence.candidate_customer_keys||[]).length!==2)
  return 'This source has more than two possible account relationships.';
 if(!client||!base||!crmAccount||!supplierAccount)
  return 'The linked CRM record, supplier record or official account could not be found.';
 if(Number(client.is_active)!==1||Number(base.client_id)!==Number(client.id) ||
    Number(service.mobile_base_id)!==Number(base.id))
  return 'The supplier points to a different customer, or the original CRM line has changed.';
 if(phone(client.cell_number_normalised||client.cell_number)!==service.phone ||
    phone(base.msisdn_normalised||base.msisdn_original)!==service.phone)
  return 'The telephone numbers do not match. Verify the customer identity first.';
 if(Number(client.account_id)!==Number(crmAccount.id)||Number(base.account_id)!==Number(supplierAccount.id)||
    Number(crmAccount.id)===Number(supplierAccount.id))
  return 'The account relationships changed. Reload the latest master record.';
 const vendorCode=norm(base.account_code_core||base.account_code);
 const supplierNumber=norm(supplierAccount.account_number);
 if(!vendorCode||!supplierNumber||!(supplierNumber.startsWith(vendorCode)||vendorCode.startsWith(supplierNumber)))
  return 'The linked Vodacom account does not match the actual supplier account code. Verify the source account first.';
 if(norm(client.account_number)!==norm(crmAccount.account_number))
  return 'The CRM line account number differs from its linked official account record. Correct that before selecting an account.';
 if((evidence.candidate_customer_keys||[]).some(k=>
    !['account:'+crmAccount.id,'account:'+supplierAccount.id].includes(k)))
  return 'The possible accounts are not the two original CRM account records.';
 if(['inactive','cancelled'].includes(String(crmAccount.account_status||'').toLowerCase())||
    ['inactive','cancelled'].includes(String(supplierAccount.account_status||'').toLowerCase()))
  return 'An account has been deactivated. A manager must verify it first.';
 return '';
}
async function loadContext(conn,service){
 const evidence=JSON.parse(service.evidence_json||'{}');
 const crmId=positive(evidence.candidate_active_client_ids?.[0]);
 const baseId=positive(service.mobile_base_id);
 let client=null,base=null,crmAccount=null,supplierAccount=null;
 if(crmId)[[client]]=await conn.execute('SELECT * FROM clients WHERE id=? LIMIT 1',[crmId]);
 if(baseId)[[base]]=await conn.execute('SELECT * FROM mobile_base_current WHERE id=? LIMIT 1',[baseId]);
 if(positive(client?.account_id))[[crmAccount]]=await conn.execute(
  'SELECT id,account_number,display_name,assigned_staff_id,account_status FROM customer_accounts WHERE id=?',
  [client.account_id]);
 if(positive(base?.account_id))[[supplierAccount]]=await conn.execute(
  'SELECT id,account_number,display_name,assigned_staff_id,account_status FROM customer_accounts WHERE id=?',
  [base.account_id]);
 const blocked=validateContext(service,evidence,client,base,crmAccount,supplierAccount);
 const counts={crm:0,supplier:0};
 if(crmAccount){
  const [[r]]=await conn.execute('SELECT COUNT(*) n FROM clients WHERE account_id=? AND is_active=1',[crmAccount.id]);
  counts.crm=Number(r.n);
 }
 if(supplierAccount){
  const [[r]]=await conn.execute('SELECT COUNT(*) n FROM clients WHERE account_id=? AND is_active=1',[supplierAccount.id]);
  counts.supplier=Number(r.n);
 }
 const [[decision]]=await conn.execute(
  'SELECT d.*,u.full_name reviewer_name FROM crm_master_service_decisions d '+
  'LEFT JOIN staff_users u ON u.id=d.reviewed_by WHERE d.service_key=?',[service.service_key]);
 return {service,evidence,client:client||null,base:base||null,
  crmAccount:crmAccount||null,supplierAccount:supplierAccount||null,
  counts,decision:decision||null,blocked,
  sourceHash:client&&base?sourceSignature(service.service_key,client,base):null};
}
async function applyDecision(conn,{serviceKey,mode,expectedSourceHash,reviewedBy,ip='',userAgent=''}){
 const actor=positive(reviewedBy);
 if(!actor)throw new ResolutionBlocked('Please sign in as the CRM Owner or Manager.');
 if(!['keep_crm','use_supplier','needs_info'].includes(mode))
  throw new ResolutionBlocked('Choose which account belongs to this number, or request more information.');
 // Defensive role check even when called outside the normal authenticated route.
 const [[reviewer]]=await conn.execute('SELECT id,full_name,role,is_active FROM staff_users WHERE id=?',[actor]);
 if(!reviewer||!['owner','manager'].includes(reviewer.role)||Number(reviewer.is_active)!==1)
  throw new ResolutionBlocked('Only an active CRM Owner or Manager can resolve this conflict.');
 const [[active]]=await conn.execute(
  'SELECT a.run_id FROM crm_master_active a WHERE a.singleton=1 FOR UPDATE');
 if(!active)throw new ResolutionBlocked('Master register is not available.');
 const [[service]]=await conn.execute(
  'SELECT * FROM crm_master_services WHERE run_id=? AND service_key=? FOR UPDATE',
  [active.run_id,serviceKey]);
 if(!service)throw new ResolutionBlocked('This telephone number no longer appears in the current master register.');
 const context=await loadContext(conn,service);
 if(context.blocked)throw new ResolutionBlocked(context.blocked);
 if(!/^[a-f0-9]{64}$/.test(String(expectedSourceHash||''))||!crypto.timingSafeEqual(
  Buffer.from(context.sourceHash,'hex'),
  Buffer.from(expectedSourceHash,'hex')))
  throw new ResolutionBlocked('The customer or Vodacom information changed. Reload this conflict and review the new details.');
 const {client,base,crmAccount,supplierAccount,evidence}=context;
 // Lock the exact customer, supplier row and both account holders before writing.
 const [[lockedClient]]=await conn.execute('SELECT * FROM clients WHERE id=? FOR UPDATE',[client.id]);
 const [[lockedBase]]=await conn.execute('SELECT * FROM mobile_base_current WHERE id=? FOR UPDATE',[base.id]);
 const [accounts]=await conn.query(
  'SELECT id,assigned_staff_id,account_status FROM customer_accounts WHERE id IN (?,?) ORDER BY id FOR UPDATE',
  [crmAccount.id,supplierAccount.id]);
 if(accounts.length!==2||sourceSignature(serviceKey,lockedClient,lockedBase)!==context.sourceHash)
  throw new ResolutionBlocked('The source records changed. Reload before deciding.');
 const selectedAccountId=mode==='keep_crm'?Number(crmAccount.id):
  mode==='use_supplier'?Number(supplierAccount.id):null;
 // Structured action descriptions are generated automatically. We never claim
 // that someone supplied evidence or a reason when they did not.
 const explanation=mode==='keep_crm'
  ?'Owner/manager selected existing CRM account '+crmAccount.account_number+
   ' for '+service.phone+'; Vodacom account difference retained as source evidence.'
  :mode==='use_supplier'
  ?'Owner/manager selected existing Vodacom-linked account '+supplierAccount.account_number+
   ' for '+service.phone+'; other telephone lines are unchanged.'
  :'Owner/manager selected Cannot confirm yet for '+service.phone+
   '; account relationship left unresolved and both accounts unchanged.';
 let updatedClient=false;
 const before={service:{service_key:service.service_key,master_customer_key:service.master_customer_key,
  link_state:service.link_state,evidence:service.evidence_json},
  crm:{id:client.id,account_id:client.account_id,account_number:client.account_number},
  supplier:{id:base.id,account_id:base.account_id,account_code:base.account_code_core||base.account_code},
  decision:context.decision||null};
 if(mode==='use_supplier'){
  // The OTHER CRM lines under the old account remain completely untouched.
  // Reject different owner assignments or any other prior linked account.
  if(!positive(crmAccount.assigned_staff_id)||!positive(supplierAccount.assigned_staff_id)||
      Number(crmAccount.assigned_staff_id)!==Number(supplierAccount.assigned_staff_id))
   throw new ResolutionBlocked('The two accounts have different or missing consultants. Resolve the staff ownership before moving this line.');
  const [assignments]=await conn.execute(
   'SELECT id,assigned_staff_id,account_number,is_active FROM client_assignments WHERE client_id=? FOR UPDATE',
   [client.id]);
  if(assignments.some(a=>Number(a.is_active)===1&&
   (Number(a.assigned_staff_id)!==Number(crmAccount.assigned_staff_id)||
    norm(a.account_number)!==norm(crmAccount.account_number))))
   throw new ResolutionBlocked('This line has a different staff assignment. Resolve its assignment first.');
  const [[existingLink]]=await conn.execute(
   'SELECT phone,account_id,client_id FROM customer_account_line_links WHERE phone=? FOR UPDATE',[service.phone]);
  if(existingLink&&(Number(existingLink.account_id)!==Number(supplierAccount.id)||
     (existingLink.client_id&&Number(existingLink.client_id)!==Number(client.id))))
   throw new ResolutionBlocked('Another approved account link exists. Open the line-link review before changing the account.');
  const [upd]=await conn.execute(
    'UPDATE clients SET account_id=?,account_number=?,updated_at=NOW() '+
    'WHERE id=? AND account_id=? AND is_active=1',
    [supplierAccount.id,supplierAccount.account_number,client.id,crmAccount.id]);
  if(upd.affectedRows!==1)throw new ResolutionBlocked('CRM account changed while reviewing. Nothing applied.');
  await conn.execute(
   'UPDATE client_assignments SET account_number=?,updated_at=NOW() WHERE client_id=? AND is_active=1 AND account_number=?',
   [supplierAccount.account_number,client.id,crmAccount.account_number]);
  // Mapping of this individual CRM source changes; the original source row remains.
  await conn.execute(
   "UPDATE crm_master_customer_sources SET customer_key=? WHERE run_id=? AND source_type='client' AND source_id=?",
   ['account:'+supplierAccount.id,active.run_id,String(client.id)]);
  await conn.execute('UPDATE crm_master_customers SET source_count=source_count-1 WHERE run_id=? AND customer_key=? AND source_count>0',
   [active.run_id,'account:'+crmAccount.id]);
  await conn.execute('UPDATE crm_master_customers SET source_count=source_count+1 WHERE run_id=? AND customer_key=?',
   [active.run_id,'account:'+supplierAccount.id]);
  updatedClient=true;
 }
 const decidedAccount=selectedAccountId===Number(crmAccount.id)?crmAccount:supplierAccount;
 await conn.execute(
  'INSERT INTO crm_master_service_decisions('+
  'service_key,resolution_mode,selected_account_id,crm_client_id,crm_account_id_at_review,'+
  'supplier_account_id_at_review,supplier_base_id,source_fingerprint,decision_reason,reviewed_by,reviewed_at) '+
  'VALUES(?,?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE '+
  'resolution_mode=VALUES(resolution_mode),selected_account_id=VALUES(selected_account_id),'+
  'crm_client_id=VALUES(crm_client_id),crm_account_id_at_review=VALUES(crm_account_id_at_review),'+
  'supplier_account_id_at_review=VALUES(supplier_account_id_at_review),supplier_base_id=VALUES(supplier_base_id),'+
  'source_fingerprint=VALUES(source_fingerprint),decision_reason=VALUES(decision_reason),'+
  'reviewed_by=VALUES(reviewed_by),reviewed_at=NOW()',
  [serviceKey,mode,selectedAccountId,client.id,crmAccount.id,supplierAccount.id,
   base.id,context.sourceHash,explanation,actor]);
 let outcome='kept for further information';
 if(selectedAccountId){
  const key='account:'+selectedAccountId;
  const evidenceAfter={...evidence,issues:[],
   owner_decision:{mode,original_issues:evidence.issues||[],
    selected_account_id:selectedAccountId,
    verified_by:actor,reason:explanation,
    supplier_account_code:base.account_code_core||base.account_code,
    original_crm_account_id:crmAccount.id,
    original_supplier_account_id:supplierAccount.id,
    source_snapshot_id:base.id}};
  const state=mode==='keep_crm'?'crm_customer_linked':'verified_crm_supplier_link';
  const [change]=await conn.execute(
   'UPDATE crm_master_services SET master_customer_key=?,crm_account_id=?,crm_client_id=?,link_state=?,evidence_json=? '+
   'WHERE run_id=? AND service_key=? AND link_state=?',
   [key,selectedAccountId,client.id,state,JSON.stringify(evidenceAfter),active.run_id,
    serviceKey,'needs_conflict_review']);
  if(change.affectedRows!==1)throw new ResolutionBlocked('This conflict has already been updated. Reload before deciding.');
  await conn.execute(
   'UPDATE crm_master_customers SET service_count=service_count+1 WHERE run_id=? AND customer_key=?',
   [active.run_id,key]);
  outcome=mode==='keep_crm'?
   'CRM account '+crmAccount.account_number+' confirmed for this line. Vodacom discrepancy retained as source evidence.':
   'This line moved to '+supplierAccount.account_number+
   ' in CRM. Other account lines were preserved.';
 }
 await conn.execute(
  'INSERT INTO audit_log(staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,?,?)',
  [actor,'master_service_conflict_owner_review','clients',client.id,
   'Master service '+serviceKey+' '+reviewer.role+' decision: '+mode+'. '+explanation.slice(0,170),
   JSON.stringify(before),JSON.stringify({
    service_key:serviceKey,selected_account_id:selectedAccountId,
    source_base_id:base.id,changed_client_account:updatedClient,
    supplier_raw_code_preserved:true,review_mode:mode,
    reviewer_id:actor,reviewer_name:reviewer.full_name,reviewer_role:reviewer.role,
    automatic_decision_description:explanation}),
   clean(ip,64),clean(userAgent,255)]);
 return {resolved:Boolean(selectedAccountId),mode,serviceKey,clientId:client.id,
  selectedAccount:selectedAccountId?(decidedAccount?.account_number||''):null,message:outcome};
}
module.exports={loadContext,applyDecision,sourceSignature,validateContext,ResolutionBlocked};
