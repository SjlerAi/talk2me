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
const migration001=read('migrations/20260801_001_integrated_core.sql');
const migration011=read('migrations/20260801_011_backup_recovery_and_operations.sql');
const migration021=read('migrations/20260801_021_merge_plan_freshness.sql');

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
need(readiness,"restore_status='passed'",'passed restore requirement');
need(readiness,"target_environment='isolated_preview_restore'",'isolated restore requirement');
need(readiness,"actual_database_name='kloka_talk2me'",'preview restore database requirement');
need(readiness,'failed_checks=0','zero failed restore checks');
need(readiness,'executionAvailable:false','execution lock');

console.log(JSON.stringify({ok:true,check:'schema-source-consistency'},null,2));
