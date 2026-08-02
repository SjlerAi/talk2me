'use strict';

const express=require('express');
const {withTransaction}=require('./core/transaction');
const {requirePermission}=require('./core/permissions');
const {RESTRICTION_TYPES,revokeRestriction}=require('./core/restrictions');

function id(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null;}
function text(v,max=1000){const s=String(v==null?'':v).trim();return s?s.slice(0,max):null;}
function context(req){return{ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}

module.exports=function createRestrictionGovernanceRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/restriction-governance',requireAuth);

  router.get('/api/os2/restriction-governance/catalog',requirePermission('restriction.read'),(req,res)=>{
    res.json({ok:true,restrictionTypes:RESTRICTION_TYPES});
  });

  router.get('/api/os2/restriction-governance/customers/:customerId/history',requirePermission('restriction.read'),async(req,res)=>{
    const customerId=id(req.params.customerId);if(!customerId)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    try{
      const [rows]=await pool.execute(`SELECT h.*,r.restriction_type,s.full_name changed_by_name
        FROM os2_restriction_history h JOIN os2_customer_restrictions r ON r.id=h.restriction_id
        LEFT JOIN staff_users s ON s.id=h.changed_by WHERE h.master_customer_id=:customerId
        ORDER BY h.created_at DESC,h.id DESC LIMIT 500`,{customerId});
      res.json({ok:true,history:rows});
    }catch(error){res.status(500).json({ok:false,error:'RESTRICTION_HISTORY_LOAD_FAILED'});}
  });

  router.post('/api/os2/restriction-governance/restrictions/:id/revoke',requirePermission('restriction.update'),async(req,res)=>{
    const restrictionId=id(req.params.id),reason=text(req.body.reason,1000);
    if(!restrictionId)return res.status(400).json({ok:false,error:'INVALID_RESTRICTION_ID'});
    if(!reason)return res.status(400).json({ok:false,error:'RESTRICTION_REVOKE_REASON_REQUIRED'});
    try{
      const result=await withTransaction(pool,connection=>revokeRestriction(connection,{restrictionId,reason,actorStaffId:req.user.id,requestContext:context(req)}));
      res.json({ok:true,...result});
    }catch(error){
      const known=['RESTRICTION_NOT_FOUND','RESTRICTION_ALREADY_INACTIVE','RESTRICTION_REVOKE_REASON_REQUIRED'];
      res.status(error.message==='RESTRICTION_NOT_FOUND'?404:known.includes(error.message)?409:500).json({ok:false,error:known.includes(error.message)?error.message:'RESTRICTION_REVOKE_FAILED'});
    }
  });
  return router;
};
