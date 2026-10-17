'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { canUseTemporaryCleanup } = require('../services/temporary-cleanup-access');
const {rowHash} = require('../services/temporary-cleanup-correction');
const {hash:assignmentHash} = require('./temporary-cleanup-assignment');
const router = express.Router();
const TAKE = 30;
const KINDS = new Set(['same_account_phone','cross_account_phone','account_alias','staff_conflict','base_unlinked']);
const DECISIONS = new Set(['approved_grouping','keep_separate','needs_correction','flagged']);
function guard(req,res,next) {
  if (!canUseTemporaryCleanup(req.session.user)) return res.status(404).render('error',{title:'Not available',message:'Temporary cleanup access is disabled or restricted.'});
  return next();
}
function csrf(req) {
  if (!req.session.tempCleanupToken) req.session.tempCleanupToken=crypto.randomBytes(32).toString('hex');
  return req.session.tempCleanupToken;
}
function checkCsrf(req) {
  const a=String(req.body.csrf||''),b=String(req.session.tempCleanupToken||'');
  return /^[a-f0-9]{64}$/.test(a)&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
const queryCases = {
  same_account_phone: `SELECT c.cell_number_normalised case_key,COUNT(*) record_count,COUNT(DISTINCT COALESCE(c.next_upgrade_date,c.upgrade_date)) upgrade_variants,COUNT(DISTINCT NULLIF(TRIM(c.client_name),'')) name_variants,
    MAX(c.client_name) display_name,MAX(c.account_number) display_account
    FROM clients c WHERE c.account_id IS NOT NULL AND c.cell_number_normalised REGEXP '^27[0-9]{9}$'
    GROUP BY c.cell_number_normalised HAVING COUNT(*)>1 AND COUNT(DISTINCT c.account_id)=1`,
  cross_account_phone: `SELECT c.cell_number_normalised case_key,COUNT(*) record_count,COUNT(DISTINCT COALESCE(c.next_upgrade_date,c.upgrade_date)) upgrade_variants,COUNT(DISTINCT NULLIF(TRIM(c.client_name),'')) name_variants,
    MAX(c.client_name) display_name,MAX(c.account_number) display_account
    FROM clients c WHERE c.cell_number_normalised REGEXP '^27[0-9]{9}$'
    GROUP BY c.cell_number_normalised HAVING COUNT(*)>1 AND COUNT(DISTINCT c.account_id)>1`,
  account_alias: `SELECT UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(a.account_number),'[-/][0-9][[:space:]]*$',''),'[^A-Z0-9]','')) case_key,
    COUNT(*) record_count,0 upgrade_variants,0 name_variants,MAX(a.display_name) display_name,MAX(a.account_number) display_account
    FROM customer_accounts a GROUP BY case_key HAVING case_key<>'' AND COUNT(*)>1`,
  staff_conflict: `SELECT UPPER(REPLACE(TRIM(a.account_number),' ','')) case_key,COUNT(*) record_count,0 upgrade_variants,0 name_variants,
    MAX(c.client_name) display_name,MAX(a.account_number) display_account FROM client_assignments a LEFT JOIN clients c ON c.id=a.client_id
    WHERE a.is_active=1 AND TRIM(COALESCE(a.account_number,''))<>'' GROUP BY case_key
    HAVING COUNT(DISTINCT a.assigned_staff_id)>1`,
  base_unlinked: `SELECT (CONVERT(CAST(b.id AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci) case_key,1 record_count,0 upgrade_variants,0 name_variants,b.account_name display_name,b.account_code display_account
    FROM mobile_base_current b WHERE b.client_id IS NULL`
};
async function reviewRows(type,key) {
  if(type==='same_account_phone'||type==='cross_account_phone') {
    const [rows]=await db.execute(`SELECT id,account_id,account_number,client_name,cell_number,cell_number_normalised,email,
      DATE_FORMAT(previous_upgrade_date,'%Y-%m-%d') previous_upgrade_date,
      DATE_FORMAT(next_upgrade_date,'%Y-%m-%d') next_upgrade_date,DATE_FORMAT(upgrade_date,'%Y-%m-%d') upgrade_date,package_name,line_status,is_active,updated_at
      FROM clients WHERE cell_number_normalised=:key ORDER BY account_id,id LIMIT 80`,{key});
    return rows;
  }
  if(type==='account_alias') {
    const [rows]=await db.query(`SELECT id,account_number,display_name,assigned_staff_id,updated_at
      FROM customer_accounts WHERE UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(account_number),'[-/][0-9][[:space:]]*$',''),'[^A-Z0-9]',''))=? ORDER BY id LIMIT 80`,[key]);
    return rows;
  }
  if(type==='staff_conflict') {
    const [rows]=await db.execute(`SELECT a.id,a.client_id,a.account_number,a.assigned_staff_id,s.full_name staff_name,a.is_active,a.updated_at
      FROM client_assignments a LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
      WHERE a.is_active=1 AND UPPER(REPLACE(TRIM(a.account_number),' ',''))=:key ORDER BY a.id LIMIT 80`,{key});
    return rows;
  }
  const [rows]=await db.execute(`SELECT b.id,b.account_code,b.account_name,b.msisdn_normalised,b.icc_id,b.imsi,
    DATE_FORMAT(b.last_upgrade_date,'%Y-%m-%d') last_upgrade_date,DATE_FORMAT(b.eligible_upgrade_date,'%Y-%m-%d') eligible_upgrade_date,
    b.client_id,b.account_id,b.updated_at FROM mobile_base_current b WHERE b.id=:id LIMIT 1`,{id:Number(key)||0});
  return rows;
}
async function getCase(type,key) {
  const [rows]=await db.query('SELECT * FROM ('+queryCases[type]+') cases WHERE case_key=? LIMIT 1',[key]);
  return rows[0]||null;
}
function keyValid(type,key) {return type==='base_unlinked'?/^[1-9][0-9]{0,17}$/.test(key):type==='account_alias'||type==='staff_conflict'?/^[A-Z0-9]{1,120}$/.test(key):/^27[0-9]{9}$/.test(key);}
function snapshot(rows) { return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'); }
router.get('/temporary-cleanup',requireAuth,guard,async(req,res,next)=>{
  try {
    const type=KINDS.has(req.query.type)?req.query.type:'same_account_phone';
    const page=Math.max(1,Math.min(1000,Number.parseInt(req.query.page,10)||1));
    const q=String(req.query.q||'').trim().slice(0,100);
    const view=String(req.query.view||'open')==='all'?'all':'open';
    const sql='SELECT x.*,r.decision,r.notes,r.reviewed_at,s.full_name reviewer FROM ('+queryCases[type]+') x LEFT JOIN temporary_cleanup_decisions r ON r.case_type=? AND r.case_key=x.case_key LEFT JOIN staff_users s ON s.id=r.reviewed_by';
    const where=[];const params=[type];
    if(view==='open')where.push('r.id IS NULL OR r.decision IN (\'flagged\',\'needs_correction\')');
    if(q){where.push('(x.case_key LIKE ? OR x.display_name LIKE ? OR x.display_account LIKE ?)');for(let i=0;i<3;i++)params.push('%'+q+'%');}
    const filter=where.length?' WHERE '+where.map(w=>'('+w+')').join(' AND '):'';
    const [[count]]=await db.query('SELECT COUNT(*) total FROM ('+sql+filter+') listing',params);
    const [cases]=await db.query(sql+filter+' ORDER BY x.record_count DESC,x.case_key LIMIT ? OFFSET ?',[...params,TAKE,(page-1)*TAKE]);
    res.set('Cache-Control','no-store');
    return res.render('temporary-cleanup',{title:'Temporary Customer Cleanup',type,page,total:Number(count.total),cases,q,view,csrf:csrf(req),selected:null,rows:[],staffOptions:[],saved:req.query.saved==='1',corrected:req.query.corrected==='1'});
  }catch(e){next(e);}
});
router.get('/temporary-cleanup/review/:type/:key',requireAuth,guard,async(req,res,next)=>{
  try{
    const type=req.params.type,key=req.params.key;
    if(!KINDS.has(type)||!keyValid(type,key))return res.status(400).render('error',{title:'Invalid case',message:'Invalid review identifier.'});
    const selected=await getCase(type,key);
    if(!selected)return res.status(404).render('error',{title:'Case not found',message:'This discrepancy no longer exists.'});
    const rows=await reviewRows(type,key);
    const [staffOptions]=type==='staff_conflict'?await db.query('SELECT id,full_name FROM staff_users WHERE is_active=1 AND deleted_at IS NULL ORDER BY full_name'):[[]];
    const [decisions]=await db.execute('SELECT d.*,s.full_name reviewer FROM temporary_cleanup_decisions d LEFT JOIN staff_users s ON s.id=d.reviewed_by WHERE d.case_type=:type AND d.case_key=:key LIMIT 1',{type,key});
    const decision=decisions[0]||{};
    res.set('Cache-Control','no-store');
    return res.render('temporary-cleanup',{title:'Review Cleanup Case',type,page:1,total:1,cases:[],q:'',view:'all',csrf:csrf(req),selected:{...selected,...decision,type,key,hash:snapshot(rows)},rows:rows.map(r=>({...r,_checkHash:(type==='same_account_phone'||type==='cross_account_phone')?rowHash(r):null,_assignmentHash:type==='staff_conflict'?assignmentHash(r):null})),staffOptions,saved:req.query.saved==='1',corrected:req.query.corrected==='1'});
  }catch(e){next(e);}
});
router.post('/temporary-cleanup/review/:type/:key',requireAuth,guard,async(req,res,next)=>{
  try{
    const type=req.params.type,key=req.params.key;
    if(!KINDS.has(type)||!keyValid(type,key)||!checkCsrf(req))return res.status(403).render('error',{title:'Review denied',message:'Invalid or expired review request.'});
    const decision=String(req.body.decision||''),notes=String(req.body.notes||'').trim().slice(0,2000);
    if(!DECISIONS.has(decision)||notes.length<8)return res.status(422).render('error',{title:'Review incomplete',message:'Choose a decision and add at least eight characters explaining it.'});
    if(decision==='approved_grouping' && type!=='same_account_phone')return res.status(422).render('error',{title:'Approval restricted',message:'Account conflicts cannot be automatically grouped. Mark for further review.'});
    const selected=await getCase(type,key);
    if(!selected)return res.status(409).render('error',{title:'Case changed',message:'The discrepancy no longer exists. Reload the review.'});
    const current=await reviewRows(type,key);
    if(String(req.body.snapshot||'')!==snapshot(current))return res.status(409).render('error',{title:'Records changed',message:'The customer data has changed since opening this case. Reload and review the latest values.'});
    const userId=Number(req.session.user.id);
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("INSERT INTO temporary_cleanup_decisions (case_type,case_key,decision,notes,source_snapshot_hash,reviewed_by,reviewed_at) VALUES (:type,:key,:decision,:notes,:hash,:userId,NOW()) ON DUPLICATE KEY UPDATE decision=VALUES(decision),notes=VALUES(notes),source_snapshot_hash=VALUES(source_snapshot_hash),reviewed_by=VALUES(reviewed_by),reviewed_at=VALUES(reviewed_at)",{type,key,decision,notes,hash:snapshot(current),userId});
      await conn.execute("INSERT INTO temporary_cleanup_review_history (case_type,case_key,decision,notes,source_snapshot_hash,reviewed_by) VALUES (:type,:key,:decision,:notes,:hash,:userId)",{type,key,decision,notes,hash:snapshot(current),userId});
      await conn.execute("INSERT INTO audit_log (staff_id,action_type,entity_type,description,after_json,ip_address,user_agent) VALUES (:userId,'temporary_cleanup_case_review','temporary_cleanup',:description,:after,:ip,:ua)",{
        userId,description:'One-off cleanup '+type+' review: '+decision,after:JSON.stringify({type,key,decision,notes}),
        ip:String(req.ip||'').slice(0,64),ua:String(req.get('user-agent')||'').slice(0,255)});
      await conn.commit();
    } catch(error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
    return res.redirect(res.locals.basePath+'/temporary-cleanup/review/'+encodeURIComponent(type)+'/'+encodeURIComponent(key)+'?saved=1');
  }catch(e){next(e);}
});
module.exports=router;
