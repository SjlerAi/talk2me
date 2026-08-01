'use strict';

const crypto = require('crypto');

function requestContext(req = {}) {
  return {
    requestId: req.requestId || crypto.randomUUID(),
    ipAddress: String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64) || null,
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 255) || null
  };
}

async function appendAudit(connection, entry) {
  if (!connection) throw new Error('AUDIT_CONNECTION_REQUIRED');
  if (!entry?.actorStaffId || !entry.actionType || !entry.entityType || !entry.description) {
    throw new Error('INVALID_AUDIT_ENTRY');
  }
  const context = entry.requestContext || {};
  const [result] = await connection.execute(`
    INSERT INTO os2_audit_log
      (actor_staff_id, action_type, entity_type, entity_id, master_customer_id, description,
       before_json, after_json, request_id, ip_address, user_agent, created_at)
    VALUES
      (:actorStaffId, :actionType, :entityType, :entityId, :masterCustomerId, :description,
       :beforeJson, :afterJson, :requestId, :ipAddress, :userAgent, NOW())`, {
    actorStaffId: Number(entry.actorStaffId),
    actionType: String(entry.actionType).slice(0, 100),
    entityType: String(entry.entityType).slice(0, 100),
    entityId: entry.entityId == null ? null : Number(entry.entityId),
    masterCustomerId: entry.masterCustomerId == null ? null : Number(entry.masterCustomerId),
    description: String(entry.description).slice(0, 500),
    beforeJson: entry.before == null ? null : JSON.stringify(entry.before),
    afterJson: entry.after == null ? null : JSON.stringify(entry.after),
    requestId: context.requestId || null,
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null
  });
  return Number(result.insertId);
}

module.exports = { requestContext, appendAudit };
