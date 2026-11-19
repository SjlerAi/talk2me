'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createQuickProspect,convertLegacyProspect,prospectFields}=require('../src/services/tk2m-prospect-to-client');
const route=fs.readFileSync(path.join(__dirname,'../src/routes/os-productivity.js'),'utf8');
const view=fs.readFileSync(path.join(__dirname,'../views/os-quick-add.ejs'),'utf8');

const lead={prospect_name:'Test Example',cell_number:'0821234567',email:'example@invalid.test',
  city_town:'QA Town',lead_source:'Walk-in',interest:'Fixed wireless enquiry',next_action_at:'2026-11-22T10:00'};
function fakeDb({duplicate=[],existingLink=[],source={...lead,id:9,status:'qualified',assigned_to:5},authorized=true}={}){
  const log=[];
  const conn={
    async beginTransaction(){log.push('BEGIN');},
    async commit(){log.push('COMMIT');},
    async rollback(){log.push('ROLLBACK');},
    release(){log.push('RELEASE');},
    async execute(sql,params){
      log.push({sql,params});
      if(sql.includes('FROM sales_prospects'))return [authorized?[source]:[]];
      if(sql.includes("source_system='sales_prospects'"))return [existingLink];
      if(sql.includes('FROM clients')&&sql.includes('cell_number_normalised'))return [duplicate];
      if(sql.includes('INSERT INTO clients'))return [{insertId:42}];
      if(sql.includes('INSERT INTO client_assignments'))return [{affectedRows:1}];
      if(sql.includes('UPDATE sales_prospects'))return [{affectedRows:1}];
      throw Error('Unexpected SQL '+sql.slice(0,80));
    }
  };
  return {db:{async getConnection(){return conn;}},log};
}
(async()=>{
  assert.equal(prospectFields(lead).phone,'27821234567');
  assert.throws(()=>prospectFields({prospect_name:'Test'}),/cellphone number or email/);
  assert.throws(()=>prospectFields({...lead,cell_number:'123'}),/valid South African mobile/);
  const fresh=fakeDb();
  assert.equal(await createQuickProspect({db:fresh.db,data:lead,userId:5}),42);
  assert.ok(fresh.log.some(x=>x.sql?.includes("'prospect'")&&x.sql.includes('INSERT INTO clients')));
  assert.ok(fresh.log.some(x=>x.sql?.includes('INSERT INTO client_assignments')));
  assert.ok(!fresh.log.some(x=>x.sql?.includes('INSERT INTO sales_prospects')));
  assert.ok(fresh.log.includes('COMMIT')&&!fresh.log.includes('ROLLBACK'));
  const repeated=fakeDb({duplicate:[{id:12,client_name:'Already exists'}]});
  await assert.rejects(createQuickProspect({db:repeated.db,data:lead,userId:5}),e=>
    e.code==='TK2M_PROSPECT_DUPLICATE'&&e.existingClientId===12);
  assert.ok(repeated.log.includes('ROLLBACK')&&!repeated.log.some(x=>x.sql?.includes('INSERT INTO clients')));
  const legacy=fakeDb();
  assert.equal(await convertLegacyProspect({db:legacy.db,prospectId:9,user:{id:5,role:'staff'}}),42);
  assert.ok(legacy.log.some(x=>x.sql?.includes('SELECT * FROM sales_prospects')&&x.sql.includes('FOR UPDATE')&&x.sql.includes('assigned_to')));
  assert.ok(legacy.log.some(x=>x.sql?.includes("source_system='sales_prospects'")));
  assert.ok(legacy.log.some(x=>x.sql?.includes('INSERT INTO clients')&&x.params.provenance.includes('"sales_prospect_id":9')));
  assert.ok(legacy.log.some(x=>x.sql?.includes("status='converted'")));
  assert.ok(legacy.log.includes('COMMIT'));
  const retry=fakeDb({source:{...lead,id:9,status:'converted',assigned_to:5},existingLink:[{id:42}]});
  assert.equal(await convertLegacyProspect({db:retry.db,prospectId:9,user:{id:5,role:'staff'}}),42);
  assert.ok(!retry.log.some(x=>x.sql?.includes('INSERT INTO clients')));
  assert.ok(!retry.log.some(x=>x.sql?.includes('UPDATE sales_prospects')));
  const unauthorized=fakeDb({authorized:false});
  await assert.rejects(convertLegacyProspect({db:unauthorized.db,prospectId:9,user:{id:6,role:'staff'}}),
    e=>e.code==='TK2M_NOT_FOUND');
  assert.ok(unauthorized.log.includes('ROLLBACK'));
  const linkedDuplicate=fakeDb({duplicate:[{id:123,client_name:'Shared cellphone'},{id:124,client_name:'Different line'}]});
  await assert.rejects(convertLegacyProspect({db:linkedDuplicate.db,prospectId:9,user:{id:5,role:'manager'}}),
    e=>e.code==='TK2M_PROSPECT_DUPLICATE'&&!e.existingClientId);
  assert.ok(linkedDuplicate.log.includes('ROLLBACK'));
  assert.match(route,/savedClientId=await createQuickProspect/);
  assert.match(route,/await convertLegacyProspect/);
  assert.match(view,/Open the searchable CRM prospect/);
  assert.match(view,/Open matching CRM customer/);
  console.log('TK2M_PROSPECT_CANONICAL_CONVERSION_PASS searchable=true assigned=true duplicate_blocked=true idempotent=true role_guard=true');
})().catch(error=>{console.error(error);process.exitCode=1});
