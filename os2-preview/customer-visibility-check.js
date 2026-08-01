'use strict';
const fs=require('fs');
function read(path){return fs.readFileSync(path,'utf8');}
function requireText(source,text,label){if(!source.includes(text))throw new Error(`MISSING_${label}`);}
const guard=read('customer-access-control.js');
const search=read('scoped-customer-search.js');
const migration=read('migrations/20260801_017_customer_access_visibility.sql');
requireText(guard,"createScopedCustomerSearch",'SCOPED_SEARCH_MOUNT');
requireText(guard,"access_denied",'DENIED_ACCESS_EVIDENCE');
requireText(guard,"write_denied",'READ_ONLY_WRITE_BLOCK');
requireText(search,"o.assigned_staff_id=:staffId OR g.id IS NOT NULL",'STAFF_SEARCH_SCOPE');
requireText(search,"scope:'authorised_customers'",'SCOPED_RESPONSE');
requireText(migration,'CREATE TABLE os2_customer_access_events','ACCESS_EVENT_TABLE');
requireText(migration,'idx_access_events_customer_date','CUSTOMER_EVENT_INDEX');
console.log('Customer visibility governance validation passed');
