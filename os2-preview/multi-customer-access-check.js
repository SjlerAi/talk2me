'use strict';

const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'customer-access-control.js'),'utf8');

function need(text,label){if(!source.includes(text))throw new Error(`Missing ${label}`);}
function forbid(text,label){if(source.includes(text))throw new Error(`Forbidden ${label}`);}

need('resolveCustomerIdsFromRequest','multi-customer request resolver');
need('primary_customer_id,candidate_customer_id','duplicate-case customer pair lookup');
need('survivor_customer_id,source_customer_id','merge-plan customer pair lookup');
need('req.body?.duplicateCaseId','merge preparation duplicate-case resolution');
need('for (const customerId of customerIds)','all-customer access enforcement');
need('requiredCustomerIds:customerIds','multi-customer audit evidence');
need('masterCustomerIds:customerIds','resolved customer set on request');
need("error:'CUSTOMER_ACCESS_DENIED'",'access denial');
need("error:'CUSTOMER_WRITE_ACCESS_REQUIRED'",'write denial');
forbid('SELECT primary_customer_id AS master_customer_id FROM os2_customer_duplicate_cases','single-sided duplicate access resolution');
forbid('SELECT survivor_customer_id AS master_customer_id FROM os2_customer_merge_plans','single-sided merge access resolution');

console.log(JSON.stringify({ok:true,check:'multi-customer-access'},null,2));
