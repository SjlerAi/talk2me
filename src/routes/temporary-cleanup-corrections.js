'use strict';
// UAT-only manual corrections. Never deletes data and never runs automatically.
const express=require('express');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {canUseTemporaryCleanup}=require('../services/temporary-cleanup-access');
const {snapshot,rowHash,csrfValid,formValues}=require('../services/temporary-cleanup-correction');
const router=express.Router();
const TYPES=new Set(['same_account_phone','cross_account_phone']);
const one=Number.isSafeInteger;
function error(res,status,message) {return res.status(status).render('error',{title:'Cleanup correction not saved',message});}
function permitted(req,res,next) {
  if(!canUseTemporaryCleanup(req.session.user))return error(res,404,'The temporary cleanup centre is not available.');
  next();
}
function detailLink(res,type,key){return res.locals.basePath+'/temporary-cleanup/review/'+encodeURIComponent(type)+'/'+encodeURIComponent(key);}
router.post('/temporary-cleanup/correct/:type/:key/:id',requireAuth,permitted,async(req,res,next)=>{
  const type=req.params.type,key=String(req.params.key||'');
  const id=Number(req.params.id);
  if(!TYPES.has(type)||!/^27[0-9]{9}$/.test(key)||!one(id)||id<1)return error(res,400,'Invalid correction target.');
  if(!csrfValid(req)||req.body.confirm_change!=='1')return error(res,403,'Please confirm your correction and reload the review before trying again.');
  const reason=String(req.body.reason||'').trim().slice(0,2000);
  if(reason.length<12)return error(res,422,'Enter at least twelve characters explaining the correction and evidence.');
  let values;
  try{values=formValues(req.body);}catch(e){return error(res,422,e.message);}
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT id,account_id,account_number,client_name,cell_number,cell_number_normalised,email,previous_upgrade_date,next_upgrade_date,upgrade_date,package_name,line_status,is_active FROM clients WHERE id=:id FOR UPDATE',{id});
    const before=rows[0];
    if(!before||before.cell_number_normalised!==key){await conn.rollback();return error(res,409,'The case has changed. Reload the current customer records.');}
    if(String(req.body.row_hash||'')!==rowHash(before)){await conn.rollback();return error(res,409,'Another change was made since this review opened. Reload and compare the latest values.');}
    const prior=snapshot(before);
    const newAccount=values.account_number!==String(before.account_number||'').trim().toUpperCase();
    let accountId=before.account_id;
    if(newAccount){
      if(req.body.confirm_account_change!=='1'){await conn.rollback();return error(res,422,'Confirm account reassignment explicitly.');}
      const [accounts]=await conn.execute("SELECT id,account_number FROM customer_accounts WHERE account_number_normalised=UPPER(REPLACE(TRIM(:account),' ','')) LIMIT 2",{account:values.account_number});
      if(accounts.length!==1){await conn.rollback();return error(res,422,'Account number is missing or ambiguous. Create or reconcile the account separately first.');}
      accountId=Number(accounts[0].id);
    }
    const changingNext=(prior.next_upgrade_date||'')!==(values.next_upgrade_date||'');
    // Source history, original dates and other CRM fields are never overwritten unless explicitly supplied in the form.
    const changedFields=Object.keys(values).filter(k=>{
      const oldVal=k.endsWith('_date')?prior[k]:prior[k]||'';
      const newVal=values[k]==null?'':String(values[k]);
      return String(oldVal||'')!==newVal;
    });
    if(newAccount)changedFields.push('account_id');
    if(!changedFields.length){await conn.rollback();return error(res,422,'No differences were entered. Use the Review decision button to approve an unchanged line.');}
    if(values.cell_number_normalised!==key && req.body.confirm_phone_change!=='1'){await conn.rollback();return error(res,422,'Confirm changing the cellphone number explicitly.');}
    await conn.execute('UPDATE clients SET client_name=:client_name,account_number=:account_number,account_id=:account_id,cell_number=:cell_number,cell_number_normalised=:cell_number_normalised,email=:email,previous_upgrade_date=:previous_upgrade_date,next_upgrade_date=:next_upgrade_date,upgrade_date=CASE WHEN :changingNext=1 THEN :next_upgrade_date ELSE upgrade_date END,package_name=:package_name,line_status=:line_status,updated_at=NOW() WHERE id=:id',{...values,account_id:accountId,changingNext:changingNext?1:0,id});
    const [updated]=await conn.execute('SELECT id,account_id,account_number,client_name,cell_number,cell_number_normalised,email,previous_upgrade_date,next_upgrade_date,upgrade_date,package_name,line_status,is_active FROM clients WHERE id=:id',{id});
    const after=snapshot(updated[0]);
    await conn.execute('INSERT INTO temporary_cleanup_changes (action_type,case_type,case_key,client_id,before_json,after_json,reviewed_by,notes,created_at) VALUES (:action,:type,:key,:id,:before,:after,:reviewer,:reason,NOW())',{
      action:'correct_line',type,key,id,before:JSON.stringify(prior),after:JSON.stringify(after),reviewer:Number(req.session.user.id),reason
    });
    await conn.execute('INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES (:staff,"temporary_cleanup_client_corrected","clients",:id,:reason,:before,:after,:ip,:ua)',{
      staff:Number(req.session.user.id),id,reason:'Temporary cleanup: '+reason.slice(0,450),before:JSON.stringify(prior),after:JSON.stringify(after),
      ip:String(req.ip||'').slice(0,64),ua:String(req.get('user-agent')||'').slice(0,255)
    });
    // A previously approved case needs fresh review after editing a line.
    await conn.execute("UPDATE temporary_cleanup_decisions SET decision='needs_correction',notes='Underlying customer details were corrected; re-approve after checking.',reviewed_by=:staff,reviewed_at=NOW() WHERE case_type=:type AND case_key=:key",{staff:Number(req.session.user.id),type,key});
    await conn.commit();
    return res.redirect(res.locals.basePath+'/temporary-cleanup?type='+type+'&view=all&corrected=1');
  }catch(e){try{await conn.rollback();}catch(_){}next(e);}
  finally{conn.release();}
});
module.exports=router;
