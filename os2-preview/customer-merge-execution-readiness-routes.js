'use strict';

const express=require('express');
const { requirePermission }=require('./core/permissions');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}

module.exports=function createCustomerMergeExecutionReadinessRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/customer-merge-execution-readiness',requireAuth);

  router.get('/api/os2/customer-merge-execution-readiness/:authorisationId',requirePermission('customer.merge.execution.authorise'),async(req,res)=>{
    const authorisationId=positiveId(req.params.authorisationId);
    if(!authorisationId)return res.status(400).json({ok:false,error:'INVALID_AUTHORISATION_ID'});
    try{
      const [[row]]=await pool.execute(`SELECT a.*,p.status plan_status,p.plan_hash current_plan_hash,p.current_snapshot_hash,
        p.blocker_count,p.conflict_count,p.invalidated_at,p.executed_at,p.revalidated_at,
        b.status backup_status,b.backup_type,b.database_name,b.completed_at backup_completed_at,b.verified_at,b.checksum_sha256,b.storage_path,b.file_name,
        rt.status restore_status,rt.target_environment restore_target_environment,rt.expected_database_name restore_expected_database_name,
        rt.actual_database_name restore_actual_database_name,rt.completed_at restore_completed_at,rt.failed_checks restore_failed_checks
        FROM os2_customer_merge_execution_authorisations a
        JOIN os2_customer_merge_plans p ON p.id=a.merge_plan_id
        JOIN os2_backup_runs b ON b.id=a.backup_run_id
        LEFT JOIN os2_restore_tests rt ON rt.id=(
          SELECT rt2.id FROM os2_restore_tests rt2
          WHERE rt2.backup_run_id=b.id
          ORDER BY rt2.completed_at DESC,rt2.id DESC LIMIT 1
        )
        WHERE a.id=:id`,{id:authorisationId});
      if(!row)return res.status(404).json({ok:false,error:'MERGE_AUTHORISATION_NOT_FOUND'});
      const checks={
        authorisationApproved:row.status==='authorised',
        authorisationUnexpired:Boolean(row.expires_at)&&Boolean(row.authorisation_unexpired),
        authorisationUnused:!row.consumed_at,
        authorisationNotRevoked:!row.revoked_at,
        planApproved:row.plan_status==='approved',
        planRevalidated:Boolean(row.revalidated_at),
        planNotInvalidated:!row.invalidated_at,
        planNotExecuted:!row.executed_at,
        planHashMatches:row.plan_hash===row.current_plan_hash,
        snapshotHashMatches:row.snapshot_hash===row.current_snapshot_hash,
        noBlockers:Number(row.blocker_count||0)===0,
        noConflicts:Number(row.conflict_count||0)===0,
        backupVerified:row.backup_status==='verified'&&Boolean(row.verified_at),
        backupCompleted:Boolean(row.backup_completed_at),
        backupTypePermitted:['database','full'].includes(String(row.backup_type||'')),
        backupArtifactPresent:Boolean(String(row.storage_path||'').trim())&&Boolean(String(row.file_name||'').trim()),
        backupIsPreview:row.database_name==='kloka_talk2me',
        backupChecksumPresent:/^[a-f0-9]{64}$/i.test(String(row.checksum_sha256||'')),
        restoreTestPassed:row.restore_status==='passed'&&Boolean(row.restore_completed_at),
        restoreTargetIsolated:row.restore_target_environment==='isolated_preview_restore',
        restoreDatabaseMatches:row.restore_expected_database_name==='kloka_talk2me'&&row.restore_actual_database_name==='kloka_talk2me',
        restoreHasNoFailedChecks:Number(row.restore_failed_checks||0)===0,
        changeReferencePresent:Boolean(String(row.change_reference||'').trim())
      };
      const ready=Object.values(checks).every(Boolean);
      res.json({ok:true,authorisationId,readyForFutureExecution:ready,executionAvailable:false,checks,blockingChecks:Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)});
    }catch(error){
      console.error('Merge execution readiness failed',{authorisationId,code:error.code||null,message:error.message||null});
      res.status(500).json({ok:false,error:'MERGE_EXECUTION_READINESS_FAILED'});
    }
  });

  return router;
};
