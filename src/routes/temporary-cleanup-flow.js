'use strict';

const express=require('express');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {canUseTemporaryCleanup}=require('../services/temporary-cleanup-access');
const {TYPES,typeSafe,nextPending,queueProgress}=require('../services/temporary-cleanup-queue');
const router=express.Router();

function guard(req,res,next){
  if(!canUseTemporaryCleanup(req.session.user))
    return res.status(404).render('error',{title:'Not available',message:'Cleanup Centre access is restricted or expired.'});
  next();
}
function statusFilter(q){
  const w=[],p=[];
  const status=String(q.status||'all');
  if(['approved_grouping','keep_separate','needs_correction','flagged'].includes(status)){w.push('d.decision=?');p.push(status);}
  const type=String(q.type||'all');
  if(TYPES.includes(type)){w.push('d.case_type=?');p.push(type);}
  const staff=Number(q.staff_id);
  if(Number.isSafeInteger(staff)&&staff>0){w.push('d.reviewed_by=?');p.push(staff);}
  const day=String(q.day||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(day)){w.push('DATE(d.reviewed_at)=?');p.push(day);}
  return {where:w.length?' WHERE '+w.join(' AND '):'',params:p,selection:{status,type,staff_id:Number.isSafeInteger(staff)&&staff>0?staff:'',day:/^\d{4}-\d{2}-\d{2}$/.test(day)?day:''}};
}
async function decorateNames(rows){
  const phones=[...new Set(rows.filter(x=>['same_account_phone','cross_account_phone'].includes(x.case_type)).map(x=>x.case_key))];
  const baseIds=[...new Set(rows.filter(x=>x.case_type==='base_unlinked'&&/^\d+$/.test(x.case_key)).map(x=>Number(x.case_key)))];
  const found=new Map();
  if(phones.length){
    const [names]=await db.query('SELECT cell_number_normalised phone,MAX(client_name) customer FROM clients WHERE cell_number_normalised IN (?) GROUP BY cell_number_normalised',[phones]);
    for(const n of names)found.set('phone:'+n.phone,n.customer);
  }
  if(baseIds.length){
    const [names]=await db.query('SELECT id,account_name customer FROM mobile_base_current WHERE id IN (?)',[baseIds]);
    for(const n of names)found.set('base:'+n.id,n.customer);
  }
  return rows.map(r=>({...r,customer_name:found.get((r.case_type==='base_unlinked'?'base:':'phone:')+r.case_key)||''}));
}

router.get('/temporary-cleanup/next',requireAuth,guard,async(req,res,next)=>{
  try{
    const type=typeSafe(req.query.type);
    const ordered=[type,...TYPES.filter(x=>x!==type)];
    for(const t of ordered){
      const key=await nextPending(t);
      if(key){
        const qs=new URLSearchParams();
        if(['approved','reviewed','flagged','corrected','consolidated'].includes(String(req.query.done||'')))
          qs.set('done',String(req.query.done));
        const suffix=qs.size?'?'+qs.toString():'';
        return res.redirect(res.locals.basePath+'/temporary-cleanup/review/'+encodeURIComponent(t)+'/'+encodeURIComponent(key)+suffix);
      }
    }
    return res.redirect(res.locals.basePath+'/temporary-cleanup?type='+encodeURIComponent(type)+'&finished=1');
  }catch(e){next(e);}
});

router.get('/temporary-cleanup/report',requireAuth,guard,async(req,res,next)=>{
  try{
    const {where,params,selection}=statusFilter(req.query);
    const page=Math.max(1,Math.min(500,parseInt(req.query.page,10)||1));
    const limit=40,offset=(page-1)*limit;
    const [staff]=await db.query('SELECT id,full_name FROM staff_users WHERE is_active=1 ORDER BY full_name');
    const [[sum]]=await db.query('SELECT COUNT(*) total FROM temporary_cleanup_decisions d'+where,params);
    const [stats]=await db.query('SELECT decision,COUNT(*) n FROM temporary_cleanup_decisions GROUP BY decision');
    const [rows]=await db.query('SELECT d.case_type,d.case_key,d.decision,d.notes,d.reviewed_at,d.reviewed_by,s.full_name reviewer FROM temporary_cleanup_decisions d LEFT JOIN staff_users s ON s.id=d.reviewed_by'+where+
      ' ORDER BY d.reviewed_at DESC,d.id DESC LIMIT ? OFFSET ?',[...params,limit,offset]);
    res.set('Cache-Control','no-store');
    return res.render('temporary-cleanup-report',{title:'Customer Cleanup Review Report',rows:await decorateNames(rows),
      total:Number(sum.total||0),page,limit,stats:Object.fromEntries(stats.map(x=>[x.decision,Number(x.n)])),
      staff,selection,types:TYPES});
  }catch(e){next(e);}
});
function csvCell(v){
  let text=String(v==null?'':v);
  if(/^[\s]*[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
router.get('/temporary-cleanup/report.csv',requireAuth,guard,async(req,res,next)=>{
  try{
    const {where,params}=statusFilter(req.query);
    const [rows]=await db.query('SELECT d.case_type,d.case_key,d.decision,d.notes,d.reviewed_at,s.full_name reviewer FROM temporary_cleanup_decisions d LEFT JOIN staff_users s ON s.id=d.reviewed_by'+where+
      ' ORDER BY d.reviewed_at DESC,d.id DESC LIMIT 10000',params);
    const decorated=await decorateNames(rows);
    const fields=['case_type','case_key','customer_name','decision','notes','reviewed_at','reviewer'];
    const contents=[fields.map(csvCell).join(',')];
    for(const row of decorated)contents.push(fields.map(f=>csvCell(row[f] instanceof Date ? row[f].toISOString():row[f])).join(','));
    res.set('Cache-Control','private, no-store');
    res.set('Content-Disposition','attachment; filename="talk2me-cleanup-review-report.csv"');
    return res.type('text/csv; charset=utf-8').send('\ufeff'+contents.join('\r\n')+'\r\n');
  }catch(e){next(e);}
});
module.exports=router;
