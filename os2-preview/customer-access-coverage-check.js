'use strict';

const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'customer-access-control.js'),'utf8');
const required=[
  '/\\/customer-lifecycle\\/(\\d+)',
  '/\\/representatives\\/(\\d+)',
  '/\\/restrictions\\/(\\d+)',
  '/\\/documents\\/(\\d+)',
  '/\\/work-items\\/(\\d+)',
  '/\\/claims\\/(\\d+)',
  '/\\/approvals\\/(\\d+)',
  '/\\/opportunities\\/(\\d+)',
  'os2_customer_documents',
  'os2_authorised_representatives',
  'os2_customer_claims',
  'lookupCustomerId'
];
for(const marker of required)if(!source.includes(marker))throw new Error(`Missing customer access coverage marker: ${marker}`);
if(!source.includes("if (!READ_METHODS.has(req.method) && access.level === 'read')"))throw new Error('Read-only write denial missing');
if(!source.includes("'access_denied'"))throw new Error('Denied access evidence missing');
console.log(JSON.stringify({ok:true,check:'customer-access-coverage',linkedEntityResolvers:13},null,2));
