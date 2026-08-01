'use strict';

const fs=require('fs');
const path=require('path');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function need(source,text,label){if(!source.includes(text))throw new Error(`Missing ${label}`);}

const route=read('customer-merge-freshness-routes.js');
const security=read('security-routes.js');
const migration=read('migrations/20260801_021_merge_plan_freshness.sql');

need(route,'/revalidate','revalidation endpoint');
need(route,'current_snapshot_hash','snapshot hash');
need(route,"status='invalidated'",'automatic invalidation');
need(route,'pending_approvals','approval blocker refresh');
need(route,'duplicate_accounts','account conflict refresh');
need(route,'duplicate_mobile_numbers','mobile conflict refresh');
need(route,'executionAvailable:false','execution remains disabled');
need(route,'customer_merge_plan_revalidated','audit evidence');
need(security,'createCustomerMergeFreshnessRouter','router mount');
need(migration,'invalidated_at','invalidation timestamp');
need(migration,'invalidation_reason','invalidation reason');
need(migration,'revalidated_at','revalidation timestamp');

console.log(JSON.stringify({ok:true,check:'customer-merge-freshness'},null,2));
