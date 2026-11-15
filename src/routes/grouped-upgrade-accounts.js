'use strict';
const crypto=require('crypto');
const masterResolver=require('../services/master-service-conflict-resolver');
const express=require('express');
const db=require('../config/db');
const {requireOwner}=require('../middleware/auth');
const router=express.Router();
const n=v=>Number.isInteger(Number(v))&&Number(v)>0?Number(v):null;
const text=(v,max=100)=>String(v||'').trim().slice(0,max);
function csrfFor(req){
 if(!req.session.masterConflictToken)req.session.masterConflictToken=crypto.randomBytes(24).toString('hex');
 return req.session.masterConflictToken;
}
function validCsrf(req){
 const got=String(req.body?.csrf_token||'');
 const correct=String(req.session?.masterConflictToken||'');
 return /^[a-f0-9]{48}$/.test(got)&&/^[a-f0-9]{48}$/.test(correct)&&
  crypto.timingSafeEqual(Buffer.from(got,'hex'),Buffer.from(correct,'hex'));
}
router.get('/grouped-upgrade-accounts/review.csv',requireOwner,async(req,res,next)=>{
 try{
  const [[batch]]=await db.query('SELECT id FROM ga26_batches ORDER BY id DESC LIMIT 1');
  if(!batch)return res.status(404).send('No grouped upgrade import staged.');
  const [items]=await db.query(
   "SELECT g.account_number,g.account_name,g.review_status AS account_status,l.phone,"+
   "l.line_status,l.base_status,l.notes,l.crm_client_id,l.base_line_id,a.task_id "+
   "FROM ga26_lines l JOIN ga26_accounts g ON g.id=l.ga_account_id "+
   "LEFT JOIN bf26_actions a ON a.contact_id=l.bf_contact_id "+
   "WHERE l.batch_id=? AND l.review_required=1 AND l.review_state IN ('pending','needs_info','needs_correction') ORDER BY g.account_number,l.phone",[batch.id]);
  const escape=value=>{
   let v=String(value==null?'':value).replace(/[\r\n]+/g,' ').trim();
   if(/^[=+\-@\t]/.test(v))v="'"+v;
   return '"'+v.replace(/"/g,'""')+'"';
  };
  const fields=['Account number','Account name','Account review','Telephone number','CRM line status','Base status','Reason','Existing client ID','Existing base line ID','Black Friday task ID'];
  const csv='\uFEFF'+[fields.map(escape).join(','),...items.map(x=>
   [x.account_number,x.account_name,x.account_status,x.phone,x.line_status,x.base_status,x.notes,x.crm_client_id,x.base_line_id,x.task_id].map(escape).join(',')
  )].join('\r\n')+'\r\n';
  res.set('Cache-Control','private, no-store');
  res.attachment('Talk2Me_Grouped_Upgrade_Review_2026.csv');
  return res.type('text/csv').send(csv);
 }catch(error){next(error)}
});

router.get('/grouped-upgrade-accounts',requireOwner,async(req,res,next)=>{
 try{
  const [[batch]]=await db.query("SELECT * FROM ga26_batches ORDER BY id DESC LIMIT 1");
  if(!batch)return res.render('grouped-upgrade-accounts',{title:'Grouped Upgrade Accounts',batch:null,stats:{},accounts:[],q:'',mode:'all',page:1,pages:1,total:0,flash:''});
  const q=text(req.query.q,80),mode=['all','review','new','existing'].includes(req.query.mode)?req.query.mode:'all',requested=n(req.query.page)||1;
  const where=['g.batch_id=?'],params=[batch.id];
  if(q){
   where.push("(g.account_number LIKE ? OR g.account_name LIKE ? OR EXISTS(SELECT 1 FROM ga26_lines li WHERE li.ga_account_id=g.id AND li.phone LIKE ?))");
   const term='%'+q+'%';params.push(term,term,term);
  }
  if(mode==='review')where.push("(g.review_status IN ('missing_account_number','conflicting_account_names') OR EXISTS (SELECT 1 FROM ga26_lines li WHERE li.ga_account_id=g.id AND li.review_required=1 AND li.review_state IN ('pending','needs_info','needs_correction')))");
  if(mode==='new')where.push("g.review_status IN ('new_account_created','new_account')");
  if(mode==='existing')where.push("g.review_status='existing_crm_account'");
  const predicate=where.join(' AND ');
  const [[cnt]]=await db.query("SELECT COUNT(*) total FROM ga26_accounts g WHERE "+predicate,params);
  const total=Number(cnt.total),pages=Math.max(1,Math.ceil(total/20)),page=Math.min(requested,pages);
  const [accounts]=await db.query(
   "SELECT g.*,COUNT(l.id) line_count_actual,SUM(l.review_required=1 AND l.review_state IN ('pending','needs_info','needs_correction')) needs_review,"+
   "SUM(l.crm_client_id IS NOT NULL) linked_crm_lines,SUM(l.base_line_id IS NOT NULL) linked_base_lines,"+
   "SUM(l.line_status='already_linked') already_linked "+
   "FROM ga26_accounts g LEFT JOIN ga26_lines l ON l.ga_account_id=g.id WHERE "+predicate+
   " GROUP BY g.id ORDER BY (SUM(l.review_required=1 AND l.review_state IN ('pending','needs_info','needs_correction'))>0) DESC, g.line_count DESC, g.account_number LIMIT ? OFFSET ?",
   [...params,20,(page-1)*20]);
  const ids=accounts.map(a=>Number(a.id));
  const details=new Map();
  if(ids.length){
   const [lines]=await db.query("SELECT l.*,b.source_upgrade_label,b.source_name,act.task_id FROM ga26_lines l "+
    "LEFT JOIN bf26_contacts b ON b.id=l.bf_contact_id LEFT JOIN bf26_actions act ON act.contact_id=l.bf_contact_id "+
    "WHERE l.ga_account_id IN ("+ids.map(()=>'?').join(',')+") ORDER BY (l.review_required=1 AND l.review_state IN ('pending','needs_info','needs_correction')) DESC,l.phone",ids);
   for(const line of lines){if(!details.has(Number(line.ga_account_id)))details.set(Number(line.ga_account_id),[]);details.get(Number(line.ga_account_id)).push(line);}
  }
  for(const item of accounts){
    item.lines=details.get(Number(item.id))||[];
    item.pending_lines=item.lines.filter(line=>Number(line.review_required)===1&&['pending','needs_info','needs_correction'].includes(line.review_state));
    item.classified_lines=item.lines.filter(line=>line.review_state==='other_service_confirmed');
  }
  const [[stats]]=await db.query(
   "SELECT (SELECT COUNT(*) FROM ga26_accounts WHERE batch_id=?) grouped_accounts,"+
   "(SELECT COUNT(*) FROM ga26_accounts WHERE batch_id=? AND account_number IS NOT NULL) numbered_accounts,"+
   "(SELECT COUNT(*) FROM ga26_accounts WHERE batch_id=? AND review_status='new_account_created') created_accounts,"+
   "(SELECT COUNT(*) FROM ga26_lines WHERE batch_id=?) distinct_numbers,"+
   "(SELECT COUNT(*) FROM ga26_lines WHERE batch_id=? AND review_required=1 AND review_state IN ('pending','needs_info','needs_correction')) review_lines,"+
   "(SELECT COUNT(*) FROM ga26_lines WHERE batch_id=? AND base_line_id IS NOT NULL) base_links,"+
   "(SELECT COUNT(*) FROM bf26_actions) sent_tasks",
   [batch.id,batch.id,batch.id,batch.id,batch.id,batch.id]);
  res.render('grouped-upgrade-accounts',{title:'Grouped Upgrade Accounts',batch,stats,accounts,q,mode,page,pages,total,flash:text(req.query.message,350)});
 }catch(error){next(error)}
});
// Read-only owner handoff for cases left after safe automatic reconciliation.
// Keeps Gerda's original grouped-account workflow intact and links to
// existing correction screens where those screens already support the case.
router.get('/grouped-upgrade-accounts/master-review',requireOwner,async(req,res,next)=>{
 try{
  const [[run]]=await db.query("SELECT id,version,state,completed_at,source_counts_json,result_counts_json FROM crm_recon_runs WHERE state='ready_for_review' ORDER BY id DESC LIMIT 1");
  if(!run)return res.status(404).render('error',{title:'Reconciliation not yet prepared',message:'No completed master-CRM comparison is available.'});
  // Display CURRENT master issue counts, not historical recon assessment
  // totals. A service can have several different problems at the same time.
  const [openServiceIssues]=await db.query(
    "SELECT evidence_json FROM crm_master_services WHERE "+
    "run_id=(SELECT run_id FROM crm_master_active WHERE singleton=1) "+
    "AND link_state='needs_conflict_review'");
  const issueCounts=new Map();
  for(const row of openServiceIssues){
    const issues=JSON.parse(row.evidence_json||'{}').issues||[];
    for(const issue of issues)issueCounts.set(issue,(issueCounts.get(issue)||0)+1);
  }
  const types=[...issueCounts].map(([assessment,n])=>({assessment,n}))
    .sort((a,b)=>b.n-a.n);
  const activeType=text(req.query.type,60);
  const type=types.some(x=>x.assessment===activeType)?activeType:'all';
  const search=text(req.query.q,80);
  const where=['active.singleton=1'],params=[];
  if(type!=='all'){
    where.push("JSON_CONTAINS(JSON_EXTRACT(ms.evidence_json,'$.issues'),JSON_QUOTE(?))=1");
    params.push(type);
  }
  if(search){where.push('(ms.phone LIKE ? OR ms.display_name LIKE ? OR c.client_name LIKE ? OR c.account_number LIKE ? OR b.account_name LIKE ? OR b.account_code_core LIKE ?)');
    for(let i=0;i<6;i++)params.push('%'+search+'%');}
  // The live master is the primary source. Legacy reconciliation is an
  // OPTIONAL source of display details, never a gate that can hide cases.
  const from='FROM crm_master_active active '+
   'JOIN crm_master_services ms ON ms.run_id=active.run_id '+
   "AND ms.link_state='needs_conflict_review' "+
   'LEFT JOIN crm_recon_line_candidates r ON r.run_id=? AND r.phone=ms.phone '+
   'LEFT JOIN clients c ON c.id=COALESCE(r.crm_client_id,ms.crm_client_id) '+
   'LEFT JOIN mobile_base_current b ON b.id=COALESCE(r.base_line_id,ms.mobile_base_id) ';
  const filter=' WHERE '+where.join(' AND ');
  const [[totalRow]]=await db.query('SELECT COUNT(*) total '+from+filter,[run.id,...params]);
  const total=Number(totalRow.total||0),pages=Math.max(1,Math.ceil(total/35));
  const page=Math.min(n(req.query.page)||1,pages);
  const [cases]=await db.query('SELECT ms.phone,ms.display_name master_service_name,r.assessment,r.attention,r.crm_client_id,r.base_line_id,ms.service_key master_service_key,ms.evidence_json master_evidence,'+
   'r.active_crm_rows,r.base_account_id,r.crm_account_id,c.client_name,c.account_number,'+
   'b.account_name supplier_name,b.account_code_core supplier_code '+
   from+filter+' ORDER BY COALESCE(r.assessment,\'zz_other\'),ms.phone LIMIT ? OFFSET ?',[run.id,...params,35,(page-1)*35]);
  const [gaLines]=cases.length?await db.query("SELECT id,phone FROM ga26_lines WHERE review_required=1 AND review_state IN ('pending','needs_info','needs_correction') AND phone IN (?)",
    [cases.map(x=>x.phone)]):[[]];
  const gaMap=new Map(gaLines.map(x=>[x.phone,x.id]));
  for(const item of cases){
   const issues=JSON.parse(item.master_evidence||'{}').issues||[];
   item.master_issues=issues;
   item.active_crm_rows=item.active_crm_rows??JSON.parse(item.master_evidence||'{}').candidate_active_client_ids?.length??0;
   item.grouped_review_id=gaMap.get(item.phone)||null;
   item.duplicate_review_type=issues.includes('multiple_active_crm_rows_same_phone')
    ?(issues.includes('different_account_relationships')?'cross_account_phone':'same_account_phone')
    :null;
   item.duplicate_review_phone=item.duplicate_review_type?'27'+item.phone.slice(1):null;
   item.import_first=issues.includes('import_conflict_pending')&&item.grouped_review_id;
   item.account_choice=issues.length===1&&issues[0]==='different_account_relationships';
  }
  const [duplicateAccounts]=await db.execute('SELECT account_key,account_ids_json FROM crm_recon_account_candidates WHERE run_id=? AND assessment=? ORDER BY account_key',
    [run.id,'exact_normalized_account_duplicate']);
  const [eventConflicts]=await db.query(
    "SELECT p.reference_event_id,p.repeated_event_id,p.reasons_json,e.msisdn_normalised,e.event_type,e.event_date "+
    "FROM crm_recon_event_matches p JOIN mobile_events e ON e.id=p.reference_event_id "+
    "WHERE p.status='manual_conflict' ORDER BY e.event_type,e.event_date DESC LIMIT 35");
  const [staffConflicts]=await db.query(
    "SELECT UPPER(REGEXP_REPLACE(TRIM(account_number),'[^A-Za-z0-9]','')) account_key,COUNT(DISTINCT assigned_staff_id) owners "+
    "FROM client_assignments WHERE is_active=1 AND TRIM(COALESCE(account_number,''))<>'' "+
    "GROUP BY UPPER(REGEXP_REPLACE(TRIM(account_number),'[^A-Za-z0-9]','')) HAVING owners>1 ORDER BY account_key LIMIT 20");
  const [[progress]]=await db.query(
    "SELECT (SELECT COUNT(*) FROM crm_recon_auto_actions) source_links_added,"+
    "(SELECT COUNT(*) FROM crm_recon_event_matches WHERE status='canonical_duplicate') event_repeats_canonicalized,"+
    "(SELECT COUNT(*) FROM ga26_lines WHERE review_required=1 AND review_state IN ('pending','needs_info','needs_correction')) grouped_import_open,"+
    "(SELECT COUNT(*) FROM crm_recon_line_candidates WHERE run_id=? AND attention='review') telephone_cases_open,"+
    "(SELECT COUNT(*) FROM crm_recon_line_candidates WHERE run_id=? AND attention='source_gap') needs_fresh_source",
    [run.id,run.id]);
  const [[openMaster]]=await db.execute(
   "SELECT COUNT(*) n FROM crm_master_services WHERE run_id=(SELECT run_id FROM crm_master_active WHERE singleton=1) AND link_state='needs_conflict_review'");
  progress.telephone_cases_open=Number(openMaster?.n||0);
  res.set('Cache-Control','private, no-store');
  return res.render('grouped-upgrade-master-review',{title:'Master CRM reconciliation — Owner or Manager review',
    notice:text(req.query.message,220),
    run,type,search,types,cases,progress,total,pages,page,
    duplicateAccounts,eventConflicts,staffConflicts});
 }catch(e){next(e)}
});

// One canonical customer/account/service register.
// Read-only management view: every provider line and every CRM record is
// represented here; raw source tables are retained for evidence only.
router.get('/master-register',requireOwner,async(req,res,next)=>{
 try{
  const [[active]]=await db.query(
   "SELECT a.run_id,a.switched_at,r.completed_at,r.version,r.source_counts_json,r.result_counts_json "+
   "FROM crm_master_active a JOIN crm_master_runs r ON r.id=a.run_id WHERE a.singleton=1 AND r.state='ready'");
  if(!active)return res.status(503).render('error',{title:'Master register unavailable',
   message:'The master customer register is not yet verified.'});
  const q=text(req.query.q,90),filter=text(req.query.filter,50);
  const states=['all','account_reference','source_unverified','needs_identity_review'];
  const state=states.includes(filter)?filter:'all';
  const where=['c.run_id=?'],params=[active.run_id];
  if(state!=='all'){where.push('c.verification_state=?');params.push(state);}
  if(q){where.push("(c.display_name LIKE ? OR c.account_number LIKE ? OR c.customer_key LIKE ? OR EXISTS "+
    "(SELECT 1 FROM crm_master_services s WHERE s.run_id=c.run_id AND s.master_customer_key=c.customer_key "+
    "AND s.phone LIKE ?))");
   const search='%'+q+'%';params.push(search,search,search,search);}
  const from=' FROM crm_master_customers c WHERE '+where.join(' AND ');
  const [[count]]=await db.query('SELECT COUNT(*) total'+from,params);
  const total=Number(count.total),pages=Math.max(1,Math.ceil(total/35));
  const page=Math.min(n(req.query.page)||1,pages);
  const [customers]=await db.query('SELECT c.customer_key,c.crm_account_id,c.account_number,c.display_name,'+
   'c.verification_state,c.customer_kind,c.source_count,c.service_count'+from+
   ' ORDER BY c.service_count DESC,c.display_name LIMIT ? OFFSET ?',[...params,35,(page-1)*35]);
  const [[statesCount]]=await db.query(
   "SELECT (SELECT COUNT(*) FROM crm_master_customers WHERE run_id=?) account_groups,"+
   "(SELECT COUNT(*) FROM crm_master_services WHERE run_id=?) services,"+
   "(SELECT COUNT(*) FROM crm_master_services WHERE run_id=? AND link_state='verified_crm_supplier_link') verified_links,"+
   "(SELECT COUNT(*) FROM crm_master_services WHERE run_id=? AND link_state='account_only_no_customer') account_only,"+
   "(SELECT COUNT(*) FROM crm_master_services WHERE run_id=? AND link_state='needs_conflict_review') conflicts,"+
   "(SELECT COUNT(*) FROM crm_master_service_sources WHERE run_id=? AND source_type='mobile_base') supplier_lines,"+
   "(SELECT COUNT(*) FROM crm_master_service_sources WHERE run_id=? AND source_type='fixed_service') fixed_services",
   Array(7).fill(active.run_id));
  res.set('Cache-Control','private, no-store');
  return res.render('master-customer-register',{title:'One Master Customer Register',
   active,customers,stats:statesCount,total,page,pages,q,filter:state});
 }catch(e){next(e)}
});
router.get('/master-register/customer/:key',requireOwner,async(req,res,next)=>{
 try{
  const key=text(req.params.key,100);
  const [[active]]=await db.query(
   "SELECT a.run_id,a.switched_at,r.completed_at,r.version "+
   "FROM crm_master_active a JOIN crm_master_runs r ON r.id=a.run_id WHERE a.singleton=1 AND r.state='ready'");
  if(!active)return res.status(503).render('error',{title:'Master register unavailable',message:'No completed master snapshot.'});
  const [[customer]]=await db.execute('SELECT * FROM crm_master_customers WHERE run_id=? AND customer_key=?',
   [active.run_id,key]);
  if(!customer)return res.status(404).render('error',{title:'Customer not found',message:'No master account-holder record matches this identifier.'});
  const [services]=await db.execute('SELECT service_key,phone,service_type,crm_client_id,mobile_base_id,fixed_service_id,'+
   'link_state,display_name,source_count,evidence_json FROM crm_master_services WHERE run_id=? AND master_customer_key=? '+
   'ORDER BY service_type,phone,service_key LIMIT 350',[active.run_id,key]);
  const [sources]=await db.execute('SELECT source_type,COUNT(*) total FROM crm_master_customer_sources '+
   'WHERE run_id=? AND customer_key=? GROUP BY source_type ORDER BY source_type',[active.run_id,key]);
  res.set('Cache-Control','private, no-store');
  return res.render('master-customer-register-detail',{title:'Master customer services',active,customer,services,sources});
 }catch(e){next(e)}
});
router.get('/master-register/service/:key',requireOwner,async(req,res,next)=>{
 try{
  const key=text(req.params.key,100);
  const [[active]]=await db.query(
   "SELECT a.run_id,a.switched_at,r.completed_at FROM crm_master_active a "+
   "JOIN crm_master_runs r ON r.id=a.run_id WHERE a.singleton=1 AND r.state='ready'");
  if(!active)return res.status(503).render('error',{title:'Master register unavailable',
   message:'No verified master snapshot is available.'});
  const [[service]]=await db.execute('SELECT * FROM crm_master_services WHERE run_id=? AND service_key=?',
   [active.run_id,key]);
  if(!service)return res.status(404).render('error',{title:'Service not found',
   message:'This telephone line is not present in the active master register.'});
  const [[customer]]=service.master_customer_key?await db.execute(
   'SELECT customer_key,account_number,display_name,verification_state FROM crm_master_customers '+
   'WHERE run_id=? AND customer_key=?',[active.run_id,service.master_customer_key]):[[]];
  const [sources]=await db.execute('SELECT source_type,source_id FROM crm_master_service_sources '+
   'WHERE run_id=? AND service_key=? ORDER BY source_type,source_id',
   [active.run_id,key]);
  const resolution=service.link_state==='needs_conflict_review'
   ?await masterResolver.loadContext(db,service):null;
  const [[recordedDecision]]=await db.execute(
   'SELECT d.resolution_mode,d.selected_account_id,d.reviewed_by,d.reviewed_at,'+
   's.full_name reviewer_name,s.role reviewer_role '+
   'FROM crm_master_service_decisions d LEFT JOIN staff_users s ON s.id=d.reviewed_by '+
   'WHERE d.service_key=? LIMIT 1',[key]);
  res.set('Cache-Control','private, no-store');
  return res.render('master-customer-service-detail',{title:'Resolve master CRM service conflict',
   active,service,customer:customer||null,sources,resolution,
   recordedDecision:recordedDecision||null,
   csrfToken:csrfFor(req),flash:text(req.query.message,250),
   error:text(req.query.error,450),
   evidence:JSON.parse(service.evidence_json||'{}')});
 }catch(e){next(e)}
});
// This is the ONLY write action from a Master Register conflict detail.
// It is restricted to the signed-in Owner or Manager (requireOwner handles
// both), CSRF-protected, stale-source checked, automatically audited and
// applies to one verified service number at a time.
router.post('/master-register/service/:key/resolve',requireOwner,async(req,res,next)=>{
 const serviceKey=text(req.params.key,100);
 const root=(res.locals.basePath||'/talk2me');
 if(!validCsrf(req))return res.status(403).render('error',{
  title:'Cannot resolve conflict',message:'Refresh the conflict page before applying a decision.'});
 const mode=text(req.body?.mode,36);
 // No free-text explanation or second checkbox is required.
 // Choosing an action and saving it is the explicit confirmation.
 const conn=await db.getConnection();
 try{
  await conn.beginTransaction();
  const result=await masterResolver.applyDecision(conn,{
   serviceKey,mode,expectedSourceHash:text(req.body?.source_hash,64),
   reviewedBy:req.session.user?.id,ip:req.ip||'',userAgent:req.get('user-agent')||''
  });
  await conn.commit();
  if(!result.resolved){
   return res.redirect(303,root+'/master-register/service/'+encodeURIComponent(serviceKey)+
    '?message='+encodeURIComponent(result.message));
  }
  return res.redirect(303,root+'/grouped-upgrade-accounts/master-review?message='+
   encodeURIComponent(result.message));
 }catch(e){
  try{await conn.rollback()}catch(_){}
  if(e instanceof masterResolver.ResolutionBlocked){
   return res.redirect(303,root+'/master-register/service/'+encodeURIComponent(serviceKey)+
    '?error='+encodeURIComponent(e.message));
  }
  return next(e);
 }finally{conn.release()}
});

// Unified, owner-only upgrade exceptions: never send work to staff using
// a date superseded by a performed upgrade or an unresolved customer match.
router.get('/master-register/upgrade-holds',requireOwner,async(req,res,next)=>{
 try{
  const reason=text(req.query.reason,75);
  const q=text(req.query.q,70);
  const conditions=['1=1'],args={};
  if(reason){
    const [[exists]]=await db.execute(
      'SELECT COUNT(*) n FROM crm_v_master_upgrade_holds WHERE hold_reason=:reason',
      {reason});
    if(Number(exists.n)>0){conditions.push('hold_reason=:reason');args.reason=reason;}
  }
  if(q){conditions.push('(client_name LIKE :search OR account_number LIKE :search OR cell_number LIKE :search)');
   args.search='%'+q+'%';}
  const where=conditions.join(' AND ');
  const [[found]]=await db.execute('SELECT COUNT(*) n FROM crm_v_master_upgrade_holds WHERE '+where,args);
  const total=Number(found?.n||0),pages=Math.max(1,Math.ceil(total/40));
  const page=Math.min(n(req.query.page)||1,pages);
  const [rows]=await db.execute(
   'SELECT id,client_name,cell_number,account_number,previous_upgrade_date,next_upgrade_date,'+
   'master_customer_key,master_service_key,master_link_state,hold_reason FROM crm_v_master_upgrade_holds '+
   'WHERE '+where+' ORDER BY next_upgrade_date,client_name LIMIT :limit OFFSET :offset',
   {...args,limit:40,offset:(page-1)*40});
  const [categories]=await db.query(
   'SELECT hold_reason,COUNT(*) n FROM crm_v_master_upgrade_holds GROUP BY hold_reason ORDER BY n DESC');
  const [[pending]]=await db.query(
   "SELECT COUNT(*) n FROM monthly_import_actions WHERE applied_status='not_applied' AND approval_status='approved'");
  res.set('Cache-Control','private, no-store');
  return res.render('master-upgrade-holds',{title:'Master CRM upgrade verification',
    rows,total,page,pages,q,reason,categories,pendingApproved:Number(pending?.n||0)});
 }catch(e){next(e)}
});
module.exports=router;
