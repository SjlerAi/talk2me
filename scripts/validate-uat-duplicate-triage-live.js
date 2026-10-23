'use strict';
// READ ONLY: live UAT ledger vs actual CRM source rows. No writes.
const assert=require('assert').strict;
const mysql=require('mysql2/promise');
const {decodeIds,groupingEvidence}=require('../src/services/temporary-duplicate-triage');
async function main(){
  assert.equal(process.env.UAT_MODE,'true');
  assert.equal(process.env.DB_NAME,'uent_Crm');
  const conn=await mysql.createConnection({
    host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,
    database:process.env.DB_NAME,connectTimeout:5000
  });
  try{
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const [cases]=await conn.query('SELECT * FROM temporary_duplicate_triage ORDER BY id');
    const safe=cases.filter(c=>c.case_type==='safe_line_group');
    const manual=cases.filter(c=>c.case_type==='manual_identity');
    assert(safe.length>=120 && manual.length>=50,'Unexpected ledger counts');
    const allIds=[...new Set(cases.flatMap(c=>decodeIds(c.client_ids_json)))];
    const [lines]=await conn.query(`SELECT c.id,c.account_id,c.account_number,
      c.client_name,c.cell_number,c.cell_number_normalised,c.email,c.id_number,
      c.is_active,a.assigned_staff_id account_staff_id
      FROM clients c LEFT JOIN customer_accounts a ON a.id=c.account_id
      WHERE c.id IN (?)`,[allIds]);
    const [ass]=await conn.query('SELECT id,client_id,assigned_staff_id,is_active FROM client_assignments WHERE client_id IN (?)',[allIds]);
    const byId=new Map(lines.map(r=>[Number(r.id),{...r,_allocations:[]}]));
    ass.forEach(a=>{const client=byId.get(Number(a.client_id));if(client)client._allocations.push(a);});
    const fail=[];
    for(const item of safe){
      const ids=decodeIds(item.client_ids_json);
      const rows=ids.map(id=>byId.get(id)).filter(Boolean);
      const evidence=groupingEvidence(rows);
      if(rows.length!==ids.length || !evidence.safe ||
        evidence.accountId!==Number(item.account_id) ||
        evidence.phone!==String(item.phone_normalised)){
        fail.push({case_id:item.id,reasons:evidence.reasons});
      }
    }
    const [supplier]=await conn.query('SELECT msisdn_normalised,account_id FROM mobile_base_current WHERE msisdn_normalised IN (?)',[safe.map(x=>x.phone_normalised)]);
    const sup=new Map(supplier.map(s=>[s.msisdn_normalised,s]));
    for(const item of safe){
      const s=sup.get(item.phone_normalised);
      if(s&&s.account_id&&Number(s.account_id)!==Number(item.account_id))
        fail.push({case_id:item.id,reasons:['supplier_account_conflict']});
    }
    const [counts]=await conn.query('SELECT COUNT(*) total,SUM(is_active=1) active FROM clients');
    console.log(JSON.stringify({database:'uent_Crm',verified_safe_groups:safe.length,
      safety_failures:fail.length,manual_queue_cases:manual.length,
      manual_pending:manual.filter(c=>c.status==='pending').length,
      active_clients:counts[0].active,all_clients:counts[0].total}));
    assert.equal(fail.length,0,'A grouping failed current source safety verification');
  }finally{await conn.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
