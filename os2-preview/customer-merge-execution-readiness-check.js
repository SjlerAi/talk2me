'use strict';

const fs=require('fs');
const path=require('path');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}

const routes=read('customer-merge-execution-readiness-routes.js');
const security=read('security-routes.js');
const schema=read('schema-verification.js');

requireText(routes,"authorisationApproved",'approved authorisation check');
requireText(routes,"authorisationUnexpired",'expiry check');
requireText(routes,"planHashMatches",'plan hash check');
requireText(routes,"snapshotHashMatches",'snapshot hash check');
requireText(routes,"backupVerified",'verified backup check');
requireText(routes,"backupIsPreview",'preview database check');
requireText(routes,"executionAvailable:false",'execution lock');
requireText(security,"createMergeExecutionReadinessRouter",'router mount');
requireText(schema,"os2_customer_merge_execution_authorisations",'authorisation schema verification');
requireText(schema,"os2_customer_merge_execution_authorisation_history",'authorisation history verification');

console.log(JSON.stringify({ok:true,check:'customer-merge-execution-readiness'},null,2));
