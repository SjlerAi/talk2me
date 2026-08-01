'use strict';

const express=require('express');
const { requirePermission }=require('./core/permissions');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}

module.exports=function createCustomerMergeExecutionReadinessRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/customer-merge-execution-readiness',requireAuth);

  router.get('/api/os2/customer-merge-execution-readiness/:authorisationId',requirePermission('customer.merge.authorise'),async(req,res)=>{
    const authorisationId=positiveId(req.params.authorisationId);
    if(!authorisationId)return res.status(400).json({ok:false,error:'INVALID_AUTHORISATION_ID'});
    try{
      const [[row]]=await pool.execute(`SELECT a.*,p.status plan_status,p.plan_hash current_plan_hash,p.current_snapshot_hash,
        p.blocker_count,p.conflict_count,p.invalidated_at,p.executed_at,
        b.status backup_status,b.database_name,b.verified_at,b.checksum_sha256
        FROM os2_customer_merge_execution_authorisations a
        JOIN os2_customer_merge_plans p ON p.id=a.merge_plan_id
        JOIN os2_backup_runs b ON b.id=a.backup_run_id
        WHERE a.id=:id`,{id:authorisationId});
      if(!row)return res.status(404).json({ok:false,error:'MERGE_AUTHORISATION_NOT_FOUND'});
      const checks={
        authorisationApproved:row.status==='authorised',
        authorisationUnexpired:Boolean(row.expires_at)&&new Date(row.expires_at).getTime()>Date.now(),
        authorisationUnused:!row.consumed_at,
        authorisationNotRevoked:!row.revoked_at,
        planApproved:row.plan_status==='approved',
        planNotInvalidated:!row.invalidated_at,
        planNotExecuted:!row.executed_at,
        planHashMatches:row.plan_hash===row.current_plan_hash,
        snapshotHashMatches:row.snapshot_hash===row.current_snapshot_hash,
        noBlockers:Number(row.blocker_count||0)===0,
        noConflicts:Number(row.conflict_count||0)===0,
        backupVerified:row.backup_status==='verified'&&Boolean(row.verified_at),
        backupIsPreview:row.database_name==='kloka_talk2me',
        backupChecksumPresent:/^[a-f0-9]{64}$/i.test(String(row.checksum_sha256||'')),
        changeReferencePresent:Boolean(String(row.change_reference||'').trim())
      };
      const ready=Object.values(checks).every(Boolean);
      res.json({ok:true,authorisationId,readyForFutureExecution:ready,executionAvailable:false,checks,blockingChecks:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)});
    }catch(error){res.status(500).json({ok:false,error:'MERGE_EXECUTION_READINESS_FAILED'});}
  });

  return router;
};
