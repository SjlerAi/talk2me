'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function need(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}

const routes=read('duplicate-customer-routes.js');
const migration=read('migrations/20260801_019_duplicate_customer_governance.sql');
const security=read('security-routes.js');
const permissions=read('core/permissions.js');

need(routes,"INSERT IGNORE INTO os2_customer_duplicate_cases",'idempotent duplicate-case creation');
need(routes,"SELF_REVIEW_NOT_ALLOWED",'separation of duties');
need(routes,"SURVIVOR_NOT_IN_CASE",'survivor validation');
need(routes,"mergeExecuted:false",'no silent merge guarantee');
need(routes,"normalisePhone",'normalised phone matching');
need(routes,"account_match",'account-number evidence');
need(routes,"appendAudit",'central audit evidence');
need(migration,"UNIQUE KEY uq_duplicate_pair",'pair uniqueness');
need(migration,"os2_customer_duplicate_history",'duplicate history schema');
need(security,"createDuplicateCustomerRouter",'router mount');
need(permissions,"customer.merge.review",'duplicate review permission');

console.log(JSON.stringify({ok:true,check:'duplicate-customer-governance'},null,2));
