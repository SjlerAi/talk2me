'use strict';
// Current data is queried read-only. Decisions are stored separately from
// customers and monthly imports to survive subsequent data refreshes.
const crypto = require('crypto');
const db = require('../config/db');
const TYPES = Object.freeze({
  migration:'Source vs test',duplicate_phone:'Repeated customer phone',
  identity:'Identity to verify',import_conflict:'Import conflict',
  import_possible:'Possible import match'
});
const hash = x => crypto.createHash('sha256').update(String(x)).digest('hex');
const text = x => x == null ? '' : String(x);
const date = x => x instanceof Date ? x.toISOString().slice(0,10) : text(x);
const normPhone = x => {
  let value = text(x).replace(/\D/g,'');
  if(value.length === 10 && value.startsWith('0')) value='27'+value.slice(1);
  return /^27[1-9]\d{8}$/.test(value) ? value : '';
};
const numbers = value => {
  try {const r=JSON.parse(value||'[]');return Array.isArray(r)?r.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0).slice(0,150):[];}
  catch(_){return [];}
};
const memberVersion = list => list.map(x=>[
  x.id,x.is_active,x.client_name,x.account_id,x.account_number,
  normPhone(x.cell_number_normalised||x.cell_number),
  date(x.next_upgrade_date),date(x.previous_upgrade_date),date(x.upgrade_date),
  x.id_number,x.email,x.package_name,x.line_status,x.assigned_staff_id
]);
function make(kind,key,label,description,members,details) {
  return {
    id:hash('tk2m-review-v1:'+kind+':'+key),kind,kindLabel:TYPES[kind],
    label,description,members,details,
    staffIds:[...new Set(members.map(x=>Number(x.assigned_staff_id||0)).filter(Boolean))],
    fingerprint:hash(JSON.stringify([details.version||[],memberVersion(members)]))
  };
}
const canManage = user => ['owner','manager'].includes(String(user?.role||'').toLowerCase());
const canSee = (item,user) => Boolean(user && (canManage(user) ||
  (user.role==='staff' && item.kind!=='migration' && item.staffIds.length===1 && item.staffIds[0]===Number(user.id))));
async function loadCases(user,conn=db) {
  const [clients]=await conn.query('SELECT c.id,c.client_name,c.account_id,c.account_number,c.cell_number,c.cell_number_normalised,c.email,c.id_number,c.next_upgrade_date,c.previous_upgrade_date,c.upgrade_date,c.package_name,c.line_status,c.birthday,c.is_active,c.updated_at,a.assigned_staff_id,u.full_name assigned_staff_name FROM clients c LEFT JOIN client_assignments a ON a.client_id=c.id AND a.is_active=1 LEFT JOIN staff_users u ON u.id=a.assigned_staff_id ORDER BY c.id');
  const byId=new Map(clients.map(x=>[Number(x.id),x]));
  const grouped=new Map(),cases=[];
  for(const c of clients) {
    if(!Number(c.is_active))continue;
    const phone=normPhone(c.cell_number_normalised||c.cell_number);
    if(!phone)continue;
    if(!grouped.has(phone))grouped.set(phone,[]);
    grouped.get(phone).push(c);
  }
  for(const [phone,people] of grouped) {
    if(people.length<2)continue;
    const versions=people.map(x=>[x.id,x.is_active,x.account_id,x.account_number,
      date(x.next_upgrade_date),date(x.previous_upgrade_date),x.line_status,text(x.updated_at)]);
    const accounts=new Set(people.map(x=>text(x.account_id||x.account_number)).filter(Boolean));
    const dates=new Set(people.map(x=>date(x.next_upgrade_date)).filter(Boolean));
    cases.push(make('duplicate_phone',phone,people.slice(0,2).map(x=>text(x.client_name||'Customer')).join(' / '),
      people.length+' active records share '+phone+' · '+dates.size+' upgrade dates · '+accounts.size+' accounts',
      people,{phone,upgradeConflict:dates.size>1,accountConflict:accounts.size>1,version:versions}));
  }
  const [triage]=await conn.query("SELECT id,status,case_type,case_key,phone_normalised,client_ids_json,reason_codes_json,source_hash,review_notes,updated_at FROM temporary_duplicate_triage WHERE status IN ('pending','needs_correction','flagged') ORDER BY id");
  for(const t of triage) {
    const members=numbers(t.client_ids_json).map(i=>byId.get(i)).filter(Boolean);
    cases.push(make('identity',String(t.id),
      members.map(x=>text(x.client_name)).filter(Boolean).slice(0,2).join(' / ')||'Identity case #'+t.id,
      'Identity case #'+t.id+' · '+members.length+' related customer records',members,
      {caseId:Number(t.id),phone:normPhone(t.phone_normalised),reason:text(t.reason_codes_json).slice(0,800),
        priorNotes:text(t.review_notes).slice(0,1200),
        version:[t.id,t.status,t.source_hash,text(t.updated_at),members.map(x=>[x.id,x.is_active,x.account_id,date(x.next_upgrade_date)])]}));
  }
  const [imports]=await conn.query("SELECT m.id match_id,m.classification,m.review_status,m.match_domain,m.match_reason,m.proposed_client_id,m.proposed_account_id,m.updated_at,r.id row_id,r.row_fingerprint,r.source_row_number,r.batch_id,r.customer_name,r.phone_normalised,r.phone_original,r.account_number,r.warning_text FROM monthly_import_matches m INNER JOIN monthly_import_rows r ON r.id=m.import_row_id WHERE m.review_status='pending' AND m.classification IN ('conflict','possible_match') ORDER BY m.classification,m.id");
  for(const m of imports) {
    const kind=m.classification==='conflict'?'import_conflict':'import_possible';
    const owner=byId.get(Number(m.proposed_client_id||0));
    const members=owner?[owner]:[];
    const key=text(m.row_fingerprint)+':'+text(m.source_row_number)+':'+text(m.match_domain);
    cases.push(make(kind,key,text(m.customer_name)||'Import row '+m.source_row_number,
      text(m.account_number)+' · '+text(m.phone_normalised||m.phone_original)+' · '+text(m.match_reason).slice(0,140),
      members,{matchId:Number(m.match_id),rowId:Number(m.row_id),batchId:Number(m.batch_id),
        rowNumber:Number(m.source_row_number),account:text(m.account_number),
        phone:text(m.phone_normalised||m.phone_original),matchReason:text(m.match_reason),
        warning:text(m.warning_text).slice(0,900),proposedClientId:Number(m.proposed_client_id||0),
        proposedAccountId:Number(m.proposed_account_id||0),
        version:[m.row_fingerprint,m.source_row_number,m.classification,m.review_status,m.match_domain,
          m.match_reason,m.proposed_client_id,m.proposed_account_id,text(m.updated_at),m.warning_text]}));
  }
  const [deltas]=await conn.query('SELECT entity_type,entity_id,field_key,source_value,stage_value,source_hash,checked_at FROM tk2m_review_source_deltas WHERE is_current=1 ORDER BY entity_type,entity_id,field_key');
  for(const d of deltas) {
    const related=d.entity_type==='client'?byId.get(Number(d.entity_id)):null;
    const members=related?[related]:[];
    cases.push(make('migration',d.entity_type+':'+d.entity_id+':'+d.field_key,
      (related?.client_name||(d.entity_type==='client'?'Customer':'Assignment'))+' #'+d.entity_id,
      d.field_key+': live '+d.source_value+' / test '+d.stage_value,members,
      {entityType:d.entity_type,entityId:Number(d.entity_id),field:d.field_key,
        sourceValue:text(d.source_value),stageValue:text(d.stage_value),
        checkedAt:date(d.checked_at),version:[d.source_value,d.stage_value,d.source_hash]}));
  }
  const visible=cases.filter(c=>canSee(c,user));
  if(visible.length) {
    const [decisions]=await conn.query('SELECT case_id,source_hash,status,note,reviewer_staff_id,revision,reviewed_at FROM tk2m_review_decisions WHERE case_id IN (?)',[visible.map(c=>c.id)]);
    const indexed=new Map(decisions.map(x=>[x.case_id,x]));
    for(const c of visible){
      c.review=indexed.get(c.id)||null;
      c.state=c.review?(c.review.source_hash===c.fingerprint?c.review.status:'stale'):'pending';
    }
  }
  return visible;
}
function summarize(cases) {
  const kinds=Object.fromEntries(Object.keys(TYPES).map(k=>[k,{total:0,pending:0,stale:0,done:0}]));
  let pending=0,stale=0,done=0;
  for(const c of cases){
    const group=kinds[c.kind];group.total++;
    if(c.state==='pending'){pending++;group.pending++;}
    else if(c.state==='stale'){stale++;group.stale++;}
    else {done++;group.done++;}
  }
  return {kinds,total:cases.length,pending,stale,done};
}
module.exports={loadCases,TYPES,canManage,canSee,summarize,normPhone,hash};
