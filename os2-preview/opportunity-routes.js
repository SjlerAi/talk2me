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

  function rangeFromQuery(req) {
    const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
    return { days };
  }

  router.get('/api/reports/summary', requireAuth, async (req,res) => {
    const { days } = rangeFromQuery(req);
    const team = manager(req.user);
    const inquiryScope = team ? '' : 'AND COALESCE(i.assigned_staff_id,i.staff_id)=:staffId';
    const attendanceScope = team ? '' : 'AND a.staff_id=:staffId';
    try {
      const params = {days,staffId:req.user.id};
      const [[inquiries]] = await pool.execute(`SELECT COUNT(*) total,
        SUM(status='resolved') resolved,
        SUM(status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')) active,
        SUM(status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND follow_up_at<NOW()) overdue
        FROM inquiries i WHERE i.created_at>=DATE_SUB(NOW(),INTERVAL :days DAY) ${inquiryScope}`,params);
      const [[attendance]] = await pool.execute(`SELECT COUNT(*) sessions,
        COUNT(DISTINCT a.staff_id) staff_count,
        COALESCE(SUM(TIMESTAMPDIFF(MINUTE,a.clock_in_at,COALESCE(a.clock_out_at,NOW()))),0) minutes
        FROM attendance_sessions a WHERE a.work_date>=DATE_SUB(CURRENT_DATE(),INTERVAL :days DAY) ${attendanceScope}`,params);
      const [[assignments]] = await pool.execute(`SELECT COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN c.id END) assigned,
        COUNT(DISTINCT CASE WHEN a.id IS NULL THEN c.id END) unassigned
        FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number))
        WHERE c.is_active=1`);
      const [[opportunities]] = await pool.execute(`SELECT
        SUM(c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL 30 DAY)) upgrades,
        SUM(c.birthday IS NOT NULL AND DATE_FORMAT(c.birthday,'%m-%d')=DATE_FORMAT(CURRENT_DATE(),'%m-%d')) birthdays,
        SUM(c.lifecycle_status='prospect' AND COALESCE(c.lead_status,'new') IN ('new','contacted','qualified')) prospects
        FROM clients c WHERE c.is_active=1`);
      res.json({ok:true,days,teamView:team,summary:{
        inquiries:Number(inquiries.total||0),resolved:Number(inquiries.resolved||0),active:Number(inquiries.active||0),overdue:Number(inquiries.overdue||0),
        attendanceSessions:Number(attendance.sessions||0),attendanceMinutes:Number(attendance.minutes||0),attendanceStaff:Number(attendance.staff_count||0),
        assigned:Number(assignments.assigned||0),unassigned:Number(assignments.unassigned||0),
        upgrades:Number(opportunities.upgrades||0),birthdays:Number(opportunities.birthdays||0),prospects:Number(opportunities.prospects||0)
      }});
    } catch(error) { console.error('Report summary failed',error); res.status(500).json({ok:false,error:error.code||'REPORT_SUMMARY_FAILED'}); }
  });

  router.get('/api/reports/table', requireAuth, async (req,res) => {
    const report = String(req.query.report || 'inquiries');
    const { days } = rangeFromQuery(req);
    const team = manager(req.user);
    const params = {days,staffId:req.user.id};
    try {
      let columns=[]; let rows=[];
      if(report==='attendance') {
        columns=['Staff member','Date','Clock in','Clock out','Minutes','Status'];
        const scope=team?'':'AND a.staff_id=:staffId';
        [rows]=await pool.execute(`SELECT s.full_name staff_member,a.work_date,a.clock_in_at,a.clock_out_at,TIMESTAMPDIFF(MINUTE,a.clock_in_at,COALESCE(a.clock_out_at,NOW())) minutes,a.status FROM attendance_sessions a JOIN staff_users s ON s.id=a.staff_id WHERE a.work_date>=DATE_SUB(CURRENT_DATE(),INTERVAL :days DAY) ${scope} ORDER BY a.work_date DESC,a.clock_in_at DESC LIMIT 500`,params);
      } else if(report==='assignments') {
        columns=['Customer','Account','Assigned staff','Town'];
        [rows]=await pool.execute(`SELECT c.client_name customer,c.account_number account,COALESCE(s.full_name,'Unassigned') assigned_staff,c.city_town town FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE c.is_active=1 ${team?'':'AND COALESCE(a.assigned_staff_id,0)=:staffId'} ORDER BY assigned_staff,c.client_name LIMIT 500`,params);
      } else if(report==='opportunities') {
        columns=['Customer','Account','Upgrade date','Birthday','Prospect','Assigned staff'];
        [rows]=await pool.execute(`SELECT c.client_name customer,c.account_number account,c.next_upgrade_date upgrade_date,c.birthday,IF(c.lifecycle_status='prospect','Yes','No') prospect,COALESCE(s.full_name,'Unassigned') assigned_staff FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE c.is_active=1 AND (c.next_upgrade_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL :days DAY) OR c.lifecycle_status='prospect') ${team?'':'AND COALESCE(a.assigned_staff_id,0)=:staffId'} ORDER BY c.next_upgrade_date,c.client_name LIMIT 500`,params);
      } else {
        columns=['Created','Customer','Staff member','Category','Status','Follow-up'];
        const scope=team?'':'AND COALESCE(i.assigned_staff_id,i.staff_id)=:staffId';
        [rows]=await pool.execute(`SELECT i.created_at created,i.client_name customer,COALESCE(s.full_name,'Unassigned') staff_member,COALESCE(ic.category_name,i.category_other,'Other') category,i.status,i.follow_up_at follow_up FROM inquiries i LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id) LEFT JOIN inquiry_categories ic ON ic.id=i.category_id WHERE i.created_at>=DATE_SUB(NOW(),INTERVAL :days DAY) ${scope} ORDER BY i.created_at DESC LIMIT 500`,params);
      }
      res.json({ok:true,report,days,teamView:team,columns,rows});
    } catch(error) { console.error('Report table failed',error); res.status(500).json({ok:false,error:error.code||'REPORT_TABLE_FAILED'}); }
  });

  router.get('/api/reports/export.csv', requireAuth, async (req,res) => {
    try {
      req.query.report = String(req.query.report || 'inquiries');
      const report = req.query.report;
      const days = Math.min(365,Math.max(1,Number(req.query.days||30)));
      const team=manager(req.user); const params={days,staffId:req.user.id};
      let rows=[];
      if(report==='attendance') [rows]=await pool.execute(`SELECT s.full_name staff_member,a.work_date,a.clock_in_at,a.clock_out_at,TIMESTAMPDIFF(MINUTE,a.clock_in_at,COALESCE(a.clock_out_at,NOW())) minutes,a.status FROM attendance_sessions a JOIN staff_users s ON s.id=a.staff_id WHERE a.work_date>=DATE_SUB(CURRENT_DATE(),INTERVAL :days DAY) ${team?'':'AND a.staff_id=:staffId'} ORDER BY a.work_date DESC,a.clock_in_at DESC LIMIT 5000`,params);
      else if(report==='assignments') [rows]=await pool.execute(`SELECT c.client_name customer,c.account_number account,COALESCE(s.full_name,'Unassigned') assigned_staff,c.city_town town FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE c.is_active=1 ${team?'':'AND COALESCE(a.assigned_staff_id,0)=:staffId'} ORDER BY assigned_staff,c.client_name LIMIT 5000`,params);
      else if(report==='opportunities') [rows]=await pool.execute(`SELECT c.client_name customer,c.account_number account,c.next_upgrade_date upgrade_date,c.birthday,c.lifecycle_status,COALESCE(s.full_name,'Unassigned') assigned_staff FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE c.is_active=1 AND (c.next_upgrade_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL :days DAY) OR c.lifecycle_status='prospect') ${team?'':'AND COALESCE(a.assigned_staff_id,0)=:staffId'} ORDER BY c.next_upgrade_date,c.client_name LIMIT 5000`,params);
      else [rows]=await pool.execute(`SELECT i.created_at,i.client_name customer,COALESCE(s.full_name,'Unassigned') staff_member,COALESCE(ic.category_name,i.category_other,'Other') category,i.status,i.follow_up_at FROM inquiries i LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id) LEFT JOIN inquiry_categories ic ON ic.id=i.category_id WHERE i.created_at>=DATE_SUB(NOW(),INTERVAL :days DAY) ${team?'':'AND COALESCE(i.assigned_staff_id,i.staff_id)=:staffId'} ORDER BY i.created_at DESC LIMIT 5000`,params);
      const headers=rows.length?Object.keys(rows[0]):['no_data'];
      const csv=[headers.join(','),...rows.map(row=>headers.map(h=>`"${String(row[h]??'').replace(/"/g,'""')}"`).join(','))].join('\n');
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="talk2me-${report}-${new Date().toISOString().slice(0,10)}.csv"`);
      res.send('\uFEFF'+csv);
    } catch(error) { console.error('Report export failed',error); res.status(500).json({ok:false,error:error.code||'REPORT_EXPORT_FAILED'}); }
  });

  return router;
};
