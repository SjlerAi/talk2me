'use strict';

const fs=require('fs');
const path=require('path');

const root=__dirname;
const files={
  server:fs.readFileSync(path.join(root,'server.js'),'utf8'),
  control:fs.readFileSync(path.join(root,'customer-access-control.js'),'utf8'),
  routes:fs.readFileSync(path.join(root,'customer-access-routes.js'),'utf8'),
  migration:fs.readFileSync(path.join(root,'migrations','20260801_016_customer_access_governance.sql'),'utf8')
};
const required=[
  [files.server,'createCustomerAccessGuard'],
  [files.server,'createCustomerAccessRouter'],
  [files.control,'CUSTOMER_ACCESS_DENIED'],
  [files.control,'CUSTOMER_WRITE_ACCESS_REQUIRED'],
  [files.control,'os2_customer_access_grants'],
  [files.routes,'SELF_GRANT_NOT_ALLOWED'],
  [files.routes,'ACTIVE_CUSTOMER_ACCESS_GRANT_EXISTS'],
  [files.routes,'customer_access_granted'],
  [files.routes,'customer_access_revoked'],
  [files.migration,'CREATE TABLE os2_customer_access_grants'],
  [files.migration,'CREATE TABLE os2_customer_access_history']
];
for(const [source,token] of required){if(!source.includes(token))throw new Error(`CUSTOMER_ACCESS_GOVERNANCE_CHECK_FAILED:${token}`);}
if(files.server.indexOf('createCustomerAccessGuard')>files.server.indexOf('createIntegratedRouter({ pool, requireAuth })'))throw new Error('CUSTOMER_ACCESS_GUARD_MUST_PRECEDE_ROUTERS');
console.log('Customer access governance architecture check passed');
