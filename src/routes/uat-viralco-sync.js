'use strict';

// Direct staff-controlled ViralCo -> CRM update; UAT only. Original XLSX never published.
const express=require('express');
const multer=require('multer');
const crypto=require('crypto');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {normaliseSouthAfricanMobile}=require('../services/sa-phone-normalisation');
const {parseViralCo,normaliseAccountNumber,MAX_FILE}=require('../services/viralco-report');
const {
  ensureSchema,crmState,matchReport,loadAccountLines,loadGlobalPhoneMatches,
  crmDigest
}=require('../services/viralco-reconcile');

const {
  buildIssues,issueByKey,validateChoice,assessIssues,ensureReviewSchema,
  loadDecisions,saveDecision,MANAGER_ONLY
}=require('../services/viralco-review');

const router=express.Router();
const managers=new Set(['owner','manager','admin']);
const ownerManagers=new Set(['owner','manager']);
const upload=multer({
  storage:multer.memoryStorage(),limits:{fileSize:MAX_FILE,files:1,fields:5},
  fileFilter(req,file,next){
    if(!/\.xlsx$/i.test(String(file.originalname||'')))return next(new Error('Download the original .xlsx report from ViralCo.'));
    next(null,true);
  }
}).single('report');

const safeId=value=>{
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>0?number:null;
};
const filename=value=>String(value||'ViralCo.xlsx').replace(/[\/\\\x00-\x1f]/g,'').slice(0,180)||'ViralCo.xlsx';
const base=(res,id)=>res.locals.basePath+'/customers/'+id+'/viralco-sync';
const deny=(res,status,message)=>res.status(status).render('error',{title:'ViralCo Account Sync',message});
const loggedInManager=user=>managers.has(String(user?.role||'').toLowerCase());
const ownerOrManager=user=>ownerManagers.has(String(user?.role||'').toLowerCase());
function csrf(req){
  if(!req.session.viralcoSyncCsrf)req.session.viralcoSyncCsrf=crypto.randomBytes(32).toString('hex');
  return req.session.viralcoSyncCsrf;
}
function validCsrf(req){
  const expected=String(req.session.viralcoSyncCsrf||''),actual=String(req.body?.viralco_csrf||'');
  return /^[a-f0-9]{64}$/.test(actual)&&actual.length===expected.length&&
    crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
async function contextFor(req,res) {
  const clientId=safeId(req.params.id);
  if(!clientId)return {error:deny(res,400,'Invalid Customer 360 link.')};
  const [[client]]=await db.execute(
    'SELECT id,client_name,account_number,account_id FROM clients WHERE id=:id LIMIT 1',{id:clientId});
  if(!client)return {error:deny(res,404,'Customer could not be found.')};
  let account=null;
  if(client.account_id){
    [[account]]=await db.execute('SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE id=:id LIMIT 1',{id:client.account_id});
  }
  if(!account&&client.account_number){
    [[account]]=await db.execute(
      'SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE account_number_normalised=:number LIMIT 1',
      {number:normaliseAccountNumber(client.account_number)});
  }
  if(!account)return {error:deny(res,422,'This customer has no linked official CRM account number. Management must resolve the account identity before importing ViralCo.')};
  if(loggedInManager(req.session.user))return {client,account,clientId};
  const userId=safeId(req.session.user?.id);
  if(!userId)return {error:deny(res,403,'An authorised staff login is required.')};
  if(Number(account.assigned_staff_id)===userId)return {client,account,clientId};
  const [[assigned]]=await db.execute(
    'SELECT a.id FROM client_assignments a LEFT JOIN clients c ON c.id=a.client_id '+
    'WHERE a.is_active=1 AND a.assigned_staff_id=:staffId '+
    'AND (UPPER(REPLACE(TRIM(COALESCE(a.account_number,""))," ",""))=:number '+
    'OR c.account_id=:accountId OR UPPER(REPLACE(TRIM(COALESCE(c.account_number,""))," ",""))=:number) LIMIT 1',
    {staffId:userId,accountId:account.id,number:normaliseAccountNumber(account.account_number)});
  if(!assigned)return {error:deny(res,403,'You may import ViralCo reports only for business accounts assigned to you.')};
  return {client,account,clientId};
}
async function loadCurrent(conn,accountId,lock=false) {
  const [[current]]=await conn.execute(
    'SELECT id,version_no,file_hash,published_at FROM viralco_import_versions '+
    'WHERE account_id=:accountId AND is_current=1 ORDER BY version_no DESC LIMIT 1'+(lock?' FOR UPDATE':''),
    {accountId}
  );
  return current||null;
}
async function readPreview(conn,previewId,ctx,staffId,lock=false,manager=false){
  if(!/^[0-9a-f-]{36}$/i.test(String(previewId||'')))return null;
  const [[row]]=await conn.execute(
    'SELECT * FROM viralco_import_previews WHERE id=:id AND account_id=:accountId '+
    (manager?'':'AND uploaded_by=:staffId ')+
    'AND expires_at>NOW() LIMIT 1'+(lock?' FOR UPDATE':''),
    {id:previewId,accountId:ctx.account.id,staffId}
  );
  return row||null;
}
async function annotate(conn,report,ctx,lock=false){
  const owned=await loadAccountLines(conn,ctx.account,lock);
  const globally=await loadGlobalPhoneMatches(conn,report,lock);
  return {result:matchReport(report,ctx.account,owned,globally),owned,globally,digest:crmDigest(owned)};
}
async function draw(req,res,ctx,extra={}){
  await ensureSchema(db);
  await ensureReviewSchema(db);
  const [versions]=await db.execute(
    'SELECT id,version_no,filename,provider_company_name,line_count,matched_count,updated_count,created_count,review_count,omitted_count,published_at,is_current,published_by '+
    'FROM viralco_import_versions WHERE account_id=:id ORDER BY version_no DESC LIMIT 50',
    {id:ctx.account.id}
  );
  const current=versions.find(v=>Number(v.is_current)===1)||null;
  const [outstandingRows]=await db.execute(
    'SELECT id,version_id,issue_number,issue_key,issue_type,phone_normalised,source_row,'+
    'status,choice,note,detail_json,updated_at FROM viralco_review_issues '+
    'WHERE account_id=:accountId AND version_id IS NOT NULL AND status IN ("held","referred") '+
    'ORDER BY updated_at DESC LIMIT 100',{accountId:ctx.account.id}
  );
  let managerRequests=[];
  if(loggedInManager(req.session.user)){
    const [pending]=await db.execute(
      'SELECT r.preview_id,r.issue_number,r.issue_type,r.phone_normalised,r.note,r.decided_by, ' +
      'p.filename,p.uploaded_by,p.expires_at FROM viralco_review_issues r ' +
      'JOIN viralco_import_previews p ON p.id=r.preview_id AND p.account_id=r.account_id ' +
      'WHERE r.account_id=:accountId AND r.version_id IS NULL AND r.status="referred" AND p.expires_at>NOW() ' +
      'ORDER BY r.updated_at DESC LIMIT 30',{accountId:ctx.account.id}
    );
    managerRequests=pending;
  }
  const outstanding=outstandingRows.map(row=>{
    let details={};
    try{details=JSON.parse(row.detail_json||'{}');}catch(_){}
    return {...row,details};
  });
  let preview=null,error=extra.error||null;
  const previewId=String(req.query.preview||'');
  if(previewId){
    const staged=await readPreview(db,previewId,ctx,req.session.user.id,false,loggedInManager(req.session.user));
    if(!staged)error='This preview expired. Please upload the ViralCo file again.';
    else {
      const report=parseViralCo(staged.file_data,staged.filename);
      const values=await annotate(db,report,ctx);
      const issues=buildIssues(values.result,report,ctx.account);
      const decisions=await loadDecisions(db,ctx.account.id,staged.id);
      const review=assessIssues(issues,decisions);
      const displayIssues=issues.map(item=>({...item,decision:decisions.get(item.key)||null}));
      values.result.rows=values.result.rows.map(row=>({...row,
        changeDecision:decisions.get('change-'+row.sourceRow)||null
      }));
      const reportMatches=normaliseAccountNumber(report.accountNumber)===normaliseAccountNumber(ctx.account.account_number);
      preview={id:staged.id,filename:staged.filename,report,...values.result,
        issues:displayIssues,review,
        baselineChanged:values.digest!==staged.expected_crm_digest,
        versionChanged:Number(current?.id||0)!==Number(staged.expected_version_id||0),
        accountMatches:reportMatches,
        canConfirmName:loggedInManager(req.session.user)
      };
    }
  }
  const recent=await (async()=>{
    if(!current)return {rows:[],total:0};
    const page=Math.max(1,Math.min(10000,Number.parseInt(String(req.query.page||1),10)||1));
    const [rows]=await db.execute(
      'SELECT source_row,msisdn_original,subscriber_name,pack_desc,upgradable,'+
      'DATE_FORMAT(earliest_upgrade_date,"%Y-%m-%d") earliest_upgrade_date,'+
      'DATE_FORMAT(term_date,"%Y-%m-%d") term_date,avg_spend,matched_client_id,sync_action '+
      'FROM viralco_import_lines WHERE version_id=:version ORDER BY source_row LIMIT 75 OFFSET :offset',
      {version:current.id,offset:(page-1)*75}
    );
    return {rows,total:Number(current.line_count||0),page};
  })();
  return res.render('viralco-account-sync',{
    title:'ViralCo Account Sync',client:ctx.client,account:ctx.account,
    versions,current,preview,outstanding,managerRequests,error,message:String(extra.message||req.query.message||'').slice(0,280),
    lines:recent.rows,totalRows:recent.total,page:recent.page||1,
    pageCount:Math.max(1,Math.ceil(recent.total/75)),
    manager:loggedInManager(req.session.user),ownerManager:ownerOrManager(req.session.user),
    csrfToken:csrf(req)
  });
}
router.get('/customers/:id/viralco-sync',requireAuth,async(req,res,next)=>{
  try{const ctx=await contextFor(req,res);if(ctx.error)return;await draw(req,res,ctx);}
  catch(error){next(error);}
});
router.post('/customers/:id/viralco-sync/upload',requireAuth,(req,res,next)=>{
  upload(req,res,async error=>{
    if(error)return deny(res,400,error.code==='LIMIT_FILE_SIZE'?'Report exceeds 4 MB.':error.message);
    try {
      const ctx=await contextFor(req,res);if(ctx.error)return;
      if(!validCsrf(req))return deny(res,403,'Your form expired. Reopen this account page before uploading.');
      if(!req.file)return deny(res,400,'Choose the original ViralCo .xlsx file.');
      const report=parseViralCo(req.file.buffer,req.file.originalname);
      if(normaliseAccountNumber(report.accountNumber)!==normaliseAccountNumber(ctx.account.account_number))
        return deny(res,409,'ViralCo account '+report.accountNumber+' does not match this CRM account '+ctx.account.account_number+'. Open the correct account. No information was imported.');
      await ensureSchema(db);
      await ensureReviewSchema(db);
      const checked=await annotate(db,report,ctx);
      const current=await loadCurrent(db,ctx.account.id);
      const id=crypto.randomUUID();
      await db.execute(
        'DELETE FROM viralco_import_previews WHERE account_id=:accountId AND uploaded_by=:staffId AND expires_at<NOW()',
        {accountId:ctx.account.id,staffId:req.session.user.id}
      );
      await db.execute(
        'INSERT INTO viralco_import_previews '+
        '(id,account_id,client_id,uploaded_by,filename,file_hash,file_data,expected_version_id,expected_crm_digest,expires_at) '+
        'VALUES (:id,:accountId,:clientId,:userId,:filename,:hash,:file,:version,:digest,DATE_ADD(NOW(),INTERVAL 7 DAY))',
        {id,accountId:ctx.account.id,clientId:ctx.clientId,userId:req.session.user.id,
          filename:filename(req.file.originalname),hash:report.fileHash,file:req.file.buffer,
          version:current?.id||null,digest:checked.digest}
      );
      return res.redirect(base(res,ctx.clientId)+'?preview='+encodeURIComponent(id));
    }catch(error){
      if(/ViralCo|workbook|report|MSISDN|Excel|ZIP|exceed|missing|invalid|duplicate|Partial/i.test(error.message||''))return deny(res,400,error.message);
      next(error);
    }
  });
});
router.post('/customers/:id/viralco-sync/decision',requireAuth,async(req,res,next)=>{
  let conn=null;
  try{
    const ctx=await contextFor(req,res);if(ctx.error)return;
    if(!validCsrf(req))return deny(res,403,'Your review form expired. Reopen the upload preview.');
    await ensureSchema(db);await ensureReviewSchema(db);
    conn=await db.getConnection();await conn.beginTransaction();
    const [[account]]=await conn.execute(
      'SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE id=:id FOR UPDATE',
      {id:ctx.account.id});
    if(!account)throw Error('The account no longer exists.');
    const lockedCtx={...ctx,account};
    const staged=await readPreview(conn,req.body.preview_id,lockedCtx,req.session.user.id,true,loggedInManager(req.session.user));
    if(!staged)throw Error('The preview has expired. Upload the original report again.');
    const report=parseViralCo(staged.file_data,staged.filename);
    const current=await loadCurrent(conn,account.id,true);
    if(Number(current?.id||0)!==Number(staged.expected_version_id||0))
      throw Error('Another import has changed the account. Please upload again.');
    const checked=await annotate(conn,report,lockedCtx,false);
    if(checked.digest!==staged.expected_crm_digest)
      throw Error('The CRM changed after preview. Upload again to review current details.');
    const issues=buildIssues(checked.result,report,account);
    const key=String(req.body.issue_key||'');
    let issue=issueByKey(issues,key);
    if(!issue&&/^change-[0-9]+$/.test(key)){
      const sourceRow=Number(key.slice(7));
      const changed=checked.result.rows.find(row=>row.sourceRow===sourceRow&&row.action==='update');
      if(changed)issue={key,type:'data_change',number:0,sourceRow:changed.sourceRow,
        phone:changed.phone,label:'Choose data source for existing line',previous:changed.previous,proposed:changed.proposed};
    }
    const decision=validateChoice(issue,req.body.choice,req.session.user.role,req.body.note);
    await saveDecision(conn,{accountId:account.id,previewId:staged.id,issue,...decision,actorId:req.session.user.id});
    await conn.commit();conn.release();conn=null;
    const hash=issue.number>0?'#review-issue-'+issue.number:'#viralco-data-changes';
    return res.redirect(base(res,ctx.clientId)+'?preview='+encodeURIComponent(staged.id)+
      '&message='+encodeURIComponent('Decision saved for '+(issue.number?'Conflict '+issue.number:'Excel row '+issue.sourceRow))+hash);
  }catch(error){
    if(conn){try{await conn.rollback();}finally{conn.release();}}
    if(/preview|change|decision|allowed|owner|manager|account|resolution|explanation|review item|expired|CRM/.test(error.message||''))
      return deny(res,409,error.message);
    next(error);
  }
});

router.post('/customers/:id/viralco-sync/publish',requireAuth,async(req,res,next)=>{
  let conn=null;
  try{
    const ctx=await contextFor(req,res);if(ctx.error)return;
    if(!validCsrf(req))return deny(res,403,'Your confirmation form expired. Reopen the preview.');
    if(String(req.body.confirm_updates||'')!=='yes')
      return deny(res,400,'Confirm this account and all safe updates before publishing.');
    await ensureSchema(db);
    await ensureReviewSchema(db);
    conn=await db.getConnection();await conn.beginTransaction();
    const [[account]]=await conn.execute(
      'SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE id=:id FOR UPDATE',
      {id:ctx.account.id}
    );
    if(!account)throw new Error('The selected account no longer exists.');
    const lockedCtx={...ctx,account};
    const preview=await readPreview(conn,req.body.preview_id,lockedCtx,req.session.user.id,true,loggedInManager(req.session.user));
    if(!preview)throw new Error('The preview has expired or was already published.');
    const report=parseViralCo(preview.file_data,preview.filename);
    if(report.fileHash!==preview.file_hash||normaliseAccountNumber(report.accountNumber)!==normaliseAccountNumber(account.account_number))
      throw new Error('The workbook identity has changed. Re-upload before publishing.');
    const current=await loadCurrent(conn,account.id,true);
    if(Number(current?.id||0)!==Number(preview.expected_version_id||0))
      throw new Error('This business account was updated by another person. Please upload again to review the latest changes.');
    if(current?.file_hash===report.fileHash){
      await conn.execute('DELETE FROM viralco_import_previews WHERE id=:id',{id:preview.id});
      await conn.commit();conn.release();conn=null;
      return res.redirect(base(res,ctx.clientId)+'?message='+encodeURIComponent('This identical ViralCo report is already the current version.'));
    }
    const checked=await annotate(conn,report,lockedCtx,true);
    if(checked.digest!==preview.expected_crm_digest)
      throw new Error('CRM customer details have changed since this preview. Upload again to see the latest comparison.');
    const issues=buildIssues(checked.result,report,account);
    const decisions=await loadDecisions(conn,account.id,preview.id);
    const review=assessIssues(issues,decisions);
    if(!review.ready)throw Error('Every numbered conflict requires a saved decision. Account identity must be verified by management before publication.');
    const mismatched=checked.result.nameMismatch;
    const accountDecision=decisions.get('account-name');
    const updateCompany=mismatched&&accountDecision?.choice==='rename_account';
    // Manager-only choices were authorised and audited when the manager saved the decision.
    // The assigned staff member can now finish the confirmed import without manager login.
    const [[max]]=await conn.execute(
      'SELECT COALESCE(MAX(version_no),0) n FROM viralco_import_versions WHERE account_id=:id',
      {id:account.id}
    );
    if(current)await conn.execute(
      'UPDATE viralco_import_versions SET is_current=0 WHERE account_id=:id AND is_current=1',{id:account.id});
    const stats={matched:0,updated:0,created:0,review:review.held+review.referred};
    const [v]=await conn.execute(
      'INSERT INTO viralco_import_versions '+
      '(account_id,version_no,provider_account_number,provider_company_name,previous_account_name,filename,file_hash,file_data,'+
      'line_count,matched_count,updated_count,created_count,review_count,omitted_count,published_by,name_approved_by) '+
      'VALUES (:accountId,:version,:providerAccount,:providerName,:oldName,:filename,:hash,:file,'+
      ':count,0,0,0,0,:omitted,:staff,:approvedBy)',
      {accountId:account.id,version:Number(max.n)+1,providerAccount:report.accountNumber,providerName:report.customerName,
        oldName:account.display_name||null,filename:preview.filename,hash:report.fileHash,file:preview.file_data,
        count:report.rows.length,omitted:checked.result.missingCount,staff:req.session.user.id,
        approvedBy:mismatched?accountDecision?.decided_by||req.session.user.id:null}
    );
    for(const row of checked.result.rows){
      let clientId=row.clientId,action='pending_new';
      const decision=decisions.get('line-'+row.sourceRow);
      const changedDecision=decisions.get('change-'+row.sourceRow);
      const before=row.previous?JSON.stringify(row.previous):null;
      let after=null;
      if(row.action==='update'||row.action==='unchanged'){
        stats.matched++;
        const keepExisting=changedDecision?.choice==='keep_crm';
        action=row.action==='update'&&!keepExisting?'updated':'unchanged';
        if(row.action==='update'&&!keepExisting){
          const [result]=await conn.execute(
            'UPDATE clients SET package_name=:pack, '+
            'next_upgrade_date=COALESCE(:nextDate,next_upgrade_date), '+
            'upgrade_date=COALESCE(:nextDate,upgrade_date), '+
            'previous_upgrade_date=COALESCE(:lastDate,previous_upgrade_date) '+
            'WHERE id=:clientId AND (account_id=:accountId OR account_number=:accountNumber)',
            {pack:row.packDesc,nextDate:row.earliestUpgradeDate,lastDate:row.lastUpgradeDate,
              clientId,accountId:account.id,accountNumber:account.account_number}
          );
          if(result.affectedRows!==1)throw new Error('A line changed ownership while importing. Nothing has been published.');
          stats.updated++;
        }
        after=JSON.stringify(keepExisting?row.previous:row.proposed);
      }else if(row.action==='new'&&decision?.choice==='create_line'){
        const [created]=await conn.execute(
          'INSERT INTO clients '+
          '(account_id,account_number,client_name,company_name,cell_number,cell_number_normalised,'+
          'customer_type,lifecycle_status,package_name,previous_upgrade_date,next_upgrade_date,upgrade_date,'+
          'line_status,is_active,source_system,raw_import_json,created_by_staff_id) '+
          'VALUES (:accountId,:accountNumber,:clientName,:companyName,:cell,:normal,"business","client",'+
          ':pack,:lastDate,:nextDate,:nextDate,"unknown",1,"ViralCo Subscriber Detailed Report",:raw,:staffId)',
          {accountId:account.id,accountNumber:account.account_number,
            clientName:row.subscriberName||report.customerName,companyName:report.customerName,
            cell:'0'+row.phone.slice(2),normal:row.phone,pack:row.packDesc,
            lastDate:row.lastUpgradeDate,nextDate:row.earliestUpgradeDate,
            raw:JSON.stringify({viralco:row,import_version:v.insertId}),staffId:req.session.user.id}
        );
        clientId=created.insertId;action='created';stats.created++;after=JSON.stringify(row.proposed);
        // A newly approved line inherits the verified account's existing owner.
        if(safeId(account.assigned_staff_id)){
          await conn.execute('INSERT INTO client_assignments '+
            '(client_id,account_number,assigned_staff_id,assigned_by,notes,is_active) '+
            'VALUES (:clientId,:accountNumber,:ownerId,:assignedBy,:notes,1)',
            {clientId,accountNumber:account.account_number,ownerId:account.assigned_staff_id,
              assignedBy:req.session.user.id,notes:'Approved new mobile line from ViralCo source report'}
          );
        }
      }else{
        if(row.action==='conflict')action='conflict';
        else if(row.action==='ambiguous')action='ambiguous';
      }
      await conn.execute(
        'INSERT INTO viralco_import_lines '+
        '(version_id,source_row,msisdn_original,phone_normalised,subscriber_name,invoice_name,sponsored_account,'+
        'activation_date,term_date,upgradable,earliest_upgrade_date,last_upgrade_date,pack_code,pack_desc,avg_spend,'+
        'loyalty_status,sim_number,dealer_id,line_status_code,matched_client_id,sync_action,old_crm_json,new_crm_json) '+
        'VALUES (:version,:sourceRow,:msisdn,:phone,:subscriber,:invoice,:sponsored,'+
        ':activation,:term,:upgradable,:earliest,:last,:packCode,:packDesc,:avgSpend,'+
        ':loyalty,:sim,:dealer,:code,:clientId,:action,:previous,:nextState)',
        {version:v.insertId,sourceRow:row.sourceRow,msisdn:row.msisdnOriginal,phone:row.phone,
          subscriber:row.subscriberName,invoice:row.invoiceName,sponsored:row.sponsoredAccount,
          activation:row.activationDate,term:row.termDate,upgradable:row.upgradable,
          earliest:row.earliestUpgradeDate,last:row.lastUpgradeDate,packCode:row.packCode,
          packDesc:row.packDesc,avgSpend:row.avgSpend,loyalty:row.loyaltyStatus,
          sim:row.simNumber,dealer:row.dealerId,code:row.lineStatusCode,clientId,action,
          previous:before,nextState:after}
      );
    }
    if(updateCompany){
      await conn.execute(
        'UPDATE customer_accounts SET display_name=:name WHERE id=:id',
        {name:report.customerName, id:account.id}
      );
    }
    await conn.execute(
      'UPDATE viralco_import_versions SET matched_count=:matched,updated_count=:updated,'+
      'created_count=:created,review_count=:review WHERE id=:id',
      {...stats,id:v.insertId}
    );
    await conn.execute(
      'UPDATE viralco_review_issues SET version_id=:version WHERE account_id=:accountId AND preview_id=:previewId',
      {version:v.insertId,accountId:account.id,previewId:preview.id}
    );
    await conn.execute('DELETE FROM viralco_import_previews WHERE id=:id',{id:preview.id});
    await conn.commit();conn.release();conn=null;
    return res.redirect(base(res,ctx.clientId)+'?message='+encodeURIComponent(
      'ViralCo import published: '+stats.updated+' updated, '+stats.created+' created, '+stats.review+' to review. Previous CRM history and imports were retained.'
    ));
  }catch(error){
    if(conn){try{await conn.rollback();}finally{conn.release();}}
    if(/preview|account|business|company|workbook|ownership|publish|line changed|importing|changed since/i.test(error.message||''))
      return deny(res,409,error.message);
    next(error);
  }
});
router.post('/customers/:id/viralco-sync/outstanding/:issueId',requireAuth,async(req,res,next)=>{
  let conn=null;
  try{
    const ctx=await contextFor(req,res);if(ctx.error)return;
    if(!validCsrf(req))return deny(res,403,'Session form expired.');
    const issueId=safeId(req.params.issueId);
    if(!issueId)return deny(res,400,'Invalid issue.');
    const choice=String(req.body.choice||''),note=String(req.body.note||'').trim();
    if(!['keep_crm','hold','refer_manager'].includes(choice)||!note||note.length>900)
      return deny(res,400,'Choose a permitted action and enter an explanation.');
    await ensureSchema(db);await ensureReviewSchema(db);
    conn=await db.getConnection();await conn.beginTransaction();
    const [[item]]=await conn.execute(
      'SELECT * FROM viralco_review_issues WHERE id=:id AND account_id=:accountId AND version_id IS NOT NULL FOR UPDATE',
      {id:issueId,accountId:ctx.account.id});
    if(!item)throw Error('Issue not found on this account.');
    if(!['held','referred'].includes(item.status))throw Error('The issue has already been resolved.');
    if(item.status==='referred'&&choice==='keep_crm'&&!loggedInManager(req.session.user))
      throw Object.assign(Error('Only management can close an issue referred to a manager.'),{statusCode:403});
    const status=choice==='keep_crm'?'resolved':choice==='hold'?'held':'referred';
    await conn.execute(
      'UPDATE viralco_review_issues SET choice=:choice,status=:status,note=:note,decided_by=:actor WHERE id=:id AND account_id=:accountId',
      {choice,status,note,actor:req.session.user.id,id:item.id,accountId:ctx.account.id});
    await conn.execute(
      'INSERT INTO viralco_review_audit (issue_id,account_id,preview_id,issue_key,previous_choice,new_choice,note,actor_id) '+
      'VALUES (:id,:accountId,:previewId,:key,:old,:choice,:note,:actor)',
      {id:item.id,accountId:ctx.account.id,previewId:item.preview_id,key:item.issue_key,
        old:item.choice,choice,note,actor:req.session.user.id});
    await conn.commit();conn.release();conn=null;
    return res.redirect(base(res,ctx.clientId)+'?message='+encodeURIComponent('Outstanding issue saved.')+'#viralco-outstanding');
  }catch(error){
    if(conn){try{await conn.rollback();}finally{conn.release();}}
    if(error.statusCode||/issue|account|resolved|manager/i.test(error.message||''))return deny(res,error.statusCode||409,error.message);
    next(error);
  }
});

router.get('/customers/:id/viralco-sync/download/:version',requireAuth,async(req,res,next)=>{
  try{
    const ctx=await contextFor(req,res);if(ctx.error)return;
    await ensureSchema(db);
    const version=safeId(req.params.version);
    if(!version)return deny(res,400,'Invalid report version.');
    const [[record]]=await db.execute(
      'SELECT version_no,file_data FROM viralco_import_versions WHERE id=:id AND account_id=:accountId LIMIT 1',
      {id:version,accountId:ctx.account.id}
    );
    if(!record)return deny(res,404,'That report does not belong to this customer account.');
    res.set('Cache-Control','private, no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Content-Disposition','attachment; filename="ViralCo-version-'+record.version_no+'.xlsx"');
    return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(record.file_data);
  }catch(error){next(error);}
});
module.exports=router;
