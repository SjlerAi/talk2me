'use strict';

const fs=require('fs');
const path=require('path');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}
function forbidText(source,needle,label){if(source.includes(needle))throw new Error(`Forbidden ${label}`);}

const routes=read('customer-merge-execution-readiness-routes.js');
const security=read('security-routes.js');
const permissions=read('core/permissions.js');
const schema=read('schema-verification.js');

requireText(routes,"customer.merge.execution.authorise",'owner-only readiness permission');
requireText(routes,"a.expires_at>NOW()",'database-time expiry check');
forbidText(routes,"Date.now()",'application-clock expiry comparison');
requireText(routes,"authorisationApproved",'approved authorisation check');
requireText(routes,"authorisationUnexpired",'expiry check');
requireText(routes,"planRevalidated",'revalidation evidence check');
requireText(routes,"planHashMatches",'plan hash check');
requireText(routes,"snapshotHashMatches",'snapshot hash check');
requireText(routes,"backupVerified",'verified backup check');
requireText(routes,"backupIsPreview",'preview database check');
requireText(routes,"backupChecksumPresent",'backup checksum check');
requireText(routes,"logFailure",'controlled server-side error logging');
requireText(routes,"executionAvailable:false",'execution lock');
requireText(permissions,"customer.merge.execution.authorise",'protected authorisation permission');
requireText(security,"createMergeExecutionReadinessRouter",'router mount');
requireText(schema,"os2_customer_merge_execution_authorisations",'authorisation schema verification');
requireText(schema,"os2_customer_merge_execution_authorisation_history",'authorisation history verification');

console.log(JSON.stringify({ok:true,check:'customer-merge-execution-readiness'},null,2));
