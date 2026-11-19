'use strict';
// Synthetic-only, no CRM/customer database connection or writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/services/master-customer-search.js'),'utf8');
const shell=fs.readFileSync(path.join(root,'public/js/os-v6.js'),'utf8');
const helper=fs.readFileSync(path.join(root,'public/js/os-v6-alpha21-8.js'),'utf8');
const route=fs.readFileSync(path.join(root,'src/routes/base-details-search.js'),'utf8');

let masterRows=[],crmRows=[],shouldFail=false;
const queries=[];
function line(id,name,extras={}){
 return {id,client_name:name,cell_number:'0710000000',email:'test@invalid.example',
   account_number:'B-SYNTH',handset:null,package_name:null,
   is_active:1,master_customer_key:null,master_service_key:null,
   master_link_state:null,...extras};
}
const db={
 async execute(sql,params){
  assert.match(sql,/^\s*SELECT /i,'global search must only SELECT');
  queries.push({sql,params});
  if(shouldFail)throw Error('synthetic query unavailable');
  if(sql.includes('FROM crm_master_active active'))return [masterRows];
  if(sql.includes('FROM crm_v_master_clients c')){
   assert.match(sql,/c\.is_active=1/);
   assert.match(sql,/c\.client_name LIKE :like/);
   assert.match(sql,/c\.cell_number LIKE :like/);
   assert.match(sql,/c\.account_number LIKE :like/);
   assert.match(sql,/c\.email LIKE :like/);
   assert.match(sql,/c\.id_number LIKE :like/);
   assert.match(sql,/LIMIT 40/);
   if(params.staffId!==undefined){
    assert.match(sql,/denied\.assigned_staff_id<>:staffId/);
    assert.match(sql,/accountOwner\.assigned_staff_id<>:staffId/);
    assert.match(sql,/COALESCE\(c\.master_link_state,''\)<>'needs_conflict_review'/);
   }
   const search=String(params.exact||'').toUpperCase();
   const phoneSuffix=params.phoneSuffix?params.phoneSuffix.replace(/%/g,''):null;
   return [crmRows.filter(c=>{
    if(!c.is_active)return false;
    if(params.staffId!==undefined &&
      (c.assigned_other||c.account_owner_other||c.master_link_state==='needs_conflict_review'))
      return false;
    return [c.client_name,c.cell_number,c.email,c.account_number,c.id_number]
      .some(v=>String(v||'').toUpperCase().includes(search)) ||
      (phoneSuffix && String(c.cell_number||'').includes(phoneSuffix));
   }).map(c=>({...c}))];
  }
  throw Error('Unexpected database query in synthetic: '+sql.slice(0,100));
 },
 async query(sql,params){
  assert.match(sql,/^SELECT /i);
  queries.push({sql,params});
  return [[]];
 }
};
const sandbox={
 module:{exports:{}},
 require(name){
  if(name==='../config/db')return db;
  throw Error('Unexpected module dependency: '+name);
 }
};
vm.runInNewContext(source,sandbox,{filename:'master-customer-search.js'});
const {searchMaster}=sandbox.module.exports;
const owner={id:1,role:'owner'},manager={id:9,role:'manager'},staff={id:2,role:'staff'};

(async()=>{
 // Missing source mapping must never cause "new customer" when a CRM line exists.
 crmRows=[line(101,'SYNTHETIC EXISTING CUSTOMER')];masterRows=[];
 let results=await searchMaster({query:'SYNTHETIC EXISTING CUSTOMER',user:owner,basePath:''});
 assert.equal(results.length,1);
 assert.equal(results[0].id,101);
 assert.equal(results[0].record_type,'crm');
 assert.equal(results[0].verification_status,'crm_unmapped');
 assert.equal(results[0].url,'/customers/101/360');

 // Keep every legitimate line, even when one person has multiple account lines.
 crmRows=[line(101,'SYNTHETIC TWO LINES'),line(102,'SYNTHETIC TWO LINES',
   {cell_number:'0720000000'})];
 results=await searchMaster({query:'SYNTHETIC TWO LINES',user:owner,basePath:'/talk2me'});
 assert.deepEqual(Array.from(results,r=>r.id),[101,102]);
 assert.equal(results[1].url,'/talk2me/customers/102/360');

 // CRM-backed master rows should win over a duplicate fallback for the same line.
 crmRows=[line(101,'SYNTHETIC LINKED')];
 masterRows=[{
  run_id:3,service_key:'mobile:0710000000',phone:'0710000000',
  service_type:'mobile',master_customer_key:'master:synthetic',
  link_state:'crm_customer_linked',crm_client_id:101,
  master_customer_name:'SYNTHETIC GROUP',crm_name:'SYNTHETIC LINKED',
  official_account:'B-SYNTH'
 }];
 results=await searchMaster({query:'SYNTHETIC LINKED',user:owner,basePath:''});
 assert.equal(results.length,1);
 assert.equal(results[0].id,101);
 assert.equal(results[0].record_type,'mobile');
 assert.equal(results[0].client_name,'SYNTHETIC LINKED');

 // Pending master conflicts remain visible to management only, not staff.
 masterRows=[];
 crmRows=[
  line(201,'SYNTHETIC STAFF ROW',{assigned_other:false}),
  line(202,'SYNTHETIC STAFF ROW',{assigned_other:true}),
  line(203,'SYNTHETIC STAFF ROW',{account_owner_other:true}),
  line(204,'SYNTHETIC STAFF ROW',{master_link_state:'needs_conflict_review'}),
  line(205,'SYNTHETIC STAFF ROW',{is_active:0})
 ];
 results=await searchMaster({query:'SYNTHETIC STAFF ROW',user:staff,basePath:''});
 assert.deepEqual(Array.from(results,r=>r.id),[201]);
 results=await searchMaster({query:'SYNTHETIC STAFF ROW',user:manager,basePath:''});
 assert.deepEqual(Array.from(results,r=>r.id),[201,202,203,204]);
 assert.equal(results[3].verification_status,'needs_conflict_review');

 // Exact provider/service lookup must remain first even when >20 CRM lines
 // share a phone. This route is used to check supplier line authorisation.
 masterRows=[{
  run_id:3,service_key:'mobile:0710000000',phone:'0710000000',
  service_type:'mobile',master_customer_key:'master:provider',
  link_state:'account_only_no_customer',mobile_base_id:909,
  master_customer_name:'SYNTHETIC PROVIDER'
 }];
 crmRows=Array.from({length:30},(_,i)=>line(i+500,'SYNTHETIC SHARED PHONE'));
 results=await searchMaster({query:'0710000000',user:owner,basePath:''});
 assert.equal(results.length,20);
 assert.equal(results[0].service_key,'mobile:0710000000');
 assert.equal(results[0].url,'/mobile-base/909');

 // Name, account, email and phone search target the same CRM view.
 crmRows=[line(301,'SYNTHETIC DETAIL SEARCH',{
  email:'customer@invalid.example',account_number:'VB-987654',
  cell_number:'0821234567',id_number:'0000000000000'
 })];
 for(const term of ['DETAIL SEARCH','VB-987654','customer@invalid.example','0821234567','0000000000000']){
  results=await searchMaster({query:term,user:owner,basePath:''});
  assert.equal(results[0]?.id,301,term);
 }
 results=await searchMaster({query:'NO SUCH CUSTOMER',user:owner,basePath:''});
 assert.equal(results.length,0);

 // Search faults must not silently masquerade as a new customer.
 shouldFail=true;
 await assert.rejects(()=>searchMaster({query:'SYNTHETIC',user:owner,basePath:''}),
   /synthetic query unavailable/);

 assert.match(route,/router\.get\('\/search\/all',requireAuth/);
 assert.match(route,/Cache-Control','private, no-store'/);
 assert.match(shell,/controller\?\.abort\(\); results = \[\]/);
 assert.match(shell,/row\.record_type === 'crm' \? 'CRM'/);
 assert.match(shell,/No customer found in your permitted records/);
 assert.match(helper,/ask a manager before creating a new record/);
 assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*(?:clients|customer_accounts)\b/i);
 console.log('TK2M_UNIFIED_AUTHORISED_CUSTOMER_SEARCH_SYNTHETIC_PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
