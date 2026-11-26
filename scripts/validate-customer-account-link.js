'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { readLinkedAccount, resolveCustomerAccountForWrite } = require('../src/services/customer-account-link');
const account = { id: 44, account_number:'VB0123', account_number_normalised:'VB0123', account_status:'active', assigned_staff_id:3 };
function fixture({ existing = null, assignments = [], race = false } = {}) {
  let row = existing; const calls = [];
  return { calls, async execute(sql, params) {
    calls.push({sql,params});
    if (sql.includes('FROM customer_accounts')) return [row ? [row] : []];
    if (sql.includes('FROM client_assignments')) return [assignments];
    if (sql.includes('INSERT INTO customer_accounts')) {
      row = { ...account, account_number:params.number, account_number_normalised:params.normalised, assigned_staff_id:params.staffId };
      if (race) { const e = new Error('duplicate'); e.code='ER_DUP_ENTRY'; throw e; }
      return [{insertId:row.id}];
    }
    if (sql.includes('UPDATE client_assignments')) return [{affectedRows:1}];
    throw Error('Unexpected SQL: '+sql);
  }};
}
async function run() {
  const client = {id:7, account_number:'', account_id:null};
  const initial = fixture({assignments:[{account_number:'',assigned_staff_id:3,assigned_by:3}]});
  assert.deepEqual(await resolveCustomerAccountForWrite(initial,client,' vb 0123 ','QA Customer',1),{accountId:44,accountNumber:'VB0123'});
  assert(initial.calls.some(x=>x.sql.includes('INSERT INTO customer_accounts') && x.params.staffId===3));
  assert(initial.calls.some(x=>x.sql.includes('UPDATE client_assignments') && x.params.id===7));
  const existing = fixture({existing:account});
  assert.deepEqual(await resolveCustomerAccountForWrite(existing,{...client,account_number:'VB0123'},'VB0123','QA Customer',1),{accountId:44,accountNumber:'VB0123'});
  assert(!existing.calls.some(x=>x.sql.includes('INSERT INTO customer_accounts')));
  assert.equal((await readLinkedAccount(existing,{...client,account_id:44,account_number:'VB0123'})).id,44);
  assert.equal(await readLinkedAccount(existing,client),null);
  const race=fixture({race:true});
  assert.equal((await resolveCustomerAccountForWrite(race,client,'VB0123','QA Customer',1)).accountId,44);
  await assert.rejects(readLinkedAccount(existing,{...client,account_id:44,account_number:'B999'}),/disagree/);
  await assert.rejects(resolveCustomerAccountForWrite(existing,{...client,account_id:44},'B999','QA Customer',1),/reassigned/);
  await assert.rejects(resolveCustomerAccountForWrite(existing,{...client,account_id:44},'','QA Customer',1),/cleared/);
  await assert.rejects(resolveCustomerAccountForWrite(fixture({existing:{...account,account_status:'inactive'}}),client,'VB0123','QA Customer',1),/not active/);
  await assert.rejects(resolveCustomerAccountForWrite(fixture({existing:account,assignments:[{assigned_staff_id:9,account_number:''}]}),client,'VB0123','QA Customer',1),/different staff member/);
  await assert.rejects(resolveCustomerAccountForWrite(fixture(),client,'bad account!','QA Customer',1),/valid official/);
  assert.deepEqual(await resolveCustomerAccountForWrite(fixture(),client,'','QA Customer',1),{accountId:null,accountNumber:''});
  const template=fs.readFileSync(path.join(__dirname,'../views/provisional-fixed-service.ejs'),'utf8');
  const options={basePath:'',client:{...client,client_name:'QA Customer'},panelMode:false,error:null,values:{}};
  const noNumber=ejs.render(template,options);
  assert(noNumber.includes('Save Fixed Service and Request Account Number'));
  const direct=ejs.render(template,{...options,directSave:true,client:{...options.client,account_number:'VB0123'}});
  assert(direct.includes('>Save Fixed Service</button>') && !direct.includes('Submit Fixed Service for Approval'));
  const captured=ejs.render(template,{...options,client:{...options.client,account_number:'VB0123'}});
  assert(captured.includes('Submit Fixed Service for Approval'));
  assert(captured.includes('VB0123'));
  assert(!captured.includes('Save Fixed Service and Request Account Number'));
  const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  const details=read('src/routes/customer-details.js');
  assert(details.includes('getClient(id, conn, true)'));
  assert(details.includes('account_number=:account_number,account_id=:account_id'));
  assert(details.includes('verifySavedCustomer(id, values, conn)'));
  assert(details.includes('await conn.rollback()') && details.includes('await conn.commit()'));
  const approval=read('src/routes/approval-decisions-safe.js');
  assert(approval.includes("set.push('account_id=:account_id')"));
  assert(approval.includes('resolveCustomerAccountForWrite(conn, client, proposed.account_number'));
  const fixed=read('src/routes/provisional-fixed-save.js');
  assert(fixed.includes('requested_account_number: capturedAccount'));
  assert(fixed.includes('accountNumber: capturedAccount'));
  assert(fixed.includes("'fixed-account-link' : 'fixed-account-number'"));
  assert(read('views/approval-centre.ejs').includes("item.provisionalAccountApproval ? (item.accountNumber || '')"));
  // Real management service, fake transactional database: legacy number,
  // canonical creation/reuse, fixed account creation and duplicate-safe save.
  const {saveKnownFixedService}=require('../src/services/known-fixed-capture');
  const {listPendingFixedServices}=require('../src/services/pending-fixed-services');
  let canonical=null,fixedAccount=null,fixedService=null;let writes=[];
  const conn={async execute(sql,p){
    if(sql.includes('FROM client_assignments'))return [[]];
    if(sql.includes('FROM customer_accounts'))return [canonical?[canonical]:[]];
    if(sql.includes('INSERT INTO customer_accounts')){canonical={...account,assigned_staff_id:null};return [{insertId:44}];}
    if(sql.includes('UPDATE clients SET')){writes.push({sql,p});return [{affectedRows:1}];}
    if(sql.includes('FROM fixed_accounts'))return [fixedAccount?[fixedAccount]:[]];
    if(sql.includes('INSERT INTO fixed_accounts')){fixedAccount={id:51,account_id:44,account_number:'VB0123',account_number_normalised:'VB0123',account_status:'active',linked_mobile_account_number:'VB0123'};writes.push({sql,p});return [{insertId:51}];}
    if(sql.includes('UPDATE fixed_accounts'))return [{affectedRows:1}];
    if(sql.includes('FROM fixed_services'))return [fixedService?[fixedService]:[]];
    if(sql.includes('INSERT INTO fixed_services')){fixedService={id:61,fixed_account_id:51,service_status:'active',source_row_hash:p.hash};writes.push({sql,p});return [{insertId:61}];}
    if(sql.includes('INSERT INTO audit_log')){writes.push({sql,p});return [{affectedRows:1}];}
    throw Error('Unexpected SQL '+sql);
  }};
  const context={client:{...client,is_active:1,account_number:'VB0123',client_name:'Synthetic QA'},service:{branch_name:'QA site',solution_id:'QA-SOL-1',service_status:'active'},user:{id:3,role:'manager'}};
  const first=await saveKnownFixedService(conn,context);
  assert.deepEqual(first,{accountId:44,fixedAccountId:51,fixedServiceId:61,created:true});
  assert.equal((await saveKnownFixedService(conn,{...context,client:{...context.client,account_id:44}})).created,false);
  assert.equal(writes.filter(x=>x.sql.includes('INSERT INTO fixed_services')).length,1);
  assert.equal(writes.filter(x=>x.sql.includes('INSERT INTO audit_log')).length,2);
  assert(!writes.some(x=>x.sql.includes('data_change_requests')));
  await assert.rejects(saveKnownFixedService(conn,{...context,user:{id:3,role:'staff'}}),/Management access required/);
  await assert.rejects(saveKnownFixedService(conn,{...context,client:{...context.client,account_number:''}}),/existing official account/);
  let query;
  const pendingDb={async execute(sql,params){query={sql,params};return [[{id:99,request_type:'assign_account_number',client_id:7,customer_name:'QA Customer',account_number:'VB0123',proposed_data_json:JSON.stringify({fixed_service:{branch_name:'QA site'}})},{id:100,request_type:'assign_account_number',proposed_data_json:'{"provisional_line_id":4}'}]];}};
  const pending=await listPendingFixedServices(pendingDb,{id:3,role:'staff'},{clientId:7,accountId:44,accountNumber:'VB0123'});
  assert.equal(pending.length,1);assert.equal(pending[0].branch_name,'QA site');
  assert(query.sql.includes('r.requested_by=:staffId')&&query.sql.includes('r.client_id=:clientId'));
  assert(fixed.includes('await saveKnownFixedService(conn'));
  assert(fixed.includes('fixed_saved='));
  console.log('Customer account linkage and fixed-service regression validation passed.');
}
run().catch(e=>{ console.error(e); process.exitCode=1; });
