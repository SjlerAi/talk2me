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
const freshnessMigration=read('migrations/20260801_021_merge_plan_freshness.sql');
need(routes,"MERGE_RECOMMENDATION_REQUIRED",'recommended-case requirement');
need(routes,"MERGE_PLAN_HASH_MISMATCH",'plan hash validation');
need(routes,"SELF_APPROVAL_NOT_ALLOWED",'separation of duties');
need(routes,"MERGE_PLAN_HAS_BLOCKERS",'blocker enforcement');
need(routes,"MERGE_PLAN_STALE",'stale plan rejection');
need(routes,"approval_revalidation",'approval-time revalidation history');
need(routes,"customer_merge_plan_invalidated_at_approval",'approval invalidation audit');
need(routes,"current_snapshot_hash=VALUES(current_snapshot_hash)",'snapshot baseline at preparation');
need(routes,"if(result.error)return res.status(409)",'persisted invalidation response');
need(routes,"executionAvailable:false",'execution hard disable');
need(routes,"duplicate_accounts",'account conflict detection');
need(routes,"duplicate_mobile_numbers",'mobile conflict detection');
need(security,"createCustomerMergePlanRouter",'router mount');
need(permissions,"customer.merge.plan",'plan permission');
need(permissions,"customer.merge.approve",'owner-only approval permission');
need(migration,"os2_customer_merge_plans",'merge plan schema');
need(migration,"plan_hash",'immutable plan checksum');
need(freshnessMigration,"current_snapshot_hash",'freshness checksum column');
console.log(JSON.stringify({ok:true,check:'customer-merge-planning-and-approval-freshness'},null,2));
