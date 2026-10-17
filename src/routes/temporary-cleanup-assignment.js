'use strict';
// UAT only. Staff allocation correction with an immutable before/after audit.
const express=require('express');
const crypto=require('crypto');
const db=require('../config/db');
const {requireAuth}=require('../middleware/auth');
const {canUseTemporaryCleanup}=require('../services/temporary-cleanup-access');
const {csrfValid}=require('../services/temporary-cleanup-correction');
const router=express.Router();
function hash(row){return crypto.createHash('sha256').update(JSON.stringify({
  id:row.id,client_id:row.client_id,account_number:row.account_number,assigned_staff_id:row.assigned_staff_id,is_active:row.is_active,updated_at:row.updated_at
})).digest('hex');}
function fail(res,status,message){return res.status(status).render('error',{title:'Staff allocation not changed',message});}
router.post('/temporary-cleanup/staff/:key/:id',requireAuth,async(req,res,next)=>{
  if(!canUseTemporaryCleanup(req.session.user))return fail(res,404,'Temporary UAT cleanup is restricted.');
  const key=String(req.params.key||''),id=Number(req.params.id),staffId=Number(req.body.staff_id);
  if(!/^[A-Z0-9]{1,120}$/.test(key)||!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(staffId)||staffId<1)return fail(res,400,'Invalid allocation or staff member.');
  if(!csrfValid(req)||req.body.confirm_staff!=='1')return fail(res,403,'Confirm that the new staff owner is correct.');
  const reason=String(req.body.reason||'').trim().slice(0,2000);
  if(reason.length<12)return fail(res,422,'Add the reason and source for this staff correction.');
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT id,client_id,account_number,assigned_staff_id,assigned_by,is_active,updated_at FROM client_assignments WHERE id=:id FOR UPDATE',{id});
    const old=rows[0];
    if(!old||!Number(old.is_active)||String(old.account_number||'').replace(/\s/g,'').toUpperCase()!==key){await conn.rollback();return fail(res,409,'This allocation is no longer active or does not belong to the selected account.');}
    if(hash(old)!==String(req.body.assignment_hash||'')){await conn.rollback();return fail(res,409,'Allocation data changed. Reload the case before applying.');}
    const [users]=await conn.execute('SELECT id,full_name FROM staff_users WHERE id=:id AND is_active=1 AND deleted_at IS NULL LIMIT 1',{id:staffId});
    if(users.length!==1){await conn.rollback();return fail(res,422,'The selected staff member is not active.');}
    if(Number(old.assigned_staff_id)===staffId){await conn.rollback();return fail(res,422,'This assignment is already assigned to the selected staff member.');}
    await conn.execute('UPDATE client_assignments SET assigned_staff_id=:staffId,assigned_by=:actor,updated_at=NOW() WHERE id=:id',{staffId,actor:Number(req.session.user.id),id});
    const [[changed]]=await conn.execute('SELECT id,client_id,account_number,assigned_staff_id,assigned_by,is_active,updated_at FROM client_assignments WHERE id=:id',{id});
    const payload={old,changed};
    await conn.execute('INSERT INTO temporary_cleanup_changes (action_type,case_type,case_key,client_id,before_json,after_json,reviewed_by,notes) VALUES ("correct_staff","staff_conflict",:key,:clientId,:before,:after,:actor,:notes)',{
      key,clientId:Number(old.client_id)||null,before:JSON.stringify(old),after:JSON.stringify(changed),actor:Number(req.session.user.id),notes:reason
    });
    await conn.execute('INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES (:actor,"temporary_cleanup_staff_corrected","client_assignments",:id,:notes,:before,:after,:ip,:ua)',{
      actor:Number(req.session.user.id),id,notes:reason.slice(0,490),before:JSON.stringify(old),after:JSON.stringify(changed),ip:String(req.ip||'').slice(0,64),ua:String(req.get('user-agent')||'').slice(0,255)
    });
    await conn.commit();
    return res.redirect(res.locals.basePath+'/temporary-cleanup?type=staff_conflict&view=all&corrected=1');
  }catch(e){try{await conn.rollback();}catch(_){}next(e);}finally{conn.release();}
});
module.exports={router,hash};
