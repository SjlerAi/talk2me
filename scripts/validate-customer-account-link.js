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
  console.log('Customer account linkage and fixed-service regression validation passed.');
}
run().catch(e=>{ console.error(e); process.exitCode=1; });
