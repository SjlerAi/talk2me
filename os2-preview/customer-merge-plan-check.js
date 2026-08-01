'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function need(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}

const routes=read('customer-merge-plan-routes.js');
const security=read('security-routes.js');
const permissions=read('core/permissions.js');
const migration=read('migrations/20260801_020_customer_merge_planning.sql');
need(routes,"MERGE_RECOMMENDATION_REQUIRED",'recommended-case requirement');
need(routes,"MERGE_PLAN_HASH_MISMATCH",'plan hash validation');
need(routes,"SELF_APPROVAL_NOT_ALLOWED",'separation of duties');
need(routes,"MERGE_PLAN_HAS_BLOCKERS",'blocker enforcement');
need(routes,"executionAvailable:false",'execution hard disable');
need(routes,"duplicate_accounts",'account conflict detection');
need(routes,"duplicate_mobile_numbers",'mobile conflict detection');
need(security,"createCustomerMergePlanRouter",'router mount');
need(permissions,"customer.merge.plan",'plan permission');
need(migration,"os2_customer_merge_plans",'merge plan schema');
need(migration,"plan_hash",'immutable plan checksum');
console.log(JSON.stringify({ok:true,check:'customer-merge-planning'},null,2));
