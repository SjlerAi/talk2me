'use strict';

// UAT-only business account quarterly workbook workflow; never alters clients or assignments.
const express=require('express');
const multer=require('multer');
const crypto=require('crypto');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {normaliseSouthAfricanMobile}=require('../services/sa-phone-normalisation');
const {
  FILE_LIMIT,parseQuarterlySheet,compareQuarterlyRows,ensureQuarterlySheetSchema
}=require('../services/quarterly-account-sheet');

const router=express.Router();
const manageRoles=new Set(['owner','manager','admin']);
const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:FILE_LIMIT,files:1,fields:4},
  fileFilter(req,file,done){
    if(!/\.xlsx$/i.test(String(file.originalname||'')))return done(new Error('Choose an .xlsx Excel file.'));
    done(null,true);
  }
}).single('sheet');

function id(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function csrf(req) {
  if(!req.session.businessSheetCsrf)req.session.businessSheetCsrf=crypto.randomBytes(32).toString('hex');
  return req.session.businessSheetCsrf;
}
function validCsrf(req){
  const actual=String(req.body?.sheet_csrf||''),stored=String(req.session.businessSheetCsrf||'');
  if(!/^[a-f0-9]{64}$/.test(actual)||actual.length!==stored.length)return false;
  return crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(stored));
}
function fail(res,status,message) {
  return res.status(status).render('error',{title:'Business account sheet',message});
}
const base=(res,clientId)=>res.locals.basePath+'/customers/'+clientId+'/business-sheet';

async function resolveAccount(clientId) {
  const [[client]]=await db.execute(
    'SELECT id,client_name,account_id,account_number FROM clients WHERE id=:id LIMIT 1',
    {id:clientId}
  );
  if(!client)return null;
  let account;
  if(client.account_id){
    [[account]]=await db.execute('SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE id=:id LIMIT 1',{id:client.account_id});
  }
  if(!account&&client.account_number){
    [[account]]=await db.execute(
      'SELECT id,account_number,account_number_normalised,display_name,assigned_staff_id FROM customer_accounts WHERE account_number_normalised=UPPER(REPLACE(TRIM(:number)," ","")) LIMIT 1',
      {number:client.account_number}
    );
  }
  return {client,account:account||null};
}
async function isAllowed(user,account) {
  if(manageRoles.has(String(user.role||'').toLowerCase()))return true;
  const userId=id(user.id);
  if(!userId||!account)return false;
  if(Number(account.assigned_staff_id)===userId)return true;
  const [[match]]=await db.execute(
    'SELECT ca.id FROM client_assignments ca LEFT JOIN clients c ON c.id=ca.client_id '+
    'WHERE ca.is_active=1 AND ca.assigned_staff_id=:userId '+
    'AND ((ca.account_number IS NOT NULL AND UPPER(REPLACE(TRIM(ca.account_number)," ",""))=:normal) '+
    'OR c.account_id=:accountId '+
    'OR (c.account_number IS NOT NULL AND UPPER(REPLACE(TRIM(c.account_number)," ",""))=:normal)) LIMIT 1',
    {userId,accountId:account.id,normal:account.account_number_normalised}
  );
  return !!match;
}
async function authorised(req,res) {
  const clientId=id(req.params.id);
  if(!clientId)return {error:fail(res,400,'Invalid customer identifier.')};
  const context=await resolveAccount(clientId);
  if(!context)return {error:fail(res,404,'The selected customer was not found.')};
  if(!context.account)return {error:fail(res,422,'Please first connect this customer to an official CRM account number. Quarterly sheets belong to an account, not an arbitrary customer line.')};
  if(!await isAllowed(req.session.user,context.account))return {error:fail(res,403,'Only assigned account staff or management can access business account sheets.')};
  return {clientId,...context};
}
function fileName(value) {
  return String(value||'business-account.xlsx').replace(/[\/\\\x00-\x1f]/g,'').slice(0,180)||'business-account.xlsx';
}
async function loadVersions(accountId) {
  const [rows]=await db.execute(
    'SELECT v.id,v.version_no,v.filename,v.file_hash,v.line_count,v.matched_count,v.unmatched_count,v.uploaded_at,v.is_current,v.restored_from_id,'+
    's.full_name uploaded_by_name FROM business_account_sheet_versions v LEFT JOIN staff_users s ON s.id=v.uploaded_by '+
    'WHERE v.account_id=:accountId ORDER BY v.version_no DESC LIMIT 75',
    {accountId}
  );
  return rows;
}
async function loadLines(versionId,page) {
  if(!versionId)return {rows:[],total:0};
  const [[sum]]=await db.execute('SELECT COUNT(*) total FROM business_account_sheet_lines WHERE version_id=:versionId',{versionId});
  const [rows]=await db.execute(
    'SELECT source_row,phone_original,phone_normalised,package_name,'+
    'DATE_FORMAT(upgrade_date_sheet,"%Y-%m-%d") upgrade_date_sheet,'+
    'DATE_FORMAT(end_date_sheet,"%Y-%m-%d") end_date_sheet,usage_text,current_cost,matched_client_id,match_status '+
    'FROM business_account_sheet_lines WHERE version_id=:versionId ORDER BY source_row LIMIT :take OFFSET :offset',
    {versionId,take:75,offset:(page-1)*75}
  );
  return {rows,total:Number(sum?.total||0)};
}
async function oldSheetRows(versionId) {
  if(!versionId)return [];
  const [rows]=await db.execute(
    'SELECT phone_normalised phone,package_name packageName,'+
    'DATE_FORMAT(upgrade_date_sheet,"%Y-%m-%d") upgradeDate,'+
    'DATE_FORMAT(end_date_sheet,"%Y-%m-%d") endDate,usage_text `usage`,current_cost currentCost '+
    'FROM business_account_sheet_lines WHERE version_id=:versionId',{versionId}
  );
  return rows.map(r=>({...r,currentCost:r.currentCost==null?null:Number(r.currentCost)}));
}
async function matchClients(account,rows) {
  // Only link to existing lines on THIS account. Never move/create/update CRM lines.
  const [lines]=await db.execute(
    'SELECT id,cell_number,cell_number_normalised FROM clients '+
    'WHERE account_id=:accountId OR (account_number IS NOT NULL AND UPPER(REPLACE(TRIM(account_number)," ",""))=:normal)',
    {accountId:account.id,normal:account.account_number_normalised}
  );
  const byPhone=new Map();
  for(const line of lines){
    const phone=line.cell_number_normalised||normaliseSouthAfricanMobile(line.cell_number);
    if(!phone)continue;
    const hits=byPhone.get(phone)||[];
    hits.push(Number(line.id));byPhone.set(phone,hits);
  }
  return rows.map(row=>{
    const matches=byPhone.get(row.phone)||[];
    return {...row,matchedClientId:matches.length===1?matches[0]:null,
      matchStatus:matches.length===1?'matched':matches.length?'ambiguous':'not_found'};
  });
}
async function draw(req,res,ctx,{message=null,error=null,previewId=null}={}) {
  await ensureQuarterlySheetSchema(db);
  const versions=await loadVersions(ctx.account.id);
  const current=versions.find(v=>Number(v.is_current)===1)||null;
  const page=Math.max(1,Math.min(10000,Number.parseInt(String(req.query.page||1),10)||1));
  const list=await loadLines(current?.id,page);
  let preview=null;
  if(previewId){
    const [[staged]]=await db.execute(
      'SELECT id,filename,file_hash,sheet_json,expires_at FROM business_account_sheet_previews '+
      'WHERE id=:id AND account_id=:accountId AND uploaded_by=:userId AND expires_at>NOW() LIMIT 1',
      {id:previewId,accountId:ctx.account.id,userId:req.session.user.id}
    );
    if(!staged)error='This upload preview has expired. Select the workbook again.';
    else {
      const parsed=JSON.parse(staged.sheet_json);
      const annotated=await matchClients(ctx.account,parsed.rows);
      const previous=await oldSheetRows(current?.id);
      preview={
        id:staged.id,filename:staged.filename,hash:staged.file_hash,
        sheetName:parsed.sheetName,headers:parsed.headers,lines:annotated.slice(0,50),
        rowCount:annotated.length,
        matched:annotated.filter(row=>row.matchStatus==='matched').length,
        unmatched:annotated.filter(row=>row.matchStatus!=='matched').length,
        differences:compareQuarterlyRows(previous,parsed.rows)
      };
    }
  }
  return res.render('business-account-sheet',{
    title:'Business Account Quarterly Sheet',client:ctx.client,account:ctx.account,
    versions,current,lines:list.rows,totalRows:list.total,page,pageCount:Math.max(1,Math.ceil(list.total/75)),
    csrfToken:csrf(req),preview,message,error,
    canRestore:manageRoles.has(String(req.session.user.role||'').toLowerCase())
  });
}
router.get('/customers/:id/business-sheet',requireAuth,async(req,res,next)=>{
  try{
    const ctx=await authorised(req,res);if(ctx.error)return;
    return await draw(req,res,ctx,{message:String(req.query.message||'').slice(0,160),previewId:String(req.query.preview||'').slice(0,36)});
  }catch(error){next(error);}
});
router.post('/customers/:id/business-sheet/preview',requireAuth,(req,res,next)=>{
  upload(req,res,async uploadError=>{
    if(uploadError)return fail(res,400,uploadError.code==='LIMIT_FILE_SIZE'?'Excel file exceeds 4 MB.':uploadError.message);
    try {
      const ctx=await authorised(req,res);if(ctx.error)return;
      if(!validCsrf(req))return fail(res,403,'Your session form expired. Reopen the business account sheet and retry.');
      if(!req.file)return fail(res,400,'Select an .xlsx spreadsheet before uploading.');
      const parsed=parseQuarterlySheet(req.file.buffer,req.file.originalname);
      await ensureQuarterlySheetSchema(db);
      // Remove only expired previews for this uploader/account; never touch saved versions.
      await db.execute('DELETE FROM business_account_sheet_previews WHERE account_id=:accountId AND uploaded_by=:userId AND expires_at<NOW()',
        {accountId:ctx.account.id,userId:req.session.user.id});
      const id=crypto.randomUUID();
      await db.execute(
        'INSERT INTO business_account_sheet_previews '+
        '(id,account_id,client_id,uploaded_by,filename,file_hash,sheet_json,file_data,expires_at) '+
        'VALUES (:id,:accountId,:clientId,:userId,:filename,:hash,:json,:file,DATE_ADD(NOW(),INTERVAL 45 MINUTE))',
        {id,accountId:ctx.account.id,clientId:ctx.clientId,userId:req.session.user.id,
          filename:fileName(req.file.originalname),hash:parsed.fileHash,
          json:JSON.stringify({sheetName:parsed.sheetName,headers:parsed.headers,rows:parsed.rows}),file:req.file.buffer}
      );
      return res.redirect(base(res,ctx.clientId)+'?preview='+encodeURIComponent(id));
    }catch(error){
      if(/not supported|No data|Correct these Excel|Excel|workbook|worksheet|ZIP|date|duplicate/i.test(error.message||''))return fail(res,400,error.message);
      next(error);
    }
  });
});
router.post('/customers/:id/business-sheet/confirm',requireAuth,async(req,res,next)=>{
  let connection;
  try{
    const ctx=await authorised(req,res);if(ctx.error)return;
    if(!validCsrf(req))return fail(res,403,'Your form has expired. Return to the sheet preview.');
    if(String(req.body.replace_current||'')!=='yes')return fail(res,400,'Confirm that you want to publish this sheet as the current account version.');
    const token=String(req.body.preview_id||'');
    if(!/^[a-f0-9-]{36}$/i.test(token))return fail(res,400,'Invalid preview. Please upload again.');
    await ensureQuarterlySheetSchema(db);
    connection=await db.getConnection();
    await connection.beginTransaction();
    const [[account]]=await connection.execute('SELECT id FROM customer_accounts WHERE id=:id FOR UPDATE',{id:ctx.account.id});
    if(!account)throw new Error('The selected account no longer exists.');
    const [[staged]]=await connection.execute(
      'SELECT * FROM business_account_sheet_previews WHERE id=:id AND account_id=:accountId '+
      'AND uploaded_by=:userId AND expires_at>NOW() FOR UPDATE',
      {id:token,accountId:ctx.account.id,userId:req.session.user.id}
    );
    if(!staged)throw new Error('Preview expired or already published. Upload the sheet again.');
    const parsed=parseQuarterlySheet(staged.file_data,staged.filename);
    if(parsed.fileHash!==staged.file_hash)throw new Error('The uploaded workbook changed. Please upload it again.');
    const [[current]]=await connection.execute(
      'SELECT id,version_no,file_hash FROM business_account_sheet_versions WHERE account_id=:accountId AND is_current=1 ORDER BY version_no DESC LIMIT 1 FOR UPDATE',
      {accountId:ctx.account.id}
    );
    if(current&&current.file_hash===parsed.fileHash){
      await connection.execute('DELETE FROM business_account_sheet_previews WHERE id=:id',{id:token});
      await connection.commit();connection.release();connection=null;
      return res.redirect(base(res,ctx.clientId)+'?message='+encodeURIComponent('This identical workbook is already the current version.'));
    }
    const [[max]]=await connection.execute(
      'SELECT COALESCE(MAX(version_no),0) maxVersion FROM business_account_sheet_versions WHERE account_id=:accountId',
      {accountId:ctx.account.id}
    );
    const annotated=await matchClients(ctx.account,parsed.rows);
    if(current)await connection.execute('UPDATE business_account_sheet_versions SET is_current=0 WHERE account_id=:accountId AND is_current=1',{accountId:ctx.account.id});
    const [insert]=await connection.execute(
      'INSERT INTO business_account_sheet_versions '+
      '(account_id,version_no,filename,file_hash,file_data,sheet_name,headers_json,line_count,matched_count,unmatched_count,uploaded_by) '+
      'VALUES (:accountId,:version,:filename,:hash,:file,:sheet,:headers,:count,:matched,:unmatched,:userId)',
      {accountId:ctx.account.id,version:Number(max.maxVersion)+1,filename:staged.filename,
        hash:parsed.fileHash,file:staged.file_data,sheet:parsed.sheetName,headers:JSON.stringify(parsed.headers),
        count:annotated.length,matched:annotated.filter(r=>r.matchStatus==='matched').length,
        unmatched:annotated.filter(r=>r.matchStatus!=='matched').length,userId:req.session.user.id}
    );
    const chunkSize=80;
    for(let start=0;start<annotated.length;start+=chunkSize){
      const chunk=annotated.slice(start,start+chunkSize),bind=[];
      for(const row of chunk)bind.push(insert.insertId,row.sourceRow,row.number,row.phone,row.packageName,row.upgradeDate,row.endDate,row.usage,row.currentCost,row.matchedClientId,row.matchStatus,JSON.stringify(row.rawFields));
      await connection.query(
        'INSERT INTO business_account_sheet_lines '+
        '(version_id,source_row,phone_original,phone_normalised,package_name,upgrade_date_sheet,end_date_sheet,usage_text,current_cost,matched_client_id,match_status,raw_json) VALUES '+
        chunk.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?)').join(','),bind
      );
    }
    await connection.execute('DELETE FROM business_account_sheet_previews WHERE id=:id',{id:token});
    await connection.commit();connection.release();connection=null;
    return res.redirect(base(res,ctx.clientId)+'?message='+encodeURIComponent('New quarterly sheet published. Previous versions remain available.'));
  }catch(error){
    if(connection){try{await connection.rollback();}finally{connection.release();}}
    if(/Preview expired|selected account no longer|uploaded workbook changed/i.test(error.message||''))return fail(res,409,error.message);
    next(error);
  }
});
router.post('/customers/:id/business-sheet/restore/:version',requireAuth,async(req,res,next)=>{
  let connection;
  try{
    const ctx=await authorised(req,res);if(ctx.error)return;
    if(!manageRoles.has(String(req.session.user.role||'').toLowerCase()))return fail(res,403,'Only a manager or owner can restore an earlier workbook.');
    if(!validCsrf(req))return fail(res,403,'Your form has expired.');
    const versionId=id(req.params.version);if(!versionId)return fail(res,400,'Invalid version.');
    await ensureQuarterlySheetSchema(db);
    connection=await db.getConnection();await connection.beginTransaction();
    await connection.execute('SELECT id FROM customer_accounts WHERE id=:id FOR UPDATE',{id:ctx.account.id});
    const [[older]]=await connection.execute(
      'SELECT * FROM business_account_sheet_versions WHERE id=:id AND account_id=:accountId FOR UPDATE',
      {id:versionId,accountId:ctx.account.id}
    );
    if(!older)throw new Error('The previous sheet could not be found on this account.');
    if(Number(older.is_current)===1){
      await connection.rollback();connection.release();connection=null;
      return res.redirect(base(res,ctx.clientId)+'?message=This+version+is+already+current.');
    }
    const [[maximum]]=await connection.execute(
      'SELECT COALESCE(MAX(version_no),0) maxVersion FROM business_account_sheet_versions WHERE account_id=:accountId',
      {accountId:ctx.account.id}
    );
    await connection.execute('UPDATE business_account_sheet_versions SET is_current=0 WHERE account_id=:accountId AND is_current=1',{accountId:ctx.account.id});
    const [newVersion]=await connection.execute(
      'INSERT INTO business_account_sheet_versions (account_id,version_no,filename,file_hash,file_data,sheet_name,headers_json,line_count,matched_count,unmatched_count,uploaded_by,restored_from_id) '+
      'VALUES (:accountId,:version,:filename,:hash,:file,:sheet,:headers,:count,:matched,:unmatched,:userId,:restoreFrom)',
      {accountId:ctx.account.id,version:Number(maximum.maxVersion)+1,filename:older.filename,
        hash:older.file_hash,file:older.file_data,sheet:older.sheet_name,headers:older.headers_json,
        count:older.line_count,matched:older.matched_count,unmatched:older.unmatched_count,
        userId:req.session.user.id,restoreFrom:older.id}
    );
    await connection.execute(
      'INSERT INTO business_account_sheet_lines '+
      '(version_id,source_row,phone_original,phone_normalised,package_name,upgrade_date_sheet,end_date_sheet,usage_text,current_cost,matched_client_id,match_status,raw_json) '+
      'SELECT :newId,source_row,phone_original,phone_normalised,package_name,upgrade_date_sheet,end_date_sheet,usage_text,current_cost,matched_client_id,match_status,raw_json '+
      'FROM business_account_sheet_lines WHERE version_id=:oldId',
      {newId:newVersion.insertId,oldId:older.id}
    );
    await connection.commit();connection.release();connection=null;
    return res.redirect(base(res,ctx.clientId)+'?message='+encodeURIComponent('Earlier version restored as a new, audited current version.'));
  }catch(error){
    if(connection){try{await connection.rollback();}finally{connection.release();}}
    if(/previous sheet could not/.test(error.message||''))return fail(res,404,error.message);
    next(error);
  }
});
router.get('/customers/:id/business-sheet/download/:version',requireAuth,async(req,res,next)=>{
  try{
    const ctx=await authorised(req,res);if(ctx.error)return;
    const version=id(req.params.version);if(!version)return fail(res,400,'Invalid file version.');
    await ensureQuarterlySheetSchema(db);
    const [[record]]=await db.execute(
      'SELECT version_no,file_data FROM business_account_sheet_versions WHERE id=:id AND account_id=:accountId LIMIT 1',
      {id:version,accountId:ctx.account.id}
    );
    if(!record)return fail(res,404,'This workbook does not belong to the selected account.');
    res.set('Cache-Control','private, no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Content-Disposition','attachment; filename="business-account-version-'+record.version_no+'.xlsx"');
    return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(record.file_data);
  }catch(error){next(error);}
});
module.exports=router;
