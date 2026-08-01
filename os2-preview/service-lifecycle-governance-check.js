'use strict';

const fs=require('fs');
const path=require('path');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function requireText(source,text,label){if(!source.includes(text))throw new Error(`MISSING_${label}`);}
const routes=read('service-lifecycle-routes.js');
const approvals=read('core/approvals.js');
const migration=read('migrations/20260801_014_service_lifecycle_completeness.sql');
requireText(routes,"consumeApproval",'APPROVAL_CONSUMPTION');
requireText(routes,"actionKey:'service_change'",'SERVICE_CHANGE_BINDING');
requireText(routes,"actionKey:'service_cancel'",'SERVICE_CANCEL_BINDING');
requireText(routes,"/api/os2/customers/:id/services",'UNIFIED_SERVICE_LIST');
requireText(routes,"/api/os2/fixed-services/:id",'FIXED_SERVICE_UPDATE');
requireText(routes,"/api/os2/fixed-services/:id/cancel",'FIXED_SERVICE_CANCEL');
requireText(routes,'APPROVAL_PAYLOAD_MISMATCH','PAYLOAD_MISMATCH_CONTROL');
requireText(approvals,"'service_change','service_cancel'",'APPROVAL_ACTIONS');
requireText(migration,'cancellation_reason','CANCELLATION_REASON');
requireText(migration,'idx_fixed_lifecycle_status','FIXED_LIFECYCLE_INDEX');
console.log(JSON.stringify({ok:true,checks:10,scope:'service lifecycle governance'},null,2));
