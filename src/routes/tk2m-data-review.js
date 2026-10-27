'use strict';
const express=require('express');
const crypto=require('crypto');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {loadCases,TYPES,canManage,summarize}=require('../services/tk2m-review-cases');
const router=express.Router();
const ALLOWED=new Set(['verified','keep_separate','needs_update','hold']);
const STAFF_ALLOWED=new Set(['needs_update','hold']);
const hex=/^[0-9a-f]{64}$/;

function protectedPage(req,res,next){
  res.set('Cache-Control','private, no-store, max-age=0');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Robots-Tag','noindex, nofollow, noarchive');
  next();
}
function reviewSession(req,res,next){
  if(!req.session.user)return res.redirect((res.locals.basePath||'')+'/data-review/login');
  return requireAuth(req,res,next);
}
function authorize(req,res,next){
  const user=req.session.user;
  if(!user || !['staff','owner','manager'].includes(user.role)) {
    return res.status(403).render('error',{title:'Access denied',message:'A current CRM staff or manager login is required.'});
  }
  next();
}
function csrf(req){
  if(!req.session.tk2mReviewCsrf)req.session.tk2mReviewCsrf=crypto.randomBytes(32).toString('hex');
  return req.session.tk2mReviewCsrf;
}
function csrfValid(req){
  const a=String(req.body.csrf||''),b=String(req.session.tk2mReviewCsrf||'');
  return hex.test(a)&&hex.test(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
function alertPage(res,status,message){
  return res.status(status).render('error',{title:'Review not saved',message});
}
function safeFilter(value,allowed,otherwise){
  const x=String(value||'');
  return allowed.includes(x)?x:otherwise;
}
function caseSort(a,b){
  const weights={migration:0,identity:1,import_conflict:2,duplicate_phone:3,import_possible:4};
  const active=x=>x.state==='stale'?0:x.state==='pending'?1:x.state==='needs_update'?2:x.state==='hold'?3:4;
  return active(a)-active(b)||weights[a.kind]-weights[b.kind]||a.label.localeCompare(b.label);
}
async function authenticatedCases(req){return loadCases(req.session.user);}
router.get('/data-review/login',protectedPage,(req,res)=>{
  const base=res.locals.basePath||'';
  // Reuse existing CRM credentials; no second password store.
  res.redirect(base+'/login?return_to='+encodeURIComponent(base+'/data-review'));
});
router.get('/data-review',protectedPage,reviewSession,authorize,async(req,res,next)=>{
  try{
    const all=await authenticatedCases(req);
    const totals=summarize(all);
    const kinds=Object.keys(TYPES);
    const kind=safeFilter(req.query.kind,[...kinds,'all'],'all');
    const view=safeFilter(req.query.view,['open','pending','stale','verified','keep_separate','needs_update','hold','all'],'open');
    const term=String(req.query.q||'').trim().slice(0,70).toLowerCase();
    let listing=all.filter(x=>(kind==='all'||x.kind===kind) &&
      (view==='all'||(view==='open'?['pending','stale','needs_update','hold'].includes(x.state):x.state===view)) &&
      (!term||[x.label,x.description,x.kindLabel,...x.members.flatMap(m=>[m.client_name,m.account_number,m.id_number,m.email,m.cell_number_normalised,m.cell_number])].some(s=>String(s||'').toLowerCase().includes(term))));
    listing.sort(caseSort);
    const page=Math.max(1,Math.min(999,Number.parseInt(req.query.page,10)||1));
    const limit=25;
    const count=listing.length;
    listing=listing.slice((page-1)*limit,page*limit);
    res.render('tk2m-review-portal',{layout:false,title:'Data Review Centre',currentUser:req.session.user,
      basePath:res.locals.basePath||'',assetVersion:res.locals.assetVersion,
      listing,totals,kinds:TYPES,kind,view,q:term,page,pages:Math.max(1,Math.ceil(count/limit)),
      listTotal:count,csrf:csrf(req),selected:null,history:null,
      notice:req.query.saved==='1'?'Review saved. The next outstanding cases remain in the queue.':'',
      canManage:canManage(req.session.user)});
  }catch(error){next(error);}
});
router.get('/data-review/history',protectedPage,reviewSession,authorize,async(req,res,next)=>{
  try{
    const owner=canManage(req.session.user);
    const params=owner?[]:[Number(req.session.user.id)];
    const where=owner?'':' WHERE h.reviewer_staff_id=?';
    const [history]=await db.query('SELECT h.case_id,h.kind,h.status,h.note,h.reviewed_at,h.revision,s.full_name reviewer FROM tk2m_review_history h LEFT JOIN staff_users s ON s.id=h.reviewer_staff_id'+where+' ORDER BY h.id DESC LIMIT 150',params);
    res.render('tk2m-review-portal',{layout:false,title:'Review History',currentUser:req.session.user,
      basePath:res.locals.basePath||'',assetVersion:res.locals.assetVersion,
      listing:[],totals:null,kinds:TYPES,kind:'all',view:'all',q:'',page:1,pages:1,listTotal:0,
      csrf:csrf(req),selected:null,history,notice:'',canManage:owner});
  }catch(error){next(error);}
});
router.get('/data-review/case/:id',protectedPage,reviewSession,authorize,async(req,res,next)=>{
  try{
    const id=String(req.params.id||'');
    if(!hex.test(id))return alertPage(res,404,'Case identifier not found.');
    const all=await authenticatedCases(req);
    const selected=all.find(x=>x.id===id);
    if(!selected)return alertPage(res,404,'This case is not available to your account or has been resolved in the current data.');
    const [history]=await db.query('SELECT h.status,h.note,h.reviewed_at,h.revision,s.full_name reviewer FROM tk2m_review_history h LEFT JOIN staff_users s ON s.id=h.reviewer_staff_id WHERE h.case_id=? ORDER BY h.id DESC LIMIT 30',[id]);
    let lines=[];
    if(selected.kind==='duplicate_phone') {
      const ids=selected.members.map(x=>Number(x.id));
      const [found]=await db.query('SELECT id,client_id,account_code,msisdn_normalised,last_upgrade_date,eligible_upgrade_date,device_name FROM mobile_base_current WHERE msisdn_normalised=? OR client_id IN (?) ORDER BY id LIMIT 70',[selected.details.phone,ids.length?ids:[0]]);
      lines=found;
    }
    res.render('tk2m-review-portal',{layout:false,title:'Review Case',currentUser:req.session.user,
      basePath:res.locals.basePath||'',assetVersion:res.locals.assetVersion,
      listing:[],totals:summarize(all),kinds:TYPES,kind:'all',view:'open',q:'',page:1,pages:1,listTotal:0,
      csrf:csrf(req),selected:{...selected,lines},history,notice:'',
      canManage:canManage(req.session.user)});
  }catch(error){next(error);}
});
router.post('/data-review/case/:id/decision',protectedPage,requireAuth,authorize,async(req,res,next)=>{
  try{
    const id=String(req.params.id||'');
    if(!hex.test(id)||!csrfValid(req))return alertPage(res,403,'Your review session has expired or the form was invalid. Open the case again.');
    const decision=String(req.body.decision||'');
    const note=String(req.body.note||'').trim().slice(0,2000);
    if(!ALLOWED.has(decision)||(!canManage(req.session.user)&&!STAFF_ALLOWED.has(decision)))
      return alertPage(res,403,'Only a manager or owner can verify a case. Staff can flag it for correction or hold.');
    if(note.length<12)return alertPage(res,422,'Please write at least 12 characters explaining the decision.');
    const all=await authenticatedCases(req);
    const selected=all.find(x=>x.id===id);
    if(!selected)return alertPage(res,409,'The case has been resolved or is no longer assigned to you. Reload the queue.');
    if(String(req.body.source_hash||'')!==selected.fingerprint)
      return alertPage(res,409,'These records changed while you were reviewing. Reload the case and check the latest details.');
    const expectedRevision=Number(req.body.revision);
    if(!Number.isInteger(expectedRevision)||expectedRevision<0)
      return alertPage(res,400,'Invalid revision. Reload this case.');
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const [prev]=await conn.execute('SELECT revision FROM tk2m_review_decisions WHERE case_id=? FOR UPDATE',[id]);
      const revision=Number(prev[0]?.revision||0);
      if(revision!==expectedRevision){
        await conn.rollback();
        return alertPage(res,409,'Another reviewer saved a decision first. Reload this case before making changes.');
      }
      const nextRevision=revision+1;
      if(prev.length) {
        await conn.execute('UPDATE tk2m_review_decisions SET kind=?,source_hash=?,status=?,note=?,reviewer_staff_id=?,revision=?,reviewed_at=NOW() WHERE case_id=?',
          [selected.kind,selected.fingerprint,decision,note,Number(req.session.user.id),nextRevision,id]);
      } else {
        await conn.execute('INSERT INTO tk2m_review_decisions (case_id,kind,source_hash,status,note,reviewer_staff_id,revision,reviewed_at) VALUES (?,?,?,?,?,?,?,NOW())',
          [id,selected.kind,selected.fingerprint,decision,note,Number(req.session.user.id),nextRevision]);
      }
      await conn.execute('INSERT INTO tk2m_review_history (case_id,kind,status,source_hash,note,reviewer_staff_id,revision,reviewed_at) VALUES (?,?,?,?,?,?,?,NOW())',
        [id,selected.kind,decision,selected.fingerprint,note,Number(req.session.user.id),nextRevision]);
      await conn.commit();
    }catch(error){
      await conn.rollback();
      if(error.code==='ER_DUP_ENTRY')return alertPage(res,409,'Another reviewer saved this case. Please reload.');
      throw error;
    }finally{conn.release();}
    return res.redirect((res.locals.basePath||'')+'/data-review?kind='+encodeURIComponent(selected.kind)+'&view=open&saved=1');
  }catch(error){next(error);}
});
module.exports=router;
