'use strict';
// Full HTTP POST consolidation in a UAT transaction. The transaction is ALWAYS rolled back.
const assert=require('assert'),fs=require('fs'),cp=require('child_process'),crypto=require('crypto');
const express=require('express');
const {staffPlan}=require('../src/services/temporary-cleanup-ownership');
const TOKEN='f'.repeat(64);
async function run(){
 const pid=cp.execSync("pgrep -f '^lsnode:/home/uent/public_html/talk2me/[[:space:]]*$' | head -n 1").toString().trim();
 const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ').toString().split('\0').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
 assert.equal(env.UAT_MODE,'true');assert.equal(env.DB_NAME,'uent_Crm');assert.equal(env.DB_USER,'uent_Crm-Uat');assert.equal(env.OUTBOUND_EMAIL_ENABLED,'false');
 for(const key of ['DB_NAME','DB_USER','DB_HOST','DB_PASSWORD','UAT_MODE','OUTBOUND_EMAIL_ENABLED','PRIVATE_UPLOAD_DIR'])process.env[key]=env[key];
 const db=require('../src/config/db');
 const {businessDate}=require('../src/middleware/auth');
 const connection=await db.getConnection();
 const actual={begin:connection.beginTransaction.bind(connection),rollback:connection.rollback.bind(connection),commit:connection.commit.bind(connection),release:connection.release.bind(connection),get:db.getConnection.bind(db)};
 let server=null,caseRecord=null;
 try{
  await actual.begin();
  const [groups]=await connection.query("SELECT cell_number_normalised phone,COUNT(*) n FROM clients WHERE account_id IS NOT NULL AND cell_number_normalised REGEXP '^27[0-9]{9}$' GROUP BY cell_number_normalised HAVING n>=2 AND COUNT(DISTINCT account_id)=1 LIMIT 180");
  for(const row of groups){
   const [clients]=await connection.execute('SELECT id,account_id,account_number,is_active FROM clients WHERE cell_number_normalised=:key ORDER BY account_id,id',{key:row.phone});
   const active=clients.filter(x=>Number(x.is_active)===1);
   if(active.length<2)continue;
   const ids=clients.map(x=>Number(x.id));
   const [assignments]=await connection.query('SELECT id,client_id,assigned_staff_id,is_active,account_number,assigned_by,notes FROM client_assignments WHERE client_id IN (?)',[ids]);
   const activeOwners=assignments.filter(x=>Number(x.is_active)===1);
   if(!activeOwners.length)continue;
   const current=active.find(c=>!activeOwners.some(a=>Number(a.client_id)===Number(c.id)));
   if(!current)continue;
   const [accounts]=await connection.execute('SELECT id,assigned_staff_id FROM customer_accounts WHERE id=:id',{id:Number(current.account_id)});
   if(accounts.length!==1)continue;
   let plan;
   try{plan=staffPlan(assignments,current.id,accounts[0].assigned_staff_id)}catch(_){continue}
   if(plan.action!=='transfer')continue;
   const archivedIds=active.filter(x=>Number(x.id)!==Number(current.id)).map(x=>Number(x.id));
   const [openTasks]=await connection.query("SELECT id FROM staff_tasks WHERE related_client_id IN (?) AND status IN ('unread','seen','in_progress') LIMIT 1",[archivedIds]);
   if(openTasks.length)continue;
   const [baseRows]=await connection.query('SELECT id,client_id,account_id,msisdn_normalised FROM mobile_base_current WHERE client_id IN (?)',[archivedIds]);
   if(baseRows.some(x=>String(x.msisdn_normalised)!==row.phone||(x.account_id&&Number(x.account_id)!==Number(current.account_id))))continue;
   const [existingDecision]=await connection.execute('SELECT id FROM temporary_cleanup_decisions WHERE case_type="same_account_phone" AND case_key=:key LIMIT 1',{key:row.phone});
   if(existingDecision.length)continue;
   caseRecord={key:row.phone,primary:Number(current.id),staffId:Number(plan.staffId),archivedIds};
   break;
  }
  assert(caseRecord,'No safe unreviewed UAT case for full transaction smoke test');
  const listSql="SELECT id,account_id,account_number,client_name,cell_number,cell_number_normalised,email,DATE_FORMAT(previous_upgrade_date,'%Y-%m-%d') previous_upgrade_date,DATE_FORMAT(next_upgrade_date,'%Y-%m-%d') next_upgrade_date,DATE_FORMAT(upgrade_date,'%Y-%m-%d') upgrade_date,package_name,line_status,is_active,updated_at FROM clients WHERE cell_number_normalised=:key ORDER BY account_id,id LIMIT 80";
  const [before]=await connection.execute(listSql,{key:caseRecord.key});
  const digest=crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex');
  const beforeActive=before.filter(x=>Number(x.is_active)===1).length;
  connection.beginTransaction=async()=>{};
  connection.commit=async()=>{};
  connection.rollback=async()=>{};
  connection.release=()=>{};
  db.getConnection=async()=>connection;
  const app=express();app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{
    req.session={user:{id:9,email:'info@b4s.co.za',role:'owner'},loginDate:businessDate(),tempCleanupToken:TOKEN};
    res.locals.basePath='/talk2me';next();
  });
  app.use('/talk2me',require('../src/routes/temporary-cleanup-consolidate'));
  server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject)});
  const location='http://127.0.0.1:'+server.address().port+'/talk2me/temporary-cleanup/consolidate/'+caseRecord.key;
  const result=await fetch(location,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
    primary_id:String(caseRecord.primary),csrf:TOKEN,snapshot:digest,confirm_consolidate:'1',reason:'Verified identical account and mobile number; transactional UAT safety test'
  }),redirect:'manual'});
  const body=await result.text();
  assert.equal(result.status,302,'Successful consolidation should redirect, got '+result.status+' '+body.slice(0,450));
  assert((result.headers.get('location')||'').includes('done=consolidated'));
  const [after]=await connection.execute(listSql,{key:caseRecord.key});
  assert.equal(after.filter(x=>Number(x.is_active)===1).length,1);
  assert(beforeActive>1);
  const [[current]]=await connection.execute('SELECT client_id,assigned_staff_id,is_active FROM client_assignments WHERE client_id=:id',{id:caseRecord.primary});
  assert.equal(Number(current.is_active),1);
  assert.equal(Number(current.assigned_staff_id),caseRecord.staffId);
  const [archivedAssignment]=await connection.query('SELECT id,is_active FROM client_assignments WHERE client_id IN (?)',[caseRecord.archivedIds]);
  assert(archivedAssignment.every(x=>Number(x.is_active)===0));
  const [[history]]=await connection.execute('SELECT before_json,after_json FROM temporary_cleanup_changes WHERE case_type="same_account_phone" AND case_key=:key AND action_type="consolidate_phone" ORDER BY id DESC LIMIT 1',{key:caseRecord.key});
  assert(history,'Expected transaction audit history');
  const parsedAfter=typeof history.after_json==='string'?JSON.parse(history.after_json):history.after_json;
  assert(parsedAfter.staff_events.some(x=>x.operation==='create_primary_assignment'||x.operation==='reactivate_primary_assignment'));
  console.log('FULL_CONSOLIDATION_HTTP_TRANSACTION_OK',{redirect:result.status,previous_active:beforeActive,remaining_active:1,staff_preserved:true});
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  db.getConnection=actual.get;
  connection.beginTransaction=actual.begin;connection.commit=actual.commit;connection.rollback=actual.rollback;connection.release=actual.release;
  await actual.rollback();
  if(caseRecord){
   const [restored]=await connection.execute('SELECT id,is_active FROM clients WHERE cell_number_normalised=:key',{key:caseRecord.key});
   assert(restored.filter(x=>Number(x.is_active)===1).length>1,'Transaction was not rolled back');
   const [[count]]=await connection.execute('SELECT COUNT(*) n FROM temporary_cleanup_changes WHERE case_type="same_account_phone" AND case_key=:key AND action_type="consolidate_phone"',{key:caseRecord.key});
   assert.equal(Number(count.n),0,'Unexpected persisted test audit entry');
   console.log('FULL_CONSOLIDATION_ROLLBACK_VERIFIED');
  }
  actual.release();
  await db.end().catch(()=>{});
 }
}
run().catch(error=>{console.error('HTTP_TRANSACTION_TEST_FAILED',error.stack||error.message);process.exitCode=1});
