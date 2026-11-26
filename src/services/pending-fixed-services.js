'use strict';
const { parseProposal,roleOf }=require('./provisional-account-approval');
function normalise(value){return String(value??'').trim().replace(/\s+/g,'').toUpperCase();}
function pendingFixedRow(row){
 let proposed;try{proposed=parseProposal(row.proposed_data_json);}catch(_){return null;}
 const service=row.request_type==='add_fixed_service'?proposed:proposed.fixed_service;
 if(!service||typeof service!=='object'||Array.isArray(service))return null;
 if(row.request_type==='assign_account_number'&&!proposed.fixed_service)return null;
 return {id:Number(row.id),client_id:row.client_id,customer_name:row.customer_name||proposed.client_name||'Customer',
  account_number:row.account_number||row.client_account_number||proposed.requested_account_number||proposed.account_number||'',
  branch_name:service.branch_name||'',solution_id:service.solution_id||'',order_number:service.order_number||'',package_name:service.package_name||'',
  requested_by_name:row.requested_by_name||'Staff',created_at:row.created_at,status:row.status};
}
async function listPendingFixedServices(db,user,{clientId=null,accountId=null,accountNumber='',q=''}={}){
 const management=['owner','manager','admin'].includes(roleOf(user));
 const params={staffId:Number(user.id),clientId,accountId,accountNumber:normalise(accountNumber)};
 const where=["r.status IN ('pending_manager','pending_owner')","((r.request_type='assign_account_number' AND r.entity_type='clients') OR (r.request_type='add_fixed_service' AND r.entity_type='customer_accounts'))"];
 if(!management)where.push('r.requested_by=:staffId');
 if(clientId)where.push("(r.client_id=:clientId OR (r.request_type='assign_account_number' AND r.record_id=:clientId) OR (r.request_type='add_fixed_service' AND :accountId IS NOT NULL AND r.record_id=:accountId) OR (:accountNumber<>'' AND UPPER(REPLACE(TRIM(r.account_number),' ',''))=:accountNumber))");
 const [rows]=await db.execute("SELECT r.id,r.request_type,r.client_id,r.account_number,r.proposed_data_json,r.created_at,r.status,c.client_name customer_name,c.account_number client_account_number,u.full_name requested_by_name FROM data_change_requests r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN staff_users u ON u.id=r.requested_by WHERE "+where.join(' AND ')+" ORDER BY r.created_at DESC,r.id DESC LIMIT 500",params);
 const term=String(q||'').trim().toLowerCase();
 return rows.map(pendingFixedRow).filter(Boolean).filter(row=>!term||[row.customer_name,row.account_number,row.branch_name,row.solution_id,row.order_number,row.package_name].some(value=>String(value||'').toLowerCase().includes(term)));
}
module.exports={listPendingFixedServices,pendingFixedRow};
