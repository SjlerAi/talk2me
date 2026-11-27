'use strict';

const express=require('express');
const multer=require('multer');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const db=require('../config/db');
const {requireOwner}=require('../middleware/auth');
const {audit}=require('../services/audit');
const core=require('../services/account-intelligence-core');
const {extractPdfText}=require('../services/account-intelligence-pdf');

const router=express.Router();
const URL='/backoffice/account-intelligence';
const MAX_FILES=6;
const upload=multer({storage:multer.memoryStorage(),
 limits:{files:MAX_FILES,fileSize:8*1024*1024,fields:5},
 fileFilter(req,file,cb){
   const name=String(file.originalname||'');
   // Vodafone's emailed copies sometimes have a .jsp name despite being real PDFs.
   if(!/\.(pdf|jsp)$/i.test(name))return cb(new Error('Only .pdf files or PDF content supplied as .jsp are supported'));
   cb(null,true);
 }}).array('documents',MAX_FILES);

function csrf(req) {
 if(!req.session.accountIntelCsrf)req.session.accountIntelCsrf=crypto.randomBytes(32).toString('hex');
 return req.session.accountIntelCsrf;
}
function csrfValid(req) {
 const a=String(req.session?.accountIntelCsrf||'');
 const b=String(req.body?.csrf||'');
 return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) &&
   crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
function cleanFilename(value) {
 return path.basename(String(value||'document.pdf')).replace(/[^a-zA-Z0-9_. -]/g,'_').slice(0,120)||'document.pdf';
}
function privateRoot() {
 const root=String(process.env.PRIVATE_UPLOAD_DIR||'').trim();
 if(!path.isAbsolute(root))throw new Error('Private document directory is not configured');
 return path.join(root,'account-intelligence');
}
function setNotice(req,value){req.session.accountIntelNotice=String(value||'').slice(0,250);}
function period(value) {return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||''))?String(value):null;}
function previousMonth(month){
 const [year,m]=month.split('-').map(Number);
 return m===1?(year-1)+'-12':year+'-'+String(m-1).padStart(2,'0');
}
function invoiceDetails(text) {
 const number=String(text).match(/Invoice\s+number\s*:\s*(VT2-[A-Z0-9]+)/i)?.[1]||null;
 const total=String(text).match(/Invoice\s+total\s+R?\s*([\d,]+\.\d{2})/i)?.[1]||null;
 const issued=String(text).match(/Invoice\s+date\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]||null;
 const sourceDate=issued?issued.slice(6)+'-'+issued.slice(3,5)+'-'+issued.slice(0,2):null;
 return {number,totalCents:total?core.cents(total):null,sourceDate};
}
async function accountRows(accountNumber) {
 const [rows]=await db.execute(
  'SELECT e.billing_month month,e.transaction_date date,e.transaction_type type,'+
  'e.category,e.item_number itemNo,e.source_reference reference,e.match_key matchingKey,'+
  'e.amount_cents amountCents,e.source_line lineNo,d.id documentId,d.uploaded_at uploadedAt '+
  'FROM account_intelligence_entries e JOIN account_intelligence_documents d ON d.id=e.document_id '+
  'WHERE d.account_number=:account AND d.document_kind="statement" '+
  'ORDER BY d.uploaded_at DESC,d.id DESC,e.id ASC LIMIT 40000',{account:accountNumber});
 const seen=new Set(),unique=[];
 // Uploaded multi-month statements overlap. Keep the most recent copy of each source transaction.
 for (const r of rows){
   const signature=[r.date,r.type,r.itemNo,r.reference,r.amountCents].join('|');
   if(seen.has(signature))continue;
   seen.add(signature);
   unique.push({...r,amountCents:Number(r.amountCents)});
 }
 return unique;
}
async function crmSnapshot(accountNumber) {
 const [accounts]=await db.execute(
   'SELECT id,account_number,display_name FROM customer_accounts '+
   'WHERE account_number_normalised=:num OR account_number=:num LIMIT 2',{num:accountNumber});
 if(accounts.length!==1)return {status:accounts.length?'ambiguous':'unlinked',lines:[],account:null};
 const account=accounts[0];
 const [lines]=await db.execute(
   'SELECT id,cell_number,line_status,package_name,monthly_invoice_amount,created_at,'+
   'DATE_FORMAT(next_upgrade_date,"%Y-%m-%d") next_upgrade_date '+
   'FROM clients WHERE account_id=:id OR (account_id IS NULL AND account_number IS NOT NULL AND '+ 
   'UPPER(REPLACE(TRIM(account_number)," ",""))=:number) ORDER BY id LIMIT 5001',
   {id:account.id,number:accountNumber});
 const truncated=lines.length>5000;
 let fixedServices=null,fixedTruncated=false;
 try {
   const [rows]=await db.execute(
     'SELECT fs.id,fs.service_title,fs.branch_name,fs.solution_id,fs.order_number,fs.package_name,'+
     'fs.service_status,DATE_FORMAT(fs.activation_date,"%Y-%m-%d") activation_date '+
     'FROM fixed_services fs JOIN fixed_accounts fa ON fa.id=fs.fixed_account_id '+
     'WHERE fa.account_id=:id OR (fa.account_id IS NULL AND fa.account_number_normalised=:number) '+
     'ORDER BY fs.id LIMIT 1001',{id:account.id,number:accountNumber});
   fixedTruncated=rows.length>1000;fixedServices=rows.slice(0,1000);
 }catch(e){fixedServices=null;}
 return {status:'linked',account,lines:lines.slice(0,5000),truncated,fixedServices,fixedTruncated};
}

async function accountActivity(crm,month) {
 if(crm?.status!=='linked')return {events:null,upcomingTasks:null,warnings:['CRM account identity is not verified']};
 const warnings=[];
 let events=null,upcomingTasks=null;
 // Source-imported events are audit evidence, not proof that a supplier processed a change.
 try {
   const [rows]=await db.execute(
     'SELECT event_type,DATE_FORMAT(event_date,"%Y-%m-%d") event_date,'+
     'description,msisdn_original,package_name FROM mobile_events '+
     'WHERE account_id=:account AND event_date>=:start AND event_date<DATE_ADD(:start,INTERVAL 1 MONTH) '+
     'ORDER BY event_date DESC,id DESC LIMIT 200',
     {account:crm.account.id,start:month+'-01'});
   events=rows;
 }catch(e){warnings.push('Monthly CRM event history is not available or could not be verified');}
 try {
   const [rows]=await db.execute(
     'SELECT t.id,t.title,DATE_FORMAT(t.due_at,"%Y-%m-%d %H:%i") due_at '+
     'FROM staff_tasks t WHERE t.related_client_id IN (SELECT c.id FROM clients c '+
     'WHERE c.account_id=:id OR (c.account_id IS NULL AND UPPER(REPLACE(TRIM(c.account_number)," ",""))=:account)) '+
     'AND t.completed_at IS NULL AND t.due_at>=NOW() AND t.due_at<DATE_ADD(NOW(),INTERVAL 28 DAY) '+
     'ORDER BY t.due_at ASC LIMIT 100',
     {id:crm.account.id,account:crm.account.account_number_normalised});
   upcomingTasks=rows;
 }catch(e){warnings.push('Scheduled CRM follow-up tasks are not available or could not be verified');}
 return {events,upcomingTasks,warnings};
}

function crmAnnotations(changes,lines) {
 return changes.map(c=>{
   const match=c.key.match(/^LINE:(\d{9})$/);
   if(!match)return {...c,crmState:'service-or-unmatched'};
   const found=lines.filter(x=>String(x.cell_number||'').replace(/\D/g,'').endsWith(match[1]));
   return {...c,crmState:found.length===1?'candidate':found.length>1?'ambiguous':'missing',
     crmLine:found.length===1?found[0]:null};
 });
}
async function dashboard(req,res) {
 const message=req.session.accountIntelNotice||null;
 delete req.session.accountIntelNotice;
 const [documents]=await db.execute(
  'SELECT id,account_number,original_filename,document_kind,invoice_number,total_cents,DATE_FORMAT(source_date,"%Y-%m-%d") source_date,uploaded_at,'+
  'extraction_warnings FROM account_intelligence_documents ORDER BY uploaded_at DESC,id DESC LIMIT 80');
 const accounts=[...new Set(documents.map(x=>x.account_number))];
 const selected=String(req.query.account||accounts[0]||'').trim().toUpperCase();
 const month=period(req.query.month)||new Date().toISOString().slice(0,7);
 const prior=previousMonth(month);
 let report=null,crm=null,activity=null,reviews=[],sourceMatches=[];
 if(selected&&accounts.includes(selected)){
   const entries=await accountRows(selected);
   report=core.compareMonths(entries,prior,month);
   crm=await crmSnapshot(selected);
   activity=await accountActivity(crm,month);
   report.top=crmAnnotations(report.top,crm.lines);
   const [existing]=await db.execute(
    'SELECT match_key,status,reason,reviewed_at FROM account_intelligence_reviews '+
    'WHERE account_number=:num AND prior_month=:prior AND current_month=:month',
    {num:selected,prior,month});
   reviews=existing;
   const byKey=new Map(existing.map(x=>[x.match_key,x]));
   report.top=report.top.map(x=>({...x,review:byKey.get(x.key)||null}));
   const statements=documents.filter(d=>d.account_number===selected&&d.document_kind==='statement');
   const invoiceDocs=documents.filter(d=>d.account_number===selected&&d.document_kind==='invoice'&&d.source_date&&String(d.source_date).slice(0,7)===month);
   // Supporting detailed invoices are evidence only, never double-counted as statement charges.
   const statementItems=entries.filter(x=>x.month===month&&x.category==='invoice');
   sourceMatches=invoiceDocs.map(x=>{
     const found=statementItems.filter(e=>e.itemNo===x.invoice_number);
     const sum=found.reduce((n,e)=>n+e.amountCents,0);
     return {...x,reconciled:found.length===1&&x.total_cents!==null&&sum===Number(x.total_cents),
       sourceFound:found.length>0,statementTotalCents:sum};
   });
   void statements;
 }
 res.set('Cache-Control','private,no-store');
 res.render('account-intelligence',{
   title:'Account Intelligence',csrf:csrf(req),documents,accounts,selected,month,prior,
   report,crm,activity,reviews,sourceMatches,message,schemaRequired:false,renderError:null,rand:core.rand
 });
}
router.get(URL,requireOwner,async(req,res,next)=>{
 try {await dashboard(req,res);}
 catch(e) {
   if(e.code==='ER_NO_SUCH_TABLE')return res.status(503).render('account-intelligence',{
     title:'Account Intelligence',csrf:csrf(req),documents:[],accounts:[],selected:'',month:'',prior:'',
     report:null,crm:null,activity:null,reviews:[],sourceMatches:[],message:null,schemaRequired:true,
     renderError:null,rand:core.rand
   });
   next(e);
 }
});
router.post(URL+'/upload',requireOwner,(req,res,next)=>{
 upload(req,res,err=>err?res.status(400).type('text/plain').send('PDF upload rejected: '+String(err.message).slice(0,140)):next());
},async(req,res,next)=>{
 if(!csrfValid(req))return res.status(403).type('text/plain').send('Expired form. Reload and retry.');
 const files=req.files||[];
 if(!files.length)return res.status(400).type('text/plain').send('Select at least one PDF');
 const kind=req.body.kind==='invoice'?'invoice':'statement';
 const addedFiles=[];
 let connection=null,committed=false;
 try {
   connection=await db.getConnection();
   await fs.mkdir(privateRoot(),{recursive:true,mode:0o700});
   await connection.beginTransaction();
   let imported=0,skipped=0;
   for(const file of files){
     const content=await extractPdfText(file.buffer);
     const parsed=core.parseStatement(content);
     if(!parsed.accountNumber)throw new Error('Account number not recognised in one of the PDFs');
     if(kind==='statement'&&!parsed.entries.length)throw new Error('No supported statement rows found');
     const sha=crypto.createHash('sha256').update(file.buffer).digest('hex');
     const [present]=await connection.execute(
       'SELECT id FROM account_intelligence_documents WHERE account_number=:account AND document_sha256=:sha LIMIT 1',
       {account:parsed.accountNumber,sha});
     if(present.length){skipped++;continue;}
     const stored=crypto.randomUUID();
     await fs.writeFile(path.join(privateRoot(),stored+'.pdf'),file.buffer,{flag:'wx',mode:0o600});
     addedFiles.push(stored);
     const invoice=invoiceDetails(content);
     const [created]=await connection.execute(
       'INSERT INTO account_intelligence_documents (account_number,original_filename,stored_filename,'+
       'document_sha256,document_kind,invoice_number,total_cents,source_date,extraction_warnings,uploaded_by) '+
       'VALUES (:account,:name,:stored,:sha,:kind,:invoice,:total,:date,:warnings,:staff)',
       {account:parsed.accountNumber,name:cleanFilename(file.originalname),stored,sha,kind,
        invoice:kind==='invoice'?invoice.number:null,total:kind==='invoice'?invoice.totalCents:null,
        date:kind==='invoice'?invoice.sourceDate:null,
        warnings:parsed.notes.join('; ').slice(0,2000),staff:req.session.user.id});
     if(kind==='statement'){
       for(const r of parsed.entries){
         await connection.execute(
          'INSERT INTO account_intelligence_entries (document_id,billing_month,transaction_date,transaction_type,'+
          'category,item_number,source_reference,match_key,amount_cents,source_line) VALUES '+
          '(:doc,:month,:date,:type,:category,:item,:reference,:matchingKey,:amount,:line)',
          {doc:created.insertId,month:r.month,date:r.date,type:r.type,category:r.category,
           item:r.itemNo,reference:r.reference,matchingKey:r.matchingKey,amount:r.amountCents,line:r.lineNo});
       }
     }
     imported++;
   }
   await connection.commit();committed=true;
   try {await audit(req,{actionType:'account_intelligence_upload',entityType:'billing_documents',
     description:'Account intelligence billing source import',after:{imported,skipped,kind}});}catch(e){console.error('Account intelligence audit failed:',e.message);}
   setNotice(req,imported+' documents saved; '+skipped+' identical duplicates skipped. No CRM lines changed.');
   res.redirect(303,URL);
 }catch(e){
   if(connection&&!committed)try{await connection.rollback();}catch(_){}
   if(!committed)for(const name of addedFiles)try{await fs.unlink(path.join(privateRoot(),name+'.pdf'));}catch(_){}
   setNotice(req,'Import not completed: '+String(e.message||'unknown error').slice(0,180));
   res.redirect(303,URL);
 }finally{if(connection)connection.release();}
});
router.get(URL+'/source/:id',requireOwner,async(req,res,next)=>{
 try {
   const id=Number(req.params.id);
   if(!Number.isSafeInteger(id)||id<=0)return res.sendStatus(404);
   const [[document]]=await db.execute(
     'SELECT stored_filename,original_filename FROM account_intelligence_documents WHERE id=:id LIMIT 1',{id});
   if(!document||!/^[a-f0-9-]{36}$/.test(document.stored_filename))return res.sendStatus(404);
   res.set('Cache-Control','private,no-store');
   res.set('X-Content-Type-Options','nosniff');
   res.download(path.join(privateRoot(),document.stored_filename+'.pdf'),cleanFilename(document.original_filename).replace(/\.(pdf|jsp)$/i,'')+'.pdf',
     err=>{if(err&&!res.headersSent)next(err)});
 }catch(e){next(e);}
});
router.post(URL+'/review',requireOwner,async(req,res,next)=>{
 try {
   if(!csrfValid(req))return res.sendStatus(403);
   const account=core.normaliseAccount(req.body.account);
   const month=period(req.body.month);
   const prior=period(req.body.prior);
   const key=String(req.body.key||'');
   const status=String(req.body.status||'');
   const reason=String(req.body.reason||'').trim().slice(0,2000);
   if(!account||!month||prior!==previousMonth(month)||key.length>110||!key||
      !['pending','verified','investigate'].includes(status)||
      (status==='verified'&&!reason))return res.status(400).type('text/plain').send('Invalid review');
   const [docs]=await db.execute('SELECT id FROM account_intelligence_documents WHERE account_number=:num LIMIT 1',{num:account});
   if(!docs.length)return res.sendStatus(404);
   const entries=await accountRows(account);
   const comparison=core.compareMonths(entries,prior,month);
   if(!comparison.changes.some(x=>x.key===key))return res.sendStatus(404);
   await db.execute(
     'INSERT INTO account_intelligence_reviews (account_number,prior_month,current_month,match_key,status,reason,reviewer_id) '+
     'VALUES (:account,:prior,:month,:key,:status,:reason,:reviewer) '+
     'ON DUPLICATE KEY UPDATE status=VALUES(status),reason=VALUES(reason),reviewer_id=VALUES(reviewer_id)',
     {account,prior,month,key,status,reason:reason||null,reviewer:req.session.user.id});
   await audit(req,{actionType:'account_intelligence_review',entityType:'billing_comparison',
     description:'Management reviewed a monthly billing difference',after:{account,month,key,status}});
   setNotice(req,'Difference review recorded. No CRM billing records have been changed.');
   res.redirect(303,URL+'?account='+encodeURIComponent(account)+'&month='+encodeURIComponent(month));
 }catch(e){next(e);}
});

router.get(URL+'/customer-report',requireOwner,async(req,res,next)=>{
 try {
   const account=core.normaliseAccount(req.query.account),month=period(req.query.month);
   if(!account||!month)return res.sendStatus(400);
   const [exists]=await db.execute('SELECT id FROM account_intelligence_documents WHERE account_number=:account LIMIT 1',{account});
   if(!exists.length)return res.sendStatus(404);
   const prior=previousMonth(month);
   const entries=await accountRows(account);
   const comparison=core.compareMonths(entries,prior,month);
   const crm=await crmSnapshot(account);
   const activity=await accountActivity(crm,month);
   const [reviewRows]=await db.execute(
    'SELECT match_key,status,reason FROM account_intelligence_reviews '+
    'WHERE account_number=:account AND prior_month=:prior AND current_month=:month',
    {account,prior,month});
   const reasons=new Map(reviewRows.map(x=>[x.match_key,x]));
   const changes=comparison.top.map(x=>({...x,review:reasons.get(x.key)||null}));
   res.set('Cache-Control','private,no-store');
   res.render('account-intelligence-customer-report',{
     layout:false,title:'Customer Account Review',account,month,prior,comparison,crm,activity,changes,rand:core.rand,
     generatedAt:new Date().toISOString()
   });
 }catch(e){next(e);}
});

module.exports=router;
