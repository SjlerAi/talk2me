'use strict';

const express=require('express');
const { withTransaction }=require('./core/transaction');
const { requirePermission }=require('./core/permissions');
const { appendAudit }=require('./core/audit');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
function text(value,max=1000){const result=String(value==null?'':value).trim();return result?result.slice(0,max):null;}
function requestContext(req){return {ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}

async function blockers(connection,customerId){
  const [[counts]]=await connection.execute(`SELECT
    (SELECT COUNT(*) FROM os2_mobile_lines WHERE master_customer_id=:id AND archived_at IS NULL AND COALESCE(line_status,'active') NOT IN ('cancelled','inactive')) active_mobile_lines,
    (SELECT COUNT(*) FROM os2_fixed_accounts fa JOIN os2_fixed_services fs ON fs.fixed_account_id=fa.id WHERE fa.master_customer_id=:id AND fa.archived_at IS NULL AND fs.archived_at IS NULL AND COALESCE(fs.service_status,'active') NOT IN ('cancelled','inactive')) active_fixed_services,
    (SELECT COUNT(*) FROM os2_work_items WHERE master_customer_id=:id AND archived_at IS NULL AND lifecycle_state NOT IN ('accepted','archived','completed','cancelled')) open_work_items,
    (SELECT COUNT(*) FROM os2_approval_requests WHERE master_customer_id=:id AND status IN ('pending','deferred')) pending_approvals,
    (SELECT COUNT(*) FROM os2_customer_claims WHERE master_customer_id=:id AND status='pending') pending_claims`,{id:customerId});
  return Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,Number(value||0)]));
}

module.exports=function createCustomerLifecycleRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/customer-lifecycle',requireAuth);

  router.get('/api/os2/customer-lifecycle/:customerId/status',requirePermission('customer.read'),async(req,res)=>{
    const customerId=positiveId(req.params.customerId);if(!customerId)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    try{
      const [[customer]]=await pool.execute('SELECT id,display_name,status,archived_at,archive_reason,archived_by,reactivated_at,reactivated_by FROM os2_master_customers WHERE id=:id',{id:customerId});
      if(!customer)return res.status(404).json({ok:false,error:'CUSTOMER_NOT_FOUND'});
      const lifecycleBlockers=await blockers(pool,customerId);
      res.json({ok:true,customer,blockers:lifecycleBlockers,canArchive:Object.values(lifecycleBlockers).every(value=>value===0)});
    }catch(error){res.status(500).json({ok:false,error:'CUSTOMER_LIFECYCLE_STATUS_FAILED'});}
  });

  router.post('/api/os2/customer-lifecycle/:customerId/archive',requirePermission('customer.archive'),async(req,res)=>{
    const customerId=positiveId(req.params.customerId),reason=text(req.body.reason);
    if(!customerId||!reason)return res.status(400).json({ok:false,error:'CUSTOMER_AND_ARCHIVE_REASON_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[customer]]=await connection.execute('SELECT * FROM os2_master_customers WHERE id=:id FOR UPDATE',{id:customerId});
        if(!customer)throw Object.assign(new Error('CUSTOMER_NOT_FOUND'),{statusCode:404});
        if(customer.archived_at)throw Object.assign(new Error('CUSTOMER_ALREADY_ARCHIVED'),{statusCode:409});
        const lifecycleBlockers=await blockers(connection,customerId);
        if(Object.values(lifecycleBlockers).some(value=>value>0))throw Object.assign(new Error('CUSTOMER_ARCHIVE_BLOCKED'),{statusCode:409,details:lifecycleBlockers});
        const after={status:'archived',archived_at:new Date().toISOString(),archive_reason:reason,archived_by:Number(req.user.id)};
        await connection.execute(`UPDATE os2_master_customers SET status='archived',archived_at=NOW(),archive_reason=:reason,archived_by=:actor,updated_by=:actor,updated_at=NOW() WHERE id=:id`,{id:customerId,reason,actor:req.user.id});
        await connection.execute(`UPDATE os2_customer_ownership SET is_current=0,effective_to=NOW() WHERE master_customer_id=:id AND is_current=1`,{id:customerId});
        await connection.execute(`UPDATE os2_customer_access_grants SET revoked_at=NOW(),revoked_by=:actor,revoke_reason='customer_archived',updated_at=NOW() WHERE master_customer_id=:id AND revoked_at IS NULL`,{id:customerId,actor:req.user.id});
        await connection.execute(`INSERT INTO os2_customer_lifecycle_history(master_customer_id,event_type,reason,before_json,after_json,changed_by,created_at) VALUES(:id,'archived',:reason,:before,:after,:actor,NOW())`,{id:customerId,reason,before:JSON.stringify(customer),after:JSON.stringify(after),actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'master_customer_archived',entityType:'os2_master_customers',entityId:customerId,masterCustomerId:customerId,description:`Archived Master Customer ${customer.display_name}`,before:customer,after,requestContext:requestContext(req)});
        return {customerId,archived:true};
      });
      res.json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'CUSTOMER_ARCHIVE_FAILED',blockers:error.details||null});}
  });

  router.post('/api/os2/customer-lifecycle/:customerId/reactivate',requirePermission('customer.archive'),async(req,res)=>{
    const customerId=positiveId(req.params.customerId),reason=text(req.body.reason),assignedStaffId=positiveId(req.body.assignedStaffId);
    if(!customerId||!reason||!assignedStaffId)return res.status(400).json({ok:false,error:'CUSTOMER_REASON_AND_OWNER_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[customer]]=await connection.execute('SELECT * FROM os2_master_customers WHERE id=:id FOR UPDATE',{id:customerId});
        if(!customer)throw Object.assign(new Error('CUSTOMER_NOT_FOUND'),{statusCode:404});
        if(!customer.archived_at)throw Object.assign(new Error('CUSTOMER_NOT_ARCHIVED'),{statusCode:409});
        const [[staff]]=await connection.execute('SELECT id FROM staff_users WHERE id=:id AND is_active=1',{id:assignedStaffId});
        if(!staff)throw Object.assign(new Error('ASSIGNED_STAFF_NOT_FOUND'),{statusCode:404});
        const after={status:'active',archived_at:null,reactivated_at:new Date().toISOString(),reactivated_by:Number(req.user.id),assigned_staff_id:assignedStaffId};
        await connection.execute(`UPDATE os2_master_customers SET status='active',archived_at=NULL,archive_reason=NULL,archived_by=NULL,reactivated_at=NOW(),reactivated_by=:actor,updated_by=:actor,updated_at=NOW() WHERE id=:id`,{id:customerId,actor:req.user.id});
        await connection.execute(`UPDATE os2_customer_ownership SET is_current=0,effective_to=COALESCE(effective_to,NOW()) WHERE master_customer_id=:id AND is_current=1`,{id:customerId});
        await connection.execute(`INSERT INTO os2_customer_ownership(master_customer_id,assigned_staff_id,ownership_reason,is_current,effective_from,created_by,created_at) VALUES(:id,:staffId,'customer_reactivation',1,NOW(),:actor,NOW())`,{id:customerId,staffId:assignedStaffId,actor:req.user.id});
        await connection.execute(`INSERT INTO os2_customer_lifecycle_history(master_customer_id,event_type,reason,before_json,after_json,changed_by,created_at) VALUES(:id,'reactivated',:reason,:before,:after,:actor,NOW())`,{id:customerId,reason,before:JSON.stringify(customer),after:JSON.stringify(after),actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'master_customer_reactivated',entityType:'os2_master_customers',entityId:customerId,masterCustomerId:customerId,description:`Reactivated Master Customer ${customer.display_name}`,before:customer,after,requestContext:requestContext(req)});
        return {customerId,reactivated:true,assignedStaffId};
      });
      res.json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'CUSTOMER_REACTIVATION_FAILED'});}
  });

  router.get('/api/os2/customer-lifecycle/:customerId/history',requirePermission('customer.read'),async(req,res)=>{
    const customerId=positiveId(req.params.customerId);if(!customerId)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    try{const [rows]=await pool.execute(`SELECT h.*,s.full_name changed_by_name FROM os2_customer_lifecycle_history h LEFT JOIN staff_users s ON s.id=h.changed_by WHERE h.master_customer_id=:id ORDER BY h.created_at DESC LIMIT 250`,{id:customerId});res.json({ok:true,history:rows});}
    catch(error){res.status(500).json({ok:false,error:'CUSTOMER_LIFECYCLE_HISTORY_FAILED'});}
  });
  return router;
};
