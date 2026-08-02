'use strict';

const express = require('express');
const { withTransaction } = require('./core/transaction');
const { requirePermission } = require('./core/permissions');
const { appendAudit } = require('./core/audit');
const createRepresentativeGovernanceRouter=require('./representative-governance-routes');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
function text(value,max=500){const result=String(value==null?'':value).trim();return result?result.slice(0,max):null;}
function context(req){return {ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}

module.exports=function createCustomerAccessRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/customer-access',requireAuth);
  router.use(createRepresentativeGovernanceRouter({pool,requireAuth}));

  router.get('/api/os2/customer-access/:customerId',requirePermission('customer.assign'),async(req,res)=>{
    const customerId=positiveId(req.params.customerId);if(!customerId)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    try{
      const [rows]=await pool.execute(`SELECT g.*,s.full_name staff_name,gb.full_name granted_by_name,rb.full_name revoked_by_name
        FROM os2_customer_access_grants g
        JOIN staff_users s ON s.id=g.staff_id
        LEFT JOIN staff_users gb ON gb.id=g.granted_by
        LEFT JOIN staff_users rb ON rb.id=g.revoked_by
        WHERE g.master_customer_id=:customerId ORDER BY g.revoked_at IS NULL DESC,g.granted_at DESC`,{customerId});
      res.json({ok:true,grants:rows});
    }catch(error){res.status(500).json({ok:false,error:'CUSTOMER_ACCESS_GRANTS_LOAD_FAILED'});}
  });

  router.post('/api/os2/customer-access/:customerId',requirePermission('customer.assign'),async(req,res)=>{
    const customerId=positiveId(req.params.customerId),staffId=positiveId(req.body.staffId);
    const level=['read','write','manage'].includes(req.body.accessLevel)?req.body.accessLevel:null;
    const reason=text(req.body.reason);const expiresAt=req.body.expiresAt||null;
    if(!customerId||!staffId||!level||!reason)return res.status(400).json({ok:false,error:'CUSTOMER_STAFF_LEVEL_REASON_REQUIRED'});
    if(Number(staffId)===Number(req.user.id)&&String(req.user.role).toLowerCase()==='staff')return res.status(409).json({ok:false,error:'SELF_GRANT_NOT_ALLOWED'});
    try{
      const grantId=await withTransaction(pool,async connection=>{
        const [[customer]]=await connection.execute('SELECT id FROM os2_master_customers WHERE id=:id AND archived_at IS NULL FOR UPDATE',{id:customerId});
        if(!customer)throw Object.assign(new Error('CUSTOMER_NOT_FOUND'),{statusCode:404});
        const [[staff]]=await connection.execute('SELECT id FROM staff_users WHERE id=:id AND is_active=1',{id:staffId});
        if(!staff)throw Object.assign(new Error('STAFF_NOT_FOUND'),{statusCode:404});
        const [[existing]]=await connection.execute(`SELECT id FROM os2_customer_access_grants WHERE master_customer_id=:customerId AND staff_id=:staffId AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1 FOR UPDATE`,{customerId,staffId});
        if(existing)throw Object.assign(new Error('ACTIVE_CUSTOMER_ACCESS_GRANT_EXISTS'),{statusCode:409});
        const [insert]=await connection.execute(`INSERT INTO os2_customer_access_grants(master_customer_id,staff_id,access_level,reason,granted_by,granted_at,expires_at,created_at,updated_at)
          VALUES(:customerId,:staffId,:level,:reason,:actor,NOW(),:expiresAt,NOW(),NOW())`,{customerId,staffId,level,reason,actor:req.user.id,expiresAt});
        const id=Number(insert.insertId);
        await connection.execute(`INSERT INTO os2_customer_access_history(master_customer_id,staff_id,event_type,access_level,reason,changed_by,details_json,created_at)
          VALUES(:customerId,:staffId,'granted',:level,:reason,:actor,:details,NOW())`,{customerId,staffId,level,reason,actor:req.user.id,details:JSON.stringify({grantId:id,expiresAt})});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_access_granted',entityType:'os2_customer_access_grants',entityId:id,masterCustomerId:customerId,description:`Granted ${level} customer access to staff ${staffId}`,after:{staffId,level,reason,expiresAt},requestContext:context(req)});
        return id;
      });
      res.status(201).json({ok:true,grantId});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'CUSTOMER_ACCESS_GRANT_FAILED'});}
  });

  router.post('/api/os2/customer-access/grants/:grantId/revoke',requirePermission('customer.assign'),async(req,res)=>{
    const grantId=positiveId(req.params.grantId),reason=text(req.body.reason);if(!grantId||!reason)return res.status(400).json({ok:false,error:'GRANT_AND_REASON_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[grant]]=await connection.execute('SELECT * FROM os2_customer_access_grants WHERE id=:id FOR UPDATE',{id:grantId});
        if(!grant)throw Object.assign(new Error('CUSTOMER_ACCESS_GRANT_NOT_FOUND'),{statusCode:404});
        if(grant.revoked_at)throw Object.assign(new Error('CUSTOMER_ACCESS_GRANT_ALREADY_REVOKED'),{statusCode:409});
        await connection.execute(`UPDATE os2_customer_access_grants SET revoked_at=NOW(),revoked_by=:actor,revoke_reason=:reason,updated_at=NOW() WHERE id=:id`,{id:grantId,actor:req.user.id,reason});
        await connection.execute(`INSERT INTO os2_customer_access_history(master_customer_id,staff_id,event_type,access_level,reason,changed_by,details_json,created_at)
          VALUES(:customerId,:staffId,'revoked',:level,:reason,:actor,:details,NOW())`,{customerId:grant.master_customer_id,staffId:grant.staff_id,level:grant.access_level,reason,actor:req.user.id,details:JSON.stringify({grantId})});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'customer_access_revoked',entityType:'os2_customer_access_grants',entityId:grantId,masterCustomerId:grant.master_customer_id,description:`Revoked customer access grant ${grantId}`,before:grant,after:{revoked:true,reason},requestContext:context(req)});
        return {grantId,masterCustomerId:Number(grant.master_customer_id),staffId:Number(grant.staff_id)};
      });
      res.json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'CUSTOMER_ACCESS_REVOKE_FAILED'});}
  });

  router.get('/api/os2/customer-access/:customerId/history',requirePermission('customer.assign'),async(req,res)=>{
    const customerId=positiveId(req.params.customerId);if(!customerId)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    try{const [rows]=await pool.execute(`SELECT h.*,s.full_name staff_name,c.full_name changed_by_name FROM os2_customer_access_history h LEFT JOIN staff_users s ON s.id=h.staff_id LEFT JOIN staff_users c ON c.id=h.changed_by WHERE h.master_customer_id=:customerId ORDER BY h.created_at DESC LIMIT 500`,{customerId});res.json({ok:true,history:rows});}
    catch(error){res.status(500).json({ok:false,error:'CUSTOMER_ACCESS_HISTORY_LOAD_FAILED'});}
  });

  return router;
};
