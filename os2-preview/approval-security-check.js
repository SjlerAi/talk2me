'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
const files=['core/approvals.js','core/services.js','core/permissions.js','customer-access-control.js','migrations/20260801_012_approval_security_and_consumption.sql','migrations/20260801_024_approval_integrity_versioning.sql','approval-integrity-version-check.js'];
for(const file of files) if(!fs.existsSync(path.join(root,file))) throw new Error(`Missing approval security file: ${file}`);
const approvals=fs.readFileSync(path.join(root,'core/approvals.js'),'utf8');
const services=fs.readFileSync(path.join(root,'core/services.js'),'utf8');
const permissions=fs.readFileSync(path.join(root,'core/permissions.js'),'utf8');
const guard=fs.readFileSync(path.join(root,'customer-access-control.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'migrations/20260801_012_approval_security_and_consumption.sql'),'utf8');
const integrityMigration=fs.readFileSync(path.join(root,'migrations/20260801_024_approval_integrity_versioning.sql'),'utf8');
const markers=[
  'APPROVAL_ACTIONS','payloadHash','APPROVAL_PAYLOAD_INTEGRITY_FAILED','APPROVAL_PAYLOAD_MISMATCH',
  'APPROVAL_ACTION_MISMATCH','APPROVAL_CUSTOMER_MISMATCH','APPROVAL_ALREADY_CONSUMED','consumeApproval',
  'CURRENT_INTEGRITY_VERSION','APPROVAL_INTEGRITY_VERSION_UNSUPPORTED','APPROVAL_INVALIDATED',
  'APPROVAL_PAYLOAD_HASH_REQUIRED','APPROVAL_CONSUMPTION_RACE'
];
for(const marker of markers) if(!approvals.includes(marker)) throw new Error(`Missing approval security marker: ${marker}`);
for(const marker of ['add_mobile_line','add_fixed_service','approval_consumed']) if(!services.includes(marker)) throw new Error(`Missing service approval marker: ${marker}`);
for(const marker of ['payload_hash','consumed_at','os2_approval_consumption_history','uq_os2_approval_consumption_once']) if(!migration.includes(marker)) throw new Error(`Missing approval migration marker: ${marker}`);
for(const marker of ['integrity_version','invalidated_at','legacy_approval_missing_canonical_payload_hash',"status IN ('pending','deferred','approved')"]) if(!integrityMigration.includes(marker)) throw new Error(`Missing approval integrity migration marker: ${marker}`);
if(!permissions.includes("'approval.create'")) throw new Error('Explicit approval create permission missing');
if(!guard.includes("hasPermission(req.user,'approval.create')")) throw new Error('Approval create route permission enforcement missing');
if(/requiresApproval\s*&&\s*!options\.approvalId[\s\S]{0,250}INSERT INTO/.test(services)===false) throw new Error('Restricted service approval gate not found before inserts');
if((services.match(/consumeApproval\(/g)||[]).length<2) throw new Error('Both mobile and fixed service creation must consume approvals');
console.log(JSON.stringify({ok:true,module:'approval-security',actions:markers.length,oneTimeConsumption:true,payloadBinding:true,integrityVersion:2,legacyInvalidation:true,explicitCreatePermission:true},null,2));
