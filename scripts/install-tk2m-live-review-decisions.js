#!/usr/bin/env node
'use strict';
/**
 * TK2M LIVE production-only repair of missing Data Review decision/history
 * tables. NEVER installs source-comparison data: that optional feed must
 * remain unavailable until a verified UENT snapshot is separately approved.
 *
 * Read-only check:
 *   node scripts/install-tk2m-live-review-decisions.js --check
 * Controlled write, only AFTER fresh protected DB backup:
 *   node scripts/install-tk2m-live-review-decisions.js --apply --backup=<basename>
 *
 * No DROP, TRUNCATE, UPDATE, DELETE, customer/line/task or import DML.
 * CREATE TABLE IF NOT EXISTS is idempotent. Keep the backup if reverting code.
 */
const fs=require('node:fs');
const path=require('node:path');
const dotenv=require('dotenv');
process.umask(0o077);

const runtime='/home/talk/crm-migration/production-runtime.env';
const stat=fs.statSync(runtime);
if(!stat.isFile() || (stat.mode & 0o077)!==0)
  throw Error('REFUSING: TK2M runtime configuration is not private');
const env=dotenv.parse(fs.readFileSync(runtime));
for(const [k,v] of Object.entries(env))process.env[k]=v;

if(env.CRM_LIVE_MODE!=='true' || env.CRM_STAGE_MODE!=='false' ||
   env.DB_NAME!=='talk_crm_stage' || env.DB_USER!=='talk_crmstg' ||
   env.APP_URL!=='https://crm.tk2m.co.za')
  throw Error('REFUSING: expected isolated TK2M LIVE production environment not proven');

const check=process.argv.includes('--check'),apply=process.argv.includes('--apply');
if(check===apply)throw Error('REFUSING: specify exactly one of --check or --apply');
const expectedBackupArg=process.argv.find(x=>x.startsWith('--backup='));
if(apply){
  const base=expectedBackupArg?.slice('--backup='.length)||'';
  if(!/^talk_Crm_before_master_refresh_\d{14}\.sql\.gz$/.test(base))
    throw Error('REFUSING: --apply requires a verified fresh database backup filename');
  const file=path.join('/home/talk/crm-live/backups',base);
  const st=fs.statSync(file);
  if(!st.isFile()||st.size<100000||(st.mode&0o077)!==0)
    throw Error('REFUSING: production database backup is missing, unsafe or unexpectedly small');
  const age=Date.now()-st.mtimeMs;
  if(age<0||age>20*60*1000)
    throw Error('REFUSING: backup must be completed within 20 minutes of this migration');
}

const db=require('../src/config/db');
const tables=[
  ['tk2m_review_decisions',
   'CREATE TABLE IF NOT EXISTS tk2m_review_decisions ('+
   'case_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,'+
   'kind VARCHAR(40) NOT NULL,source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
   'status ENUM("verified","keep_separate","needs_update","hold") NOT NULL,'+
   'note TEXT NOT NULL,reviewer_staff_id BIGINT UNSIGNED NOT NULL,'+
   'revision INT UNSIGNED NOT NULL DEFAULT 1,reviewed_at DATETIME NOT NULL,'+
   'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
   'INDEX idx_kind_status(kind,status),INDEX idx_reviewer(reviewer_staff_id,reviewed_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
   ['case_id','kind','source_hash','status','note','reviewer_staff_id','revision','reviewed_at','created_at']],
  ['tk2m_review_history',
   'CREATE TABLE IF NOT EXISTS tk2m_review_history ('+
   'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,'+
   'case_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
   'kind VARCHAR(40) NOT NULL,status VARCHAR(40) NOT NULL,'+
   'source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
   'note TEXT NOT NULL,reviewer_staff_id BIGINT UNSIGNED NOT NULL,'+
   'revision INT UNSIGNED NOT NULL,reviewed_at DATETIME NOT NULL,'+
   'INDEX idx_case_revision(case_id,revision),INDEX idx_reviewed_at(reviewed_at),INDEX idx_reviewer(reviewer_staff_id,reviewed_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
   ['id','case_id','kind','status','source_hash','note','reviewer_staff_id','revision','reviewed_at']]
];

async function validateTable(name,required) {
  const [columns]=await db.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[name]);
  const have=new Set(columns.map(c=>c.COLUMN_NAME));
  if(required.some(c=>!have.has(c)))
    throw Error('REFUSING: unexpected pre-existing schema for '+name);
}
async function run(){
  try {
    const [present]=await db.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tk2m_review_decisions','tk2m_review_history')");
    const existing=new Set(present.map(r=>r.TABLE_NAME));
    if(check){
      console.log('TK2M_REVIEW_LIVE_SCHEMA_CHECK current='+[...existing].sort().join(',')+
        ' missing='+tables.filter(([n])=>!existing.has(n)).map(([n])=>n).join(','));
      for(const [name,,required] of tables)if(existing.has(name))await validateTable(name,required);
      return;
    }
    for(const [name,ddl,required] of tables) {
      if(existing.has(name))await validateTable(name,required);
      else await db.query(ddl);
      await validateTable(name,required);
    }
    const [counts]=await db.query(
      "SELECT (SELECT COUNT(*) FROM tk2m_review_decisions) decisions,"+
      "(SELECT COUNT(*) FROM tk2m_review_history) history");
    console.log('TK2M_LIVE_REVIEW_DECISIONS_SCHEMA_READY decisions='+counts[0].decisions+
      ' history='+counts[0].history+' source_snapshot_not_modified=true');
  } finally {await db.end();}
}
run().catch(error=>{
  console.error('TK2M_LIVE_REVIEW_SCHEMA_REFUSED_OR_FAILED',error.code||error.message);
  process.exitCode=1;
});
