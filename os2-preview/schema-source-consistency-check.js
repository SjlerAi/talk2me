'use strict';

const fs=require('fs');
const path=require('path');

function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function need(source,text,label){if(!source.includes(text))throw new Error(`Missing ${label}`);}
function forbid(source,text,label){if(source.includes(text))throw new Error(`Forbidden ${label}`);}

const plan=read('customer-merge-plan-routes.js');
const freshness=read('customer-merge-freshness-routes.js');
const authorisation=read('customer-merge-execution-authorisation-routes.js');
const readiness=read('customer-merge-execution-readiness-routes.js');
const schemaVerification=read('schema-verification.js');
const restoreEvidenceVerification=read('merge-restore-evidence-verification.js');
const migration001=read('migrations/20260801_001_integrated_core.sql');
const migration011=read('migrations/20260801_011_backup_recovery_and_operations.sql');
const migration021=read('migrations/20260801_021_merge_plan_freshness.sql');
const migration025=read('migrations/20260801_025_merge_authorisation_restore_pin.sql');

need(migration001,"status ENUM('active','expired','revoked','archived')",'representative status lifecycle');
need(plan,"status='active'",'merge plan representative status filter');
need(plan,'expires_at IS NULL OR expires_at>NOW()','merge plan representative expiry filter');
need(freshness,"status='active'",'freshness representative status filter');
need(freshness,'expires_at IS NULL OR expires_at>NOW()','freshness representative expiry filter');
forbid(plan,'os2_authorised_representatives WHERE master_customer_id=:sourceId AND is_active=1','nonexistent representative is_active column in merge plan');
forbid(freshness,'os2_authorised_representatives WHERE master_customer_id=:sourceId AND is_active=1','nonexistent representative is_active column in freshness');
need(migration021,'current_snapshot_hash','merge snapshot hash column');
need(migration021,'revalidated_at','merge revalidation column');
need(authorisation,'revalidated_at','authorisation schema-aligned revalidation evidence');
forbid(authorisation,'last_revalidated_at','nonexistent last_revalidated_at column');
need(migration011,"status ENUM('planned','running','passed','failed','cancelled')",'restore-test status vocabulary');
need(migration025,'ADD COLUMN restore_test_id BIGINT NULL','authorisation restore-test pin column');
need(migration025,'idx_merge_execution_restore','authorisation restore-test pin index');
need(migration025,'ORDER BY rt.completed_at DESC,rt.id DESC','deterministic restore-test backfill');
forbid(migration025,'MAX(rt.id)','non-chronological restore-test backfill');
need(authorisation,'restore_test_id','authorisation stores pinned restore-test evidence');
need(authorisation,'PINNED_RESTORE_TEST_REQUIRED','authorisation rejects missing pinned restore evidence');
need(readiness,'rt.id=a.restore_test_id','readiness joins exact pinned restore test');
need(readiness,'restorePinned','readiness confirms pinned restore identity');
need(readiness,'restoreMatchesBackup','readiness confirms restore belongs to linked backup');
need(readiness,"restore_status='passed'",'passed restore requirement');
need(readiness,"target_environment='isolated_preview_restore'",'isolated restore requirement');
need(readiness,"actual_database_name='kloka_talk2me'",'preview restore database requirement');
need(readiness,'failed_checks=0','zero failed restore checks');
need(readiness,'executionAvailable:false','execution lock');
need(schemaVerification,"'restore_test_id'",'schema verification requires restore-test pin column');
need(schemaVerification,'migrations.length < 25','schema verification requires migration 025');
need(schemaVerification,'restore_test_id IS NULL','schema verification rejects unpinned authorisations');
need(restoreEvidenceVerification,"database !== 'kloka_talk2me'",'preview database refusal guard');
need(restoreEvidenceVerification,'LEFT JOIN os2_backup_runs b ON b.id = a.backup_run_id','exact backup evidence join');
need(restoreEvidenceVerification,'LEFT JOIN os2_restore_tests rt ON rt.id = a.restore_test_id','exact pinned restore evidence join');
need(restoreEvidenceVerification,'rt.backup_run_id <> a.backup_run_id','restore-to-backup relationship check');
need(restoreEvidenceVerification,"b.status <> 'verified'",'verified backup requirement');
need(restoreEvidenceVerification,"rt.status <> 'passed'",'passed restore requirement');
need(restoreEvidenceVerification,"rt.target_environment <> 'isolated_preview_restore'",'isolated restore requirement');
need(restoreEvidenceVerification,"rt.actual_database_name <> 'kloka_talk2me'",'restored database identity requirement');
need(restoreEvidenceVerification,'rt.completed_at > a.authorised_at','restore chronology requirement');

console.log(JSON.stringify({ok:true,check:'schema-source-consistency'},null,2));
