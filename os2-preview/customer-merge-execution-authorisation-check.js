'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}
function forbidText(source,needle,label){if(source.includes(needle))throw new Error(`Forbidden ${label}`);}

const routes=read('customer-merge-execution-authorisation-routes.js');
const security=read('security-routes.js');
const permissions=read('core/permissions.js');
const migration=read('migrations/20260801_022_merge_execution_authorisation.sql');

requireText(routes,'VERIFIED_PREVIEW_BACKUP_REQUIRED','verified preview backup gate');
requireText(routes,'PASSED_PREVIEW_RESTORE_TEST_REQUIRED','passed restore-test gate');
requireText(routes,"['database','full'].includes(backup.backup_type)",'permitted backup types');
requireText(routes,"backup.database_name==='kloka_talk2me'",'preview database identity');
requireText(routes,'backup.completed_at','completed backup evidence');
requireText(routes,'backup.verified_at','verified backup evidence');
requireText(routes,'backup.checksum_sha256','backup checksum evidence');
requireText(routes,'backup.storage_path','backup storage evidence');
requireText(routes,'backup.file_name','backup file evidence');
requireText(routes,"restore.status==='passed'",'restore passed status');
requireText(routes,"restore.target_environment==='isolated_preview_restore'",'isolated restore environment');
requireText(routes,"restore.actual_database_name==='kloka_talk2me'",'restored preview database identity');
requireText(routes,'Number(restore.failed_checks)===0','zero failed restore checks');
requireText(routes,'MERGE_PLAN_REVALIDATION_REQUIRED','freshness gate');
requireText(routes,'plan.revalidated_at','schema-aligned revalidation timestamp');
requireText(routes,'plan.invalidated_at','invalidated plan rejection');
requireText(routes,'plan.executed_at','already executed plan rejection');
requireText(routes,'Number(plan.conflict_count)>0','conflict enforcement');
requireText(routes,'SELF_AUTHORISATION_NOT_ALLOWED','separation of duties');
requireText(routes,'CONSUMED_AUTHORISATION_CANNOT_BE_REUSED','consumed authorisation reuse protection');
requireText(routes,'AUTHORISATION_REQUEST_ALREADY_PENDING','duplicate pending request protection');
requireText(routes,'ACTIVE_AUTHORISATION_ALREADY_EXISTS','active authorisation overwrite protection');
requireText(routes,"existing.status==='authorised'",'active status check');
requireText(routes,'existing.is_unexpired','database-time active-authorisation check');
requireText(routes,"INTERVAL 30 MINUTE",'short authorisation lifetime');
requireText(routes,'expires_at>NOW()','database-time expiry evaluation');
requireText(routes,'AUTHORISATION_EXPIRY_NOT_ACTIVE','authorisation expiry activation assertion');
requireText(routes,'customer_merge_execution_authorisation_revoked','revocation audit event');
requireText(routes,'appendAudit(connection','transactional audit evidence');
requireText(routes,'executionAvailable:false','execution remains disabled');
requireText(routes,"status='revoked'",'authorisation revocation');
forbidText(routes,'consumed_at=NULL','consumption evidence reset');
forbidText(routes,'consumed_by=NULL','consumption actor reset');
forbidText(routes,'Date.now()','application-clock expiry calculation');
forbidText(routes,'last_revalidated_at','non-existent legacy revalidation column');
requireText(security,'createMergeExecutionAuthorisationRouter','router mount');
requireText(permissions,'customer.merge.execution.request','manager request permission');
requireText(permissions,'customer.merge.execution.authorise','owner-only authorisation permission');
requireText(migration,'os2_customer_merge_execution_authorisations','authorisation schema');
requireText(migration,'os2_customer_merge_execution_authorisation_history','authorisation history schema');
requireText(migration,'UNIQUE KEY uq_merge_execution_plan','single authorisation per plan');

console.log(JSON.stringify({ok:true,check:'customer-merge-execution-authorisation'},null,2));
