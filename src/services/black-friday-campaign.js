'use strict';

const XLSX = require('xlsx');
const db = require('../config/db');

const norm = value => {
  let s = String(value == null ? '' : value).replace(/\D/g,'');
  if (s.length === 11 && s.startsWith('27')) s = '0' + s.slice(2);
  if (s.length === 9 && s.startsWith('6') || s.length === 9 && s.startsWith('7') || s.length === 9 && s.startsWith('8')) s = '0' + s;
  return /^0\d{9}$/.test(s) ? s : '';
};
const txt = (v, max=250) => String(v == null ? '' : v).trim().slice(0,max);
const date = value => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  const v = txt(value,45);
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  return null;
};
let schemaPromise;
function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await db.query("CREATE TABLE IF NOT EXISTS bf26_batches (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,source_filename VARCHAR(200) NOT NULL,imported_by BIGINT UNSIGNED NOT NULL,source_rows INT UNSIGNED NOT NULL DEFAULT 0,unique_phones INT UNSIGNED NOT NULL DEFAULT 0,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    await db.query("CREATE TABLE IF NOT EXISTS bf26_contacts (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,batch_id BIGINT UNSIGNED NOT NULL,msisdn VARCHAR(16) NOT NULL,source_name VARCHAR(250) NULL,source_email VARCHAR(250) NULL,tariff_description VARCHAR(250) NULL,eligible_at DATE NULL,source_upgrade_label VARCHAR(120) NULL,source_row_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,review_flags VARCHAR(500) NULL,match_status VARCHAR(32) NOT NULL DEFAULT 'unmatched',matched_client_id BIGINT UNSIGNED NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_bf26_batch_phone(batch_id,msisdn),KEY ix_bf26_batch(batch_id,match_status),KEY ix_bf26_client(matched_client_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    await db.query("CREATE TABLE IF NOT EXISTS bf26_lines (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,contact_id BIGINT UNSIGNED NOT NULL,source_excel_row INT UNSIGNED NOT NULL,source_payload TEXT NOT NULL,KEY ix_bf26_lines_contact(contact_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    await db.query("CREATE TABLE IF NOT EXISTS bf26_actions (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,contact_id BIGINT UNSIGNED NOT NULL,assigned_staff_id BIGINT UNSIGNED NULL,task_id BIGINT UNSIGNED NULL,call_status VARCHAR(40) NOT NULL DEFAULT 'not_called',call_note TEXT NULL,due_at DATETIME NULL,updated_by BIGINT UNSIGNED NOT NULL,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY uq_bf26_action(contact_id),KEY ix_bf26_assignee(assigned_staff_id,call_status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    await db.query("CREATE TABLE IF NOT EXISTS bf26_current (id TINYINT UNSIGNED NOT NULL PRIMARY KEY,batch_id BIGINT UNSIGNED NOT NULL,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  })().catch(err=>{schemaPromise=null;throw err;});
  return schemaPromise;
}
async function currentBatch() {
  const [[r]] = await db.execute("SELECT b.* FROM bf26_current c JOIN bf26_batches b ON b.id=c.batch_id WHERE c.id=1");
  return r||null;
}
function spreadsheetRows(buffer) {
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:true});
  const sheet=wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw Error('The spreadsheet has no worksheet.');
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',blankrows:true,raw:true});
  const header=rows.findIndex(row=>String(row[1]||'').trim().toUpperCase()==='MSISDN');
  if(header<0) throw Error('MSISDN column not found. Please use the Eligible for Upgrade Combined file.');
  const result=[];
  for (let i=header+1; i<rows.length; i++){
    const r=rows[i]; if(!Array.isArray(r))continue;
    const msisdn=norm(r[1]);if(!msisdn)continue;
    const item={msisdn,source_excel_row:i+1,tariff:txt(r[2],90),tariff_description:txt(r[3],250),
      title:txt(r[6],45),name:txt(r[7],250),email:txt(r[9],250),
      activation_at:date(r[10]),eligible_at:date(r[11]),terminate_at:date(r[12]),
      average_spend:txt(r[13],45),mte:txt(r[14],40),upgrade_label:txt(r[15],120),
      source_status:txt(r[16],60)};
    result.push(item);
  }
  if(result.length===0)throw Error('No valid South African cellphone numbers found.');
  if(result.length>5000)throw Error('Import limit is 5,000 source rows.');
  return result;
}
function accountKey(c){
  const a=txt(c.account_number,100).replace(/\s/g,'').toUpperCase();
  return c.account_id ? 'id:'+c.account_id : a ? 'number:'+a : 'client:'+c.id;
}
function uniqueIds(rows) {return [...new Set(rows.map(x=>Number(x.id)))];}
function resolveMatch(msisdn,byPhone) {
  const matches=byPhone.get(msisdn)||[];
  if(!matches.length) return {match_status:'unmatched',matched_client_id:null};
  const keys=new Set(matches.map(accountKey));
  if(keys.size>1)return {match_status:'ambiguous',matched_client_id:null};
  const ranked=[...matches].sort((a,b)=>{
    const score=r=>Number(r.account_authority_status==='confirmed')*100+Number(r.line_status==='active')*10+Number(r.lifecycle_status==='client')*2;
    return score(b)-score(a)||Number(a.id)-Number(b.id);
  });
  return {match_status:uniqueIds(matches).length>1?'multiple_lines':'matched',matched_client_id:ranked[0].id};
}
async function crmContext() {
  const [[clients],[assignments],[accounts],[staff]] = await Promise.all([
    db.query("SELECT id,account_id,account_number,client_name,cell_number,cell_number_normalised,main_contact_number_normalised,email,package_name,handset,next_upgrade_date,line_status,lifecycle_status,account_authority_status FROM clients WHERE is_active=1"),
    db.query("SELECT client_id,account_number,assigned_staff_id FROM client_assignments WHERE is_active=1"),
    db.query("SELECT id,account_number,assigned_staff_id FROM customer_accounts WHERE assigned_staff_id IS NOT NULL"),
    db.query("SELECT id,full_name,role,is_active FROM staff_users ORDER BY full_name")
  ]);
  const byPhone=new Map(),byId=new Map(),byAccount=new Map(),byAccountNo=new Map(),byAccountId=new Map();
  for(const c of clients) {
    byId.set(Number(c.id),c);
    const phone=norm(c.cell_number_normalised)||norm(c.cell_number);
    if(phone){if(!byPhone.has(phone))byPhone.set(phone,[]);byPhone.get(phone).push(c);}
    const k=accountKey(c);
    if(!byAccount.has(k))byAccount.set(k,[]);
    byAccount.get(k).push(c);
    const accountNo=txt(c.account_number,100).replace(/\s/g,'').toUpperCase();
    if(accountNo){if(!byAccountNo.has(accountNo))byAccountNo.set(accountNo,[]);byAccountNo.get(accountNo).push(c);}
    if(c.account_id){const id=Number(c.account_id);if(!byAccountId.has(id))byAccountId.set(id,[]);byAccountId.get(id).push(c);}
  }
  const groupedByPhone=new Map();
  try{
    const [links]=await db.query(
      "SELECT l.phone,l.review_required,l.service_type,g.account_number,g.account_name,g.crm_account_id "+
      "FROM ga26_lines l JOIN ga26_accounts g ON g.id=l.ga_account_id "+
      "JOIN ga26_batches b ON b.id=l.batch_id WHERE b.id=(SELECT MAX(id) FROM ga26_batches)");
    for(const link of links)groupedByPhone.set(link.phone,link);
  }catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;}
  return {clients,assignments,accounts,staff,byPhone,byId,byAccount,byAccountNo,byAccountId,groupedByPhone};
}
function resolveOwner(client,context,msisdn='') {
  if(!client){
    const link=context.groupedByPhone?.get(norm(msisdn))||null;
    if(!link||Number(link.review_required)===1||!link.account_number){
      return {staff_id:null,staff_name:'Needs account review',review:true,
        reason:link&&Number(link.review_required)===1?'Grouped account or telephone line needs review':'Not linked to a confirmed CRM account',lines:[]};
    }
    const accountNumber=txt(link.account_number,100).replace(/\s/g,'').toUpperCase();
    const id=Number(link.crm_account_id)||null;
    const lines=[...new Map([...(context.byAccountNo.get(accountNumber)||[]),...(context.byAccountId.get(id)||[])]
      .map(c=>[Number(c.id),c])).values()];
    const memberIds=new Set(lines.map(c=>Number(c.id)));
    const candidates=new Set();
    for(const a of context.assignments){
      if(txt(a.account_number,100).replace(/\s/g,'').toUpperCase()===accountNumber||
        memberIds.has(Number(a.client_id)))candidates.add(Number(a.assigned_staff_id));
    }
    for(const a of context.accounts){
      if(Number(a.id)===id||txt(a.account_number,100).replace(/\s/g,'').toUpperCase()===accountNumber)candidates.add(Number(a.assigned_staff_id));
    }
    const active=new Set(context.staff.filter(s=>s.is_active).map(s=>Number(s.id)));
    const owners=[...candidates].filter(x=>active.has(x));
    if(owners.length!==1)return {staff_id:null,staff_name:owners.length?'Conflicting staff ownership':'Unassigned',review:true,
      reason:owners.length?'Multiple CRM staff assignments':'No current staff owner',lines};
    const user=context.staff.find(s=>Number(s.id)===owners[0]);
    return {staff_id:owners[0],staff_name:user?.full_name||'Staff',review:false,
      reason:'Confirmed from linked account in current CRM',lines};
  }
  const lines=context.byAccount.get(accountKey(client))||[client];
  const ids=new Set(lines.map(x=>Number(x.id)));
  const accountNumbers=new Set(lines.map(x=>txt(x.account_number,100).replace(/\s/g,'').toUpperCase()).filter(Boolean));
  const accountIds=new Set(lines.map(x=>Number(x.account_id)).filter(Boolean));
  const candidates=new Set();
  for(const a of context.assignments){
    if(ids.has(Number(a.client_id))||accountNumbers.has(txt(a.account_number,100).replace(/\s/g,'').toUpperCase()))candidates.add(Number(a.assigned_staff_id));
  }
  for(const a of context.accounts){
    if(accountIds.has(Number(a.id))||accountNumbers.has(txt(a.account_number,100).replace(/\s/g,'').toUpperCase()))candidates.add(Number(a.assigned_staff_id));
  }
  const active=new Set(context.staff.filter(x=>x.is_active).map(x=>Number(x.id)));
  const names=new Map(context.staff.map(x=>[Number(x.id),x.full_name]));
  const owners=[...candidates].filter(id=>active.has(id));
  if(owners.length!==1)return {staff_id:null,staff_name:owners.length?'Conflicting staff ownership':'Unassigned',review:true,reason:owners.length?'Multiple CRM staff assignments':'No current staff owner',lines};
  return {staff_id:owners[0],staff_name:names.get(owners[0])||'Unknown',review:false,reason:'Confirmed from current CRM',lines};
}
async function importWorkbook(buffer,filename,userId) {
  await ensureSchema();
  const entries=spreadsheetRows(buffer);
  const grouped=new Map();
  for(const entry of entries){
    if(!grouped.has(entry.msisdn))grouped.set(entry.msisdn,[]);
    grouped.get(entry.msisdn).push(entry);
  }
  const context=await crmContext(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [b]=await conn.execute("INSERT INTO bf26_batches(source_filename,imported_by,source_rows,unique_phones) VALUES(?,?,?,?)",
      [txt(filename,200),userId,entries.length,grouped.size]);
    for(const [msisdn,lines] of grouped){
      const first=lines[0];
      const match=resolveMatch(msisdn,context.byPhone);
      const variant=new Set(lines.map(l=>[l.tariff,l.eligible_at,l.terminate_at].join('|'))).size>1;
      const flags=variant?'Multiple different source lines/dates: review before dispatch':lines.length>1?'Repeated source phone: review all entries':'';
      const [r]=await conn.execute("INSERT INTO bf26_contacts(batch_id,msisdn,source_name,source_email,tariff_description,eligible_at,source_upgrade_label,source_row_count,review_flags,match_status,matched_client_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [b.insertId,msisdn,first.name,first.email,first.tariff_description,first.eligible_at,first.upgrade_label,lines.length,flags,match.match_status,match.matched_client_id]);
      for(const item of lines){
        await conn.execute("INSERT INTO bf26_lines(contact_id,source_excel_row,source_payload) VALUES(?,?,?)",
          [r.insertId,item.source_excel_row,JSON.stringify(item)]);
      }
    }
    await conn.execute("INSERT INTO bf26_current(id,batch_id) VALUES(1,?) ON DUPLICATE KEY UPDATE batch_id=VALUES(batch_id)",[b.insertId]);
    await conn.commit();
    return {id:b.insertId,sourceRows:entries.length,phones:grouped.size};
  }catch(err){await conn.rollback();throw err;}finally{conn.release();}
}
async function loadPage(batch,options={}) {
  await ensureSchema();
  // The staff picker must reflect CURRENT CRM OWNERSHIP until Gerda dispatches
  // a campaign task. The previous database filter looked only at bf26_actions,
  // so every staff member incorrectly appeared to have zero customers.
  const requestedPage=Math.max(1,Math.min(999,Number(options.page)||1)),limit=options.selectedStaffId&&options.pool!=='unassigned'?100:50;
  const [all]=await db.query(
    "SELECT c.*,a.assigned_staff_id action_staff_id,a.task_id,a.call_status,a.call_note,a.due_at action_due_at,a.updated_at action_updated_at FROM bf26_contacts c LEFT JOIN bf26_actions a ON a.contact_id=c.id WHERE c.batch_id=?",
    [batch.id]
  );
  const ctx=await crmContext();
  const ownerCache=new Map();
  const staffNames=new Map(ctx.staff.filter(s=>s.is_active).map(s=>[Number(s.id),s.full_name]));
  const staffCounts=new Map(),queueCounts={all:0,unassigned:0,ready:0,review:0,dispatched:0};
  for(const row of all){
    const crm=ctx.byId.get(Number(row.matched_client_id))||null;
    const grouped=ctx.groupedByPhone.get(row.msisdn)||null;
    const key=crm?accountKey(crm):(grouped&&Number(grouped.review_required)===0
      ?'grouped:'+grouped.account_number:'unmatched:'+row.msisdn);
    if(!ownerCache.has(key))ownerCache.set(key,resolveOwner(crm,ctx,row.msisdn));
    const owner=ownerCache.get(key);
    row.crm=crm;row.owner=owner;row.grouped_review=Boolean(grouped&&Number(grouped.review_required)===1);
    row.non_mobile_service=Boolean(grouped&&['voip','fixed','other'].includes(String(grouped.service_type)));
    row.grouped_owner_confirmed=!crm&&grouped&&!row.grouped_review&&!row.non_mobile_service&&!owner.review;
    row.responsible_id=row.task_id?Number(row.action_staff_id)||null:owner.staff_id;
    row.responsible_name=row.task_id?(staffNames.get(row.responsible_id)||'Assigned staff unavailable'):(owner.staff_name||'Unassigned');
    row.is_due=String(row.source_upgrade_label||'').trim().toLowerCase()==='due';
    row.needs_assignment=!row.task_id&&owner.review;
    row.needs_review=!row.task_id&&(owner.review||row.grouped_review||row.non_mobile_service||Boolean(row.review_flags)||row.match_status==='ambiguous');
    row.ready=!row.task_id&&!owner.review&&!row.grouped_review&&!row.non_mobile_service&&!row.review_flags&&row.is_due;
    if(row.responsible_id)staffCounts.set(row.responsible_id,(staffCounts.get(row.responsible_id)||0)+1);
    queueCounts.all++;
    if(row.needs_assignment)queueCounts.unassigned++;
    if(row.needs_review)queueCounts.review++;
    if(row.ready)queueCounts.ready++;
    if(row.task_id)queueCounts.dispatched++;
  }
  const q=txt(options.q||'',80).toLowerCase(),staffFilter=String(options.staffFilter||''),
    queue=['unassigned','ready','review','dispatched'].includes(options.queue)?options.queue:'all';
  const filtered=all.filter(row=>{
    if(staffFilter==='__choose_staff__')return false;
    if(q && ![row.msisdn,row.source_name,row.source_email,row.crm?.client_name,row.crm?.account_number]
      .some(v=>String(v||'').toLowerCase().includes(q)))return false;
    if(options.match && ['matched','multiple_lines','unmatched','ambiguous'].includes(options.match) && row.match_status!==options.match)return false;
    if(options.onlyDispatched){
      if(!row.task_id||Number(row.action_staff_id)!==Number(options.staffId))return false;
    } else if(staffFilter==='unassigned'){
      if(!row.needs_assignment)return false;
    } else if(staffFilter && Number(row.responsible_id)!==Number(staffFilter)){
      return false;
    }
    if(queue==='unassigned'&&!row.needs_assignment)return false;
    if(queue==='ready'&&!row.ready)return false;
    if(queue==='review'&&!row.needs_review)return false;
    if(queue==='dispatched'&&!row.task_id)return false;
    return true;
  }).sort((a,b)=>{
    const priority=r=>r.task_id?2:r.ready?0:1;
    return priority(a)-priority(b)||
      String(a.source_name||'').localeCompare(String(b.source_name||''))||
      Number(a.id)-Number(b.id);
  });
  const count=filtered.length,pages=Math.max(1,Math.ceil(count/limit)),p=Math.min(requestedPage,pages),
    rows=filtered.slice((p-1)*limit,p*limit);
  const ids=new Set();
  for(const row of rows){
    row.crm_lines=row.owner.lines.map(l=>({id:l.id,account_number:l.account_number,cell_number:l.cell_number,package_name:l.package_name,handset:l.handset,next_upgrade_date:l.next_upgrade_date,line_status:l.line_status}));
    row.can_auto_assign=!row.review_flags && !row.grouped_review && !row.non_mobile_service && row.is_due &&
      (['matched','multiple_lines'].includes(row.match_status)||row.grouped_owner_confirmed) && !row.owner.review;
    if(row.crm)ids.add(Number(row.crm.id));
  }
  const clients=[...ids].filter(Number.isInteger);
  const issues=new Map();
  if(clients.length){
    const marks=clients.map(()=>'?').join(',');
    const queries=[
      ["SELECT related_client_id client_id,'Task' kind,title detail,due_at due_date,assigned_to staff_id FROM staff_tasks WHERE related_client_id IN ("+marks+") AND type='task' AND status IN ('unread','seen','in_progress')",clients],
      ["SELECT client_id,'Follow-up' kind,reason detail,scheduled_at due_date,assigned_to staff_id FROM customer_followups WHERE client_id IN ("+marks+") AND status='open'",clients],
      ["SELECT client_id,'Callback' kind,reason detail,scheduled_at due_date,assigned_to staff_id FROM customer_callbacks WHERE client_id IN ("+marks+") AND status='scheduled'",clients],
      ["SELECT client_id,'Inquiry' kind,query_text detail,follow_up_at due_date,COALESCE(assigned_staff_id,staff_id) staff_id FROM inquiries WHERE client_id IN ("+marks+") AND status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')",clients]
    ];
    for(const [sql,args] of queries){
      const [items]=await db.query(sql,args);
      for(const item of items){
        if(!issues.has(Number(item.client_id)))issues.set(Number(item.client_id),[]);
        issues.get(Number(item.client_id)).push(item);
      }
    }
  }
  for(const row of rows){
    // A business can have hundreds of separate lines. A task on one mobile
    // number must not block follow-ups on all of its other valid lines.
    row.outstanding=row.crm?(issues.get(Number(row.crm.id))||[]).slice(0,12):[];
    row.can_select_for_dispatch=!row.task_id&&row.is_due&&!row.review_flags&&!row.grouped_review&&!row.non_mobile_service&&
      row.outstanding.length===0&&row.owner.reason!=='Multiple CRM staff assignments'&&
      ((options.pool==='unassigned'&&row.needs_assignment)||
       (options.pool!=='unassigned'&&row.can_auto_assign));
  }
  const [sources]=rows.length?await db.query("SELECT l.contact_id,l.source_payload FROM bf26_lines l WHERE l.contact_id IN ("+rows.map(()=>'?').join(',')+") ORDER BY l.source_excel_row",rows.map(r=>r.id)):[[]];
  const sourceMap=new Map();
  for(const src of sources){if(!sourceMap.has(Number(src.contact_id)))sourceMap.set(Number(src.contact_id),[]);try{sourceMap.get(Number(src.contact_id)).push(JSON.parse(src.source_payload));}catch(_){}}
  for(const row of rows)row.source_lines=sourceMap.get(Number(row.id))||[];
  // The grouped-upgrade import links each Black Friday number to its account
  // without creating duplicate CRM clients or changing outstanding tasks.
  if(rows.length){
    try{
      const [groups]=await db.query(
        "SELECT l.phone,g.id group_id,g.account_number,g.account_name,g.line_count FROM ga26_lines l "+
        "JOIN ga26_accounts g ON g.id=l.ga_account_id WHERE l.phone IN ("+rows.map(()=>'?').join(',')+")",
        rows.map(r=>r.msisdn));
      const byNumber=new Map(groups.map(g=>[g.phone,g]));
      for(const row of rows)row.grouped_account=byNumber.get(row.msisdn)||null;
    }catch(error){
      if(error.code!=='ER_NO_SUCH_TABLE')throw error;
    }
  }
  const [[stats]]=await db.query("SELECT COUNT(*) total,SUM(match_status='matched') matched,SUM(match_status='multiple_lines') multi,SUM(match_status='ambiguous') ambiguous,SUM(match_status='unmatched') unmatched FROM bf26_contacts WHERE batch_id=?",[batch.id]);
  const [[progress]]=await db.query("SELECT COUNT(*) assigned,SUM(a.call_status IN ('interested','quoted','sale')) positive,SUM(a.call_status='completed') completed FROM bf26_actions a JOIN bf26_contacts c ON c.id=a.contact_id WHERE c.batch_id=?",[batch.id]);
  return {rows,stats,progress,count,page:p,pages,staff:ctx.staff.filter(x=>x.is_active),
    staffCounts:Object.fromEntries(staffCounts),queueCounts,options};
}
module.exports={ensureSchema,currentBatch,spreadsheetRows,crmContext,resolveOwner,importWorkbook,loadPage,norm,txt,date};
