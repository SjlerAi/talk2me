'use strict';

const fs=require('fs');
const path=require('path');
const root=__dirname;
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}
function forbidText(source,needle,label){if(source.includes(needle))throw new Error(`Forbidden ${label}`);}

const migration=read('migrations/20260801_025_merge_authorisation_restore_pin.sql');
const authorisation=read('customer-merge-execution-authorisation-routes.js');
const readiness=read('customer-merge-execution-readiness-routes.js');

requireText(migration,'ADD COLUMN restore_test_id BIGINT NULL','restore evidence reference');
requireText(migration,'idx_merge_execution_restore','restore evidence index');
requireText(migration,"rt.status='passed'",'passed restore backfill filter');
requireText(migration,'rt.completed_at IS NOT NULL','completed restore evidence');
requireText(migration,"rt.target_environment='isolated_preview_restore'",'isolated restore environment');
requireText(migration,"rt.expected_database_name='kloka_talk2me'",'expected preview database');
requireText(migration,"rt.actual_database_name='kloka_talk2me'",'actual preview database');
requireText(migration,'rt.failed_checks=0','zero failed restore checks');
requireText(migration,'a.authorised_at IS NULL OR rt.completed_at<=a.authorised_at','restore chronology against authorisation');
requireText(migration,'ORDER BY rt.completed_at DESC,rt.id DESC','deterministic latest eligible restore backfill');
forbidText(migration,'MAX(rt.id)','non-chronological restore selection');

requireText(authorisation,'restore_test_id','authorisation restore pin storage');
requireText(authorisation,'restoreTestId:evidence.restore.id','selected restore pin assignment');
requireText(authorisation,'PINNED_RESTORE_TEST_REQUIRED','missing pinned restore rejection');
requireText(authorisation,'authorisation.restore_test_id','decision-time pinned restore revalidation');
requireText(authorisation,'id=:restoreTestId AND backup_run_id=:backupRunId','exact restore and backup match');
requireText(readiness,'a.restore_test_id','readiness restore pin projection');
requireText(readiness,'rt.id=a.restore_test_id','exact readiness restore join');
requireText(readiness,'restoreEvidencePinned','pinned restore readiness check');
requireText(readiness,'restoreBelongsToBackup','restore-to-backup ownership check');
forbidText(readiness,'ORDER BY rt2.completed_at','latest restore substitution in readiness');

console.log(JSON.stringify({ok:true,check:'merge-restore-pin',schemaReady:true,routePinned:true,backfillEvidenceHardened:true},null,2));
