'use strict';
// The only archive operation in the temporary UAT cleanup tool.
// Requires explicit selection, approval, stable original snapshot and safe staff ownership.
const express=require('express');
const crypto=require('crypto');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {canUseTemporaryCleanup}=require('../services/temporary-cleanup-access');
const {csrfValid}=require('../services/temporary-cleanup-correction');
const {nextUrl}=require('../services/temporary-cleanup-queue');
const {AssignmentConflict,staffPlan,applyStaffPlan}=require('../services/temporary-cleanup-ownership');
const router=express.Router();
function fail(res,code,message){return res.status(code).render('error',{title:'Consolidation not applied',message});}
class UnsafeConsolidation extends Error {}
const listSql="SELECT id,account_id,account_number,client_name,cell_number,cell_number_normalised,email,DATE_FORMAT(previous_upgrade_date,'%Y-%m-%d') previous_upgrade_date,DATE_FORMAT(next_upgrade_date,'%Y-%m-%d') next_upgrade_date,DATE_FORMAT(upgrade_date,'%Y-%m-%d') upgrade_date,package_name,line_status,is_active,updated_at FROM clients WHERE cell_number_normalised=:key ORDER BY account_id,id LIMIT 80";
function listHash(rows){return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
router.post('/temporary-cleanup/consolidate/:key',requireAuth,async(req,res,next)=>{
  if(!canUseTemporaryCleanup(req.session.user))return fail(res,404,'Temporary UAT cleanup not available.');
  const key=String(req.params.key||'');
  const primaryId=Number(req.body.primary_id);
  if(!/^27[0-9]{9}$/.test(key)||!Number.isSafeInteger(primaryId)||primaryId<1)return fail(res,400,'Invalid line or current-record identifier.');
  if(!csrfValid(req)||req.body.confirm_consolidate!=='1')return fail(res,403,'Review and explicitly confirm the operation before applying.');
  const reason=String(req.body.reason||'').trim().slice(0,2000);
  if(reason.length<15)return fail(res,422,'Provide at least fifteen characters explaining your current-record choice and evidence.');
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [original]=await connection.execute(listSql+' FOR UPDATE',{key});
    if(original.length<2||original.length>=80)throw new UnsafeConsolidation('Expected two or more complete historical records. No changes applied.');
    if(listHash(original)!==String(req.body.snapshot||''))throw new UnsafeConsolidation('Customer records changed after this review opened. Reload before confirming.');
    const ids=original.map(r=>Number(r.id));
    const active=original.filter(r=>Number(r.is_active)===1);
    const chosen=active.find(r=>Number(r.id)===primaryId);
    if(!chosen||active.length<2)throw new UnsafeConsolidation('Choose one active record from a group with multiple active duplicates.');
    const accounts=new Set(original.map(r=>Number(r.account_id||0)));
    if(accounts.size!==1||accounts.has(0))throw new UnsafeConsolidation('These records are not linked to one verified customer account.');
    // Prevent physical archival of a differently named/identified customer. The
    // non-destructive grouping ledger is NEVER authority to archive a line.
    const names=new Set(active.map(r=>String(r.client_name||'').toUpperCase().replace(/[^A-Z0-9]/g,'')));
    if(names.size!==1||names.has(''))throw new UnsafeConsolidation('Different customer names. Correct and verify the identity before consolidation.');
    const [identityRows]=await connection.query('SELECT id,id_number FROM clients WHERE id IN (?) FOR UPDATE',[ids]);
    const identityNumbers=new Set(identityRows.map(r=>String(r.id_number||'').replace(/\\D/g,'')).filter(Boolean));
    if(identityNumbers.size>1)throw new UnsafeConsolidation('Different identity numbers. Do not archive either line.');
    const emails=new Set(active.map(r=>String(r.email||'').trim().toLowerCase()).filter(Boolean));
    if(emails.size>1)throw new UnsafeConsolidation('Different customer email addresses. Verify ownership before consolidation.');
    const [logicalOnly]=await connection.execute('SELECT id FROM temporary_duplicate_triage WHERE case_type="safe_line_group" AND status="auto_grouped" AND account_id=:account AND phone_normalised=:key LIMIT 1',{account:Number(chosen.account_id),key});
    if(logicalOnly.length)throw new UnsafeConsolidation('This group is display-only. A physical archive requires separate verified approval and restore testing.');
    const archiveIds=active.filter(r=>Number(r.id)!==primaryId).map(r=>Number(r.id));
    const [masters]=await connection.execute('SELECT id,assigned_staff_id FROM customer_accounts WHERE id=:id FOR UPDATE',{id:Number(chosen.account_id)});
    if(masters.length!==1)throw new UnsafeConsolidation('The account record is missing; do not consolidate.');
    const [assignmentRows]=await connection.query('SELECT id,client_id,assigned_staff_id,is_active,account_number,assigned_by,notes FROM client_assignments WHERE client_id IN (?) FOR UPDATE',[ids]);
    const plan=staffPlan(assignmentRows,primaryId,masters[0].assigned_staff_id);
    const [tasks]=await connection.query("SELECT id,related_client_id,status FROM staff_tasks WHERE related_client_id IN (?) AND status IN ('unread','seen','in_progress') LIMIT 20",[archiveIds]);
    if(tasks.length)throw new UnsafeConsolidation('An older line still has outstanding tasks. Complete or reassign those tasks before archiving this line.');
    const [baseRows]=await connection.query('SELECT id,client_id,account_id,msisdn_normalised FROM mobile_base_current WHERE client_id IN (?) FOR UPDATE',[archiveIds]);
    if(baseRows.some(r=>String(r.msisdn_normalised)!==key || (r.account_id && Number(r.account_id)!==Number(chosen.account_id))))
      throw new UnsafeConsolidation('The supplier source has a different phone/account linked to a candidate. Manual investigation required.');
    // Snapshot before changes includes full original customer rows and every affected reference.
    const before={customer_records:original,staff_assignments:assignmentRows,account_master:masters[0],base_links:baseRows,primary_id:primaryId,staff_plan:{action:plan.action,source_client_id:plan.source?.client_id||null,staff_id:plan.staffId}};
    await connection.query("UPDATE clients SET is_active=0,lifecycle_status='inactive',updated_at=NOW() WHERE id IN (?) AND is_active=1",[archiveIds]);
    const staffEvents=await applyStaffPlan(connection,plan,assignmentRows,primaryId,chosen.account_number,Number(req.session.user.id),reason,archiveIds);
    if(baseRows.length)await connection.query('UPDATE mobile_base_current SET client_id=?,updated_at=NOW() WHERE client_id IN (?) AND msisdn_normalised=?',[primaryId,archiveIds,key]);
    const [afterClients]=await connection.execute(listSql,{key});
    const [afterAssignments]=await connection.query('SELECT id,client_id,assigned_staff_id,is_active,account_number,assigned_by,notes FROM client_assignments WHERE client_id IN (?)',[ids]);
    const [afterBase]=await connection.query('SELECT id,client_id,account_id,msisdn_normalised FROM mobile_base_current WHERE id IN (?)',[baseRows.length?baseRows.map(r=>r.id):[0]]);
    const after={customer_records:afterClients,staff_assignments:afterAssignments,account_master:masters[0],base_links:afterBase,primary_id:primaryId,staff_events:staffEvents};
    const userId=Number(req.session.user.id);
    await connection.execute('INSERT INTO temporary_cleanup_changes (action_type,case_type,case_key,client_id,before_json,after_json,reviewed_by,notes) VALUES ("consolidate_phone","same_account_phone",:key,:primary,:before,:after,:staff,:reason)',{
      key,primary:primaryId,before:JSON.stringify(before),after:JSON.stringify(after),staff:userId,reason
    });
    const approvalNote='Consolidated in UAT. Kept client #'+primaryId+' current; archived historical records: '+archiveIds.join(',')+'. '+(plan.action==='transfer'?'Preserved staff #'+plan.staffId+' on current record. ':'')+reason;
    await connection.execute('INSERT INTO temporary_cleanup_decisions (case_type,case_key,decision,notes,source_snapshot_hash,reviewed_by,reviewed_at) VALUES ("same_account_phone",:key,"approved_grouping",:notes,:hash,:staff,NOW()) ON DUPLICATE KEY UPDATE decision=VALUES(decision),notes=VALUES(notes),source_snapshot_hash=VALUES(source_snapshot_hash),reviewed_by=VALUES(reviewed_by),reviewed_at=VALUES(reviewed_at)',{
      key,notes:approvalNote,hash:listHash(afterClients),staff:userId
    });
    await connection.execute('INSERT INTO temporary_cleanup_review_history (case_type,case_key,decision,notes,source_snapshot_hash,reviewed_by) VALUES ("same_account_phone",:key,"approved_grouping",:notes,:hash,:staff)',{
      key,notes:approvalNote,hash:listHash(afterClients),staff:userId
    });
    await connection.execute('INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES (:staff,"temporary_cleanup_consolidated","clients",:primary,:reason,:before,:after,:ip,:ua)',{
      staff:userId,primary:primaryId,reason:'UAT line consolidation: '+reason.slice(0,450),before:JSON.stringify(before),after:JSON.stringify(after),
      ip:String(req.ip||'').slice(0,64),ua:String(req.get('user-agent')||'').slice(0,255)
    });
    await connection.commit();
    return res.redirect(nextUrl(res.locals.basePath,'same_account_phone','consolidated'));
  }catch(e){
    try{await connection.rollback();}catch(_){}
    if(e instanceof AssignmentConflict || e instanceof UnsafeConsolidation){
      const codes=new Set(['staff_conflict','account_staff_conflict','inactive_staff']);
      const code=e instanceof AssignmentConflict && codes.has(e.code) ? e.code :
        /outstanding tasks/i.test(e.message) ? 'open_tasks' :
        /source.*different/i.test(e.message) ? 'source_conflict' :
        /changed|reload/i.test(e.message) ? 'stale' : 'review_required';
      return res.redirect(303,res.locals.basePath+'/temporary-cleanup/review/same_account_phone/'+encodeURIComponent(key)+'?blocked='+encodeURIComponent(code));
    }
    return next(e);
  }finally{connection.release();}
});
module.exports=router;
