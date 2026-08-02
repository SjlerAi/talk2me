'use strict';

const express = require('express');
const crypto = require('crypto');
const { withTransaction } = require('./core/transaction');
const { requirePermission } = require('./core/permissions');
const { appendAudit, requestContext } = require('./core/audit');

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function text(value, max = 1000) {
  const result = String(value == null ? '' : value).trim();
  if (!result) return null;
  if (result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) return null;
  return result;
}
function reference() {
  return `DSR-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}
function controlledError(code, statusCode = 400, details) {
  const error = new Error(code);
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}
function sendError(res, error, fallback) {
  if (error && Number.isInteger(error.statusCode)) return res.status(error.statusCode).json({ ok:false, error:error.message, details:error.details });
  return res.status(500).json({ ok:false, error:fallback });
}

module.exports = function createPrivacyRouter({ pool, requireAuth }) {
  if (!pool) throw new Error('PRIVACY_POOL_REQUIRED');
  if (typeof requireAuth !== 'function') throw new Error('PRIVACY_AUTH_MIDDLEWARE_REQUIRED');
  const router = express.Router();
  router.use('/api/os2/privacy', requireAuth);

  router.get('/api/os2/privacy/customers/:customerId/consents', requirePermission('privacy.read'), async (req, res) => {
    try {
      const customerId = positiveId(req.params.customerId);
      if (!customerId) throw controlledError('INVALID_CUSTOMER_ID');
      const [rows] = await pool.execute(`SELECT c.*,s.full_name recorded_by_name
        FROM os2_customer_consents c JOIN staff_users s ON s.id=c.recorded_by
        WHERE c.master_customer_id=:customerId ORDER BY c.created_at DESC,c.id DESC LIMIT 1000`, { customerId });
      res.json({ ok:true, consents:rows });
    } catch (error) { sendError(res, error, 'CONSENTS_LOAD_FAILED'); }
  });

  router.post('/api/os2/privacy/customers/:customerId/consents', requirePermission('privacy.manage'), async (req, res) => {
    const customerId = positiveId(req.params.customerId);
    const consentType = text(req.body && req.body.consentType,80);
    const consentStatus = ['granted','withdrawn','not_required','pending'].includes(req.body && req.body.consentStatus) ? req.body.consentStatus : null;
    if (!customerId || !consentType || !consentStatus) return res.status(400).json({ ok:false, error:'CONSENT_DETAILS_REQUIRED' });
    try {
      const consentId = await withTransaction(pool, async connection => {
        const [[customer]] = await connection.execute('SELECT id,display_name FROM os2_master_customers WHERE id=:id AND archived_at IS NULL LIMIT 1 FOR UPDATE', { id:customerId });
        if (!customer) throw controlledError('CUSTOMER_NOT_FOUND',404);
        const [insert] = await connection.execute(`INSERT INTO os2_customer_consents
          (master_customer_id,consent_type,consent_status,source,evidence_reference,granted_at,withdrawn_at,recorded_by,created_at,updated_at)
          VALUES(:customerId,:consentType,:status,:source,:evidence,
            CASE WHEN :status='granted' THEN NOW() ELSE NULL END,
            CASE WHEN :status='withdrawn' THEN NOW() ELSE NULL END,:actor,NOW(),NOW())`, {
          customerId,consentType,status:consentStatus,source:text(req.body.source,80),evidence:text(req.body.evidenceReference,255),actor:Number(req.user.id)
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id,actionType:'customer_consent_recorded',entityType:'os2_customer_consents',entityId:insert.insertId,
          masterCustomerId:customerId,description:`${consentType} consent recorded as ${consentStatus}`,
          after:{ consentType,consentStatus },requestContext:requestContext(req)
        });
        return Number(insert.insertId);
      });
      res.status(201).json({ ok:true, consentId });
    } catch (error) { sendError(res,error,'CONSENT_CREATE_FAILED'); }
  });

  router.get('/api/os2/privacy/requests', requirePermission('privacy.read'), async (req, res) => {
    try {
      const status = text(req.query.status,40);
      if (status && !['received','identity_verification','in_review','approved','rejected','completed','cancelled'].includes(status)) throw controlledError('INVALID_PRIVACY_REQUEST_STATUS');
      const [rows] = await pool.execute(`SELECT r.*,mc.display_name customer_name,creator.full_name created_by_name,reviewer.full_name reviewed_by_name
        FROM os2_data_subject_requests r
        JOIN os2_master_customers mc ON mc.id=r.master_customer_id
        JOIN staff_users creator ON creator.id=r.created_by
        LEFT JOIN staff_users reviewer ON reviewer.id=r.reviewed_by
        WHERE (:status IS NULL OR r.status=:status)
        ORDER BY FIELD(r.status,'received','identity_verification','in_review','approved','rejected','completed','cancelled'),r.due_at,r.created_at DESC
        LIMIT 500`, { status });
      res.json({ ok:true, requests:rows });
    } catch (error) { sendError(res,error,'PRIVACY_REQUESTS_LOAD_FAILED'); }
  });

  router.post('/api/os2/privacy/requests', requirePermission('privacy.manage'), async (req, res) => {
    const customerId = positiveId(req.body && req.body.masterCustomerId);
    const requestType = ['access','correction','restriction','objection','deletion','export'].includes(req.body && req.body.requestType) ? req.body.requestType : null;
    if (!customerId || !requestType) return res.status(400).json({ ok:false, error:'CUSTOMER_AND_REQUEST_TYPE_REQUIRED' });
    try {
      const result = await withTransaction(pool, async connection => {
        const [[customer]] = await connection.execute('SELECT id,display_name FROM os2_master_customers WHERE id=:id AND archived_at IS NULL LIMIT 1 FOR UPDATE', { id:customerId });
        if (!customer) throw controlledError('CUSTOMER_NOT_FOUND',404);
        const requestReference = reference();
        const [insert] = await connection.execute(`INSERT INTO os2_data_subject_requests
          (master_customer_id,request_type,status,request_reference,request_details,requested_at,due_at,created_by,created_at,updated_at)
          VALUES(:customerId,:requestType,'received',:reference,:details,NOW(),DATE_ADD(NOW(),INTERVAL 30 DAY),:actor,NOW(),NOW())`, {
          customerId,requestType,reference:requestReference,details:text(req.body.requestDetails,10000),actor:Number(req.user.id)
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id,actionType:'privacy_request_created',entityType:'os2_data_subject_requests',entityId:insert.insertId,
          masterCustomerId:customerId,description:`${requestType} request ${requestReference} created`,after:{ requestType,requestReference },requestContext:requestContext(req)
        });
        return { requestId:Number(insert.insertId), requestReference };
      });
      res.status(201).json({ ok:true,...result });
    } catch (error) { sendError(res,error,'PRIVACY_REQUEST_CREATE_FAILED'); }
  });

  router.post('/api/os2/privacy/requests/:id/decision', requirePermission('privacy.decide'), async (req, res) => {
    const requestId = positiveId(req.params.id);
    const status = ['identity_verification','in_review','approved','rejected','completed','cancelled'].includes(req.body && req.body.status) ? req.body.status : null;
    if (!requestId || !status) return res.status(400).json({ ok:false, error:'VALID_STATUS_REQUIRED' });
    try {
      await withTransaction(pool, async connection => {
        const [[record]] = await connection.execute('SELECT * FROM os2_data_subject_requests WHERE id=:id LIMIT 1 FOR UPDATE', { id:requestId });
        if (!record) throw controlledError('PRIVACY_REQUEST_NOT_FOUND',404);
        if (Number(record.created_by) === Number(req.user.id) && ['approved','rejected','completed'].includes(status)) throw controlledError('SELF_APPROVAL_NOT_ALLOWED',403);
        if (['rejected','cancelled','completed'].includes(record.status)) throw controlledError('PRIVACY_REQUEST_TERMINAL',409);
        const rejectionReason = status==='rejected' ? text(req.body.reason,5000) : null;
        if (status==='rejected' && !rejectionReason) throw controlledError('REJECTION_REASON_REQUIRED');
        const [update] = await connection.execute(`UPDATE os2_data_subject_requests SET status=:status,rejection_reason=:rejectionReason,
          reviewed_by=:actor,completed_at=CASE WHEN :status='completed' THEN NOW() ELSE completed_at END,updated_at=NOW()
          WHERE id=:id AND status=:currentStatus`, {
          id:record.id,status,rejectionReason,actor:Number(req.user.id),currentStatus:record.status
        });
        if (Number(update.affectedRows)!==1) throw controlledError('PRIVACY_REQUEST_STATE_CHANGED',409);
        await appendAudit(connection, {
          actorStaffId:req.user.id,actionType:'privacy_request_status_changed',entityType:'os2_data_subject_requests',entityId:record.id,
          masterCustomerId:record.master_customer_id,description:`Privacy request ${record.request_reference} changed to ${status}`,
          before:{ status:record.status },after:{ status },requestContext:requestContext(req)
        });
      });
      res.json({ ok:true });
    } catch (error) { sendError(res,error,'PRIVACY_REQUEST_UPDATE_FAILED'); }
  });

  router.post('/api/os2/privacy/requests/:id/export', requirePermission('privacy.export'), async (req, res) => {
    try {
      const requestId = positiveId(req.params.id);
      if (!requestId) throw controlledError('INVALID_PRIVACY_REQUEST_ID');
      const exportFormat = req.body && ['json','csv_bundle'].includes(req.body.exportFormat) ? req.body.exportFormat : null;
      if (!exportFormat) throw controlledError('VALID_EXPORT_FORMAT_REQUIRED');
      const result = await withTransaction(pool, async connection => {
        const [[record]] = await connection.execute('SELECT * FROM os2_data_subject_requests WHERE id=:id LIMIT 1 FOR UPDATE', { id:requestId });
        if (!record) throw controlledError('PRIVACY_REQUEST_NOT_FOUND',404);
        if (!['access','export'].includes(record.request_type)) throw controlledError('REQUEST_NOT_EXPORTABLE',409);
        if (!['approved','completed'].includes(record.status)) throw controlledError('PRIVACY_REQUEST_NOT_APPROVED',409);
        const [[existing]] = await connection.execute(`SELECT id,status,expires_at FROM os2_data_exports
          WHERE data_subject_request_id=:requestId AND status IN ('queued','processing','ready')
            AND expires_at IS NOT NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE`, { requestId:record.id });
        if (existing) throw controlledError('ACTIVE_PRIVACY_EXPORT_ALREADY_EXISTS',409,{ exportId:Number(existing.id),status:existing.status });
        const [insert] = await connection.execute(`INSERT INTO os2_data_exports
          (master_customer_id,data_subject_request_id,export_format,status,expires_at,created_by,created_at,updated_at)
          VALUES(:customerId,:requestId,:format,'queued',DATE_ADD(NOW(),INTERVAL 7 DAY),:actor,NOW(),NOW())`, {
          customerId:record.master_customer_id,requestId:record.id,format:exportFormat,actor:Number(req.user.id)
        });
        const exportId = Number(insert.insertId);
        await connection.execute(`INSERT INTO os2_export_access_log
          (data_export_id,accessed_by,access_type,request_id,ip_address,user_agent,details_json,created_at)
          VALUES(:exportId,:actor,'release_authorised',:requestId,:ip,:userAgent,:details,NOW())`, {
          exportId,actor:Number(req.user.id),requestId:req.requestId||null,
          ip:requestContext(req).ipAddress,userAgent:requestContext(req).userAgent,
          details:JSON.stringify({ requestReference:record.request_reference,exportFormat })
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id,actionType:'privacy_export_queued',entityType:'os2_data_exports',entityId:exportId,
          masterCustomerId:record.master_customer_id,description:`Privacy export queued for ${record.request_reference}`,
          after:{ requestId:record.id,exportFormat,expiresInDays:7 },requestContext:requestContext(req)
        });
        return exportId;
      }, { isolationLevel:'SERIALIZABLE' });
      res.status(201).json({ ok:true, exportId:result });
    } catch (error) { sendError(res,error,'PRIVACY_EXPORT_QUEUE_FAILED'); }
  });

  router.get('/api/os2/privacy/exports/:id', requirePermission('privacy.export'), async (req,res) => {
    try {
      const exportId = positiveId(req.params.id);
      if (!exportId) throw controlledError('INVALID_PRIVACY_EXPORT_ID');
      const metadata = await withTransaction(pool,async connection=>{
        const [[record]] = await connection.execute(`SELECT e.id,e.master_customer_id,e.data_subject_request_id,e.export_format,e.status,
          e.content_sha256,e.row_count,e.file_count,e.total_bytes,e.expires_at,e.generated_at,e.failure_reason,e.created_by,e.created_at,e.updated_at,
          r.request_reference,r.request_type
          FROM os2_data_exports e JOIN os2_data_subject_requests r ON r.id=e.data_subject_request_id
          WHERE e.id=:id LIMIT 1 FOR UPDATE`,{id:exportId});
        if(!record) throw controlledError('PRIVACY_EXPORT_NOT_FOUND',404);
        await connection.execute(`INSERT INTO os2_export_access_log
          (data_export_id,accessed_by,access_type,request_id,ip_address,user_agent,details_json,created_at)
          VALUES(:exportId,:actor,'metadata_view',:requestId,:ip,:userAgent,NULL,NOW())`,{
          exportId,actor:Number(req.user.id),requestId:req.requestId||null,
          ip:requestContext(req).ipAddress,userAgent:requestContext(req).userAgent
        });
        return record;
      });
      res.json({ok:true,export:metadata});
    }catch(error){sendError(res,error,'PRIVACY_EXPORT_METADATA_FAILED');}
  });

  router.post('/api/os2/privacy/exports/:id/revoke', requirePermission('privacy.decide'), async (req,res)=>{
    try{
      const exportId=positiveId(req.params.id);
      if(!exportId) throw controlledError('INVALID_PRIVACY_EXPORT_ID');
      const reason=text(req.body&&req.body.reason,1000);
      if(!reason) throw controlledError('PRIVACY_EXPORT_REVOCATION_REASON_REQUIRED');
      await withTransaction(pool,async connection=>{
        const [[record]]=await connection.execute('SELECT * FROM os2_data_exports WHERE id=:id LIMIT 1 FOR UPDATE',{id:exportId});
        if(!record) throw controlledError('PRIVACY_EXPORT_NOT_FOUND',404);
        if(record.status==='revoked') throw controlledError('PRIVACY_EXPORT_ALREADY_REVOKED',409);
        const [update]=await connection.execute(`UPDATE os2_data_exports
          SET status='revoked',worker_id=NULL,claimed_at=NULL,failure_reason='EXPORT_REVOKED',updated_at=NOW()
          WHERE id=:id AND status=:currentStatus`,{id:exportId,currentStatus:record.status});
        if(Number(update.affectedRows)!==1) throw controlledError('PRIVACY_EXPORT_STATE_CHANGED',409);
        await connection.execute(`INSERT INTO os2_export_access_log
          (data_export_id,accessed_by,access_type,request_id,ip_address,user_agent,details_json,created_at)
          VALUES(:exportId,:actor,'revoked',:requestId,:ip,:userAgent,:details,NOW())`,{
          exportId,actor:Number(req.user.id),requestId:req.requestId||null,
          ip:requestContext(req).ipAddress,userAgent:requestContext(req).userAgent,
          details:JSON.stringify({reason,previousStatus:record.status})
        });
        await appendAudit(connection,{
          actorStaffId:req.user.id,actionType:'privacy_export_revoked',entityType:'os2_data_exports',entityId:exportId,
          masterCustomerId:record.master_customer_id,description:`Privacy export ${exportId} revoked`,
          before:{status:record.status},after:{status:'revoked',reason},requestContext:requestContext(req)
        });
      },{isolationLevel:'SERIALIZABLE'});
      res.json({ok:true});
    }catch(error){sendError(res,error,'PRIVACY_EXPORT_REVOCATION_FAILED');}
  });

  router.get('/api/os2/privacy/retention/reviews', requirePermission('privacy.retention'), async (req, res) => {
    try {
      const status=text(req.query.status,40);
      if(status&&!['pending','retained','archived','anonymised','deleted','deferred'].includes(status)) throw controlledError('INVALID_RETENTION_STATUS');
      const [rows] = await pool.execute(`SELECT rr.*,rp.retention_days,rp.action_type,rp.legal_basis,s.full_name reviewed_by_name
        FROM os2_retention_reviews rr JOIN os2_retention_policies rp ON rp.id=rr.retention_policy_id
        LEFT JOIN staff_users s ON s.id=rr.reviewed_by
        WHERE (:status IS NULL OR rr.status=:status) ORDER BY rr.created_at DESC LIMIT 500`, { status });
      res.json({ ok:true, reviews:rows });
    } catch (error) { sendError(res,error,'RETENTION_REVIEWS_LOAD_FAILED'); }
  });

  router.post('/api/os2/privacy/retention/reviews/:id/decision', requirePermission('privacy.retention'), async (req, res) => {
    const reviewId=positiveId(req.params.id);
    const status = ['retained','archived','anonymised','deleted','deferred'].includes(req.body&&req.body.status) ? req.body.status : null;
    if (!reviewId||!status) return res.status(400).json({ ok:false, error:'VALID_RETENTION_DECISION_REQUIRED' });
    try {
      await withTransaction(pool,async connection=>{
        const [[record]]=await connection.execute('SELECT * FROM os2_retention_reviews WHERE id=:id LIMIT 1 FOR UPDATE',{id:reviewId});
        if(!record||record.status!=='pending') throw controlledError('RETENTION_REVIEW_NOT_FOUND_OR_DECIDED',404);
        const reason=text(req.body.reason,5000);
        if(!reason) throw controlledError('RETENTION_DECISION_REASON_REQUIRED');
        const [update]=await connection.execute(`UPDATE os2_retention_reviews SET status=:status,decision_reason=:reason,
          reviewed_by=:actor,reviewed_at=NOW() WHERE id=:id AND status='pending'`,{
          id:reviewId,status,reason,actor:Number(req.user.id)
        });
        if(Number(update.affectedRows)!==1) throw controlledError('RETENTION_REVIEW_STATE_CHANGED',409);
        await appendAudit(connection,{
          actorStaffId:req.user.id,actionType:'retention_review_decided',entityType:'os2_retention_reviews',entityId:reviewId,
          description:`Retention review ${reviewId} decided as ${status}`,
          before:{status:'pending'},after:{status,reason},requestContext:requestContext(req)
        });
      });
      res.json({ ok:true });
    } catch (error) { sendError(res,error,'RETENTION_DECISION_FAILED'); }
  });

  return router;
};
