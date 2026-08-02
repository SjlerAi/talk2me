'use strict';

const MANAGEMENT_ROLES = new Set(['owner','manager','admin']);

function text(value,max=180){const result=String(value==null?'':value).trim();return result?result.slice(0,max):null;}
function normalisePhone(value){let phone=String(value||'').replace(/\D/g,'');if(phone.startsWith('27')&&phone.length===11)phone=`0${phone.slice(2)}`;return phone;}

module.exports=function createScopedCustomerSearch({pool}){
  return async function scopedCustomerSearch(req,res,next){
    if(req.method!=='GET'||req.path!=='/api/os2/customers/search'||!req.user)return next();
    const role=String(req.user.role||'').toLowerCase();
    if(MANAGEMENT_ROLES.has(role))return next();
    const query=text(req.query.q);
    if(!query||query.length<2)return res.json({ok:true,customers:[]});
    const like=`%${query}%`;const canonical=normalisePhone(query);
    try{
      const [rows]=await pool.execute(`
        SELECT mc.id,mc.customer_type,mc.display_name,mc.responsible_person,mc.primary_mobile,mc.primary_email,mc.town,mc.status,
               o.assigned_staff_id,su.full_name owner_name,
               GROUP_CONCAT(DISTINCT a.account_number ORDER BY a.account_number SEPARATOR ', ') account_numbers,
               COUNT(DISTINCT ml.id) mobile_line_count,COUNT(DISTINCT fs.id) fixed_service_count,
               CASE WHEN o.assigned_staff_id=:staffId THEN 'ownership' ELSE 'grant' END access_source,
               CASE WHEN o.assigned_staff_id=:staffId THEN 'manage' ELSE MAX(g.access_level) END access_level
          FROM os2_master_customers mc
          LEFT JOIN os2_customer_accounts a ON a.master_customer_id=mc.id AND a.archived_at IS NULL
          LEFT JOIN os2_mobile_lines ml ON ml.master_customer_id=mc.id AND ml.archived_at IS NULL
          LEFT JOIN os2_fixed_accounts fa ON fa.master_customer_id=mc.id AND fa.archived_at IS NULL
          LEFT JOIN os2_fixed_services fs ON fs.fixed_account_id=fa.id AND fs.archived_at IS NULL
          LEFT JOIN os2_customer_ownership o ON o.master_customer_id=mc.id AND o.is_current=1 AND (o.access_expires_at IS NULL OR o.access_expires_at>NOW())
          LEFT JOIN staff_users su ON su.id=o.assigned_staff_id
          LEFT JOIN os2_customer_access_grants g ON g.master_customer_id=mc.id AND g.staff_id=:staffId AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
         WHERE mc.archived_at IS NULL
           AND (o.assigned_staff_id=:staffId OR g.id IS NOT NULL)
           AND (mc.display_name LIKE :like OR mc.responsible_person LIKE :like OR mc.primary_mobile LIKE :like OR mc.primary_email LIKE :like OR mc.town LIKE :like
             OR EXISTS(SELECT 1 FROM os2_customer_accounts ca WHERE ca.master_customer_id=mc.id AND ca.account_number LIKE :like AND ca.archived_at IS NULL)
             OR EXISTS(SELECT 1 FROM os2_mobile_lines x WHERE x.master_customer_id=mc.id AND (x.mobile_number LIKE :like OR x.sim_number LIKE :like OR x.imei LIKE :like) AND x.archived_at IS NULL)
             OR EXISTS(SELECT 1 FROM os2_fixed_accounts y WHERE y.master_customer_id=mc.id AND y.fixed_account_number LIKE :like AND y.archived_at IS NULL)
             OR EXISTS(SELECT 1 FROM os2_fixed_services z JOIN os2_fixed_accounts q ON q.id=z.fixed_account_id WHERE q.master_customer_id=mc.id AND (z.mac_address LIKE :like OR z.solution_id LIKE :like OR z.order_number LIKE :like) AND z.archived_at IS NULL))
         GROUP BY mc.id,o.assigned_staff_id,su.full_name
         ORDER BY (mc.primary_mobile=:canonical) DESC,mc.display_name LIMIT 25`,{staffId:Number(req.user.id),like,canonical});
      await pool.execute(`INSERT INTO os2_customer_access_events(staff_id,event_type,query_text,result_count,request_id,ip_address,created_at)
        VALUES(:staffId,'scoped_search',:query,:resultCount,:requestId,:ip,NOW())`,{
        staffId:Number(req.user.id),query:query.slice(0,180),resultCount:rows.length,requestId:req.requestId||null,
        ip:String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,64)
      }).catch(()=>{});
      return res.json({ok:true,customers:rows,scope:'authorised_customers'});
    }catch(error){console.error('Scoped customer search failed',error.code||error.message);return res.status(500).json({ok:false,error:'CUSTOMER_SEARCH_FAILED'});}
  };
};
