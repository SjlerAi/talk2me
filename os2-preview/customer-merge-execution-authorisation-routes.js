'use strict';

const express=require('express');
const {withTransaction}=require('./core/transaction');
const {requirePermission}=require('./core/permissions');
const {appendAudit}=require('./core/audit');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
function text(value,max=1000){const result=String(value==null?'':value).trim();return result?result.slice(0,max):null;}
function hash(value){const result=String(value||'').trim().toLowerCase();return /^[a-f0-9]{64}$/.test(result)?result:null;}
function context(req){return{ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}

async function requireRecoverablePreviewBackup(connection,backupRunId){
  const [[backup]]=await connection.execute(`SELECT id,status,backup_type,completed_at,verified_at,database_name,checksum_sha256,storage_path,file_name
    FROM os2_backup_runs WHERE id=:id FOR UPDATE`,{id:backupRunId});
  const validBackup=backup&&backup.status==='verified'&&['database','full'].includes(backup.backup_type)&&backup.completed_at&&backup.verified_at&&backup.database_name==='kloka_talk2me'&&/^[a-f0-9]{64}$/i.test(String(backup.checksum_sha256||''))&&text(backup.storage_path,1000)&&text(backup.file_name,255);
  if(!validBackup)throw Object.assign(new Error('VERIFIED_PREVIEW_BACKUP_REQUIRED'),{statusCode:409});
  const [[restore]]=await connection.execute(`SELECT id,status,completed_at,target_environment,expected_database_name,actual_database_name,failed_checks
    FROM os2_restore_tests WHERE backup_run_id=:backupRunId ORDER BY completed_at DESC,id DESC LIMIT 1 FOR UPDATE`,{backupRunId});
  const validRestore=restore&&restore.status==='passed'&&restore.completed_at&&restore.target_environment==='isolated_preview_restore'&&restore.expected_database_name==='kloka_talk2me'&&restore.actual_database_name==='kloka_talk2me'&&Number(restore.failed_checks)===0;
  if(!validRestore)throw Object.assign(new Error('PASSED_PREVIEW_RESTORE_TEST_REQUIRED'),{statusCode:409});
  return{backup,restore};
}

module.exports=function createMergeExecutionAuthorisationRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/customer-merge-execution-authorisations',requireAuth);

  router.post('/api/os2/customer-merge-execution-authorisations',requirePermission('customer.merge.execution.request'),async(req,res)=>{
    const mergePlanId=positiveId(req.body.mergePlanId),backupRunId=positiveId(req.body.backupRunId),planHash=hash(req.body.planHash),snapshotHash=hash(req.body.snapshotHash),changeReference=text(req.body.changeReference,120);
    if(!mergePlanId||!backupRunId||!planHash||!snapshotHash||!changeReference)return res.status(400).json({ok:false,error:'PLAN_BACKUP_HASHES_AND_CHANGE_REFERENCE_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[plan]]=await connection.execute('SELECT * FROM os2_customer_merge_plans WHERE id=:id FOR UPDATE',{id:mergePlanId});
        if(!plan)throw Object.assign(new Error('MERGE_PLAN_NOT_FOUND'),{statusCode:404});
        if(plan.status!=='approved')throw Object.assign(new Error('APPROVED_MERGE_PLAN_REQUIRED'),{statusCode:409});
        if(plan.invalidated_at)throw Object.assign(new Error('MERGE_PLAN_INVALIDATED'),{statusCode:409});
        if(plan.executed_at)throw Object.assign(new Error('MERGE_PLAN_ALREADY_EXECUTED'),{statusCode:409});
        if(plan.plan_hash!==planHash||plan.current_snapshot_hash!==snapshotHash)throw Object.assign(new Error('MERGE_PLAN_HASH_MISMATCH'),{statusCode:409});
        if(Number(plan.blocker_count)>0||Number(plan.conflict_count)>0)throw Object.assign(new Error('MERGE_PLAN_NOT_CLEAR'),{statusCode:409});
        if(!plan.revalidated_at)throw Object.assign(new Error('MERGE_PLAN_REVALIDATION_REQUIRED'),{statusCode:409});
        const [[existing]]=await connection.execute('SELECT *,(expires_at IS NOT NULL AND expires_at>NOW()) AS is_unexpired FROM os2_customer_merge_execution_authorisations WHERE merge_plan_id=:mergePlanId FOR UPDATE',{mergePlanId});
        if(existing&&existing.consumed_at)throw Object.assign(new Error('CONSUMED_AUTHORISATION_CANNOT_BE_REUSED'),{statusCode:409});
        if(existing&&existing.status==='pending')throw Object.assign(new Error('AUTHORISATION_REQUEST_ALREADY_PENDING'),{statusCode:409});
        if(existing&&existing.status==='authorised'&&Number(existing.is_unexpired)===1&&!existing.revoked_at)throw Object.assign(new Error('ACTIVE_AUTHORISATION_ALREADY_EXISTS'),{statusCode:409});
        const evidence=await requireRecoverablePreviewBackup(connection,backupRunId);
        await connection.execute(`INSERT INTO os2_customer_merge_execution_authorisations
          (merge_plan_id,plan_hash,snapshot_hash,backup_run_id,change_reference,status,requested_by,requested_at,created_at,updated_at)
          VALUES(:mergePlanId,:planHash,:snapshotHash,:backupRunId,:changeReference,'pending',:actor,NOW(),NOW(),NOW())
          ON DUPLICATE KEY UPDATE plan_hash=VALUES(plan_hash),snapshot_hash=VALUES(snapshot_hash),backup_run_id=VALUES(backup_run_id),change_reference=VALUES(change_reference),status='pending',requested_by=VALUES(requested_by),requested_at=NOW(),authorised_by=NULL,authorised_at=NULL,expires_at=NULL,revoked_by=NULL,revoked_at=NULL,revocation_reason=NULL,updated_at=NOW()`,{mergePlanId,planHash,snapshotHash,backupRunId,changeReference,actor:req.user.id});
        const [[saved]]=await connection.execute('SELECT id FROM os2_customer_merge_execution_authorisations WHERE merge_plan_id=:mergePlanId',{mergePlanId});
        const details={mergePlanId,backupRunId,restoreTestId:evidence.restore.id,planHash,snapshotHash,changeReference,replacesAuthorisationStatus:existing?existing.status:null};
        await connection.execute(`INSERT INTO os2_customer_merge_execution_authorisation_history(authorisation_id,event_type,to_status,reason,details_json,changed_by,created_at) VALUES(:id,'requested','pending','Execution authorisation requested',:details,:actor,NOW())`,{id:saved.id,details:JSON.stringify(details),actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_merge_execution_authorisation_requested',entityType:'os2_customer_merge_execution_authorisations',entityId:saved.id,masterCustomerId:plan.survivor_customer_id,description:`Requested merge execution authorisation ${saved.id}; execution remains disabled`,after:details,requestContext:context(req)});
        return{authorisationId:Number(saved.id),status:'pending',executionAvailable:false};
      });
      res.status(201).json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'MERGE_EXECUTION_AUTHORISATION_REQUEST_FAILED'});}
  });

  router.post('/api/os2/customer-merge-execution-authorisations/:id/decision',requirePermission('customer.merge.execution.authorise'),async(req,res)=>{
    const id=positiveId(req.params.id),decision=['authorised','rejected'].includes(req.body.decision)?req.body.decision:null,reason=text(req.body.reason);
    if(!id||!decision||!reason)return res.status(400).json({ok:false,error:'AUTHORISATION_DECISION_AND_REASON_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[authorisation]]=await connection.execute('SELECT * FROM os2_customer_merge_execution_authorisations WHERE id=:id FOR UPDATE',{id});
        if(!authorisation)throw Object.assign(new Error('MERGE_EXECUTION_AUTHORISATION_NOT_FOUND'),{statusCode:404});
        if(authorisation.status!=='pending')throw Object.assign(new Error('AUTHORISATION_NOT_PENDING'),{statusCode:409});
        if(Number(authorisation.requested_by)===Number(req.user.id))throw Object.assign(new Error('SELF_AUTHORISATION_NOT_ALLOWED'),{statusCode:409});
        const [[plan]]=await connection.execute('SELECT * FROM os2_customer_merge_plans WHERE id=:id FOR UPDATE',{id:authorisation.merge_plan_id});
        if(!plan||plan.status!=='approved'||plan.invalidated_at||plan.executed_at||!plan.revalidated_at||Number(plan.blocker_count)>0||Number(plan.conflict_count)>0||plan.plan_hash!==authorisation.plan_hash||plan.current_snapshot_hash!==authorisation.snapshot_hash)throw Object.assign(new Error('MERGE_PLAN_CHANGED'),{statusCode:409});
        const evidence=decision==='authorised'?await requireRecoverablePreviewBackup(connection,authorisation.backup_run_id):null;
        await connection.execute(`UPDATE os2_customer_merge_execution_authorisations SET status=:decision,authorised_by=IF(:decision='authorised',:actor,NULL),authorised_at=IF(:decision='authorised',NOW(),NULL),expires_at=IF(:decision='authorised',DATE_ADD(NOW(),INTERVAL 30 MINUTE),NULL),revocation_reason=IF(:decision='rejected',:reason,NULL),updated_at=NOW() WHERE id=:id`,{id,decision,actor:req.user.id,reason});
        const [[updated]]=await connection.execute('SELECT expires_at,(expires_at IS NOT NULL AND expires_at>NOW()) AS is_unexpired FROM os2_customer_merge_execution_authorisations WHERE id=:id',{id});
        if(decision==='authorised'&&Number(updated.is_unexpired)!==1)throw Object.assign(new Error('AUTHORISATION_EXPIRY_NOT_ACTIVE'),{statusCode:409});
        const expiresAt=decision==='authorised'?updated.expires_at:null;
        const details={expiresAt,isUnexpired:decision==='authorised',backupRunId:authorisation.backup_run_id,restoreTestId:evidence?evidence.restore.id:null,executionAvailable:false};
        await connection.execute(`INSERT INTO os2_customer_merge_execution_authorisation_history(authorisation_id,event_type,from_status,to_status,reason,details_json,changed_by,created_at) VALUES(:id,'decision','pending',:decision,:reason,:details,:actor,NOW())`,{id,decision,reason,details:JSON.stringify(details),actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_merge_execution_authorisation_decided',entityType:'os2_customer_merge_execution_authorisations',entityId:id,masterCustomerId:plan.survivor_customer_id,description:`Merge execution authorisation ${id} ${decision}; execution remains disabled`,before:{status:'pending'},after:{status:decision,reason,...details},requestContext:context(req)});
        return{authorisationId:id,status:decision,expiresAt,executionAvailable:false};
      });
      res.json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'MERGE_EXECUTION_AUTHORISATION_DECISION_FAILED'});}
  });

  router.post('/api/os2/customer-merge-execution-authorisations/:id/revoke',requirePermission('customer.merge.execution.authorise'),async(req,res)=>{
    const id=positiveId(req.params.id),reason=text(req.body.reason);if(!id||!reason)return res.status(400).json({ok:false,error:'AUTHORISATION_AND_REASON_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[authorisation]]=await connection.execute('SELECT * FROM os2_customer_merge_execution_authorisations WHERE id=:id FOR UPDATE',{id});
        if(!authorisation)throw Object.assign(new Error('MERGE_EXECUTION_AUTHORISATION_NOT_FOUND'),{statusCode:404});
        if(authorisation.status!=='authorised'||authorisation.consumed_at)throw Object.assign(new Error('AUTHORISATION_NOT_REVOCABLE'),{statusCode:409});
        const [[plan]]=await connection.execute('SELECT survivor_customer_id FROM os2_customer_merge_plans WHERE id=:id',{id:authorisation.merge_plan_id});
        await connection.execute(`UPDATE os2_customer_merge_execution_authorisations SET status='revoked',revoked_by=:actor,revoked_at=NOW(),revocation_reason=:reason,updated_at=NOW() WHERE id=:id`,{id,actor:req.user.id,reason});
        await connection.execute(`INSERT INTO os2_customer_merge_execution_authorisation_history(authorisation_id,event_type,from_status,to_status,reason,changed_by,created_at) VALUES(:id,'revoked','authorised','revoked',:reason,:actor,NOW())`,{id,reason,actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_merge_execution_authorisation_revoked',entityType:'os2_customer_merge_execution_authorisations',entityId:id,masterCustomerId:plan?plan.survivor_customer_id:null,description:`Revoked merge execution authorisation ${id}; execution remains disabled`,before:{status:'authorised',expiresAt:authorisation.expires_at},after:{status:'revoked',reason},requestContext:context(req)});
        return{authorisationId:id,status:'revoked',executionAvailable:false};
      });
      res.json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'MERGE_EXECUTION_AUTHORISATION_REVOKE_FAILED'});}
  });

  router.get('/api/os2/customer-merge-execution-authorisations/:id',requirePermission('customer.merge.review'),async(req,res)=>{const id=positiveId(req.params.id);if(!id)return res.status(400).json({ok:false,error:'INVALID_AUTHORISATION_ID'});try{const [[authorisation]]=await pool.execute('SELECT *, (expires_at IS NOT NULL AND expires_at>NOW()) AS is_unexpired FROM os2_customer_merge_execution_authorisations WHERE id=:id',{id});if(!authorisation)return res.status(404).json({ok:false,error:'MERGE_EXECUTION_AUTHORISATION_NOT_FOUND'});const [history]=await pool.execute('SELECT * FROM os2_customer_merge_execution_authorisation_history WHERE authorisation_id=:id ORDER BY created_at DESC',{id});res.json({ok:true,authorisation,history,executionAvailable:false});}catch(error){res.status(500).json({ok:false,error:'MERGE_EXECUTION_AUTHORISATION_LOAD_FAILED'});}});
  return router;
};
