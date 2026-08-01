'use strict';

const express = require('express');
const crypto = require('crypto');
const { withTransaction } = require('./core/transaction');
const { requirePermission } = require('./core/permissions');
const { appendAudit } = require('./core/audit');

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function text(value, max = 1000) {
  const result = String(value == null ? '' : value).trim();
  return result ? result.slice(0, max) : null;
}
function requestContext(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0,64),
    userAgent: String(req.headers['user-agent'] || '').slice(0,255)
  };
}
function reference() {
  return `DSR-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

module.exports = function createPrivacyRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use('/api/os2/privacy', requireAuth);

  router.get('/api/os2/privacy/customers/:customerId/consents', requirePermission('privacy.read'), async (req, res) => {
    try {
      const [rows] = await pool.execute(`SELECT c.*,s.full_name recorded_by_name
        FROM os2_customer_consents c JOIN staff_users s ON s.id=c.recorded_by
        WHERE c.master_customer_id=:customerId ORDER BY c.created_at DESC`, { customerId:Number(req.params.customerId) });
      res.json({ ok:true, consents:rows });
    } catch (error) {
      res.status(500).json({ ok:false, error:'CONSENTS_LOAD_FAILED' });
    }
  });

  router.post('/api/os2/privacy/customers/:customerId/consents', requirePermission('privacy.manage'), async (req, res) => {
    const customerId = positiveId(req.params.customerId);
    const consentType = text(req.body.consentType,80);
    const consentStatus = ['granted','withdrawn','not_required','pending'].includes(req.body.consentStatus) ? req.body.consentStatus : null;
    if (!customerId || !consentType || !consentStatus) return res.status(400).json({ ok:false, error:'CONSENT_DETAILS_REQUIRED' });
    try {
      const consentId = await withTransaction(pool, async connection => {
        const [[customer]] = await connection.execute('SELECT id,display_name FROM os2_master_customers WHERE id=:id AND archived_at IS NULL', { id:customerId });
        if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
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
    } catch (error) {
      res.status(error.message==='CUSTOMER_NOT_FOUND' ? 404 : 500).json({ ok:false, error:error.message==='CUSTOMER_NOT_FOUND' ? error.message : 'CONSENT_CREATE_FAILED' });
    }
  });

  router.get('/api/os2/privacy/requests', requirePermission('privacy.read'), async (req, res) => {
    try {
      const [rows] = await pool.execute(`SELECT r.*,mc.display_name customer_name,creator.full_name created_by_name,reviewer.full_name reviewed_by_name
        FROM os2_data_subject_requests r
        JOIN os2_master_customers mc ON mc.id=r.master_customer_id
        JOIN staff_users creator ON creator.id=r.created_by
        LEFT JOIN staff_users reviewer ON reviewer.id=r.reviewed_by
        WHERE (:status IS NULL OR r.status=:status)
        ORDER BY FIELD(r.status,'received','identity_verification','in_review','approved','rejected','completed','cancelled'),r.due_at,r.created_at DESC
        LIMIT 500`, { status:text(req.query.status,40) });
      res.json({ ok:true, requests:rows });
    } catch (error) {
      res.status(500).json({ ok:false, error:'PRIVACY_REQUESTS_LOAD_FAILED' });
    }
  });

  router.post('/api/os2/privacy/requests', requirePermission('privacy.manage'), async (req, res) => {
    const customerId = positiveId(req.body.masterCustomerId);
    const requestType = ['access','correction','restriction','objection','deletion','export'].includes(req.body.requestType) ? req.body.requestType : null;
    if (!customerId || !requestType) return res.status(400).json({ ok:false, error:'CUSTOMER_AND_REQUEST_TYPE_REQUIRED' });
    try {
      const result = await withTransaction(pool, async connection => {
        const [[customer]] = await connection.execute('SELECT id,display_name FROM os2_master_customers WHERE id=:id', { id:customerId });
        if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
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
    } catch (error) {
      res.status(error.message==='CUSTOMER_NOT_FOUND' ? 404 : 500).json({ ok:false, error:error.message==='CUSTOMER_NOT_FOUND' ? error.message : 'PRIVACY_REQUEST_CREATE_FAILED' });
    }
  });

  router.post('/api/os2/privacy/requests/:id/decision', requirePermission('privacy.decide'), async (req, res) => {
    const status = ['identity_verification','in_review','approved','rejected','completed','cancelled'].includes(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ ok:false, error:'VALID_STATUS_REQUIRED' });
    try {
      await withTransaction(pool, async connection => {
        const [[record]] = await connection.execute('SELECT * FROM os2_data_subject_requests WHERE id=:id FOR UPDATE', { id:Number(req.params.id) });
        if (!record) throw new Error('PRIVACY_REQUEST_NOT_FOUND');
        if (Number(record.created_by) === Number(req.user.id) && ['approved','rejected','completed'].includes(status)) throw new Error('SELF_APPROVAL_NOT_ALLOWED');
        await connection.execute(`UPDATE os2_data_subject_requests SET status=:status,rejection_reason=:rejectionReason,
          reviewed_by=:actor,completed_at=CASE WHEN :status='completed' THEN NOW() ELSE completed_at END,updated_at=NOW() WHERE id=:id`, {
          id:record.id,status,rejectionReason:status==='rejected' ? text(req.body.reason,5000) : null,actor:Number(req.user.id)
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id,actionType:'privacy_request_status_changed',entityType:'os2_data_subject_requests',entityId:record.id,
          masterCustomerId:record.master_customer_id,description:`Privacy request ${record.request_reference} changed to ${status}`,
          before:{ status:record.status },after:{ status },requestContext:requestContext(req)
        });
      });
      res.json({ ok:true });
    } catch (error) {
      const known = ['PRIVACY_REQUEST_NOT_FOUND','SELF_APPROVAL_NOT_ALLOWED'].includes(error.message);
      res.status(error.message==='PRIVACY_REQUEST_NOT_FOUND' ? 404 : known ? 400 : 500).json({ ok:false, error:known ? error.message : 'PRIVACY_REQUEST_UPDATE_FAILED' });
    }
  });

  router.post('/api/os2/privacy/requests/:id/export', requirePermission('privacy.export'), async (req, res) => {
    try {
      const result = await withTransaction(pool, async connection => {
        const [[record]] = await connection.execute('SELECT * FROM os2_data_subject_requests WHERE id=:id FOR UPDATE', { id:Number(req.params.id) });
        if (!record) throw new Error('PRIVACY_REQUEST_NOT_FOUND');
        if (!['access','export'].includes(record.request_type)) throw new Error('REQUEST_NOT_EXPORTABLE');
        const [insert] = await connection.execute(`INSERT INTO os2_data_exports
          (master_customer_id,data_subject_request_id,export_format,status,expires_at,created_by,created_at,updated_at)
          VALUES(:customerId,:requestId,:format,'queued',DATE_ADD(NOW(),INTERVAL 7 DAY),:actor,NOW(),NOW())`, {
          customerId:record.master_customer_id,requestId:record.id,format:req.body.exportFormat==='csv_bundle' ? 'csv_bundle' : 'json',actor:Number(req.user.id)
        });
        await appendAudit(connection, {
          actorStaffId:req.user.id,actionType:'privacy_export_queued',entityType:'os2_data_exports',entityId:insert.insertId,
          masterCustomerId:record.master_customer_id,description:`Privacy export queued for ${record.request_reference}`,
          after:{ requestId:record.id,exportFormat:req.body.exportFormat==='csv_bundle' ? 'csv_bundle' : 'json' },requestContext:requestContext(req)
        });
        return Number(insert.insertId);
      });
      res.status(201).json({ ok:true, exportId:result });
    } catch (error) {
      const known = ['PRIVACY_REQUEST_NOT_FOUND','REQUEST_NOT_EXPORTABLE'].includes(error.message);
      res.status(error.message==='PRIVACY_REQUEST_NOT_FOUND' ? 404 : known ? 400 : 500).json({ ok:false, error:known ? error.message : 'PRIVACY_EXPORT_QUEUE_FAILED' });
    }
  });

  router.get('/api/os2/privacy/retention/reviews', requirePermission('privacy.retention'), async (req, res) => {
    try {
      const [rows] = await pool.execute(`SELECT rr.*,rp.retention_days,rp.action_type,rp.legal_basis,s.full_name reviewed_by_name
        FROM os2_retention_reviews rr JOIN os2_retention_policies rp ON rp.id=rr.retention_policy_id
        LEFT JOIN staff_users s ON s.id=rr.reviewed_by
        WHERE (:status IS NULL OR rr.status=:status) ORDER BY rr.created_at DESC LIMIT 500`, { status:text(req.query.status,40) });
      res.json({ ok:true, reviews:rows });
    } catch (error) {
      res.status(500).json({ ok:false, error:'RETENTION_REVIEWS_LOAD_FAILED' });
    }
  });

  router.post('/api/os2/privacy/retention/reviews/:id/decision', requirePermission('privacy.retention'), async (req, res) => {
    const status = ['retained','archived','anonymised','deleted','deferred'].includes(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ ok:false, error:'VALID_RETENTION_DECISION_REQUIRED' });
    try {
      const [result] = await pool.execute(`UPDATE os2_retention_reviews SET status=:status,decision_reason=:reason,reviewed_by=:actor,reviewed_at=NOW() WHERE id=:id AND status='pending'`, {
        id:Number(req.params.id),status,reason:text(req.body.reason,5000),actor:Number(req.user.id)
      });
      if (!result.affectedRows) return res.status(404).json({ ok:false, error:'RETENTION_REVIEW_NOT_FOUND_OR_DECIDED' });
      res.json({ ok:true });
    } catch (error) {
      res.status(500).json({ ok:false, error:'RETENTION_DECISION_FAILED' });
    }
  });

  return router;
};