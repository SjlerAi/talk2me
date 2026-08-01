'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}

const routes=read('customer-merge-execution-authorisation-routes.js');
const security=read('security-routes.js');
const permissions=read('core/permissions.js');
const migration=read('migrations/20260801_022_merge_execution_authorisation.sql');

requireText(routes,'VERIFIED_PREVIEW_BACKUP_REQUIRED','verified preview backup gate');
requireText(routes,'MERGE_PLAN_REVALIDATION_REQUIRED','freshness gate');
requireText(routes,'SELF_AUTHORISATION_NOT_ALLOWED','separation of duties');
requireText(routes,"INTERVAL 30 MINUTE",'short authorisation lifetime');
requireText(routes,'executionAvailable:false','execution remains disabled');
requireText(routes,"status='revoked'",'authorisation revocation');
requireText(security,'createMergeExecutionAuthorisationRouter','router mount');
requireText(permissions,'customer.merge.execution.request','manager request permission');
requireText(migration,'os2_customer_merge_execution_authorisations','authorisation schema');
requireText(migration,'os2_customer_merge_execution_authorisation_history','authorisation history schema');
requireText(migration,'UNIQUE KEY uq_merge_execution_plan','single authorisation per plan');

console.log(JSON.stringify({ok:true,check:'customer-merge-execution-authorisation'},null,2));
