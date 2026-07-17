const db=require('../config/db');

async function audit(req,{actionType,entityType=null,entityId=null,description,before=null,after=null}){
  await db.execute(`INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent)
    VALUES (:staffId,:actionType,:entityType,:entityId,:description,:beforeJson,:afterJson,:ip,:userAgent)`,{
    staffId:req.session?.user?.id||null,actionType,entityType,entityId,description,
    beforeJson:before===null?null:JSON.stringify(before),afterJson:after===null?null:JSON.stringify(after),
    ip:String(req.ip||'').slice(0,64),userAgent:String(req.headers['user-agent']||'').slice(0,255)
  });
}

module.exports={audit};
