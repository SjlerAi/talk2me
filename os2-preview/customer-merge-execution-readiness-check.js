'use strict';

const fs=require('fs');
const path=require('path');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}
function forbidText(source,needle,label){if(source.includes(needle))throw new Error(`Forbidden ${label}`);}

const routes=read('customer-merge-execution-readiness-routes.js');
const security=read('security-routes.js');
const schema=read('schema-verification.js');
const backupMigration=read('migrations/20260801_011_backup_recovery_and_operations.sql');

requireText(routes,"customer.merge.execution.authorise",'owner-only readiness permission');
requireText(routes,"a.expires_at>NOW()",'database-time expiry check');
forbidText(routes,"Date.now()",'JavaScript expiry evaluation');
requireText(routes,"authorisationApproved",'approved authorisation check');
requireText(routes,"authorisationUnexpired",'expiry result check');
requireText(routes,"planRevalidated",'plan revalidation evidence');
requireText(routes,"planHashMatches",'plan hash check');
requireText(routes,"snapshotHashMatches",'snapshot hash check');
requireText(routes,"backupVerified",'verified backup check');
requireText(routes,"backupCompleted",'completed backup check');
requireText(routes,"backupTypePermitted",'backup type gate');
requireText(routes,"backupArtifactPresent",'backup artifact evidence');
requireText(routes,"backupIsPreview",'preview database check');
requireText(routes,"backupChecksumPresent",'backup checksum gate');
requireText(routes,"os2_restore_tests",'restore-test evidence query');
requireText(routes,"restoreTestPassed",'passed restore-test gate');
requireText(routes,"restoreTargetIsolated",'isolated restore target gate');
requireText(routes,"restoreDatabaseMatches",'restored database identity gate');
requireText(routes,"restoreHasNoFailedChecks",'restore failure-count gate');
requireText(routes,"executionAvailable:false",'execution lock');
requireText(routes,"Merge execution readiness failed",'controlled server-side error logging');
requireText(security,"createMergeExecutionReadinessRouter",'router mount');
requireText(schema,"os2_customer_merge_execution_authorisations",'authorisation schema verification');
requireText(schema,"os2_customer_merge_execution_authorisation_history",'authorisation history verification');
requireText(backupMigration,"os2_backup_runs",'backup schema');
requireText(backupMigration,"os2_restore_tests",'restore-test schema');

console.log(JSON.stringify({ok:true,check:'customer-merge-execution-readiness'},null,2));
