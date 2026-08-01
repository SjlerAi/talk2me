'use strict';

const { appendAudit } = require('./audit');

const REPRESENTATIVE_ACTIONS = new Set([
  'view_account','request_upgrade','add_line','change_package','cancel_service',
  'add_fixed_service','finance_device','receive_documents','sign_instruction'
]);

function normalisePermissions(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(items.map(item => String(item).trim()).filter(item => REPRESENTATIVE_ACTIONS.has(item)))];
}

async function findAuthorisedRepresentative(connection, options) {
  const [rows] = await connection.execute(`
    SELECT * FROM os2_authorised_representatives
     WHERE master_customer_id=:masterCustomerId
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at>NOW())
       AND (:mobile IS NULL OR mobile=:mobile)
       AND (:email IS NULL OR LOWER(email)=LOWER(:email))
     ORDER BY created_at DESC`, {
    masterCustomerId: Number(options.masterCustomerId),
    mobile: options.mobile || null,
    email: options.email || null
  });
  return rows;
}

function canRepresentativePerform(representative, action) {
  if (!representative || !REPRESENTATIVE_ACTIONS.has(action)) return false;
  const permissions = normalisePermissions(representative.permissions_json ? JSON.parse(representative.permissions_json) : representative.permissions);
  return permissions.includes(action);
}

async function createRepresentative(connection, options) {
  const permissions = normalisePermissions(options.permissions);
  if (!options.fullName || !permissions.length) throw new Error('REPRESENTATIVE_NAME_AND_PERMISSIONS_REQUIRED');
  const [result] = await connection.execute(`
    INSERT INTO os2_authorised_representatives
      (master_customer_id, full_name, relationship_type, mobile, email, id_reference,
       permissions_json, verification_method, evidence_document_id, expires_at,
       status, created_by, updated_by, created_at, updated_at)
    VALUES
      (:masterCustomerId,:fullName,:relationshipType,:mobile,:email,:idReference,
       :permissionsJson,:verificationMethod,:evidenceDocumentId,:expiresAt,
       'active',:actor,:actor,NOW(),NOW())`, {
    masterCustomerId: Number(options.masterCustomerId),
    fullName: options.fullName,
    relationshipType: options.relationshipType || null,
    mobile: options.mobile || null,
    email: options.email || null,
    idReference: options.idReference || null,
    permissionsJson: JSON.stringify(permissions),
    verificationMethod: options.verificationMethod || null,
    evidenceDocumentId: options.evidenceDocumentId || null,
    expiresAt: options.expiresAt || null,
    actor: Number(options.actorStaffId)
  });
  const id = Number(result.insertId);
  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'authorised_representative_created',
    entityType: 'os2_authorised_representatives',
    entityId: id,
    masterCustomerId: options.masterCustomerId,
    description: `Added authorised representative ${options.fullName}`,
    after: { ...options, permissions },
    requestContext: options.requestContext
  });
  return id;
}

async function revokeRepresentative(connection, options) {
  const [[row]] = await connection.execute('SELECT * FROM os2_authorised_representatives WHERE id=:id FOR UPDATE', { id: Number(options.representativeId) });
  if (!row) throw new Error('REPRESENTATIVE_NOT_FOUND');
  if (row.revoked_at) return { representativeId: Number(row.id), alreadyRevoked: true };
  await connection.execute(`UPDATE os2_authorised_representatives SET status='revoked', revoked_at=NOW(), revoked_by=:actor, revoke_reason=:reason, updated_at=NOW() WHERE id=:id`, {
    id: Number(row.id), actor: Number(options.actorStaffId), reason: options.reason || null
  });
  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'authorised_representative_revoked',
    entityType: 'os2_authorised_representatives',
    entityId: row.id,
    masterCustomerId: row.master_customer_id,
    description: `Revoked authorised representative ${row.full_name}`,
    before: { status: row.status, revoked_at: row.revoked_at },
    after: { status: 'revoked', reason: options.reason || null },
    requestContext: options.requestContext
  });
  return { representativeId: Number(row.id), alreadyRevoked: false };
}

module.exports = { REPRESENTATIVE_ACTIONS, normalisePermissions, findAuthorisedRepresentative, canRepresentativePerform, createRepresentative, revokeRepresentative };
