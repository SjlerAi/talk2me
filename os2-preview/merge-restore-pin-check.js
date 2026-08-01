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
requireText(migration,'ORDER BY rt.completed_at DESC,rt.id DESC','deterministic latest restore backfill');
forbidText(migration,'MAX(rt.id)','non-chronological restore selection');

const routePinned=authorisation.includes('restore_test_id')&&readiness.includes('a.restore_test_id');
if(routePinned){
  requireText(authorisation,'PINNED_RESTORE_TEST_REQUIRED','missing pinned restore rejection');
  requireText(readiness,'rt.id=a.restore_test_id','exact readiness restore join');
}

console.log(JSON.stringify({ok:true,check:'merge-restore-pin',schemaReady:true,routePinned},null,2));
