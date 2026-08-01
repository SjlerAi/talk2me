'use strict';

const express=require('express');
const crypto=require('crypto');
const { withTransaction }=require('./core/transaction');
const { requirePermission }=require('./core/permissions');
const { appendAudit }=require('./core/audit');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.keys(value).sort().reduce((out,key)=>{out[key]=stable(value[key]);return out;},{});return value;}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function context(req){return {ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}

async function snapshot(connection,survivorId,sourceId){
  const [[row]]=await connection.execute(`SELECT
    (SELECT COUNT(*) FROM os2_customer_accounts WHERE master_customer_id=:sourceId AND archived_at IS NULL) source_accounts,
    (SELECT COUNT(*) FROM os2_mobile_lines WHERE master_customer_id=:sourceId AND archived_at IS NULL) source_mobile_lines,
    (SELECT COUNT(*) FROM os2_fixed_accounts WHERE master_customer_id=:sourceId AND archived_at IS NULL) source_fixed_accounts,
    (SELECT COUNT(*) FROM os2_work_items WHERE master_customer_id=:sourceId AND archived_at IS NULL) source_work_items,
    (SELECT COUNT(*) FROM os2_customer_documents WHERE master_customer_id=:sourceId AND archived_at IS NULL) source_documents,
    (SELECT COUNT(*) FROM os2_authorised_representatives WHERE master_customer_id=:sourceId AND is_active=1) source_representatives,
    (SELECT COUNT(*) FROM os2_customer_restrictions WHERE master_customer_id=:sourceId AND is_active=1) source_restrictions,
    (SELECT COUNT(*) FROM os2_customer_accounts s JOIN os2_customer_accounts d ON d.master_customer_id=:survivorId AND d.archived_at IS NULL AND d.normalised_account_number=s.normalised_account_number WHERE s.master_customer_id=:sourceId AND s.archived_at IS NULL AND s.normalised_account_number IS NOT NULL) duplicate_accounts,
    (SELECT COUNT(*) FROM os2_mobile_lines s JOIN os2_mobile_lines d ON d.master_customer_id=:survivorId AND d.archived_at IS NULL AND d.mobile_number=s.mobile_number WHERE s.master_customer_id=:sourceId AND s.archived_at IS NULL AND s.mobile_number IS NOT NULL) duplicate_mobile_numbers,
    (SELECT COUNT(*) FROM os2_customer_claims WHERE master_customer_id=:sourceId AND status='pending') pending_claims,
    (SELECT COUNT(*) FROM os2_approval_requests WHERE master_customer_id=:sourceId AND status IN ('pending','deferred')) pending_approvals,
    (SELECT COUNT(*) FROM os2_customer_ownership WHERE master_customer_id=:sourceId AND is_current=1) source_current_ownership,
    (SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM os2_master_customers WHERE id IN (:survivorId,:sourceId)) customer_version,
    (SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM os2_customer_accounts WHERE master_customer_id IN (:survivorId,:sourceId)) account_version,
    (SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM os2_mobile_lines WHERE master_customer_id IN (:survivorId,:sourceId)) mobile_version`,{survivorId,sourceId});
  return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?null:Number(value)]));
}

module.exports=function createCustomerMergeFreshnessRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/customer-merge-plans',requireAuth);

  router.post('/api/os2/customer-merge-plans/:planId/revalidate',requirePermission('customer.merge.plan'),async(req,res)=>{
    const planId=positiveId(req.params.planId);if(!planId)return res.status(400).json({ok:false,error:'INVALID_PLAN_ID'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[plan]]=await connection.execute('SELECT * FROM os2_customer_merge_plans WHERE id=:id FOR UPDATE',{id:planId});
        if(!plan)throw Object.assign(new Error('MERGE_PLAN_NOT_FOUND'),{statusCode:404});
        if(plan.executed_at)throw Object.assign(new Error('MERGE_PLAN_ALREADY_EXECUTED'),{statusCode:409});
        const [customers]=await connection.execute('SELECT id,archived_at FROM os2_master_customers WHERE id IN (:survivorId,:sourceId) FOR UPDATE',{survivorId:plan.survivor_customer_id,sourceId:plan.source_customer_id});
        const current=await snapshot(connection,plan.survivor_customer_id,plan.source_customer_id);
        const currentHash=hash(current);
        const changed=Boolean(plan.current_snapshot_hash&&plan.current_snapshot_hash!==currentHash);
        const blocked=customers.length!==2||customers.some(row=>row.archived_at)||Number(current.duplicate_accounts||0)>0||Number(current.duplicate_mobile_numbers||0)>0||Number(current.pending_claims||0)>0||Number(current.pending_approvals||0)>0;
        let status=plan.status;
        let invalidationReason=null;
        if((changed||blocked)&&['draft','approved'].includes(plan.status)){
          status='invalidated';
          invalidationReason=blocked?'Current customer data contains merge blockers':'Customer data changed after merge plan preparation';
        }
        await connection.execute(`UPDATE os2_customer_merge_plans SET status=:status,current_snapshot_hash=:currentHash,revalidated_at=NOW(),invalidated_at=IF(:status='invalidated',NOW(),invalidated_at),invalidated_by=IF(:status='invalidated',:actor,invalidated_by),invalidation_reason=IF(:status='invalidated',:reason,invalidation_reason),updated_at=NOW() WHERE id=:id`,{id:planId,status,currentHash,actor:req.user.id,reason:invalidationReason});
        await connection.execute(`INSERT INTO os2_customer_merge_plan_history(merge_plan_id,event_type,from_status,to_status,reason,details_json,changed_by,created_at) VALUES(:id,'revalidated',:fromStatus,:toStatus,:reason,:details,:actor,NOW())`,{id:planId,fromStatus:plan.status,toStatus:status,reason:invalidationReason||'Merge plan snapshot revalidated',details:JSON.stringify({previousSnapshotHash:plan.current_snapshot_hash||null,currentSnapshotHash:currentHash,changed,blocked,snapshot:current}),actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_merge_plan_revalidated',entityType:'os2_customer_merge_plans',entityId:planId,masterCustomerId:plan.survivor_customer_id,description:`Revalidated merge plan ${planId}; status ${status}`,before:{status:plan.status,currentSnapshotHash:plan.current_snapshot_hash||null},after:{status,currentSnapshotHash:currentHash,changed,blocked},requestContext:context(req)});
        return {mergePlanId:planId,status,currentSnapshotHash:currentHash,changed,blocked,invalidationReason,executionAvailable:false};
      });
      res.json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'MERGE_PLAN_REVALIDATION_FAILED'});}
  });
  return router;
};
