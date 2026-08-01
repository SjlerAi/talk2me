'use strict';

const fs=require('fs');
const path=require('path');

const root=__dirname;
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}

const routes=read('customer-lifecycle-routes.js');
const security=read('security-routes.js');
const permissions=read('core/permissions.js');
const migration=read('migrations/20260801_018_customer_lifecycle_governance.sql');

requireText(routes,"CUSTOMER_ARCHIVE_BLOCKED",'archive blocker enforcement');
requireText(routes,"active_mobile_lines",'active mobile blocker');
requireText(routes,"active_fixed_services",'active fixed blocker');
requireText(routes,"open_work_items",'open work blocker');
requireText(routes,"pending_approvals",'pending approval blocker');
requireText(routes,"customer_access_grants",'grant revocation on archive');
requireText(routes,"customer_reactivation",'ownership restoration on reactivation');
requireText(routes,"os2_customer_lifecycle_history",'lifecycle history');
requireText(security,"createCustomerLifecycleRouter",'router mount');
requireText(permissions,"customer.archive",'archive permission');
requireText(migration,"archive_reason",'archive evidence columns');
requireText(migration,"os2_customer_lifecycle_history",'lifecycle history schema');

console.log(JSON.stringify({ok:true,check:'customer-lifecycle-governance'},null,2));
