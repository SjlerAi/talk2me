#!/usr/bin/env node
'use strict';
require('dotenv').config();
if (process.env.CRM_STAGE_MODE!=='true' || process.env.DB_NAME!=='talk_crm_stage' ||
    process.env.DB_USER!=='talk_crmstg' || process.env.APP_URL!=='https://crm.tk2m.co.za') {
 throw Error('REFUSING: merge plans may only be installed on isolated TK2M staging');
}
const db=require('../src/config/db');
const statements=[
 'CREATE TABLE IF NOT EXISTS tk2m_merge_case_locks ('+
 'case_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB',
 'CREATE TABLE IF NOT EXISTS tk2m_merge_proposals ('+
 'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,'+
 'case_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
 'kind VARCHAR(40) NOT NULL,'+
 'status ENUM("submitted","approved","needs_revision") NOT NULL DEFAULT "submitted",'+
 'source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
 'plan_json LONGTEXT NOT NULL,note TEXT NOT NULL,'+
 'proposed_by BIGINT UNSIGNED NOT NULL,approved_by BIGINT UNSIGNED NULL,'+
 'revision INT UNSIGNED NOT NULL DEFAULT 1,'+
 'proposed_at DATETIME NOT NULL,approved_at DATETIME NULL,'+
 'INDEX idx_case_status(case_id,status),INDEX idx_proposer(proposed_by,proposed_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
 'CREATE TABLE IF NOT EXISTS tk2m_merge_proposal_history ('+
 'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,'+
 'proposal_id BIGINT UNSIGNED NOT NULL,case_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
 'revision INT UNSIGNED NOT NULL,'+
 'action ENUM("submitted","approved","needs_revision") NOT NULL,'+
 'actor_staff_id BIGINT UNSIGNED NOT NULL,note TEXT NOT NULL,'+
 'source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,'+
 'recorded_at DATETIME NOT NULL,'+
 'INDEX idx_proposal_revision(proposal_id,revision),INDEX idx_case_date(case_id,recorded_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
];
async function run(){
 try{
  for(const sql of statements)await db.query(sql);
  const [rows]=await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tk2m_merge_case_locks','tk2m_merge_proposals','tk2m_merge_proposal_history')");
  if(rows.length!==3)throw Error('Incomplete staging merge proposal tables');
  console.log('STAGING_PROPOSALS_INSTALLED',rows.map(x=>x.TABLE_NAME).join(','));
 }finally{await db.end();}
}
run().catch(err=>{console.error('MERGE_SCHEMA_INSTALL_FAILED',err.message);process.exitCode=1;});
