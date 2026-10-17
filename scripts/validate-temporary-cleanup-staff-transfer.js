'use strict';
// Smoke-check safe staff transfer without leaving any data changes in UAT.
const assert=require('assert');
const fs=require('fs'),cp=require('child_process');
const {staffPlan,applyStaffPlan,AssignmentConflict}=require('../src/services/temporary-cleanup-ownership');
const assertConflict=(rows,primary,accountOwner,code)=>{
  assert.throws(()=>staffPlan(rows,primary,accountOwner),e=>e instanceof AssignmentConflict&&e.code===code);
};
async function run(){
 const old={id:1,client_id:101,assigned_staff_id:4,is_active:1,notes:'Original assigned'};
 assert.equal(staffPlan([old],102,4).action,'transfer');
 assert.equal(staffPlan([old],102,null).staffId,4);
 assert.equal(staffPlan([old,{...old,id:2,client_id:102}],102,4).action,'retain');
 assert.equal(staffPlan([],102,null).action,'no_active_assignment');
 assertConflict([old,{...old,id:2,client_id:102,assigned_staff_id:6}],102,null,'staff_conflict');
 assertConflict([old],102,6,'account_staff_conflict');
 const inactivePrimary={id:77,client_id:102,assigned_staff_id:5,is_active:0,notes:'Prior inactive value'};
 const activity=[];
 const stub={
   query:async(sql,args)=>{activity.push({kind:'query',sql,args});return [[],[]]},
   execute:async(sql,args)=>{
     activity.push({kind:'execute',sql,args});
     if(sql.startsWith('SELECT id FROM staff_users'))return [[{id:4}],[]];
     return [{affectedRows:1},[]];
   }
 };
 const mockPlan=staffPlan([old,inactivePrimary],102,4);
 const mockEvents=await applyStaffPlan(stub,mockPlan,[old,inactivePrimary],102,'TEST_ACCOUNT',9,'Verified assignment from older active record',[101]);
 assert(mockEvents.some(e=>e.operation==='reactivate_primary_assignment'));
 assert(activity.some(a=>a.sql.startsWith('UPDATE client_assignments SET assigned_staff_id')&&a.args.id===77&&a.args.staffId===4));
 console.log('INACTIVE_CURRENT_ASSIGNMENT_REACTIVATION_RULE_OK');
 console.log('PURE_STAFF_TRANSFER_RULES_OK');
 const pid=cp.execSync("pgrep -f '^lsnode:/home/uent/public_html/talk2me/[[:space:]]*$' | head -n 1").toString().trim();
 const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ').toString().split('\0').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
 assert.equal(env.UAT_MODE,'true');
 assert.equal(env.DB_NAME,'uent_Crm');
 assert.equal(env.DB_USER,'uent_Crm-Uat');
 for(const k of ['DB_NAME','DB_USER','DB_HOST','DB_PASSWORD','UAT_MODE','OUTBOUND_EMAIL_ENABLED','PRIVATE_UPLOAD_DIR'])process.env[k]=env[k];
 const db=require('../src/config/db');
 const conn=await db.getConnection();
 try{
  await conn.beginTransaction();
  // Small, indexed UAT-only candidate scan to test the same staff assignment structure shown in the UI.
  const [groups]=await conn.query("SELECT c.cell_number_normalised phone,COUNT(*) n FROM clients c WHERE c.account_id IS NOT NULL AND c.cell_number_normalised REGEXP '^27[0-9]{9}$' GROUP BY c.cell_number_normalised HAVING n>1 AND COUNT(DISTINCT c.account_id)=1 LIMIT 160");
  let found=null;
  for(const g of groups){
    const [clients]=await conn.execute("SELECT id,account_id,account_number,is_active FROM clients WHERE cell_number_normalised=:phone ORDER BY id",{phone:g.phone});
    const active=clients.filter(r=>Number(r.is_active)===1);
    if(active.length<2)continue;
    const [assignments]=await conn.query('SELECT id,client_id,assigned_staff_id,assigned_by,is_active,notes FROM client_assignments WHERE client_id IN (?)',[clients.map(x=>Number(x.id))]);
    const activeAllocations=assignments.filter(x=>Number(x.is_active)===1);
    if(activeAllocations.length<1 || new Set(activeAllocations.map(x=>x.assigned_staff_id)).size!==1)continue;
    const current=active.find(c=>!activeAllocations.some(a=>Number(a.client_id)===Number(c.id)));
    if(!current)continue;
    const [master]=await conn.execute('SELECT assigned_staff_id FROM customer_accounts WHERE id=:id',{id:Number(current.account_id)});
    if(master.length!==1)continue;
    let plan;
    try{plan=staffPlan(assignments,current.id,master[0].assigned_staff_id)}catch(_){continue}
    if(plan.action!=='transfer')continue;
    const other=active.filter(x=>Number(x.id)!==Number(current.id)).map(x=>Number(x.id));
    const [outstanding]=await conn.query("SELECT id FROM staff_tasks WHERE related_client_id IN (?) AND status IN ('unread','seen','in_progress') LIMIT 1",[other]);
    if(outstanding.length)continue;
    found={key:g.phone,primary:current.id,account:current.account_number,accountId:current.account_id,archive:other,plan,clients,assignments};
    break;
  }
  assert(found,'No representative UAT case available with a uniquely assigned older line and unassigned selected current line');
  const baseline=await conn.query('SELECT id,client_id,assigned_staff_id,is_active,notes FROM client_assignments WHERE client_id IN (?) ORDER BY id',[found.clients.map(x=>x.id)]);
  const events=await applyStaffPlan(conn,found.plan,found.assignments,found.primary,found.account,9,'Automated safety test rolled back completely',found.archive);
  assert(events.some(e=>e.operation==='create_primary_assignment'||e.operation==='reactivate_primary_assignment'),'Expected staff allocation movement');
  const [[newAssignment]]=await conn.execute('SELECT client_id,assigned_staff_id,is_active FROM client_assignments WHERE client_id=:id',{id:found.primary});
  assert.equal(Number(newAssignment.is_active),1);
  assert.equal(Number(newAssignment.assigned_staff_id),Number(found.plan.staffId));
  const [older]=await conn.query('SELECT id,is_active FROM client_assignments WHERE client_id IN (?)',[found.archive]);
  assert(older.every(x=>Number(x.is_active)===0),'Older staff assignments should be inactive');
  console.log('UAT_STAFF_ASSIGNMENT_TRANSFER_TRANSACTION_OK',{primary_masked:'record-'+String(found.primary).slice(-2),actions:events.map(e=>e.operation)});
  await conn.rollback();
  const [actual]=await conn.query('SELECT id,client_id,assigned_staff_id,is_active,notes FROM client_assignments WHERE client_id IN (?) ORDER BY id',[found.clients.map(x=>x.id)]);
  assert.deepStrictEqual(actual,baseline[0],'UAT safety test left a persisted change');
  console.log('UAT_STAFF_TRANSFER_ROLLBACK_VERIFIED');
 }catch(e){try{await conn.rollback()}catch(_){}throw e}
 finally{conn.release();await db.end().catch(()=>{})}
}
run().catch(e=>{console.error('STAFF_TRANSFER_TEST_FAILED',e.stack||e.message);process.exitCode=1});
