'use strict';

const express=require('express');
const { withTransaction }=require('./core/transaction');
const { requirePermission }=require('./core/permissions');
const { appendAudit }=require('./core/audit');

function positiveId(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
function text(value,max=1000){const result=String(value==null?'':value).trim();return result?result.slice(0,max):null;}
function normalisePhone(value){let phone=String(value||'').replace(/\D/g,'');if(phone.startsWith('27')&&phone.length===11)phone=`0${phone.slice(2)}`;return phone;}
function context(req){return {ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}
function orderedPair(a,b){return Number(a)<Number(b)?[Number(a),Number(b)]:[Number(b),Number(a)];}

module.exports=function createDuplicateCustomerRouter({pool,requireAuth}){
  const router=express.Router();
  router.use('/api/os2/duplicate-customers',requireAuth);

  router.get('/api/os2/duplicate-customers',requirePermission('customer.merge.review'),async(req,res)=>{
    const status=['open','under_review','not_duplicate','merge_recommended','closed'].includes(req.query.status)?req.query.status:null;
    try{
      const [rows]=await pool.execute(`SELECT d.*,p.display_name primary_name,p.primary_mobile primary_mobile,
        c.display_name candidate_name,c.primary_mobile candidate_mobile,cb.full_name created_by_name,rb.full_name reviewed_by_name
        FROM os2_customer_duplicate_cases d
        JOIN os2_master_customers p ON p.id=d.primary_customer_id
        JOIN os2_master_customers c ON c.id=d.candidate_customer_id
        LEFT JOIN staff_users cb ON cb.id=d.created_by
        LEFT JOIN staff_users rb ON rb.id=d.reviewed_by
        WHERE (:status IS NULL OR d.status=:status)
        ORDER BY FIELD(d.status,'open','under_review','merge_recommended','not_duplicate','closed'),d.match_score DESC,d.created_at DESC
        LIMIT 500`,{status});
      res.json({ok:true,cases:rows});
    }catch(error){res.status(500).json({ok:false,error:'DUPLICATE_CASES_LOAD_FAILED'});}
  });

  router.post('/api/os2/duplicate-customers/scan',requirePermission('customer.merge.review'),async(req,res)=>{
    const customerId=positiveId(req.body.masterCustomerId);if(!customerId)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[customer]]=await connection.execute(`SELECT id,display_name,primary_mobile,primary_email FROM os2_master_customers WHERE id=:id AND archived_at IS NULL FOR UPDATE`,{id:customerId});
        if(!customer)throw Object.assign(new Error('CUSTOMER_NOT_FOUND'),{statusCode:404});
        const phone=normalisePhone(customer.primary_mobile),email=String(customer.primary_email||'').trim().toLowerCase();
        const [accountRows]=await connection.execute(`SELECT normalised_account_number FROM os2_customer_accounts WHERE master_customer_id=:id AND archived_at IS NULL AND normalised_account_number IS NOT NULL`,{id:customerId});
        const accounts=accountRows.map(row=>row.normalised_account_number);
        const [candidates]=await connection.execute(`SELECT DISTINCT mc.id,mc.display_name,mc.primary_mobile,mc.primary_email,
          EXISTS(SELECT 1 FROM os2_customer_accounts ca WHERE ca.master_customer_id=mc.id AND ca.archived_at IS NULL AND ca.normalised_account_number IN (${accounts.length?accounts.map((_,i)=>`:account${i}`).join(','):'NULL'})) account_match
          FROM os2_master_customers mc
          WHERE mc.id<>:id AND mc.archived_at IS NULL AND (
            (:phone<>'' AND REPLACE(REPLACE(REPLACE(mc.primary_mobile,' ',''),'-',''),'(', '') LIKE :phoneLike) OR
            (:email<>'' AND LOWER(mc.primary_email)=:email) OR
            ${accounts.length?`EXISTS(SELECT 1 FROM os2_customer_accounts ca WHERE ca.master_customer_id=mc.id AND ca.archived_at IS NULL AND ca.normalised_account_number IN (${accounts.map((_,i)=>`:account${i}`).join(',')}))`:'0'}
          ) LIMIT 100`,{id:customerId,phone,email,phoneLike:`%${phone}%`,...Object.fromEntries(accounts.map((value,index)=>[`account${index}`,value]))});
        let created=0;
        for(const candidate of candidates){
          const [primaryId,candidateId]=orderedPair(customerId,candidate.id);
          const phoneMatch=phone&&normalisePhone(candidate.primary_mobile)===phone;
          const emailMatch=email&&String(candidate.primary_email||'').trim().toLowerCase()===email;
          const accountMatch=Boolean(candidate.account_match);
          const basis=[phoneMatch?'mobile':null,emailMatch?'email':null,accountMatch?'account':null].filter(Boolean);
          const score=(accountMatch?60:0)+(phoneMatch?30:0)+(emailMatch?10:0);
          const [insert]=await connection.execute(`INSERT IGNORE INTO os2_customer_duplicate_cases
            (primary_customer_id,candidate_customer_id,match_basis,match_score,evidence_json,status,created_by,created_at,updated_at)
            VALUES(:primaryId,:candidateId,:basis,:score,:evidence,'open',:actor,NOW(),NOW())`,{
            primaryId,candidateId,basis:basis.join('+')||'manual',score,evidence:JSON.stringify({phoneMatch,emailMatch,accountMatch,scannedCustomerId:customerId}),actor:req.user.id
          });
          if(insert.affectedRows){
            created++;
            await connection.execute(`INSERT INTO os2_customer_duplicate_history(duplicate_case_id,event_type,to_status,reason,details_json,changed_by,created_at)
              VALUES(:caseId,'detected','open','Automated duplicate scan',:details,:actor,NOW())`,{caseId:insert.insertId,details:JSON.stringify({score,basis}),actor:req.user.id});
          }
        }
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'duplicate_customer_scan',entityType:'os2_master_customers',entityId:customerId,masterCustomerId:customerId,description:`Scanned Master Customer ${customerId} for duplicates`,after:{candidateCount:candidates.length,createdCases:created},requestContext:context(req)});
        return {candidateCount:candidates.length,createdCases:created};
      });
      res.json({ok:true,...result});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'DUPLICATE_SCAN_FAILED'});}
  });

  router.post('/api/os2/duplicate-customers/:caseId/review',requirePermission('customer.merge.review'),async(req,res)=>{
    const caseId=positiveId(req.params.caseId),decision=['under_review','not_duplicate','merge_recommended','closed'].includes(req.body.decision)?req.body.decision:null;
    const reason=text(req.body.reason);const survivorId=positiveId(req.body.survivorCustomerId);
    if(!caseId||!decision||!reason)return res.status(400).json({ok:false,error:'CASE_DECISION_AND_REASON_REQUIRED'});
    if(decision==='merge_recommended'&&!survivorId)return res.status(400).json({ok:false,error:'SURVIVOR_CUSTOMER_REQUIRED'});
    try{
      const result=await withTransaction(pool,async connection=>{
        const [[duplicateCase]]=await connection.execute('SELECT * FROM os2_customer_duplicate_cases WHERE id=:id FOR UPDATE',{id:caseId});
        if(!duplicateCase)throw Object.assign(new Error('DUPLICATE_CASE_NOT_FOUND'),{statusCode:404});
        if(['not_duplicate','closed'].includes(duplicateCase.status))throw Object.assign(new Error('DUPLICATE_CASE_ALREADY_CLOSED'),{statusCode:409});
        if(Number(duplicateCase.created_by)===Number(req.user.id)&&['not_duplicate','merge_recommended','closed'].includes(decision))throw Object.assign(new Error('SELF_REVIEW_NOT_ALLOWED'),{statusCode:409});
        if(survivorId&&![Number(duplicateCase.primary_customer_id),Number(duplicateCase.candidate_customer_id)].includes(survivorId))throw Object.assign(new Error('SURVIVOR_NOT_IN_CASE'),{statusCode:400});
        await connection.execute(`UPDATE os2_customer_duplicate_cases SET status=:decision,proposed_survivor_customer_id=:survivorId,
          resolution_reason=:reason,reviewed_by=:actor,reviewed_at=NOW(),closed_at=IF(:decision IN ('not_duplicate','closed'),NOW(),NULL),updated_at=NOW() WHERE id=:id`,{id:caseId,decision,survivorId,reason,actor:req.user.id});
        await connection.execute(`INSERT INTO os2_customer_duplicate_history(duplicate_case_id,event_type,from_status,to_status,reason,details_json,changed_by,created_at)
          VALUES(:id,'reviewed',:fromStatus,:decision,:reason,:details,:actor,NOW())`,{id:caseId,fromStatus:duplicateCase.status,decision,reason,details:JSON.stringify({survivorId}),actor:req.user.id});
        await appendAudit(connection,{actorStaffId:req.user.id,actionType:'duplicate_customer_reviewed',entityType:'os2_customer_duplicate_cases',entityId:caseId,masterCustomerId:duplicateCase.primary_customer_id,description:`Duplicate customer case ${caseId} marked ${decision}`,before:duplicateCase,after:{decision,reason,survivorId},requestContext:context(req)});
        return {caseId,decision,survivorCustomerId:survivorId};
      });
      res.json({ok:true,...result,mergeExecuted:false});
    }catch(error){res.status(error.statusCode||500).json({ok:false,error:error.statusCode?error.message:'DUPLICATE_REVIEW_FAILED'});}
  });

  router.get('/api/os2/duplicate-customers/:caseId/history',requirePermission('customer.merge.review'),async(req,res)=>{
    const caseId=positiveId(req.params.caseId);if(!caseId)return res.status(400).json({ok:false,error:'INVALID_CASE_ID'});
    try{const [rows]=await pool.execute(`SELECT h.*,s.full_name changed_by_name FROM os2_customer_duplicate_history h LEFT JOIN staff_users s ON s.id=h.changed_by WHERE h.duplicate_case_id=:id ORDER BY h.created_at DESC`,{id:caseId});res.json({ok:true,history:rows});}
    catch(error){res.status(500).json({ok:false,error:'DUPLICATE_HISTORY_LOAD_FAILED'});}
  });
  return router;
};
