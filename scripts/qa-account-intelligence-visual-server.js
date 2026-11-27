'use strict';
// Synthetic-only, loopback-bound visual QA for the REAL Account Intelligence routes/views.
// Never run this harness on hosting. It replaces only the DB adapter with an in-memory fake.
const express=require('express');
const session=require('express-session');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const PORT=38187;
const root=path.resolve(__dirname,'..');
const qaRoot=path.join(os.tmpdir(),'tk2m-account-intelligence-qa-synthetic');
fs.mkdirSync(qaRoot,{recursive:true});
process.env.PRIVATE_UPLOAD_DIR=qaRoot;
process.env.OUTBOUND_EMAIL_ENABLED='false';
process.env.CRM_BACKGROUND_WORKERS_ENABLED='false';
process.env.CRM_LIVE_MODE='false';

function formatDate(days){return new Date(Date.now()+days*86400000).toISOString().slice(0,10)}
const accounts=[
 {id:101,account_number:'B0000001',account_number_normalised:'B0000001',display_name:'SYNTHETIC BUSINESS ONE'},
 {id:102,account_number:'B0000002',account_number_normalised:'B0000002',display_name:'SYNTHETIC BUSINESS TWO'}
];
const clients=[
 {id:1001,account_id:101,account_number:'B0000001',cell_number:'0791111101',line_status:'active',package_name:'Demo Mobile 10GB',monthly_invoice_amount:240.00,created_at:'2026-01-15',next_upgrade_date:formatDate(12)},
 {id:1002,account_id:101,account_number:'B0000001',cell_number:'0791111102',line_status:'active',package_name:'Demo SIM-only',monthly_invoice_amount:120.00,created_at:'2026-02-15',next_upgrade_date:formatDate(60)},
 {id:1003,account_id:102,account_number:'B0000002',cell_number:'0791111201',line_status:'active',package_name:'Demo Business',monthly_invoice_amount:180.00,created_at:'2026-04-20',next_upgrade_date:null}
];
const fixed=[
 {id:2001,account_id:101,account_number_normalised:'B0000001',service_title:'Demo branch internet',branch_name:'Demo site',solution_id:'SYNTH-SOL-001',order_number:'SYNTH-ORDER-1',package_name:'Demo Fibre 50Mbps',service_status:'active',activation_date:'2026-02-03'}
];
const events=[
 {id:1,account_id:101,event_type:'upgrade_imported',event_date:'2026-11-14',description:'Synthetic monthly import event; confirmation pending',msisdn_original:'0791111102',package_name:'Demo SIM-only'}
];
const tasks=[
 {id:1,related_client_id:1001,title:'Verify supplier contract for demo line',due_at:formatDate(7)+' 08:30',completed_at:null}
];
let state={documents:[],entries:[],reviews:[],audit:[],docSerial:0,entrySerial:0,schemaReady:true};
function cloneState(){return structuredClone(state)}
function errSchema(){const e=new Error('Synthetic schema not installed');e.code='ER_NO_SUCH_TABLE';throw e}
const fakeDb={
 async execute(sql,p={}){
  if(!state.schemaReady && /account_intelligence_(?:documents|entries|reviews)/.test(sql))errSchema();
  if(/SELECT id,account_number,original_filename,document_kind/.test(sql)&&/FROM account_intelligence_documents/.test(sql))
   return [state.documents.slice().sort((a,b)=>b.id-a.id).slice(0,80)];
  if(/SELECT id FROM account_intelligence_documents WHERE account_number=:account AND document_sha256/.test(sql))
   return [state.documents.filter(d=>d.account_number===p.account && d.document_sha256===p.sha).map(x=>({id:x.id})).slice(0,1)];
  if(/SELECT id FROM account_intelligence_documents WHERE account_number/.test(sql))
   return [state.documents.filter(d=>d.account_number===(p.account||p.num)).map(x=>({id:x.id})).slice(0,1)];
  if(/SELECT stored_filename,original_filename FROM account_intelligence_documents/.test(sql))
   return [state.documents.filter(x=>x.id===p.id).map(x=>({stored_filename:x.stored_filename,original_filename:x.original_filename})).slice(0,1)];
  if(/FROM account_intelligence_entries e JOIN account_intelligence_documents d/.test(sql)){
   const documents=state.documents.filter(d=>d.account_number===p.account && d.document_kind==='statement');
   const rows=[];
   for(const d of documents)for(const e of state.entries.filter(x=>x.document_id===d.id))
    rows.push({month:e.billing_month,date:e.transaction_date,type:e.transaction_type,category:e.category,
      itemNo:e.item_number,reference:e.source_reference,matchingKey:e.match_key,
      amountCents:e.amount_cents,lineNo:e.source_line,documentId:d.id,uploadedAt:d.uploaded_at});
   return [rows.slice(0,40000)];
  }
  if(/FROM customer_accounts/.test(sql))return [accounts.filter(x=>x.account_number_normalised===p.num).slice(0,2).map(x=>({...x}))];
  if(/FROM clients WHERE account_id/.test(sql))return [clients.filter(x=>x.account_id===p.id).map(x=>({...x})).slice(0,5001)];
  if(/FROM fixed_services fs JOIN fixed_accounts fa/.test(sql))return [fixed.filter(x=>x.account_id===p.id).map(x=>({...x})).slice(0,1001)];
  if(/FROM mobile_events/.test(sql))return [events.filter(x=>x.account_id===p.account&&x.event_date.startsWith(p.start.slice(0,7))).map(x=>({...x})).slice(0,200)];
  if(/FROM staff_tasks t/.test(sql))return [tasks.filter(x=>clients.some(c=>c.id===x.related_client_id&&c.account_id===p.id)).map(x=>({...x})).slice(0,100)];
  if(/FROM account_intelligence_reviews/.test(sql))return [state.reviews.filter(x=>x.account_number===p.num||x.account_number===p.account).filter(x=>x.prior_month===p.prior&&x.current_month===p.month)
     .map(x=>({match_key:x.match_key,status:x.status,reason:x.reason,reviewed_at:x.reviewed_at}))];
  if(/INSERT INTO account_intelligence_documents/.test(sql)){
   const id=++state.docSerial;
   state.documents.push({id,account_number:p.account,original_filename:p.name,stored_filename:p.stored,document_sha256:p.sha,
     document_kind:p.kind,invoice_number:p.invoice,total_cents:p.total,source_date:p.date,
     extraction_warnings:p.warnings,uploaded_by:p.staff,uploaded_at:new Date().toISOString()});
   return [{insertId:id,affectedRows:1}];
  }
  if(/INSERT INTO account_intelligence_entries/.test(sql)){
   state.entries.push({id:++state.entrySerial,document_id:p.doc,billing_month:p.month,transaction_date:p.date,
     transaction_type:p.type,category:p.category,item_number:p.item,source_reference:p.reference,
     match_key:p.matchingKey,amount_cents:p.amount,source_line:p.line});
   return [{insertId:state.entrySerial,affectedRows:1}];
  }
  if(/INSERT INTO account_intelligence_reviews/.test(sql)){
   const v={account_number:p.account,prior_month:p.prior,current_month:p.month,match_key:p.key,
     status:p.status,reason:p.reason,reviewer_id:p.reviewer,reviewed_at:new Date().toISOString()};
   state.reviews=state.reviews.filter(x=>!(x.account_number===v.account_number&&x.prior_month===v.prior_month&&x.current_month===v.current_month&&x.match_key===v.match_key));
   state.reviews.push(v);return [{affectedRows:1}];
  }
  if(/INSERT INTO audit_log/.test(sql)){state.audit.push({action:p.actionType||'unknown'});return[{affectedRows:1}]}
  throw new Error('Unexpected synthetic query: '+sql.slice(0,150));
 },
 async getConnection(){
  let snapshot;
  return {execute:(s,p)=>fakeDb.execute(s,p),beginTransaction:async()=>{snapshot=cloneState()},
    commit:async()=>{snapshot=null},rollback:async()=>{if(snapshot)state=snapshot},
    release:()=>{}};
 }
};
const mod=path.resolve(root,'src/config/db.js');
require.cache[mod]={id:mod,filename:mod,loaded:true,exports:fakeDb};

function makePdf(lines) {
 const escape=s=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
 const content=['BT','/F1 9 Tf','12 TL','40 750 Td'];
 for(const [index,line] of lines.entries()){
  if(index)content.push('T*');
  content.push('('+escape(line)+') Tj');
 }
 content.push('ET');
 const stream=Buffer.from(content.join('\n'),'latin1');
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 620 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Length '+stream.length+' >>\nstream\n'+stream.toString('latin1')+'\nendstream'
 ];
 let pdf='%PDF-1.4\n',offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,'latin1'));pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'}
 const start=Buffer.byteLength(pdf,'latin1');
 pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
 for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
 pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n';
 return Buffer.from(pdf,'latin1');
}
const fixtureDir=path.join(qaRoot,'fixtures');
fs.mkdirSync(fixtureDir,{recursive:true});
const statement=[
 'Account Number: B0000001',
 '2026/10/03 INV B600000003 999111112 R17.29 R600.00',
 '2026/10/03 INV B600000004 999111113 R200.00 R800.00',
 '2026/11/03 INV B600000005 999111112 R30.00 R830.00',
 '2026/11/03 INV B600000006 999111113 R200.00 R1030.00',
 '2026/11/03 INV B600000007 999111114 R60.00 R1090.00',
 '2026/11/03 CRN CND123456 CND123456 R-10.00 R1080.00',
 '2026/11/09 CSH SCZ314817 496395817 R-220.00 R860.00'
];
fs.writeFileSync(path.join(fixtureDir,'synthetic-statement.pdf'),makePdf(statement));
fs.writeFileSync(path.join(fixtureDir,'synthetic-statement.jsp'),makePdf(statement));
fs.writeFileSync(path.join(fixtureDir,'synthetic-invoice.pdf'),makePdf([
 'Account Number: B0000001','Invoice number: VT2-FAKE01','Invoice date: 03/11/2026','Invoice total R200.00'
]));
fs.writeFileSync(path.join(fixtureDir,'synthetic-no-account.pdf'),makePdf([
 'NO ACCOUNT NUMBER HERE','2026/11/03 INV B600000005 999111112 R30.00 R830.00'
]));
fs.writeFileSync(path.join(fixtureDir,'synthetic-fake.pdf'),Buffer.from('This is not a PDF','utf8'));
fs.writeFileSync(path.join(fixtureDir,'synthetic-second-account.pdf'),makePdf([
 'Account Number: B0000002','2026/10/06 INV B600000201 999111121 R100.00 R100.00',
 '2026/11/06 INV B600000202 999111121 R130.00 R130.00'
]));

const app=express();
app.set('view engine','ejs');
app.set('views',path.join(root,'views'));
app.use(express.urlencoded({extended:false}));
app.use(express.json());
app.use(session({secret:'LOCAL-SYNTHETIC-QA-NOT-FOR-HOSTING',resave:false,saveUninitialized:false,
 cookie:{sameSite:'lax',httpOnly:true,secure:false}}));
app.use((req,res,next)=>{
 res.locals.basePath='';
 res.locals.panelMode=false;
 res.locals.isLive=true;
 res.locals.isUat=false;
 res.locals.currentUser=req.session.user||null;
 res.locals.assetVersion='qa';
 res.locals.appVersion='qa';
 next();
});
app.use('/public',express.static(path.join(root,'public')));
app.get('/__qa/login/:role',(req,res)=>{
 const role=req.params.role;
 if(!['owner','manager','staff'].includes(role))return res.sendStatus(400);
 const {businessDate}=require('../src/middleware/auth');
 req.session.user={id:role==='owner'?1:role==='manager'?2:3,role,full_name:'SYNTHETIC '+role.toUpperCase()};
 req.session.loginDate=businessDate();
 req.session.save(()=>res.redirect('/backoffice'));
});
app.get('/__qa/reset',(req,res)=>{
 state={documents:[],entries:[],reviews:[],audit:[],docSerial:0,entrySerial:0,schemaReady:true};
 res.redirect('/backoffice/account-intelligence');
});
app.get('/__qa/schema/:state',(req,res)=>{state.schemaReady=req.params.state==='on';res.redirect('/backoffice/account-intelligence')});
app.get('/__qa/fixture-path',(req,res)=>res.type('text/plain').send(fixtureDir));
app.get('/__qa/status',(req,res)=>res.json({synthetic:true,role:req.session.user?.role||'none',
 schemaReady:state.schemaReady,documents:state.documents.length,entries:state.entries.length,
 reviews:state.reviews.length,audits:state.audit.length,uploadedAccounts:[...new Set(state.documents.map(x=>x.account_number))]}));
app.get('/backoffice',(req,res)=>res.render('backoffice-home',{layout:false,title:'Administration Centre'}));
app.use('/',require('../src/routes/account-intelligence'));
app.use((err,req,res,next)=>{console.error('QA_ERROR',String(err.message||err));res.status(500).type('text/plain').send('SYNTHETIC QA ERROR: '+String(err.message||err).slice(0,160))});
app.listen(PORT,'127.0.0.1',()=>console.log('TK2M_ACCOUNT_INTELLIGENCE_VISUAL_QA_READY http://127.0.0.1:'+PORT+' synthetic=true fixtureDir='+fixtureDir));
