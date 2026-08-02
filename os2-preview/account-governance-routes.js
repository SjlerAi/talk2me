'use strict';

const express=require('express');
const {withTransaction}=require('./core/transaction');
const {requirePermission}=require('./core/permissions');
const {appendAudit}=require('./core/audit');

function positiveId(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null;}
function text(v,max=255){const s=String(v==null?'':v).trim();return s?s.slice(0,max):null;}
function normalise(v){return String(v||'').toUpperCase().replace(/[\s-]/g,'');}
function ctx(req){return {ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)};}
async function history(connection,o){await connection.execute(`INSERT INTO os2_account_history
(account_id,master_customer_id,event_type,before_json,after_json,reason,changed_by,created_at)
VALUES(:accountId,:customerId,:eventType,:beforeJson,:afterJson,:reason,:actor,NOW())`,{
accountId:o.accountId,customerId:o.customerId,eventType:o.eventType,beforeJson:o.before?JSON.stringify(o.before):null,afterJson:o.after?JSON.stringify(o.after):null,reason:o.reason||null,actor:o.actor});}

module.exports=function createAccountGovernanceRouter({pool,requireAuth}){
 const router=express.Router();
 router.use('/api/os2',requireAuth);
 router.get('/api/os2/customers/:id/accounts',requirePermission('account.read'),async(req,res)=>{
  const id=positiveId(req.params.id);if(!id)return res.status(400).json({ok:false,error:'INVALID_CUSTOMER_ID'});
  try{const [rows]=await pool.execute(`SELECT a.*,
   (SELECT COUNT(*) FROM os2_mobile_lines ml WHERE ml.account_id=a.id AND ml.archived_at IS NULL) mobile_line_count,
   (SELECT COUNT(*) FROM os2_fixed_accounts fa WHERE fa.account_id=a.id AND fa.archived_at IS NULL) fixed_account_count
   FROM os2_customer_accounts a WHERE a.master_customer_id=:id ORDER BY a.archived_at IS NULL DESC,a.is_primary DESC,a.account_number`,{id});
   res.json({ok:true,accounts:rows});}catch(e){res.status(500).json({ok:false,error:'ACCOUNTS_LOAD_FAILED'});}
 });
 router.post('/api/os2/customers/:id/accounts',requirePermission('account.create'),async(req,res)=>{
  const customerId=positiveId(req.params.id),accountNumber=text(req.body.accountNumber,100),normalised=normalise(accountNumber);
  if(!customerId||!accountNumber)return res.status(400).json({ok:false,error:'CUSTOMER_AND_ACCOUNT_REQUIRED'});
  try{const id=await withTransaction(pool,async c=>{
   const [[customer]]=await c.execute('SELECT id FROM os2_master_customers WHERE id=:id AND archived_at IS NULL FOR UPDATE',{id:customerId});
   if(!customer)throw Object.assign(new Error('CUSTOMER_NOT_FOUND'),{statusCode:404});
   const [[dup]]=await c.execute('SELECT id,master_customer_id FROM os2_customer_accounts WHERE normalised_account_number=:n AND archived_at IS NULL LIMIT 1 FOR UPDATE',{n:normalised});
   if(dup)throw Object.assign(new Error('ACCOUNT_NUMBER_ALREADY_EXISTS'),{statusCode:409,details:dup});
   const [[countRow]]=await c.execute('SELECT COUNT(*) total FROM os2_customer_accounts WHERE master_customer_id=:id AND archived_at IS NULL',{id:customerId});
   const isPrimary=Number(countRow.total||0)===0?1:(req.body.isPrimary?1:0);
   if(isPrimary)await c.execute('UPDATE os2_customer_accounts SET is_primary=0,updated_by=:actor,updated_at=NOW() WHERE master_customer_id=:id AND archived_at IS NULL',{actor:req.user.id,id:customerId});
   const [r]=await c.execute(`INSERT INTO os2_customer_accounts
   (master_customer_id,account_number,normalised_account_number,account_type,account_status,expected_line_count,is_primary,created_by,updated_by,created_at,updated_at)
   VALUES(:customerId,:accountNumber,:normalised,:accountType,'active',:lineCount,:isPrimary,:actor,:actor,NOW(),NOW())`,{
   customerId,accountNumber,normalised,accountType:text(req.body.accountType,50)||'standard',lineCount:positiveId(req.body.expectedLineCount),isPrimary,actor:req.user.id});
   const id=Number(r.insertId),after={accountNumber,normalised,accountType:text(req.body.accountType,50)||'standard',isPrimary};
   await history(c,{accountId:id,customerId,eventType:'created',after,actor:req.user.id});
   await appendAudit(c,{actorStaffId:req.user.id,actionType:'customer_account_created',entityType:'os2_customer_accounts',entityId:id,masterCustomerId:customerId,description:`Created customer account ${accountNumber}`,after,requestContext:ctx(req)});
   return id;});res.status(201).json({ok:true,accountId:id});
  }catch(e){res.status(e.statusCode||500).json({ok:false,error:e.statusCode?e.message:'ACCOUNT_CREATE_FAILED',details:e.details||null});}
 });
 router.patch('/api/os2/accounts/:id',requirePermission('account.update'),async(req,res)=>{
  const id=positiveId(req.params.id);if(!id)return res.status(400).json({ok:false,error:'INVALID_ACCOUNT_ID'});
  try{const result=await withTransaction(pool,async c=>{
   const [[a]]=await c.execute('SELECT * FROM os2_customer_accounts WHERE id=:id AND archived_at IS NULL FOR UPDATE',{id});
   if(!a)throw Object.assign(new Error('ACCOUNT_NOT_FOUND'),{statusCode:404});
   const accountNumber=text(req.body.accountNumber,100)||a.account_number,n=normalise(accountNumber);
   const [[dup]]=await c.execute('SELECT id FROM os2_customer_accounts WHERE normalised_account_number=:n AND id<>:id AND archived_at IS NULL LIMIT 1 FOR UPDATE',{n,id});
   if(dup)throw Object.assign(new Error('ACCOUNT_NUMBER_ALREADY_EXISTS'),{statusCode:409});
   const isPrimary=req.body.isPrimary==null?Number(a.is_primary):(req.body.isPrimary?1:0);
   if(isPrimary)await c.execute('UPDATE os2_customer_accounts SET is_primary=0,updated_by=:actor,updated_at=NOW() WHERE master_customer_id=:customerId AND id<>:id AND archived_at IS NULL',{actor:req.user.id,customerId:a.master_customer_id,id});
   const after={account_number:accountNumber,normalised_account_number:n,account_type:text(req.body.accountType,50)||a.account_type,account_status:text(req.body.accountStatus,30)||a.account_status,expected_line_count:req.body.expectedLineCount==null?a.expected_line_count:Number(req.body.expectedLineCount),is_primary:isPrimary};
   await c.execute(`UPDATE os2_customer_accounts SET account_number=:account_number,normalised_account_number=:normalised_account_number,
   account_type=:account_type,account_status=:account_status,expected_line_count=:expected_line_count,is_primary=:is_primary,updated_by=:actor,updated_at=NOW() WHERE id=:id`,{...after,actor:req.user.id,id});
   await history(c,{accountId:id,customerId:a.master_customer_id,eventType:'updated',before:a,after,actor:req.user.id});
   await appendAudit(c,{actorStaffId:req.user.id,actionType:'customer_account_updated',entityType:'os2_customer_accounts',entityId:id,masterCustomerId:a.master_customer_id,description:`Updated customer account ${accountNumber}`,before:a,after,requestContext:ctx(req)});
   return {accountId:id};});res.json({ok:true,...result});
  }catch(e){res.status(e.statusCode||500).json({ok:false,error:e.statusCode?e.message:'ACCOUNT_UPDATE_FAILED'});}
 });
 router.post('/api/os2/accounts/:id/archive',requirePermission('account.update'),async(req,res)=>{
  const id=positiveId(req.params.id),reason=text(req.body.reason,1000);if(!id)return res.status(400).json({ok:false,error:'INVALID_ACCOUNT_ID'});if(!reason)return res.status(400).json({ok:false,error:'ARCHIVE_REASON_REQUIRED'});
  try{const out=await withTransaction(pool,async c=>{
   const [[a]]=await c.execute('SELECT * FROM os2_customer_accounts WHERE id=:id AND archived_at IS NULL FOR UPDATE',{id});
   if(!a)throw Object.assign(new Error('ACCOUNT_NOT_FOUND'),{statusCode:404});
   const [[usage]]=await c.execute(`SELECT
   (SELECT COUNT(*) FROM os2_mobile_lines WHERE account_id=:id AND archived_at IS NULL AND line_status<>'cancelled') mobile,
   (SELECT COUNT(*) FROM os2_fixed_accounts WHERE account_id=:id AND archived_at IS NULL AND status='active') fixed_accounts`,{id});
   if(Number(usage.mobile||0)>0||Number(usage.fixed_accounts||0)>0)throw Object.assign(new Error('ACCOUNT_HAS_ACTIVE_SERVICES'),{statusCode:409,details:usage});
   await c.execute(`UPDATE os2_customer_accounts SET account_status='archived',archived_at=NOW(),archive_reason=:reason,archived_by=:actor,is_primary=0,updated_by=:actor,updated_at=NOW() WHERE id=:id`,{reason,actor:req.user.id,id});
   if(Number(a.is_primary)===1){const [[replacement]]=await c.execute('SELECT id FROM os2_customer_accounts WHERE master_customer_id=:customerId AND id<>:id AND archived_at IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE',{customerId:a.master_customer_id,id});if(replacement)await c.execute('UPDATE os2_customer_accounts SET is_primary=1,updated_by=:actor,updated_at=NOW() WHERE id=:id',{actor:req.user.id,id:replacement.id});}
   await history(c,{accountId:id,customerId:a.master_customer_id,eventType:'archived',before:a,after:{account_status:'archived'},reason,actor:req.user.id});
   await appendAudit(c,{actorStaffId:req.user.id,actionType:'customer_account_archived',entityType:'os2_customer_accounts',entityId:id,masterCustomerId:a.master_customer_id,description:`Archived customer account ${a.account_number}`,before:a,after:{reason},requestContext:ctx(req)});
   return {accountId:id};});res.json({ok:true,...out});
  }catch(e){res.status(e.statusCode||500).json({ok:false,error:e.statusCode?e.message:'ACCOUNT_ARCHIVE_FAILED',details:e.details||null});}
 });
 router.get('/api/os2/accounts/:id/history',requirePermission('account.read'),async(req,res)=>{const id=positiveId(req.params.id);if(!id)return res.status(400).json({ok:false,error:'INVALID_ACCOUNT_ID'});try{const [rows]=await pool.execute(`SELECT h.*,s.full_name changed_by_name FROM os2_account_history h LEFT JOIN staff_users s ON s.id=h.changed_by WHERE h.account_id=:id ORDER BY h.created_at DESC LIMIT 250`,{id});res.json({ok:true,history:rows});}catch(e){res.status(500).json({ok:false,error:'ACCOUNT_HISTORY_LOAD_FAILED'});}});
 return router;
};