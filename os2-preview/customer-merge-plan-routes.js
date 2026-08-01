'use strict';

const express=require('express');
const crypto=require('crypto');
const { withTransaction }=require('./core/transaction');
const { requirePermission }=require('./core/permissions');
const { appendAudit }=require('./core/audit');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
function text(value,max=1000){const result=String(value==null?'':value).trim();return result?result.slice(0,max):null;}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.keys(value).sort().reduce((out,key)=>{out[key]=stable(value[key]);return out;},{});return value;}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function context(req){return {ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}

async function buildPlan(connection,survivorId,sourceId){
  const [[counts]]=await connection.execute(`SELECT
    (SELECT COUNT(*) FROM os2_customer_accounts WHERE master_customer_id=:sourceId AND archived_at IS NULL) accounts,
    (SELECT COUNT(*) FROM os2_mobile_lines WHERE master_customer_id=:sourceId AND archived_at IS NULL) mobile_lines,
    (SELECT COUNT(*) FROM os2_fixed_accounts WHERE master_customer_id=:sourceId AND archived_at IS NULL) fixed_accounts,
    (SELECT COUNT(*) FROM os2_work_items WHERE master_customer_id=:sourceId AND archived_at IS NULL) work_items,
    (SELECT COUNT(*) FROM os2_customer_documents WHERE master_customer_id=:sourceId AND archived_at IS NULL) documents,
    (SELECT COUNT(*) FROM os2_authorised_representatives WHERE master_customer_id=:sourceId AND is_active=1) representatives,
    (SELECT COUNT(*) FROM os2_customer_restrictions WHERE master_customer_id=:sourceId AND is_active=1) restrictions`,{sourceId});
  const [[conflicts]]=await connection.execute(`SELECT
    (SELECT COUNT(*) FROM os2_customer_accounts s JOIN os2_customer_accounts d ON d.master_customer_id=:survivorId AND d.archived_at IS NULL AND d.normalised_account_number=s.normalised_account_number WHERE s.master_customer_id=:sourceId AND s.archived_at IS NULL AND s.normalised_account_number IS NOT NULL) duplicate_accounts,
    (SELECT COUNT(*) FROM os2_mobile_lines s JOIN os2_mobile_lines d ON d.master_customer_id=:survivorId AND d.archived_at IS NULL AND d.mobile_number=s.mobile_number WHERE s.master_customer_id=:sourceId AND s.archived_at IS NULL AND s.mobile_number IS NOT NULL) duplicate_mobile_numbers,
    (SELECT COUNT(*) FROM os2_customer_ownership WHERE master_customer_id=:sourceId AND is_current=1) source_current_ownership,
    (SELECT COUNT(*) FROM os2_customer_claims WHERE master_customer_id=:sourceId AND status='pending') pending_claims,
    (SELECT COUNT(*) FROM os2_approval_requests WHERE master_customer_id=:sourceId AND status IN ('pending','deferred')) pending_approvals`,{survivorId,sourceId});
  const blockerKeys=['duplicate_accounts','duplicate_mobile_numbers','pending_claims','pending_approvals'];
  const conflictCount=Number(conflicts.duplicate_accounts||0)+Number(conflicts.duplicate_mobile_numbers||0);
  const blockerCount=blockerKeys.reduce((sum,key)=>sum+Number(conflicts[key]||0),0);
  return {survivorCustomerId:survivorId,sourceCustomerId:sourceId,transferCounts:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,Number(v||0)])),conflicts:Object.fromEntries(Object.entries(conflicts).map(([k,v])=>[k,Number(v||0)])),blockerCount,conflictCount,executionAvailable:false};
}

async function buildSnapshot(connection,survivorId,sourceId){
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

function snapshotBlocked(customers,snapshot){return customers.length!==2||customers.some(row=>row.archived_at)||Number(snapshot.duplicate_accounts||0)>0||Number(snapshot.duplicate_mobile_numbers||0)>0||Number(snapshot.pending_claims||0)>0||Number(snapshot.pending_approvals||0)>0;}

module.exports=function createCustomerMergePlanRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/customer-merge-plans',requireAuth);

  router.post('/api/os2/customer-merge-plans/prepare',requirePermission('customer.merge.plan'),async(req,res)=>{
    const caseId=positiveId(req.body.duplicateCaseId),survivorId=positiveId(req.body.survivorCustomerId);
    if(!caseId||!survivorId)return res.status(400).json({ok:false,error:'CASE_AND_SURVIVOR_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[duplicateCase]]=await connection.execute('SELECT * FROM os2_customer_duplicate_cases WHERE id=:id FOR UPDATE',{id:caseId});
        if(!duplicateCase)throw Object.assign(new Error('DUPLICATE_CASE_NOT_FOUND'),{statusCode:404});
        if(duplicateCase.status!=='merge_recommended')throw Object.assign(new Error('MERGE_RECOMMENDATION_REQUIRED'),{statusCode:409});
        const pair=[Number(duplicateCase.primary_customer_id),Number(duplicateCase.candidate_customer_id)];
        if(!pair.includes(survivorId))throw Object.assign(new Error('SURVIVOR_NOT_IN_CASE'),{statusCode:400});
        const sourceId=pair.find(id=>id!==survivorId);
        const [customers]=await connection.execute('SELECT id,archived_at FROM os2_master_customers WHERE id IN (:survivorId,:sourceId) FOR UPDATE',{survivorId,sourceId});
        if(customers.length!==2||customers.some(row=>row.archived_at))throw Object.assign(new Error('BOTH_CUSTOMERS_MUST_BE_ACTIVE'),{statusCode:409});
        const plan=await buildPlan(connection,survivorId,sourceId);const planHash=hash(plan);
        const currentSnapshot=await buildSnapshot(connection,survivorId,sourceId);const currentSnapshotHash=hash(currentSnapshot);
        await connection.execute(`INSERT INTO os2_customer_merge_plans(duplicate_case_id,survivor_customer_id,source_customer_id,status,plan_json,plan_hash,blocker_count,conflict_count,prepared_by,prepared_at,current_snapshot_hash,revalidated_at,created_at,updated_at)
          VALUES(:caseId,:survivorId,:sourceId,'draft',:plan,:planHash,:blockers,:conflicts,:actor,NOW(),:snapshotHash,NOW(),NOW(),NOW())
          ON DUPLICATE KEY UPDATE survivor_customer_id=VALUES(survivor_customer_id),source_customer_id=VALUES(source_customer_id),status='draft',plan_json=VALUES(plan_json),plan_hash=VALUES(plan_hash),blocker_count=VALUES(blocker_count),conflict_count=VALUES(conflict_count),prepared_by=VALUES(prepared_by),prepared_at=NOW(),current_snapshot_hash=VALUES(current_snapshot_hash),revalidated_at=NOW(),invalidated_at=NULL,invalidated_by=NULL,invalidation_reason=NULL,approved_by=NULL,approved_at=NULL,rejected_by=NULL,rejected_at=NULL,decision_reason=NULL,updated_at=NOW()`,{caseId,survivorId,sourceId,plan:JSON.stringify(plan),planHash,blockers:plan.blockerCount,conflicts:plan.conflictCount,actor:req.user.id,snapshotHash:currentSnapshotHash});
        const [[saved]]=await connection.execute('SELECT id FROM os2_customer_merge_plans WHERE duplicate_case_id=:caseId',{caseId});
        await connection.execute(`INSERT INTO os2_customer_merge_plan_history(merge_plan_id,event_type,to_status,reason,details_json,changed_by,created_at) VALUES(:id,'prepared','draft','Merge plan prepared and baselined',:details,:actor,NOW())`,{id:saved.id,details:JSON.stringify({planHash,currentSnapshotHash,blockerCount:plan.blockerCount,conflictCount:plan.conflictCount}),actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_merge_plan_prepared',entityType:'os2_customer_merge_plans',entityId:saved.id,masterCustomerId:survivorId,description:`Prepared merge plan ${saved.id}; execution disabled`,after:{caseId,survivorId,sourceId,planHash,currentSnapshotHash,blockerCount:plan.blockerCount},requestContext:context(req)});
        return {mergePlanId:Number(saved.id),planHash,currentSnapshotHash,plan};
      });
      res.status(201).json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'MERGE_PLAN_PREPARE_FAILED'});}
  });

  router.post('/api/os2/customer-merge-plans/:planId/decision',requirePermission('customer.merge.approve'),async(req,res)=>{
    const planId=positiveId(req.params.planId),decision=['approved','rejected'].includes(req.body.decision)?req.body.decision:null,reason=text(req.body.reason),expectedHash=String(req.body.planHash||'');
    if(!planId||!decision||!reason||!/^[a-f0-9]{64}$/i.test(expectedHash))return res.status(400).json({ok:false,error:'PLAN_DECISION_REASON_AND_HASH_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[plan]]=await connection.execute('SELECT * FROM os2_customer_merge_plans WHERE id=:id FOR UPDATE',{id:planId});
        if(!plan)throw Object.assign(new Error('MERGE_PLAN_NOT_FOUND'),{statusCode:404});
        if(plan.status!=='draft')throw Object.assign(new Error('MERGE_PLAN_NOT_DRAFT'),{statusCode:409});
        if(Number(plan.prepared_by)===Number(req.user.id))throw Object.assign(new Error('SELF_APPROVAL_NOT_ALLOWED'),{statusCode:409});
        if(plan.plan_hash!==expectedHash)throw Object.assign(new Error('MERGE_PLAN_HASH_MISMATCH'),{statusCode:409});
        let currentSnapshotHash=plan.current_snapshot_hash;
        if(decision==='approved'){
          const [customers]=await connection.execute('SELECT id,archived_at FROM os2_master_customers WHERE id IN (:survivorId,:sourceId) FOR UPDATE',{survivorId:plan.survivor_customer_id,sourceId:plan.source_customer_id});
          const currentSnapshot=await buildSnapshot(connection,plan.survivor_customer_id,plan.source_customer_id);
          currentSnapshotHash=hash(currentSnapshot);
          const changed=!plan.current_snapshot_hash||plan.current_snapshot_hash!==currentSnapshotHash;
          const blocked=snapshotBlocked(customers,currentSnapshot)||Number(plan.blocker_count)>0||Number(plan.conflict_count)>0;
          if(changed||blocked){
            const invalidationReason=blocked?'Current customer data contains merge blockers':'Customer data changed after merge plan preparation';
            await connection.execute(`UPDATE os2_customer_merge_plans SET status='invalidated',current_snapshot_hash=:snapshotHash,revalidated_at=NOW(),invalidated_at=NOW(),invalidated_by=:actor,invalidation_reason=:reason,updated_at=NOW() WHERE id=:id`,{id:planId,snapshotHash:currentSnapshotHash,actor:req.user.id,reason:invalidationReason});
            await connection.execute(`INSERT INTO os2_customer_merge_plan_history(merge_plan_id,event_type,from_status,to_status,reason,details_json,changed_by,created_at) VALUES(:id,'approval_revalidation','draft','invalidated',:reason,:details,:actor,NOW())`,{id:planId,reason:invalidationReason,details:JSON.stringify({previousSnapshotHash:plan.current_snapshot_hash||null,currentSnapshotHash,changed,blocked,snapshot:currentSnapshot}),actor:req.user.id});
            await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_merge_plan_invalidated_at_approval',entityType:'os2_customer_merge_plans',entityId:planId,masterCustomerId:plan.survivor_customer_id,description:`Invalidated stale or blocked merge plan ${planId} during approval`,before:{status:'draft',currentSnapshotHash:plan.current_snapshot_hash||null},after:{status:'invalidated',currentSnapshotHash,invalidationReason,changed,blocked},requestContext:context(req)});
            return {mergePlanId:planId,status:'invalidated',currentSnapshotHash,error:blocked?'MERGE_PLAN_HAS_BLOCKERS':'MERGE_PLAN_STALE',executionAvailable:false};
          }
        }
        await connection.execute(`UPDATE os2_customer_merge_plans SET status=:decision,current_snapshot_hash=:snapshotHash,revalidated_at=IF(:decision='approved',NOW(),revalidated_at),approved_by=IF(:decision='approved',:actor,NULL),approved_at=IF(:decision='approved',NOW(),NULL),rejected_by=IF(:decision='rejected',:actor,NULL),rejected_at=IF(:decision='rejected',NOW(),NULL),decision_reason=:reason,updated_at=NOW() WHERE id=:id`,{id:planId,decision,actor:req.user.id,reason,snapshotHash:currentSnapshotHash});
        await connection.execute(`INSERT INTO os2_customer_merge_plan_history(merge_plan_id,event_type,from_status,to_status,reason,details_json,changed_by,created_at) VALUES(:id,'decision','draft',:decision,:reason,:details,:actor,NOW())`,{id:planId,decision,reason,details:JSON.stringify({planHash:expectedHash,currentSnapshotHash,approvalRevalidated:decision==='approved',executionAvailable:false}),actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_merge_plan_decided',entityType:'os2_customer_merge_plans',entityId:planId,masterCustomerId:plan.survivor_customer_id,description:`Merge plan ${planId} ${decision}; execution disabled`,before:{status:plan.status,currentSnapshotHash:plan.current_snapshot_hash||null},after:{status:decision,reason,planHash:expectedHash,currentSnapshotHash},requestContext:context(req)});
        return {mergePlanId:planId,status:decision,currentSnapshotHash,executionAvailable:false};
      });
      if(result.error)return res.status(409).json({ok:false,...result});
      res.json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'MERGE_PLAN_DECISION_FAILED'});}
  });

  router.get('/api/os2/customer-merge-plans/:planId',requirePermission('customer.merge.review'),async(req,res)=>{
    const planId=positiveId(req.params.planId);if(!planId)return res.status(400).json({ok:false,error:'INVALID_PLAN_ID'});
    try{const [[plan]]=await pool.execute('SELECT * FROM os2_customer_merge_plans WHERE id=:id',{id:planId});if(!plan)return res.status(404).json({ok:false,error:'MERGE_PLAN_NOT_FOUND'});const [history]=await pool.execute('SELECT * FROM os2_customer_merge_plan_history WHERE merge_plan_id=:id ORDER BY created_at DESC',{id:planId});res.json({ok:true,plan,history,executionAvailable:false});}
    catch(error){res.status(500).json({ok:false,error:'MERGE_PLAN_LOAD_FAILED'});}
  });
  return router;
};
