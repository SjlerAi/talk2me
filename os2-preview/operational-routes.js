'use strict';

const express = require('express');
const { withTransaction } = require('./core/transaction');
const { requirePermission } = require('./core/permissions');
const { createMobileLine, createFixedService } = require('./core/services');
const { recordRestriction, loadActiveRestrictions, enforceCustomerAction } = require('./core/restrictions');
const { createRepresentative, revokeRepresentative, REPRESENTATIVE_ACTIONS } = require('./core/representatives');
const { createApproval, decideApproval } = require('./core/approvals');

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function text(value, max = 255) {
  const result = String(value == null ? '' : value).trim();
  return result ? result.slice(0, max) : null;
}
function context(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
  };
}
function sendError(res, error, fallback) {
  const known = new Set([
    'CUSTOMER_RESTRICTION_BLOCKED','APPROVAL_REQUIRED','MOBILE_NUMBER_REQUIRED',
    'MOBILE_NUMBER_ALREADY_EXISTS','FIXED_ACCOUNT_NUMBER_REQUIRED',
    'FIXED_ACCOUNT_BELONGS_TO_ANOTHER_CUSTOMER','FIXED_SERVICE_IDENTIFIER_COLLISION',
    'REPRESENTATIVE_NAME_AND_PERMISSIONS_REQUIRED','REPRESENTATIVE_NOT_FOUND',
    'INVALID_APPROVAL_DECISION','APPROVAL_NOT_FOUND','APPROVAL_ALREADY_FINAL',
    'SELF_APPROVAL_NOT_ALLOWED'
  ]);
  const status = error.statusCode || (known.has(error.message) ? 409 : 500);
  return res.status(status).json({ ok: false, error: known.has(error.message) ? error.message : fallback, details: error.details || null });
}

module.exports = function createOperationalRouter({ pool, requireAuth }) {
  const router = express.Router();
  router.use('/api/os2', requireAuth);

  router.get('/api/os2/customers/:id/restrictions', requirePermission('restriction.read'), async (req, res) => {
    try {
      const rows = await withTransaction(pool, connection => loadActiveRestrictions(connection, req.params.id));
      res.json({ ok: true, restrictions: rows });
    } catch (error) { sendError(res, error, 'RESTRICTIONS_LOAD_FAILED'); }
  });

  router.post('/api/os2/customers/:id/restrictions', requirePermission('restriction.update'), async (req, res) => {
    const masterCustomerId = positiveId(req.params.id);
    const restrictionType = text(req.body.restrictionType, 100);
    if (!masterCustomerId || !restrictionType) return res.status(400).json({ ok:false, error:'CUSTOMER_AND_RESTRICTION_REQUIRED' });
    try {
      const id = await withTransaction(pool, connection => recordRestriction(connection, {
        masterCustomerId,
        restrictionType,
        restrictionValue: text(req.body.restrictionValue, 255),
        verificationMethod: text(req.body.verificationMethod, 100),
        evidenceDocumentId: positiveId(req.body.evidenceDocumentId),
        effectiveFrom: req.body.effectiveFrom || null,
        expiresAt: req.body.expiresAt || null,
        notes: text(req.body.notes, 2000),
        actorStaffId: req.user.id,
        requestContext: context(req)
      }));
      res.status(201).json({ ok:true, restrictionId:id });
    } catch (error) { sendError(res, error, 'RESTRICTION_CREATE_FAILED'); }
  });

  router.post('/api/os2/customers/:id/action-check', async (req, res) => {
    const masterCustomerId = positiveId(req.params.id);
    const action = text(req.body.action, 100);
    if (!masterCustomerId || !action) return res.status(400).json({ ok:false, error:'CUSTOMER_AND_ACTION_REQUIRED' });
    try {
      const decision = await withTransaction(pool, connection => enforceCustomerAction(connection, {
        masterCustomerId,
        action,
        context: {
          currentLineCount: Number(req.body.currentLineCount || 0),
          proposedMonthlyTotal: req.body.proposedMonthlyTotal == null ? null : Number(req.body.proposedMonthlyTotal),
          monthlyIncrease: req.body.monthlyIncrease == null ? null : Number(req.body.monthlyIncrease)
        }
      }));
      res.json({ ok:true, decision });
    } catch (error) { sendError(res, error, 'ACTION_CHECK_FAILED'); }
  });

  router.post('/api/os2/customers/:id/mobile-lines', requirePermission('service.create'), async (req, res) => {
    const masterCustomerId = positiveId(req.params.id);
    const accountId = positiveId(req.body.accountId);
    if (!masterCustomerId || !accountId) return res.status(400).json({ ok:false, error:'CUSTOMER_AND_ACCOUNT_REQUIRED' });
    try {
      const id = await withTransaction(pool, connection => createMobileLine(connection, {
        masterCustomerId,
        accountId,
        mobileNumber: text(req.body.mobileNumber, 40),
        simNumber: text(req.body.simNumber, 100),
        imei: text(req.body.imei, 100),
        handset: text(req.body.handset, 200),
        packageName: text(req.body.packageName, 200),
        contractMonths: Number(req.body.contractMonths || 36),
        previousUpgradeDate: req.body.previousUpgradeDate || null,
        nextUpgradeDate: req.body.nextUpgradeDate || null,
        monthlyAmount: req.body.monthlyAmount,
        proposedMonthlyTotal: req.body.proposedMonthlyTotal,
        approvalId: positiveId(req.body.approvalId),
        actorStaffId: req.user.id,
        requestContext: context(req)
      }));
      res.status(201).json({ ok:true, mobileLineId:id });
    } catch (error) { sendError(res, error, 'MOBILE_LINE_CREATE_FAILED'); }
  });

  router.post('/api/os2/customers/:id/fixed-services', requirePermission('service.create'), async (req, res) => {
    const masterCustomerId = positiveId(req.params.id);
    const accountId = positiveId(req.body.accountId);
    if (!masterCustomerId || !accountId) return res.status(400).json({ ok:false, error:'CUSTOMER_AND_ACCOUNT_REQUIRED' });
    try {
      const result = await withTransaction(pool, connection => createFixedService(connection, {
        masterCustomerId,
        accountId,
        fixedAccountNumber: text(req.body.fixedAccountNumber, 100),
        serviceName: text(req.body.serviceName, 200),
        serviceType: text(req.body.serviceType, 100),
        macAddress: text(req.body.macAddress, 100),
        solutionId: text(req.body.solutionId, 100),
        orderNumber: text(req.body.orderNumber, 100),
        packageName: text(req.body.packageName, 200),
        monthlyAmount: req.body.monthlyAmount,
        proposedMonthlyTotal: req.body.proposedMonthlyTotal,
        approvalId: positiveId(req.body.approvalId),
        actorStaffId: req.user.id,
        requestContext: context(req)
      }));
      res.status(201).json({ ok:true, ...result });
    } catch (error) { sendError(res, error, 'FIXED_SERVICE_CREATE_FAILED'); }
  });

  router.get('/api/os2/customers/:id/representatives', async (req, res) => {
    try {
      const [rows] = await pool.execute(`SELECT id,full_name,relationship_type,mobile,email,id_reference,permissions_json,verification_method,evidence_document_id,expires_at,status,revoked_at,revoke_reason,created_at FROM os2_authorised_representatives WHERE master_customer_id=:id ORDER BY revoked_at IS NULL DESC,full_name`, { id:Number(req.params.id) });
      res.json({ ok:true, allowedActions:[...REPRESENTATIVE_ACTIONS], representatives:rows });
    } catch (error) { sendError(res, error, 'REPRESENTATIVES_LOAD_FAILED'); }
  });

  router.post('/api/os2/customers/:id/representatives', requirePermission('restriction.update'), async (req, res) => {
    try {
      const id = await withTransaction(pool, connection => createRepresentative(connection, {
        masterCustomerId: Number(req.params.id),
        fullName: text(req.body.fullName, 200),
        relationshipType: text(req.body.relationshipType, 100),
        mobile: text(req.body.mobile, 40),
        email: text(req.body.email, 254),
        idReference: text(req.body.idReference, 100),
        permissions: req.body.permissions,
        verificationMethod: text(req.body.verificationMethod, 100),
        evidenceDocumentId: positiveId(req.body.evidenceDocumentId),
        expiresAt: req.body.expiresAt || null,
        actorStaffId: req.user.id,
        requestContext: context(req)
      }));
      res.status(201).json({ ok:true, representativeId:id });
    } catch (error) { sendError(res, error, 'REPRESENTATIVE_CREATE_FAILED'); }
  });

  router.post('/api/os2/representatives/:id/revoke', requirePermission('restriction.update'), async (req, res) => {
    try {
      const result = await withTransaction(pool, connection => revokeRepresentative(connection, {
        representativeId: Number(req.params.id),
        reason: text(req.body.reason, 1000),
        actorStaffId: req.user.id,
        requestContext: context(req)
      }));
      res.json({ ok:true, ...result });
    } catch (error) { sendError(res, error, 'REPRESENTATIVE_REVOKE_FAILED'); }
  });

  router.get('/api/os2/approvals', requirePermission('approval.read'), async (req, res) => {
    const status = text(req.query.status, 30) || 'pending';
    try {
      const [rows] = await pool.execute(`SELECT ar.*,mc.display_name customer_name,requester.full_name requester_name,reviewer.full_name reviewer_name FROM os2_approval_requests ar LEFT JOIN os2_master_customers mc ON mc.id=ar.master_customer_id LEFT JOIN staff_users requester ON requester.id=ar.requested_by LEFT JOIN staff_users reviewer ON reviewer.id=ar.reviewed_by WHERE (:status='all' OR ar.status=:status) ORDER BY FIELD(ar.status,'pending','deferred','approved','rejected'),ar.requested_at DESC LIMIT 250`, { status });
      res.json({ ok:true, approvals:rows });
    } catch (error) { sendError(res, error, 'APPROVALS_LOAD_FAILED'); }
  });

  router.post('/api/os2/approvals', async (req, res) => {
    const requestType = text(req.body.requestType, 100);
    if (!requestType) return res.status(400).json({ ok:false, error:'REQUEST_TYPE_REQUIRED' });
    try {
      const id = await withTransaction(pool, connection => createApproval(connection, {
        requestType,
        masterCustomerId: positiveId(req.body.masterCustomerId),
        targetEntityType: text(req.body.targetEntityType, 100),
        targetEntityId: positiveId(req.body.targetEntityId),
        payload: req.body.payload || {},
        requestedBy: req.user.id,
        requestContext: context(req)
      }));
      res.status(201).json({ ok:true, approvalId:id });
    } catch (error) { sendError(res, error, 'APPROVAL_CREATE_FAILED'); }
  });

  router.post('/api/os2/approvals/:id/decision', requirePermission('approval.decide'), async (req, res) => {
    try {
      const result = await withTransaction(pool, connection => decideApproval(connection, {
        approvalId: Number(req.params.id),
        decision: text(req.body.decision, 30),
        reason: text(req.body.reason, 2000),
        reviewerStaffId: req.user.id,
        requestContext: context(req)
      }));
      res.json({ ok:true, ...result });
    } catch (error) { sendError(res, error, 'APPROVAL_DECISION_FAILED'); }
  });

  return router;
};
