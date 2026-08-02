'use strict';

const fs=require('fs');
const path=require('path');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}

const core=read('core/approvals.js');
const permissions=read('core/permissions.js');
const guard=read('customer-access-control.js');
const migration=read('migrations/20260801_024_approval_integrity_versioning.sql');

requireText(core,'CURRENT_INTEGRITY_VERSION = 2','current approval integrity version');
requireText(core,'APPROVAL_INTEGRITY_VERSION_UNSUPPORTED','legacy integrity rejection');
requireText(core,'APPROVAL_INVALIDATED','invalidated approval rejection');
requireText(core,'APPROVAL_PAYLOAD_HASH_REQUIRED','mandatory payload hash');
requireText(core,'APPROVAL_CONSUMPTION_RACE','one-time atomic consumption check');
requireText(core,'integrity_version=:integrityVersion','version-bound consumption update');
requireText(permissions,"'approval.create'",'explicit approval request permission');
requireText(guard,"hasPermission(req.user,'approval.create')",'approval request route permission enforcement');
requireText(migration,"legacy_approval_missing_canonical_payload_hash",'legacy approval invalidation reason');
requireText(migration,"status IN ('pending','deferred','approved')",'all usable legacy approval states invalidated');

console.log(JSON.stringify({ok:true,check:'approval-integrity-versioning',integrityVersion:2},null,2));
