'use strict';

const express=require('express');
const {withTransaction}=require('./core/transaction');
const {requirePermission}=require('./core/permissions');
const {REPRESENTATIVE_ACTIONS,safeRepresentative,createRepresentative,updateRepresentative,revokeRepresentative}=require('./core/representatives');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
function text(value,max=1000){const result=String(value==null?'':value).trim();return result?result.slice(0,max):null;}
function context(req){return {ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}
function payload(req){return {fullName:text(req.body.fullName,200),relationshipType:text(req.body.relationshipType,100),mobile:text(req.body.mobile,40),email:text(req.body.email,254)?.toLowerCase()||null,idReference:text(req.body.idReference,100),permissions:req.body.permissions,verificationMethod:text(req.body.verificationMethod,100),evidenceDocumentId:positiveId(req.body.evidenceDocumentId),expiresAt:req.body.expiresAt||null,reason:text(req.body.reason,1000),actorStaffId:req.user.id,requestContext:context(req)};}
function sendError(res,error,fallback){const known=new Set(['REPRESENTATIVE_NAME_AND_PERMISSIONS_REQUIRED','REPRESENTATIVE_NOT_FOUND','REPRESENTATIVE_ALREADY_REVOKED','REVOCATION_REASON_REQUIRED']);const status=error.statusCode||(known.has(error.message)?409:500);return res.status(status).json({ok:false,error:known.has(error.message)?error.message:fallback});}

module.exports=function createRepresentativeGovernanceRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2',requireAuth);

  router.get('/api/os2/customers/:id/representatives',requirePermission('restriction.read'),async(req,res)=>{
    const customerId=positiveId(req.params.id);if(!customerId)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    try{
      const [rows]=await pool.execute(`SELECT id,master_customer_id,full_name,relationship_type,mobile,email,id_reference,permissions_json,verification_method,evidence_document_id,expires_at,status,revoked_at,revoke_reason,created_at,updated_at FROM os2_authorised_representatives WHERE master_customer_id=:id ORDER BY revoked_at IS NULL DESC,full_name`,{id:customerId});
      res.json({ok:true,allowedActions:[...REPRESENTATIVE_ACTIONS],representatives:rows.map(safeRepresentative)});
    }catch(error){res.status(500).json({ok:false,error:'REPRESENTATIVES_LOAD_FAILED'});}
  });

  router.post('/api/os2/customers/:id/representatives',requirePermission('restriction.update'),async(req,res)=>{
    const customerId=positiveId(req.params.id);if(!customerId)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    try{const representativeId=await withTransaction(pool,connection=>createRepresentative(connection,{masterCustomerId:customerId,...payload(req)}));res.status(201).json({ok:true,representativeId});}
    catch(error){sendError(res,error,'REPRESENTATIVE_CREATE_FAILED');}
  });

  router.put('/api/os2/representatives/:id',requirePermission('restriction.update'),async(req,res)=>{
    const representativeId=positiveId(req.params.id);if(!representativeId)return res.status(400).json({ok:false,error:'INVALID_REPRESENTATIVE_ID'});
    try{const representative=await withTransaction(pool,connection=>updateRepresentative(connection,{representativeId,...payload(req)}));res.json({ok:true,representative});}
    catch(error){sendError(res,error,'REPRESENTATIVE_UPDATE_FAILED');}
  });

  router.post('/api/os2/representatives/:id/revoke',requirePermission('restriction.update'),async(req,res)=>{
    const representativeId=positiveId(req.params.id),reason=text(req.body.reason,1000);if(!representativeId||!reason)return res.status(400).json({ok:false,error:'REPRESENTATIVE_AND_REASON_REQUIRED'});
    try{const result=await withTransaction(pool,connection=>revokeRepresentative(connection,{representativeId,reason,actorStaffId:req.user.id,requestContext:context(req)}));res.json({ok:true,...result});}
    catch(error){sendError(res,error,'REPRESENTATIVE_REVOKE_FAILED');}
  });

  router.get('/api/os2/representatives/:id/history',requirePermission('restriction.read'),async(req,res)=>{
    const representativeId=positiveId(req.params.id);if(!representativeId)return res.status(400).json({ok:false,error:'INVALID_REPRESENTATIVE_ID'});
    try{const [rows]=await pool.execute(`SELECT h.id,h.representative_id,h.master_customer_id,h.event_type,h.before_json,h.after_json,h.reason,h.changed_by,h.created_at,s.full_name changed_by_name FROM os2_representative_history h LEFT JOIN staff_users s ON s.id=h.changed_by WHERE h.representative_id=:id ORDER BY h.created_at DESC LIMIT 250`,{id:representativeId});res.json({ok:true,history:rows});}
    catch(error){res.status(500).json({ok:false,error:'REPRESENTATIVE_HISTORY_LOAD_FAILED'});}
  });

  return router;
};
