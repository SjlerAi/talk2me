'use strict';

// Authenticated UAT-only review for non-destructive groupings and unresolved identities.
// No customer row may be archived or merged through this module.
const express=require('express');
const crypto=require('crypto');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {canUseTemporaryCleanup}=require('../services/temporary-cleanup-access');
const {csrfValid}=require('../services/temporary-cleanup-correction');
const {
  decodeIds,decodeReasons,prettyReason,groupingEvidence,rowFingerprint,reviewRevision
}=require('../services/temporary-duplicate-triage');
const router=express.Router();
const TAKE=20;
function gate(req,res,next) {
  if(!canUseTemporaryCleanup(req.session.user)) return res.status(404).render('error',{
    title:'Unavailable',message:'The private UAT duplicate review is restricted or expired.'});
  next();
}
function csrf(req) {
  if(!req.session.tempCleanupToken) req.session.tempCleanupToken=crypto.randomBytes(32).toString('hex');
  return req.session.tempCleanupToken;
}
function permittedId(value) {
  const id=Number(value);
  return Number.isSafeInteger(id)&&id>0?id:null;
}
function caseType(value) {
  return value==='safe_line_group'?'safe_line_group':'manual_identity';
}
function decodeItem(row) {
  return {...row,clientIds:decodeIds(row.client_ids_json),reasons:decodeReasons(row.reason_codes_json),
    revision:reviewRevision(row)};
}
async function loadClientRows(items,connection=db) {
  const ids=[...new Set(items.flatMap(item=>item.clientIds))];
  const found=new Map();
  if(!ids.length)return found;
  if(ids.length>1000)throw new Error('Triage case selection too large.');
  const [lines]=await connection.query(`SELECT
      c.id,c.account_id,c.account_number,c.client_name,c.cell_number,c.cell_number_normalised,
      c.email,c.id_number,c.package_name,c.line_status,c.previous_upgrade_date,
      c.next_upgrade_date,c.upgrade_date,c.is_active,c.updated_at,
      a.display_name account_name,a.assigned_staff_id account_staff_id
    FROM clients c LEFT JOIN customer_accounts a ON a.id=c.account_id
    WHERE c.id IN (?) ORDER BY c.id`,[ids]);
  const [assignments]=await connection.query(`SELECT x.id,x.client_id,x.assigned_staff_id,
      x.is_active,s.full_name staff_name
    FROM client_assignments x LEFT JOIN staff_users s ON s.id=x.assigned_staff_id
    WHERE x.client_id IN (?) ORDER BY x.id`,[ids]);
  const byClient=new Map();
  assignments.forEach(a=>{
    const list=byClient.get(Number(a.client_id))||[];
    list.push(a);
    byClient.set(Number(a.client_id),list);
  });
  lines.forEach(row=>{
    row._allocations=byClient.get(Number(row.id))||[];
    found.set(Number(row.id),row);
  });
  return found;
}
function rowsFor(item,map) {
  return item.clientIds.map(id=>map.get(id)).filter(Boolean);
}
async function loadSupplierPhones(items) {
  const phones=[...new Set(items.filter(t=>t.case_type==='safe_line_group').map(t=>t.phone_normalised).filter(Boolean))];
  const found=new Map();
  if(phones.length){
    const [rows]=await db.query('SELECT msisdn_normalised,account_id FROM mobile_base_current WHERE msisdn_normalised IN (?)',[phones]);
    rows.forEach(row=>found.set(String(row.msisdn_normalised),row));
  }
  return found;
}
function groupState(item,rows,suppliers) {
  const evidence=groupingEvidence(rows);
  const supplier=suppliers.get(String(item.phone_normalised||''));
  const supplierConflict=Boolean(supplier && Number(supplier.account_id)>0 && Number(supplier.account_id)!==Number(item.account_id));
  const safe=item.clientIds.length===rows.length && evidence.safe &&
    evidence.accountId===Number(item.account_id) &&
    evidence.phone===String(item.phone_normalised) && !supplierConflict;
  const reasons=evidence.reasons.slice();
  if(item.clientIds.length!==rows.length)reasons.push('missing_client_record');
  if(supplierConflict)reasons.push('supplier_account_conflict');
  return {safe,reasons};
}
async function totals() {
  const [rows]=await db.query('SELECT case_type,status,COUNT(*) n FROM temporary_duplicate_triage GROUP BY case_type,status');
  const out={grouped:0,manual:0,pending:0,followup:0,completed:0};
  rows.forEach(r=>{
    const n=Number(r.n||0);
    if(r.case_type==='safe_line_group'&&r.status==='auto_grouped')out.grouped+=n;
    if(r.case_type==='manual_identity') {
      out.manual+=n;
      if(r.status==='pending')out.pending+=n;
      else if(r.status==='keep_separate')out.completed+=n;
      else out.followup+=n;
    }
  });
  return out;
}
router.get('/temporary-cleanup/triage',requireAuth,gate,async(req,res,next)=>{
  try{
    const type=caseType(req.query.type);
    const status=String(req.query.status||'all');
    const q=String(req.query.q||'').trim().toLowerCase().slice(0,70);
    const page=Math.max(1,Math.min(200,Number.parseInt(req.query.page,10)||1));
    const [databaseRows]=await db.query(
      'SELECT t.*,s.full_name reviewer_name FROM temporary_duplicate_triage t '+
      'LEFT JOIN staff_users s ON s.id=t.reviewed_by WHERE t.case_type=? ORDER BY t.id',[type]);
    const items=databaseRows.map(decodeItem);
    const matchMap=await loadClientRows(items);
    const suppliers=await loadSupplierPhones(items);
    let cases=items.map(item=>{
      const rows=rowsFor(item,matchMap);
      const state=type==='safe_line_group'?groupState(item,rows,suppliers):null;
      return {...item,rows,display:rows[0]||{},state};
    });
    if(status!=='all')cases=cases.filter(c=>c.status===status);
    if(q)cases=cases.filter(c=>
      c.case_key.toLowerCase().includes(q) ||
      c.clientIds.some(id=>String(id).includes(q)) ||
      c.rows.some(r=>[r.client_name,r.account_number,r.cell_number,r.email].some(v=>
        String(v||'').toLowerCase().includes(q))));
    const total=cases.length,pageCount=Math.max(1,Math.ceil(total/TAKE));
    const current=Math.min(page,pageCount);
    cases=cases.slice((current-1)*TAKE,current*TAKE);
    res.set('Cache-Control','private, no-store');
    res.render('temporary-duplicate-triage',{
      title:'Safe Grouping & Manual Duplicate Review',type,status,q,
      page:current,pageCount,total,cases,item:null,prettyReason,
      summary:await totals(),saved:req.query.saved==='1',csrf:csrf(req)});
  }catch(error){next(error);}
});
router.get('/temporary-cleanup/triage/case/:id',requireAuth,gate,async(req,res,next)=>{
  try{
    const id=permittedId(req.params.id);
    if(!id)return res.sendStatus(400);
    const [rows]=await db.query('SELECT t.*,s.full_name reviewer_name FROM temporary_duplicate_triage t LEFT JOIN staff_users s ON s.id=t.reviewed_by WHERE t.id=? LIMIT 1',[id]);
    if(!rows.length)return res.sendStatus(404);
    const item=decodeItem(rows[0]);
    const loaded=await loadClientRows([item]);
    item.rows=rowsFor(item,loaded);
    item.snapshot=rowFingerprint(item.rows);
    item.state=item.case_type==='safe_line_group'?groupState(item,item.rows,await loadSupplierPhones([item])):null;
    res.set('Cache-Control','private, no-store');
    res.render('temporary-duplicate-triage',{title:'Duplicate Review Case',item,
      type:item.case_type,status:'all',q:'',cases:[],page:1,pageCount:1,total:1,
      prettyReason,summary:await totals(),saved:false,csrf:csrf(req)});
  }catch(error){next(error);}
});
router.post('/temporary-cleanup/triage/case/:id/review',requireAuth,gate,async(req,res,next)=>{
  const id=permittedId(req.params.id);
  const decision=String(req.body.status||'');
  const notes=String(req.body.notes||'').trim().slice(0,2000);
  if(!id || !csrfValid(req) || !['keep_separate','needs_correction','flagged'].includes(decision) ||
     notes.length<12 || !/^[a-f0-9]{64}$/.test(String(req.body.snapshot||'')) ||
     !/^[a-f0-9]{64}$/.test(String(req.body.revision||''))) {
    return res.status(422).render('error',{title:'Invalid review',message:'Review requires a valid session, status and evidence notes.'});
  }
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [list]=await conn.query('SELECT * FROM temporary_duplicate_triage WHERE id=? AND case_type="manual_identity" FOR UPDATE',[id]);
    if(list.length!==1) {
      await conn.rollback();
      return res.status(404).render('error',{title:'Not found',message:'Manual case no longer exists.'});
    }
    const item=decodeItem(list[0]);
    if(reviewRevision(item)!==String(req.body.revision)){
      await conn.rollback();
      return res.status(409).render('error',{title:'Already reviewed',message:'This case was updated by another staff member. Reload it.'});
    }
    const [source]=await conn.query('SELECT id FROM clients WHERE id IN (?) ORDER BY id FOR UPDATE',[item.clientIds]);
    if(source.length!==item.clientIds.length) {
      await conn.rollback();
      return res.status(409).render('error',{title:'Customer changed',message:'A customer record is missing. Reload the case.'});
    }
    const rows=rowsFor(item,await loadClientRows([item],conn));
    const hash=rowFingerprint(rows);
    if(hash!==String(req.body.snapshot)){
      await conn.rollback();
      return res.status(409).render('error',{title:'Customer changed',message:'Customer or assignment details changed after this review opened. Reload the case.'});
    }
    const reviewer=Number(req.session.user.id);
    await conn.query('UPDATE temporary_duplicate_triage SET status=?,review_notes=?,reviewed_by=?,reviewed_at=NOW(),source_hash=? WHERE id=?',
      [decision,notes,reviewer,hash,id]);
    await conn.query('INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?)',[
      reviewer,'duplicate_manual_review','temporary_duplicate_triage',id,
      'Manual duplicate identity review: '+decision,
      JSON.stringify({status:item.status,notes:item.review_notes}),
      JSON.stringify({status:decision,notes,client_ids:item.clientIds,source_hash:hash}),
      String(req.ip||'').slice(0,64),String(req.get('user-agent')||'').slice(0,255)
    ]);
    await conn.commit();
    return res.redirect(res.locals.basePath+'/temporary-cleanup/triage?type=manual_identity&status=pending&saved=1');
  }catch(error){
    try{await conn.rollback();}catch(_){}
    return next(error);
  }finally{conn.release();}
});
module.exports=router;
