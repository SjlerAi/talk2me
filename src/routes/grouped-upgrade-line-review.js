'use strict';

const express=require('express');
const crypto=require('crypto');
const db=require('../config/db');
const {requireOwner}=require('../middleware/auth');
const resolver=require('../services/grouped-upgrade-resolver');
const customers=require('../services/grouped-upgrade-customer-resolver');
const router=express.Router();

const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const inputText=(value,max=1500)=>String(value==null?'':value).trim().slice(0,max);
const phoneKey=value=>{
  let digits=String(value||'').replace(/\D/g,'');
  if(digits.startsWith('27')&&digits.length===11)digits='0'+digits.slice(2);
  return digits;
};
const accountKey=value=>inputText(value,100).toUpperCase().replace(/[^A-Z0-9]/g,'');
const normalMobile=number=>/^0(?:6\d|7\d|8[1-5])\d{7}$/.test(phoneKey(number));

function tokenFor(req){
  if(!req.session.gaReviewCsrfToken)req.session.gaReviewCsrfToken=crypto.randomBytes(24).toString('hex');
  return req.session.gaReviewCsrfToken;
}
function validToken(req){
  const received=Buffer.from(String(req.body?.csrf_token||''));
  const stored=Buffer.from(String(req.session.gaReviewCsrfToken||''));
  return stored.length===48&&received.length===48&&crypto.timingSafeEqual(stored,received);
}
function reviewLink(req,res,id,message=''){
  const base=res.locals.basePath??'/talk2me';
  const params=new URLSearchParams({...(String(req.body?.panel||'')==='1'?{panel:'1'}:{}),...(message?{message}:{})});
  return base+'/grouped-upgrade-accounts/line/'+id+'/review?'+params.toString();
}
const errorPage=(res,msg,code=400)=>res.status(code).render('error',{title:'Grouped line review',message:msg});

async function getLine(id,conn=db,lock=false){
  const sql="SELECT l.*,g.account_number,g.account_name,g.crm_account_id,g.review_status AS account_review_status,"+
    "g.source_names_json,g.source_row_numbers,g.line_count AS source_line_count,g.id AS group_id,b.source_name,b.source_upgrade_label,b.tariff_description,b.eligible_at,"+
    "a.task_id AS black_friday_task_id "+
    "FROM ga26_lines l JOIN ga26_accounts g ON g.id=l.ga_account_id "+
    "JOIN ga26_batches s ON s.id=l.batch_id "+
    "LEFT JOIN bf26_contacts b ON b.id=l.bf_contact_id LEFT JOIN bf26_actions a ON a.contact_id=l.bf_contact_id "+
    "WHERE l.id=? AND l.batch_id=(SELECT MAX(id) FROM ga26_batches) LIMIT 1"+(lock?' FOR UPDATE':'');
  const [[line]]=await conn.execute(sql,[id]);
  return line||null;
}
async function candidates(line,conn=db){
  const domestic=phoneKey(line.phone),international='27'+domestic.slice(1);
  const numbers=[domestic,international,'+'+international];
  const [clients]=await conn.query("SELECT id,account_id,account_number,client_name,email,cell_number,cell_number_normalised,is_active,package_name,next_upgrade_date "+
    "FROM clients WHERE cell_number_normalised IN (?,?,?) OR cell_number IN (?,?,?) "+
    "ORDER BY is_active DESC,id LIMIT 40",[...numbers,...numbers]);
  const [base]=await conn.query("SELECT id,account_id,account_code,account_code_core,msisdn_original,msisdn_normalised,contract_status,eligible_upgrade_flag,client_id "+
    "FROM mobile_base_current WHERE msisdn_normalised IN (?,?,?) OR msisdn_original IN (?,?,?) "+
    "ORDER BY id LIMIT 40",[...numbers,...numbers]);
  const [[account]]=line.crm_account_id?await conn.execute("SELECT id,account_number,display_name,assigned_staff_id FROM customer_accounts WHERE id=?",[line.crm_account_id]):[[null]];
  return {clients,base,account};
}
function mayApproveMobile(line,matched){
  if(!normalMobile(line.phone))return {allowed:false,reason:'This telephone number does not have a conventional South African mobile prefix. Classify it as another service instead.'};
  if(!line.account_number||!line.crm_account_id||!matched.account)return {allowed:false,reason:'A verified existing CRM account number is required before approving this as a mobile line.'};
  if(accountKey(line.account_number)!==accountKey(matched.account.account_number))return {allowed:false,reason:'The grouped import and actual CRM account numbers differ.'};
  if(['missing_account_number','conflicting_account_names'].includes(line.account_review_status))return {allowed:false,reason:'The account has an unresolved missing number or conflicting names.'};
  if(['existing_line_other_account','duplicate_crm_line_review','missing_account_number','conflicting_source_account_names'].includes(line.line_status))return {allowed:false,reason:'A duplicate, wrong account or source-name conflict must be resolved first.'};
  if(line.base_status==='base_account_conflict')return {allowed:false,reason:'The original mobile-base account conflicts with the source account.'};
  const account=accountKey(line.account_number);
  for(const client of matched.clients){
    if(client.account_id&&Number(client.account_id)!==Number(line.crm_account_id))
      return {allowed:false,reason:'An existing CRM customer is linked to another account.'};
    if(client.account_number&&accountKey(client.account_number)!==account)
      return {allowed:false,reason:'An existing CRM customer has a different account number.'};
  }
  for(const base of matched.base){
    if(base.account_code_core&&accountKey(base.account_code_core)!==account)
      return {allowed:false,reason:'A matching mobile-base line is linked to another account.'};
    if(base.account_id&&Number(base.account_id)!==Number(line.crm_account_id))
      return {allowed:false,reason:'The mobile-base line has another account ID.'};
  }
  if(matched.clients.length>1||matched.base.length>1)
    return {allowed:false,reason:'There are multiple matches for this telephone number; choose the correct record in the duplicate review workflow first.'};
  return {allowed:true,reason:'Number and account pass automated checks. Management must still confirm the source information before approving.'};
}

router.get('/grouped-upgrade-accounts/line/:id/review',requireOwner,async(req,res,next)=>{
  try{
    const id=positive(req.params.id);if(!id)return errorPage(res,'Invalid line identifier.',404);
    const line=await getLine(id);if(!line)return errorPage(res,'Line not found in the current grouped import.',404);
    const matched=await candidates(line);
    const [siblings]=await db.execute('SELECT id,phone,review_required,review_state,service_type FROM ga26_lines WHERE ga_account_id=? AND batch_id=? ORDER BY id',[line.group_id,line.batch_id]);
    const [history]=await db.execute("SELECT h.*,s.full_name reviewer_name FROM ga26_line_review_history h "+
      "LEFT JOIN staff_users s ON s.id=h.reviewer_id WHERE h.line_id=? ORDER BY h.id DESC LIMIT 25",[id]);
    const [sourceLines]=line.bf_contact_id?await db.execute("SELECT source_excel_row,source_payload FROM bf26_lines WHERE contact_id=? ORDER BY source_excel_row",[line.bf_contact_id]):[[]];
    const sources=sourceLines.map(s=>{try{return {row:s.source_excel_row,data:JSON.parse(s.source_payload)}}catch(_){return {row:s.source_excel_row,data:{}}}});
    const approval=mayApproveMobile(line,matched);
    const suggestions=await resolver.accountSuggestions(line,matched,req.query.account_search);
    const sourceNames=[...new Set([matched.account?.display_name,...JSON.parse(line.source_names_json||'[]')].filter(Boolean))];
    const customerGroup=await customers.getGroup(db,line.group_id);
    const clientSearch=inputText(req.query.client_search,100);
    const [nearClients,eligibleStaff]=await Promise.all([
      customers.findCustomerMatches(customerGroup,line,clientSearch),customers.getStaff()
    ]);
    return res.render('grouped-upgrade-line-review',{title:'Resolve telephone-line conflict',
      line,matched,siblings,history,sources,approval,suggestions,sourceNames,customerGroup,
      sourceLine:line,nearClients,eligibleStaff,clientSearch,
      accountSearch:inputText(req.query.account_search,70),resolverMobile:resolver.normalMobile(line.phone),csrfToken:tokenFor(req),flash:inputText(req.query.message,250),error:inputText(req.query.error,500)});
  }catch(e){next(e)}
});

// Redirect outdated cached review forms to the new one-click resolution screen.
// They must not update only a status flag while leaving a real conflict unresolved.
router.post('/grouped-upgrade-accounts/line/:id/review',requireOwner,(req,res)=>{
  const id=positive(req.params.id);
  if(!id)return errorPage(res,'Invalid telephone line.',404);
  const params=new URLSearchParams({
    ...(String(req.body?.panel||'')==='1'?{panel:'1'}:{}),
    error:'The review screen has been updated. Choose the correct record or account and click Update.'
  });
  return res.redirect(303,(res.locals.basePath??'/talk2me')+'/grouped-upgrade-accounts/line/'+id+'/review?'+params.toString());
});

router.post('/grouped-upgrade-accounts/line/:id/resolve',requireOwner,async(req,res,next)=>{
  const id=positive(req.params.id);
  if(!id)return errorPage(res,'Invalid line identifier.',404);
  if(!validToken(req))return errorPage(res,'Please refresh the review screen and select the correction again.',403);
  const action=inputText(req.body.action,40);
  const userId=positive(req.session.user?.id);
  if(!userId)return errorPage(res,'The CRM owner session has expired.',403);
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const result=await resolver.applyResolution(conn,{
      lineId:id,action,values:req.body,userId,
      ip:req.ip||'',userAgent:req.get('user-agent')||''
    });
    await conn.commit();
    const params=new URLSearchParams({
      mode:'review',...(String(req.body.panel)==='1'?{panel:'1'}:{}),
      message:result.message
    });
    return res.redirect((res.locals.basePath??'/talk2me')+'/grouped-upgrade-accounts?'+params.toString());
  }catch(e){
    try{await conn.rollback()}catch(_){}
    if(e instanceof resolver.ResolutionBlocked){
      const params=new URLSearchParams({
        ...(String(req.body.panel)==='1'?{panel:'1'}:{}),error:e.message
      });
      return res.redirect((res.locals.basePath??'/talk2me')+'/grouped-upgrade-accounts/line/'+id+'/review?'+params.toString());
    }
    return next(e);
  }finally{conn.release()}
});
router.get('/grouped-upgrade-accounts/account/:id/customer',requireOwner,async(req,res,next)=>{
  try{
    const groupId=positive(req.params.id);
    if(!groupId)return errorPage(res,'Invalid imported business account.',404);
    const customerGroup=await customers.getGroup(db,groupId);
    const clientSearch=inputText(req.query.client_search,100);
    const accountSearch=inputText(req.query.account_search,80);
    const [nearClients,eligibleStaff,relatedLines,linkedCustomers,accountSuggestions]=await Promise.all([
      customers.findCustomerMatches(customerGroup,null,clientSearch),
      customers.getStaff(),
      db.execute('SELECT id,phone,review_required,review_state FROM ga26_lines WHERE ga_account_id=? ORDER BY id LIMIT 60',[groupId]).then(r=>r[0]),
      db.execute('SELECT c.id,c.client_name,c.cell_number,c.account_number FROM ga26_account_client_links g JOIN clients c ON c.id=g.client_id WHERE g.ga_account_id=? ORDER BY c.id DESC LIMIT 30',[groupId]).then(r=>r[0]),
      resolver.accountSuggestions({crm_account_id:customerGroup.crm_account_id,account_name:customerGroup.account_name},
        {clients:[],base:[]},accountSearch)
    ]);
    return res.render('grouped-upgrade-customer',{title:'Find or create correct customer',
      customerGroup,sourceLine:null,nearClients,eligibleStaff,relatedLines,linkedCustomers,accountSuggestions,
      accountSearch,clientSearch,csrfToken:tokenFor(req),flash:inputText(req.query.message,350),
      error:inputText(req.query.error,500)});
  }catch(e){next(e)}
});
async function customerUpdate(req,res,next,fromLine){
  const id=positive(req.params.id);
  if(!id)return errorPage(res,'Invalid imported line or business account.',404);
  if(!validToken(req))return errorPage(res,'Refresh the page and choose the correction again.',403);
  const userId=positive(req.session.user?.id);
  if(!userId)return errorPage(res,'Your login session has expired.',403);
  const root=(res.locals.basePath??'/talk2me')+'/grouped-upgrade-accounts';
  const returnPath=fromLine?root+'/line/'+id+'/review':root+'/account/'+id+'/customer';
  const action=inputText(req.body.action,40);
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    let result;
    if(!fromLine&&['create_group_account','select_group_account'].includes(action)){
      result=await customers.applyVerifiedBusinessAccount(conn,{groupId:id,action,
        values:req.body,userId,ip:req.ip||'',userAgent:req.get('user-agent')||''});
    }else{
      const line=fromLine?await getLine(id,conn,true):null;
      if(fromLine&&!line)throw new resolver.ResolutionBlocked('The imported telephone line no longer exists.');
      result=await customers.applyCustomerResolution(conn,{
        groupId:line?.group_id||id,lineId:line?.id||null,action,values:req.body,userId,
        ip:req.ip||'',userAgent:req.get('user-agent')||''
      });
    }
    await conn.commit();
    const params=new URLSearchParams({
      ...(String(req.body.panel)==='1'?{panel:'1'}:{}),message:result.message
    });
    return res.redirect(303,returnPath+'?'+params.toString());
  }catch(e){
    try{await conn.rollback()}catch(_){}
    if(e instanceof resolver.ResolutionBlocked){
      const params=new URLSearchParams({
        ...(String(req.body.panel)==='1'?{panel:'1'}:{}),error:e.message
      });
      return res.redirect(303,returnPath+'?'+params.toString());
    }
    if(e?.code==='ER_DUP_ENTRY'){
      const params=new URLSearchParams({error:'This customer, account or telephone number was already recorded. Refresh the page and select the existing entry.'});
      return res.redirect(303,returnPath+'?'+params.toString());
    }
    return next(e);
  }finally{conn.release()}
}
router.post('/grouped-upgrade-accounts/line/:id/customer',requireOwner,(req,res,next)=>
  customerUpdate(req,res,next,true));
router.post('/grouped-upgrade-accounts/account/:id/customer',requireOwner,(req,res,next)=>
  customerUpdate(req,res,next,false));

module.exports=router;
