'use strict';

const { appendAudit } = require('./audit');

const REPRESENTATIVE_ACTIONS = new Set([
  'view_account','request_upgrade','add_line','change_package','cancel_service',
  'add_fixed_service','finance_device','receive_documents','sign_instruction'
]);

function normalisePermissions(value) {
  let items = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try { items = JSON.parse(trimmed); } catch (error) { items = []; }
    } else items = trimmed.split(',');
  }
  if (!Array.isArray(items)) items = [];
  return [...new Set(items.map(item => String(item).trim()).filter(item => REPRESENTATIVE_ACTIONS.has(item)))];
}

function safeRepresentative(row) {
  if (!row) return null;
  const permissions = normalisePermissions(row.permissions_json || row.permissions);
  return {
    id:Number(row.id),
    masterCustomerId:Number(row.master_customer_id),
    fullName:row.full_name,
    relationshipType:row.relationship_type || null,
    mobile:row.mobile || null,
    email:row.email || null,
    idReference:row.id_reference || null,
    permissions,
    verificationMethod:row.verification_method || null,
    evidenceDocumentId:row.evidence_document_id ? Number(row.evidence_document_id) : null,
    expiresAt:row.expires_at || null,
    status:row.status,
    revokedAt:row.revoked_at || null,
    revokeReason:row.revoke_reason || null,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
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
  return rows.map(safeRepresentative);
}

function canRepresentativePerform(representative, action) {
  if (!representative || !REPRESENTATIVE_ACTIONS.has(action)) return false;
  return normalisePermissions(representative.permissions || representative.permissions_json).includes(action);
}

async function writeHistory(connection,{representativeId,masterCustomerId,eventType,before,after,reason,actorStaffId}){
  await connection.execute(`INSERT INTO os2_representative_history
    (representative_id,master_customer_id,event_type,before_json,after_json,reason,changed_by,created_at)
    VALUES(:representativeId,:masterCustomerId,:eventType,:beforeJson,:afterJson,:reason,:actor,NOW())`,{
    representativeId,masterCustomerId,eventType,
    beforeJson:before?JSON.stringify(before):null,afterJson:after?JSON.stringify(after):null,
    reason:reason||null,actor:Number(actorStaffId)
  });
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
  const after={fullName:options.fullName,relationshipType:options.relationshipType||null,mobile:options.mobile||null,email:options.email||null,idReference:options.idReference||null,permissions,verificationMethod:options.verificationMethod||null,evidenceDocumentId:options.evidenceDocumentId||null,expiresAt:options.expiresAt||null,status:'active'};
  await writeHistory(connection,{representativeId:id,masterCustomerId:Number(options.masterCustomerId),eventType:'created',after,actorStaffId:options.actorStaffId});
  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'authorised_representative_created',
    entityType: 'os2_authorised_representatives',
    entityId: id,
    masterCustomerId: options.masterCustomerId,
    description: `Added authorised representative ${options.fullName}`,
    after,
    requestContext: options.requestContext
  });
  return id;
}

async function updateRepresentative(connection,options){
  const [[row]]=await connection.execute('SELECT * FROM os2_authorised_representatives WHERE id=:id FOR UPDATE',{id:Number(options.representativeId)});
  if(!row)throw new Error('REPRESENTATIVE_NOT_FOUND');
  if(row.revoked_at)throw new Error('REPRESENTATIVE_ALREADY_REVOKED');
  const permissions=normalisePermissions(options.permissions);
  if(!options.fullName||!permissions.length)throw new Error('REPRESENTATIVE_NAME_AND_PERMISSIONS_REQUIRED');
  const before=safeRepresentative(row);
  await connection.execute(`UPDATE os2_authorised_representatives SET
    full_name=:fullName,relationship_type=:relationshipType,mobile=:mobile,email=:email,id_reference=:idReference,
    permissions_json=:permissionsJson,verification_method=:verificationMethod,evidence_document_id=:evidenceDocumentId,
    expires_at=:expiresAt,updated_by=:actor,updated_at=NOW() WHERE id=:id`,{
    id:Number(row.id),fullName:options.fullName,relationshipType:options.relationshipType||null,mobile:options.mobile||null,
    email:options.email||null,idReference:options.idReference||null,permissionsJson:JSON.stringify(permissions),
    verificationMethod:options.verificationMethod||null,evidenceDocumentId:options.evidenceDocumentId||null,
    expiresAt:options.expiresAt||null,actor:Number(options.actorStaffId)
  });
  const after={...before,fullName:options.fullName,relationshipType:options.relationshipType||null,mobile:options.mobile||null,email:options.email||null,idReference:options.idReference||null,permissions,verificationMethod:options.verificationMethod||null,evidenceDocumentId:options.evidenceDocumentId||null,expiresAt:options.expiresAt||null};
  await writeHistory(connection,{representativeId:Number(row.id),masterCustomerId:Number(row.master_customer_id),eventType:'updated',before,after,reason:options.reason,actorStaffId:options.actorStaffId});
  await appendAudit(connection,{actorStaffId:options.actorStaffId,actionType:'authorised_representative_updated',entityType:'os2_authorised_representatives',entityId:row.id,masterCustomerId:row.master_customer_id,description:`Updated authorised representative ${options.fullName}`,before,after,requestContext:options.requestContext});
  return after;
}

async function revokeRepresentative(connection, options) {
  const [[row]] = await connection.execute('SELECT * FROM os2_authorised_representatives WHERE id=:id FOR UPDATE', { id: Number(options.representativeId) });
  if (!row) throw new Error('REPRESENTATIVE_NOT_FOUND');
  if (row.revoked_at) return { representativeId: Number(row.id), alreadyRevoked: true };
  if(!options.reason)throw new Error('REVOCATION_REASON_REQUIRED');
  const before=safeRepresentative(row);
  await connection.execute(`UPDATE os2_authorised_representatives SET status='revoked', revoked_at=NOW(), revoked_by=:actor, revoke_reason=:reason, updated_by=:actor, updated_at=NOW() WHERE id=:id`, {
    id: Number(row.id), actor: Number(options.actorStaffId), reason: options.reason
  });
  const after={...before,status:'revoked',revokeReason:options.reason};
  await writeHistory(connection,{representativeId:Number(row.id),masterCustomerId:Number(row.master_customer_id),eventType:'revoked',before,after,reason:options.reason,actorStaffId:options.actorStaffId});
  await appendAudit(connection, {
    actorStaffId: options.actorStaffId,
    actionType: 'authorised_representative_revoked',
    entityType: 'os2_authorised_representatives',
    entityId: row.id,
    masterCustomerId: row.master_customer_id,
    description: `Revoked authorised representative ${row.full_name}`,
    before,
    after,
    requestContext: options.requestContext
  });
  return { representativeId: Number(row.id), alreadyRevoked: false };
}

module.exports = { REPRESENTATIVE_ACTIONS, normalisePermissions, safeRepresentative, findAuthorisedRepresentative, canRepresentativePerform, createRepresentative, updateRepresentative, revokeRepresentative };
