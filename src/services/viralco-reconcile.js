'use strict';

const crypto=require('crypto');
const {normaliseSouthAfricanMobile}=require('./sa-phone-normalisation');
const {normaliseAccountNumber,companyKey}=require('./viralco-report');
const {todayInSouthAfrica}=require('./uat-customer-filters');

// The shared UAT deployer packages JS services but not the sql/ migrations folder.
// Keep these additive CREATE TABLE statements embedded so first-run previews work.
const VIRALCO_CREATE_STATEMENTS=Object.freeze([
  "CREATE TABLE IF NOT EXISTS viralco_import_previews (\n  id CHAR(36) PRIMARY KEY,\n  account_id BIGINT UNSIGNED NOT NULL,\n  client_id BIGINT UNSIGNED NOT NULL,\n  uploaded_by BIGINT UNSIGNED NOT NULL,\n  filename VARCHAR(255) NOT NULL,\n  file_hash CHAR(64) NOT NULL,\n  file_data MEDIUMBLOB NOT NULL,\n  expected_version_id BIGINT UNSIGNED NULL,\n  expected_crm_digest CHAR(64) NOT NULL,\n  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  expires_at DATETIME NOT NULL,\n  KEY idx_viralco_preview_account (account_id,uploaded_by,expires_at)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  "CREATE TABLE IF NOT EXISTS viralco_import_versions (\n  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,\n  account_id BIGINT UNSIGNED NOT NULL,\n  version_no INT UNSIGNED NOT NULL,\n  provider_account_number VARCHAR(80) NOT NULL,\n  provider_company_name VARCHAR(180) NOT NULL,\n  previous_account_name VARCHAR(180) NULL,\n  filename VARCHAR(255) NOT NULL,\n  file_hash CHAR(64) NOT NULL,\n  file_data MEDIUMBLOB NOT NULL,\n  line_count INT UNSIGNED NOT NULL,\n  matched_count INT UNSIGNED NOT NULL DEFAULT 0,\n  updated_count INT UNSIGNED NOT NULL DEFAULT 0,\n  created_count INT UNSIGNED NOT NULL DEFAULT 0,\n  review_count INT UNSIGNED NOT NULL DEFAULT 0,\n  omitted_count INT UNSIGNED NOT NULL DEFAULT 0,\n  published_by BIGINT UNSIGNED NOT NULL,\n  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  is_current TINYINT(1) NOT NULL DEFAULT 1,\n  name_approved_by BIGINT UNSIGNED NULL,\n  UNIQUE KEY uq_viralco_account_version (account_id,version_no),\n  KEY idx_viralco_active (account_id,is_current,published_at)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  "CREATE TABLE IF NOT EXISTS viralco_import_lines (\n  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,\n  version_id BIGINT UNSIGNED NOT NULL,\n  source_row INT UNSIGNED NOT NULL,\n  msisdn_original VARCHAR(40) NOT NULL,\n  phone_normalised VARCHAR(20) NOT NULL,\n  subscriber_name VARCHAR(160) NULL,\n  invoice_name VARCHAR(160) NULL,\n  sponsored_account VARCHAR(120) NULL,\n  activation_date DATE NULL,\n  term_date DATE NULL,\n  upgradable CHAR(1) NOT NULL,\n  earliest_upgrade_date DATE NULL,\n  last_upgrade_date DATE NULL,\n  pack_code VARCHAR(80) NULL,\n  pack_desc VARCHAR(180) NULL,\n  avg_spend DECIMAL(14,2) NULL,\n  loyalty_status VARCHAR(120) NULL,\n  sim_number VARCHAR(80) NULL,\n  dealer_id VARCHAR(80) NULL,\n  line_status_code VARCHAR(30) NULL,\n  matched_client_id BIGINT UNSIGNED NULL,\n  sync_action ENUM('updated','unchanged','created','pending_new','conflict','ambiguous') NOT NULL,\n  old_crm_json TEXT NULL,\n  new_crm_json TEXT NULL,\n  UNIQUE KEY uq_viralco_version_row (version_id,source_row),\n  KEY idx_viralco_version (version_id),\n  KEY idx_viralco_phone (phone_normalised),\n  KEY idx_viralco_matched_client (matched_client_id),\n  CONSTRAINT fk_viralco_import_version\n    FOREIGN KEY (version_id) REFERENCES viralco_import_versions (id)\n    ON DELETE RESTRICT\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
]);
let initialized=null;
async function ensureSchema(db){
  if(initialized)return initialized;
  initialized=(async()=>{
    for(const sql of VIRALCO_CREATE_STATEMENTS)await db.query(sql);
  })().catch(error=>{initialized=null;throw error;});
  return initialized;
}
const isoDate=value=>{
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string')return value.slice(0,10);
  if(value instanceof Date){
    return String(value.getFullYear())+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0');
  }
  return null;
};
function crmState(row){
  if(!row)return null;
  return {
    package_name:row.package_name||null,
    next_upgrade_date:isoDate(row.next_upgrade_date),
    upgrade_date:isoDate(row.upgrade_date),
    previous_upgrade_date:isoDate(row.previous_upgrade_date)
  };
}
function intendedState(line,row){
  const current=crmState(row)||{};
  return {
    package_name:line.packDesc||current.package_name||null,
    next_upgrade_date:line.earliestUpgradeDate||current.next_upgrade_date||null,
    upgrade_date:line.earliestUpgradeDate||current.upgrade_date||null,
    previous_upgrade_date:line.lastUpgradeDate||current.previous_upgrade_date||null
  };
}
function equalState(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function accountKey(account){
  return normaliseAccountNumber(account?.account_number_normalised||account?.account_number||'');
}
function belongsToAccount(client,account){
  // Explicit account_id has precedence over a stale/duplicated account_number.
  if(Number(client.account_id)>0)return Number(client.account_id)===Number(account.id);
  return Boolean(client.account_number&&normaliseAccountNumber(client.account_number)===accountKey(account));
}
function matchReport(report,account,own,global){
  const ownMap=new Map(),globalMap=new Map();
  for(const row of own){
    const phone=normaliseSouthAfricanMobile(row.cell_number_normalised)||normaliseSouthAfricanMobile(row.cell_number);
    if(!phone)continue;
    const hits=ownMap.get(phone)||[];hits.push(row);ownMap.set(phone,hits);
  }
  for(const row of global){
    const phone=normaliseSouthAfricanMobile(row.cell_number_normalised)||normaliseSouthAfricanMobile(row.cell_number);
    if(!phone)continue;
    const hits=globalMap.get(phone)||[];hits.push(row);globalMap.set(phone,hits);
  }
  const rows=report.rows.map(line=>{
    const here=ownMap.get(line.phone)||[];
    const anywhere=globalMap.get(line.phone)||[];
    const foreign=anywhere.filter(c=>!belongsToAccount(c,account));
    const found=here.length===1?here[0]:null;
    let action='new',reason='';
    if(foreign.length){action='conflict';reason='The same mobile number is linked to another CRM account.';}
    else if(here.length>1||anywhere.length>1){action='ambiguous';reason='The number has multiple CRM records. Review identities before changing data.';}
    else if(found){
      action=equalState(crmState(found),intendedState(line,found))?'unchanged':'update';
    }
    return {...line,action,reason,clientId:found?Number(found.id):null,
      previous:found?crmState(found):null,proposed:found?intendedState(line,found):intendedState(line,null),
      previousUpdatedAt:found?.updated_at?new Date(found.updated_at).toISOString():null};
  });
  const reportPhones=new Set(report.rows.map(x=>x.phone));
  const missing=own.filter(c=>{
    const phone=c.cell_number_normalised||normaliseSouthAfricanMobile(c.cell_number);
    return phone&&!reportPhones.has(phone);
  });
  const count=action=>rows.filter(row=>row.action===action).length;
  const nameMismatch=companyKey(report.customerName)!==companyKey(account.display_name);
  const mismatchEligibility=rows.filter(row=>row.upgradable==='N'&&row.earliestUpgradeDate&&row.earliestUpgradeDate<=todayInSouthAfrica()).length;
  return {rows,missingCount:missing.length,nameMismatch,reportCompanyName:report.customerName,
    total:rows.length,matched:count('update')+count('unchanged'),changed:count('update'),
    unchanged:count('unchanged'),safeNew:count('new'),
    conflicts:count('conflict')+count('ambiguous'),eligible:rows.filter(x=>x.upgradable==='Y').length,
    mismatchEligibility};
}
async function loadAccountLines(conn,account,lock=false){
  const sql='SELECT id,account_id,account_number,cell_number,cell_number_normalised,client_name,package_name,'+
    'DATE_FORMAT(next_upgrade_date,"%Y-%m-%d") next_upgrade_date,'+
    'DATE_FORMAT(upgrade_date,"%Y-%m-%d") upgrade_date,'+
    'DATE_FORMAT(previous_upgrade_date,"%Y-%m-%d") previous_upgrade_date,updated_at '+
    'FROM clients WHERE account_id=:accountId OR (account_id IS NULL AND account_number IS NOT NULL '+
    'AND UPPER(REPLACE(TRIM(account_number)," ",""))=:normal)'+(lock?' FOR UPDATE':'');
  const [rows]=await conn.execute(sql,{accountId:account.id,normal:accountKey(account)});
  return rows;
}
function crmDigest(own){
  const ordered=own.map(row=>({id:Number(row.id),phone:normaliseSouthAfricanMobile(row.cell_number_normalised)||normaliseSouthAfricanMobile(row.cell_number),state:crmState(row),updatedAt:row.updated_at?new Date(row.updated_at).toISOString():null})).sort((a,b)=>a.id-b.id);
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}
async function loadGlobalPhoneMatches(conn,report,lock=false){
  const found=[];
  const phones=[...new Set(report.rows.map(r=>r.phone))];
  for(let i=0;i<phones.length;i+=160){
    const chunk=phones.slice(i,i+160);
    const raws=chunk.map(n=>'0'+n.slice(2));
    const sql='SELECT id,account_id,account_number,cell_number,cell_number_normalised FROM clients '+
      'WHERE cell_number_normalised IN ('+chunk.map(()=>'?').join(',')+') '+
      'OR cell_number IN ('+raws.map(()=>'?').join(',')+')'+(lock?' FOR UPDATE':'');
    const [rows]=await conn.query(sql,[...chunk,...raws]);
    found.push(...rows.filter(r=>chunk.includes(normaliseSouthAfricanMobile(r.cell_number_normalised)||normaliseSouthAfricanMobile(r.cell_number))));
  }
  // Legacy rows without a normalised number are checked read-only, avoiding broad locking.
  const [unindexed]=await conn.query("SELECT id,account_id,account_number,cell_number,cell_number_normalised FROM clients WHERE (cell_number_normalised IS NULL OR cell_number_normalised='') AND cell_number IS NOT NULL");
  for(const r of unindexed){if(phones.includes(normaliseSouthAfricanMobile(r.cell_number)))found.push(r);}
  return [...new Map(found.map(r=>[Number(r.id),r])).values()];
}
module.exports={ensureSchema,crmState,intendedState,matchReport,loadAccountLines,loadGlobalPhoneMatches,belongsToAccount,isoDate,crmDigest};
