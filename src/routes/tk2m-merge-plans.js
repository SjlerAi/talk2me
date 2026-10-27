'use strict';
const express=require('express');
const crypto=require('node:crypto');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {loadCases}=require('../services/tk2m-review-cases');
const {
 candidatesForCase,makePlan,previewSeal,compareSeal,existingPlans,statusOf,canManage,
 formatted,validId,hash
}=require('../services/tk2m-merge-planner');
const router=express.Router();
const caseHex=/^[a-f0-9]{64}$/;
const MAX_NOTE=2000;
function protect(req,res,next){
 res.set('Cache-Control','private, no-store, max-age=0');
 res.set('Referrer-Policy','no-referrer');
 res.set('X-Robots-Tag','noindex,nofollow,noarchive');next();
}
function reviewer(req,res,next){
 if(!req.session.user)return res.redirect((res.locals.basePath||'')+'/data-review/login');
 return requireAuth(req,res,next);
}
function authorize(req,res,next){
 if(!['owner','manager','staff'].includes(req.session.user?.role))
  return res.status(403).send('Access denied');
 next();
}
function token(req){
 if(!req.session.tk2mReviewCsrf)req.session.tk2mReviewCsrf=crypto.randomBytes(32).toString('hex');
 return req.session.tk2mReviewCsrf;
}
function validCsrf(req){
 const actual=String(req.body.csrf||''),expected=String(req.session.tk2mReviewCsrf||'');
 return caseHex.test(actual)&&caseHex.test(expected)&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
function noteOrError(value){
 const note=String(value||'').trim().slice(0,MAX_NOTE);
 if(note.length<12)throw Error('Explain your decision in at least 12 characters.');
 return note;
}
function caseURL(req){return (resBase(req))+'/data-review/case/'+encodeURIComponent(req.params.id);}
function resBase(req){return req.app.locals.basePath || req.res.locals.basePath || '';}
async function locate(req){
 const caseId=String(req.params.id||'');
 if(!caseHex.test(caseId))return null;
 const all=await loadCases(req.session.user);
 const item=all.find(c=>c.id===caseId);
 if(!item)return null;
 const data=await candidatesForCase(item,req.session.user);
 if(!data)return null;
 const proposals=await existingPlans(item.id);
 return {item,data,proposals};
}
function view(req,res,ctx,{preview=null,posted={},error='',notice='',focusProposal=null}={},status=200){
 const {item,data,proposals}=ctx;
 const isManager=canManage(req.session.user);
 const available=proposals.filter(p=>isManager||Number(p.proposed_by)===Number(req.session.user.id));
 const selectedProposal=focusProposal||
   available.find(p=>p.id===validId(req.query.proposal))||null;
 res.status(status).render('tk2m-merge-planner',{
  layout:false,title:'Selective Merge Plan',currentUser:req.session.user,
  basePath:req.res.locals.basePath||'',assetVersion:req.res.locals.assetVersion,
  item,data,proposals:available,selectedProposal,
  preview,posted,error,notice,isManager,csrf:token(req),
  formatted,caseId:item.id
 });
}
function fail(req,res,status,message){
 return res.status(status).send(message);
}
router.get('/data-review/case/:id/merge',protect,reviewer,authorize,async(req,res,next)=>{
 try{
  const ctx=await locate(req);
  if(!ctx)return fail(req,res,404,'No compatible customer records were found for your authorised case.');
  view(req,res,ctx,{notice:req.query.saved==='1'?'Merge proposal saved without changing any CRM records.':''});
 }catch(error){next(error);}
});
router.post('/data-review/case/:id/merge/preview',protect,reviewer,authorize,async(req,res,next)=>{
 try{
  if(!validCsrf(req))return fail(req,res,403,'Invalid session. Open the merge planner again.');
  const ctx=await locate(req);
  if(!ctx)return fail(req,res,404,'Case not found or no longer assigned to you.');
  if(String(req.body.source_hash||'')!==ctx.data.sourceHash)
   return view(req,res,ctx,{posted:req.body,error:'Customer data changed. Please compare the latest records again.'},409);
  let plan;
  try{plan=makePlan(ctx.data,req.body);}
  catch(error){return view(req,res,ctx,{posted:req.body,error:error.message},422);}
  const seal=previewSeal(plan,token(req));
  const posted={selected:req.body.selected||[],primary:req.body.primary||'',
    donor:req.body.donor||{},note:String(req.body.note||'').slice(0,2000)};
  return view(req,res,ctx,{preview:{plan,seal},posted});
 }catch(error){next(error);}
});
router.post('/data-review/case/:id/merge/submit',protect,reviewer,authorize,async(req,res,next)=>{
 try{
  if(!validCsrf(req))return fail(req,res,403,'Invalid review session. Open the planner again.');
  const ctx=await locate(req);
  if(!ctx)return fail(req,res,404,'Case not found or no longer assigned to you.');
  if(ctx.data.sourceHash!==String(req.body.source_hash||''))
   return view(req,res,ctx,{error:'Customer records changed since preview. Reload this case.'},409);
  let plan,note;
  try{plan=makePlan(ctx.data,req.body);note=noteOrError(req.body.note);}
  catch(error){return view(req,res,ctx,{posted:req.body,error:error.message},422);}
  const expected=previewSeal(plan,token(req));
  if(!compareSeal(expected,req.body.preview_seal))
   return view(req,res,ctx,{posted:req.body,error:'The preview has changed. Preview and confirm again.'},409);
  const conn=await db.getConnection();
  let committed=false;
  try{
   await conn.beginTransaction();
   // A case-specific row lock prevents concurrent overlapping proposals.
   await conn.execute('INSERT IGNORE INTO tk2m_merge_case_locks (case_id) VALUES (?)',[ctx.item.id]);
   await conn.execute('SELECT case_id FROM tk2m_merge_case_locks WHERE case_id=? FOR UPDATE',[ctx.item.id]);
   const [existing]=await conn.execute(
    'SELECT id,status,source_hash,plan_json FROM tk2m_merge_proposals '+
    'WHERE case_id=? AND status IN ("submitted","approved") FOR UPDATE',[ctx.item.id]);
   for(const proposal of existing){
    let previous={};try{previous=JSON.parse(proposal.plan_json||'{}');}catch(_){}
    if((previous.selectedIds||[]).some(id=>plan.selectedIds.includes(Number(id))))
     throw Object.assign(Error('Another active proposal already includes one of these records. Review or reopen that proposal first.'),{isConflict:true});
   }
   const [created]=await conn.execute('INSERT INTO tk2m_merge_proposals '+
    '(case_id,kind,status,source_hash,plan_json,note,proposed_by,revision,proposed_at) '+
    'VALUES (?,?,"submitted",?,?,?,?,1,UTC_TIMESTAMP())',
    [ctx.item.id,ctx.item.kind,plan.sourceHash,JSON.stringify(plan),note,Number(req.session.user.id)]);
   await conn.execute('INSERT INTO tk2m_merge_proposal_history '+
    '(proposal_id,case_id,revision,action,actor_staff_id,note,source_hash,recorded_at) '+
    'VALUES (?,?,1,"submitted",?,?,?,UTC_TIMESTAMP())',
    [created.insertId,ctx.item.id,Number(req.session.user.id),note,plan.sourceHash]);
   await conn.commit();committed=true;
  }catch(error){
   if(!committed)await conn.rollback();
   if(error.isConflict)return view(req,res,ctx,{posted:req.body,error:error.message},409);
   throw error;
  }finally{conn.release();}
  return res.redirect((req.res.locals.basePath||'')+'/data-review/case/'+ctx.item.id+'/merge?saved=1');
 }catch(error){next(error);}
});
async function changeStatus(req,res,next,action){
 try{
  if(!validCsrf(req))return fail(req,res,403,'Invalid session. Reopen the proposal.');
  if(!canManage(req.session.user))return fail(req,res,403,'Manager or owner approval required.');
  const ctx=await locate(req);
  if(!ctx)return fail(req,res,409,'The review case is no longer available. No approval was recorded.');
  const id=validId(req.params.proposalId);
  if(!id)return fail(req,res,404,'Invalid proposal identifier.');
  let note;
  try{note=noteOrError(req.body.note);}catch(error){return fail(req,res,422,error.message);}
  const expectedRevision=Number(req.body.revision);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
   return fail(req,res,400,'Reload the proposal before approving.');
  const conn=await db.getConnection();
  try{
   await conn.beginTransaction();
   const [items]=await conn.execute('SELECT * FROM tk2m_merge_proposals WHERE id=? AND case_id=? FOR UPDATE',[id,ctx.item.id]);
   const row=items[0];
   if(!row||Number(row.revision)!==expectedRevision) {
    await conn.rollback();return fail(req,res,409,'This proposal was modified by another reviewer. Reload.');
   }
   if(action==='approved'){
    if(row.status!=='submitted') {
     await conn.rollback();return fail(req,res,409,'Only submitted plans can be approved.');
    }
    if(Number(row.proposed_by)===Number(req.session.user.id)){
     await conn.rollback();return fail(req,res,403,'A different manager or owner must approve your proposal.');
    }
    if(row.source_hash!==ctx.data.sourceHash){
     await conn.rollback();return fail(req,res,409,'The customer records have changed since the proposal. Re-review required.');
    }
   }else if(!['approved','submitted'].includes(row.status)){
    await conn.rollback();return fail(req,res,409,'This proposal cannot be reopened.');
   }
   const nextRevision=expectedRevision+1,approver=Number(req.session.user.id);
   const approval=action==='approved';
   await conn.execute('UPDATE tk2m_merge_proposals SET status=?,revision=?,approved_by=?,approved_at=? WHERE id=?',
    [action,nextRevision,approval?approver:null,approval?new Date():null,id]);
   await conn.execute('INSERT INTO tk2m_merge_proposal_history '+
    '(proposal_id,case_id,revision,action,actor_staff_id,note,source_hash,recorded_at) '+
    'VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP())',
    [id,ctx.item.id,nextRevision,action,approver,note,row.source_hash]);
   await conn.commit();
  }catch(error){await conn.rollback();throw error;}
  finally{conn.release();}
  res.redirect((req.res.locals.basePath||'')+'/data-review/case/'+ctx.item.id+'/merge?proposal='+id);
 }catch(error){next(error);}
}
router.post('/data-review/case/:id/merge/:proposalId/approve',protect,reviewer,authorize,
 (req,res,next)=>changeStatus(req,res,next,'approved'));
router.post('/data-review/case/:id/merge/:proposalId/reopen',protect,reviewer,authorize,
 (req,res,next)=>changeStatus(req,res,next,'needs_revision'));
module.exports=router;
