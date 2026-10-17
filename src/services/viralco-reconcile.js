'use strict';

const fs=require('fs');
const crypto=require('crypto');
const path=require('path');
const {normaliseSouthAfricanMobile}=require('./sa-phone-normalisation');
const {normaliseAccountNumber,companyKey}=require('./viralco-report');
const {todayInSouthAfrica}=require('./uat-customer-filters');

let initialized=null;
async function ensureSchema(db){
  if(initialized)return initialized;
  initialized=(async()=>{
    const sql=fs.readFileSync(path.join(__dirname,'../../sql/20261017_viralco_direct_import.sql'),'utf8')
      .split(';').map(s=>s.trim()).filter(Boolean);
    for(const statement of sql)await db.query(statement);
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
