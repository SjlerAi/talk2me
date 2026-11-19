'use strict';
/*
 * Unify quick prospects and legacy sales-prospect conversion with the
 * searchable CRM clients table. Never mark a lead converted without a
 * committed, assigned CRM client. Do not merge matching phone/email records.
 *
 * All writes occur on ONE connection/transaction. A legacy sales_prospects
 * row is locked to make retries and concurrent conversion requests safe.
 */
const {normaliseSouthAfricanMobile}=require('./sa-phone-normalisation');

const clean=(v,max=5000)=>String(v??'').trim().slice(0,max);
const nullable=(v,max=5000)=>clean(v,max)||null;

function prospectFields(data={}) {
  const name=clean(data.prospect_name||data.client_name,200);
  const cell=clean(data.cell_number,40);
  const phone=cell?normaliseSouthAfricanMobile(cell):'';
  const email=clean(data.email,255).toLowerCase();
  if(!name)throw Error('Enter the prospect name.');
  if(!cell&&!email)throw Error('Enter a cellphone number or email before saving or converting.');
  if(cell&&!phone)throw Error('Enter a valid South African mobile number.');
  return {name,cell:cell||null,phone:phone||null,email:email||null,
    city:nullable(data.city_town,150),leadSource:nullable(data.lead_source,150)||'Prospect',
    interest:nullable(data.interest,1500),nextAction:nullable(data.next_action_at,30)};
}
async function findDuplicate(conn,fields) {
  const [rows]=await conn.execute(`SELECT id,client_name FROM clients
    WHERE is_active=1 AND
      ((:phone IS NOT NULL AND cell_number_normalised=:phone) OR
       (:email IS NOT NULL AND LOWER(email)=:email))
    ORDER BY id LIMIT 3 FOR UPDATE`,{phone:fields.phone,email:fields.email});
  return rows;
}
function duplicateError(rows) {
  const err=new Error('A matching CRM customer or prospect already exists. Open the existing customer and confirm identity before converting; no duplicate was created.');
  err.code='TK2M_PROSPECT_DUPLICATE';
  err.existingClientId=rows.length===1?Number(rows[0].id):null;
  return err;
}
async function insertClient(conn,fields,{assignedTo,createdBy,sourceId=null}) {
  const detail=[
    fields.interest?'Interest: '+fields.interest:'',
    fields.nextAction?'Next action: '+fields.nextAction:'',
    sourceId?'Converted from legacy sales prospect #'+sourceId:''
  ].filter(Boolean).join('\n');
  const provenance=sourceId?JSON.stringify({sales_prospect_id:sourceId,origin:'sales_prospects',created_via:'conversion'}):null;
  const [saved]=await conn.execute(`INSERT INTO clients
    (client_name,cell_number,cell_number_normalised,email,city_town,lifecycle_status,
     lead_source,lead_status,line_status,notes,created_by_staff_id,is_active,source_system,raw_import_json)
    VALUES (:name,:cell,:phone,:email,:city,'client',:leadSource,'converted','unknown',
      :detail,:createdBy,1,:sourceSystem,:provenance)`,
    {...fields,detail,createdBy,sourceSystem:sourceId?'sales_prospects':'os_quick_add',provenance});
  const clientId=Number(saved.insertId);
  if(!Number.isSafeInteger(clientId)||clientId<1)throw Error('CRM client record could not be verified.');
  await conn.execute(`INSERT INTO client_assignments
    (client_id,account_number,assigned_staff_id,assigned_by,is_active)
    VALUES (:clientId,'',:assignedTo,:createdBy,1)`,{clientId,assignedTo,createdBy});
  return clientId;
}
async function createQuickProspect({db,data,userId}) {
  const fields=prospectFields(data);
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const matched=await findDuplicate(conn,fields);
    if(matched.length)throw duplicateError(matched);
    // Quick Add remains a prospect until a staff member explicitly converts it
    // in Customer 360. The record is searchable immediately.
    const [saved]=await conn.execute(`INSERT INTO clients
      (client_name,cell_number,cell_number_normalised,email,city_town,lifecycle_status,
       lead_source,lead_status,line_status,notes,created_by_staff_id,is_active,source_system)
      VALUES (:name,:cell,:phone,:email,:city,'prospect',:leadSource,'new','unknown',
        :notes,:userId,1,'os_quick_add')`,
      {...fields,notes:[fields.interest?'Interest: '+fields.interest:'',
        fields.nextAction?'Next action: '+fields.nextAction:''].filter(Boolean).join('\n')||null,userId});
    const clientId=Number(saved.insertId);
    if(!Number.isSafeInteger(clientId)||clientId<1)throw Error('CRM prospect record could not be verified.');
    await conn.execute(`INSERT INTO client_assignments
      (client_id,account_number,assigned_staff_id,assigned_by,is_active)
      VALUES (:clientId,'',:userId,:userId,1)`,{clientId,userId});
    await conn.commit();
    return clientId;
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
async function convertLegacyProspect({db,prospectId,user}) {
  if(!Number.isSafeInteger(prospectId)||prospectId<1)throw Error('Invalid legacy prospect.');
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const owner=user && ['owner','manager','admin'].includes(user.role);
    const [rows]=await conn.execute(`SELECT * FROM sales_prospects
      WHERE id=:prospectId${owner?'':' AND assigned_to=:userId'}
      LIMIT 1 FOR UPDATE`,{prospectId,userId:Number(user?.id||0)});
    const source=rows[0];
    if(!source){const e=new Error('Prospect is not assigned to this account or does not exist.');e.code='TK2M_NOT_FOUND';throw e;}
    const needle='%"sales_prospect_id":'+prospectId+',%';
    const [linked]=await conn.execute(`SELECT id FROM clients
      WHERE source_system='sales_prospects' AND raw_import_json LIKE :needle
      ORDER BY id LIMIT 2 FOR UPDATE`,{needle});
    if(linked.length===1){
      if(source.status!=='converted')await conn.execute(`UPDATE sales_prospects
        SET status='converted',converted_at=NOW(),converted_by=:userId
        WHERE id=:prospectId`,{userId:Number(user.id),prospectId});
      await conn.commit();
      return Number(linked[0].id);
    }
    if(linked.length>1)throw Error('Multiple CRM records link to this prospect. Management review required.');
    const fields=prospectFields(source);
    const matched=await findDuplicate(conn,fields);
    if(matched.length)throw duplicateError(matched);
    const clientId=await insertClient(conn,fields,{assignedTo:Number(source.assigned_to),createdBy:Number(user.id),sourceId:prospectId});
    await conn.execute(`UPDATE sales_prospects SET status='converted',
      converted_at=NOW(),converted_by=:userId WHERE id=:prospectId`,
      {userId:Number(user.id),prospectId});
    await conn.commit();
    return clientId;
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
module.exports={createQuickProspect,convertLegacyProspect,prospectFields};
