const express = require('express');

module.exports = function createOpportunityRouter({ pool, requireAuth, requestIp }) {
  const router = express.Router();
  const manager = user => ['owner','manager'].includes(user.role);

  async function audit(req, actionType, clientId, description, after) {
    await pool.execute(`INSERT INTO audit_log
      (staff_id,action_type,entity_type,entity_id,description,after_json,ip_address,user_agent,created_at)
      VALUES (:staffId,:actionType,'clients',:clientId,:description,:afterJson,:ip,:agent,NOW())`, {
      staffId:req.user.id, actionType, clientId, description,
      afterJson:JSON.stringify(after || {}), ip:requestIp(req),
      agent:String(req.headers['user-agent'] || '').slice(0,255)
    });
  }

  router.get('/api/opportunities', requireAuth, async (req,res) => {
    const type = String(req.query.type || 'upgrades');
    const days = Math.min(60, Math.max(0, Number(req.query.days || 30)));
    const team = manager(req.user);
    const assignmentJoin = `LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) LEFT JOIN staff_users s ON s.id=a.assigned_staff_id`;
    const scope = team ? '' : 'AND COALESCE(a.assigned_staff_id,0)=:staffId';
    let condition = '';
    if (type === 'birthdays') condition = `c.birthday IS NOT NULL AND DATE_FORMAT(c.birthday,'%m-%d') BETWEEN DATE_FORMAT(CURRENT_DATE(),'%m-%d') AND DATE_FORMAT(DATE_ADD(CURRENT_DATE(),INTERVAL :days DAY),'%m-%d')`;
    else if (type === 'prospects') condition = `c.lifecycle_status='prospect' AND COALESCE(c.lead_status,'new') IN ('new','contacted','qualified')`;
    else if (type === 'renewals') condition = `c.cancellation_date IS NOT NULL AND DATE(c.cancellation_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL :days DAY)`;
    else condition = `c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL :days DAY)`;
    try {
      const [items] = await pool.execute(`SELECT c.id,c.client_name,c.account_number,c.cell_number,c.email,c.city_town,c.next_upgrade_date,c.birthday,c.cancellation_date,c.lifecycle_status,c.lead_status,c.package_name,c.handset,COALESCE(s.full_name,'Unassigned') assigned_staff,COALESCE(a.assigned_staff_id,0) assigned_staff_id FROM clients c ${assignmentJoin} WHERE c.is_active=1 AND ${condition} ${scope} ORDER BY COALESCE(c.next_upgrade_date,c.cancellation_date,c.birthday),c.client_name LIMIT 250`, {days,staffId:req.user.id});
      res.json({ok:true,type,days,teamView:team,items,count:items.length});
    } catch(error) {
      console.error('Opportunity query failed',error);
      res.status(500).json({ok:false,error:error.code || 'OPPORTUNITY_QUERY_FAILED'});
    }
  });

  router.post('/api/opportunities/:clientId/contacted', requireAuth, async (req,res) => {
    const clientId = Number(req.params.clientId);
    const method = String(req.body.method || 'call').slice(0,30);
    if (!Number.isInteger(clientId) || clientId < 1) return res.status(400).json({ok:false,error:'INVALID_CLIENT_ID'});
    try {
      const [[client]] = await pool.execute('SELECT id,client_name FROM clients WHERE id=:clientId AND is_active=1',{clientId});
      if (!client) return res.status(404).json({ok:false,error:'CUSTOMER_NOT_FOUND'});
      await audit(req,'opportunity_contacted',clientId,`${client.client_name} contacted by ${method}`,{method});
      res.json({ok:true,clientId});
    } catch(error) { res.status(500).json({ok:false,error:error.code || 'OPPORTUNITY_CONTACT_FAILED'}); }
  });

  router.post('/api/opportunities/:clientId/follow-up', requireAuth, async (req,res) => {
    const clientId = Number(req.params.clientId);
    const followUpAt = new Date(String(req.body.followUpAt || ''));
    const note = String(req.body.note || 'Opportunity follow-up').trim().slice(0,1000);
    if (!Number.isInteger(clientId) || clientId < 1) return res.status(400).json({ok:false,error:'INVALID_CLIENT_ID'});
    if (Number.isNaN(followUpAt.getTime())) return res.status(400).json({ok:false,error:'INVALID_FOLLOW_UP_DATE'});
    try {
      const [[client]] = await pool.execute('SELECT id,client_name,cell_number,email FROM clients WHERE id=:clientId AND is_active=1',{clientId});
      if (!client) return res.status(404).json({ok:false,error:'CUSTOMER_NOT_FOUND'});
      const [[cat]] = await pool.execute("SELECT id FROM inquiry_categories WHERE is_active=1 ORDER BY CASE WHEN LOWER(category_name) LIKE '%upgrade%' THEN 0 ELSE 1 END,sort_order,id LIMIT 1");
      const [result] = await pool.execute(`INSERT INTO inquiries (client_id,service_type,staff_id,assigned_staff_id,walkin_or_call,client_name,cell_number,email,category_id,query_text,action_taken,status,follow_up_at,owner_visible,priority,created_at,updated_at) VALUES (:clientId,'mobile',:staffId,:staffId,'other',:name,:cell,:email,:categoryId,:note,'Opportunity follow-up scheduled','follow_up',:followUpAt,1,'normal',NOW(),NOW())`,{clientId,staffId:req.user.id,name:client.client_name,cell:client.cell_number||null,email:client.email||null,categoryId:cat?.id || null,note,followUpAt});
      await audit(req,'opportunity_follow_up',clientId,`Follow-up scheduled for ${client.client_name}`,{inquiry_id:result.insertId,follow_up_at:followUpAt,note});
      res.status(201).json({ok:true,inquiryId:Number(result.insertId)});
    } catch(error) { console.error('Opportunity follow-up failed',error); res.status(500).json({ok:false,error:error.code || 'OPPORTUNITY_FOLLOW_UP_FAILED'}); }
  });

  return router;
};
