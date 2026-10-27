#!/usr/bin/env node
'use strict';
// Explicit staging-only schema installation. Do not run on live UENT or
// before a TK2M production database has its own approved cutover migration.
require('dotenv').config();
if(process.env.CRM_STAGE_MODE!=='true' || process.env.DB_NAME!=='talk_crm_stage' ||
   process.env.DB_USER!=='talk_crmstg' || process.env.APP_URL!=='https://crm.tk2m.co.za'){
  throw new Error('REFUSING: Data Review schema installation requires isolated TK2M staging.');
}
const db=require('../src/config/db');
const tables=[
  'CREATE TABLE IF NOT EXISTS tk2m_review_decisions ('+
  'case_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,'+
  'kind VARCHAR(40) NOT NULL,source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
  'status ENUM("verified","keep_separate","needs_update","hold") NOT NULL,'+
  'note TEXT NOT NULL,reviewer_staff_id BIGINT UNSIGNED NOT NULL,'+
  'revision INT UNSIGNED NOT NULL DEFAULT 1,reviewed_at DATETIME NOT NULL,'+
  'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
  'INDEX idx_kind_status(kind,status),INDEX idx_reviewer(reviewer_staff_id,reviewed_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'CREATE TABLE IF NOT EXISTS tk2m_review_history ('+
  'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,'+
  'case_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
  'kind VARCHAR(40) NOT NULL,status VARCHAR(40) NOT NULL,'+
  'source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
  'note TEXT NOT NULL,reviewer_staff_id BIGINT UNSIGNED NOT NULL,'+
  'revision INT UNSIGNED NOT NULL,reviewed_at DATETIME NOT NULL,'+
  'INDEX idx_case_revision(case_id,revision),INDEX idx_reviewed_at(reviewed_at),INDEX idx_reviewer(reviewer_staff_id,reviewed_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'CREATE TABLE IF NOT EXISTS tk2m_review_source_deltas ('+
  'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,'+
  'entity_type VARCHAR(30) NOT NULL,entity_id BIGINT UNSIGNED NOT NULL,'+
  'field_key VARCHAR(60) NOT NULL,source_value VARCHAR(120) NOT NULL,'+
  'stage_value VARCHAR(120) NOT NULL,source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
  'is_current TINYINT(1) NOT NULL DEFAULT 1,checked_at DATETIME NOT NULL,'+
  'UNIQUE KEY uq_delta(entity_type,entity_id,field_key),INDEX idx_current(is_current,entity_type)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
];
async function run(){
  try{
    for(const ddl of tables)await db.query(ddl);
    const [rows]=await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tk2m_review_decisions','tk2m_review_history','tk2m_review_source_deltas')");
    if(rows.length!==3)throw new Error('Missing data review tables');
    console.log('TK2M_STAGING_REVIEW_SCHEMA_READY',rows.map(x=>x.TABLE_NAME).sort().join(','));
  }finally{await db.end();}
}
run().catch(e=>{console.error('REVIEW_SCHEMA_INSTALL_FAILED',e.message);process.exitCode=1;});
