const express = require('express');

module.exports = function createReportRouter({ pool, requireAuth }) {
  const router = express.Router();
  const canManage = user => ['owner', 'manager'].includes(user.role);
  const clampDays = value => Math.min(365, Math.max(1, Number(value || 30)));

  function scopeSql(user, alias = 'i') {
    return canManage(user) ? { sql: '', params: {} } : {
      sql: ` AND COALESCE(${alias}.assigned_staff_id, ${alias}.staff_id)=:staffId`,
      params: { staffId: user.id }
    };
  }

  async function scalar(sql, params = {}) {
    const [[row]] = await pool.execute(sql, params);
    return Number(row?.total || 0);
  }

  router.get('/api/reporting/summary', requireAuth, async (req, res) => {
    const days = clampDays(req.query.days);
    const inquiryScope = scopeSql(req.user, 'i');
    const attendanceScope = canManage(req.user) ? { sql: '', params: {} } : {
      sql: ' AND a.staff_id=:staffId',
      params: { staffId: req.user.id }
    };

    try {
      const params = { days, ...inquiryScope.params };
      const [inquiries, resolved, active, overdue, attendanceMinutes, unassigned, upgrades, prospects, birthdays] = await Promise.all([
        scalar(`SELECT COUNT(*) total FROM inquiries i WHERE i.created_at>=DATE_SUB(NOW(),INTERVAL :days DAY)${inquiryScope.sql}`, params),
        scalar(`SELECT COUNT(*) total FROM inquiries i WHERE i.created_at>=DATE_SUB(NOW(),INTERVAL :days DAY) AND i.status='resolved'${inquiryScope.sql}`, params),
        scalar(`SELECT COUNT(*) total FROM inquiries i WHERE i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')${inquiryScope.sql}`, inquiryScope.params),
        scalar(`SELECT COUNT(*) total FROM inquiries i WHERE i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND i.follow_up_at IS NOT NULL AND i.follow_up_at<NOW()${inquiryScope.sql}`, inquiryScope.params),
        scalar(`SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE,a.clock_in_at,COALESCE(a.clock_out_at,NOW()))),0) total FROM attendance_sessions a WHERE a.work_date>=DATE_SUB(CURRENT_DATE(),INTERVAL :days DAY)${attendanceScope.sql}`, { days, ...attendanceScope.params }),
        scalar(`SELECT COUNT(DISTINCT COALESCE(NULLIF(c.account_number,''),CONCAT('client:',c.id))) total FROM clients c WHERE c.is_active=1 AND NOT EXISTS (SELECT 1 FROM client_assignments a WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)))`),
        scalar(`SELECT COUNT(DISTINCT c.id) total FROM clients c WHERE c.is_active=1 AND c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL :days DAY)`, { days }),
        scalar(`SELECT COUNT(DISTINCT c.id) total FROM clients c WHERE c.is_active=1 AND c.lifecycle_status='prospect'`),
        scalar(`SELECT COUNT(DISTINCT c.id) total FROM clients c WHERE c.is_active=1 AND c.birthday IS NOT NULL AND MONTH(c.birthday)=MONTH(CURRENT_DATE()) AND DAY(c.birthday)=DAY(CURRENT_DATE())`)
      ]);
      res.json({ ok: true, teamView: canManage(req.user), summary: { inquiries, resolved, active, overdue, attendanceMinutes, unassigned, upgrades, prospects, birthdays } });
    } catch (error) {
      console.error('Report summary failed', error);
      res.status(500).json({ ok: false, error: error.code || 'REPORT_SUMMARY_FAILED' });
    }
  });

  async function reportData(report, days, user, limit = 500) {
    const inquiryScope = scopeSql(user, 'i');
    if (report === 'attendance') {
      const scope = canManage(user) ? { sql: '', params: {} } : { sql: ' AND a.staff_id=:staffId', params: { staffId: user.id } };
      const [rows] = await pool.execute(`SELECT DATE_FORMAT(a.work_date,'%d %b %Y') Work_Date,s.full_name Staff_Member,DATE_FORMAT(a.clock_in_at,'%d %b %Y, %H:%i') Clock_In,DATE_FORMAT(a.clock_out_at,'%d %b %Y, %H:%i') Clock_Out,TIMESTAMPDIFF(MINUTE,a.clock_in_at,COALESCE(a.clock_out_at,NOW())) Minutes,a.status Status FROM attendance_sessions a JOIN staff_users s ON s.id=a.staff_id WHERE a.work_date>=DATE_SUB(CURRENT_DATE(),INTERVAL :days DAY)${scope.sql} ORDER BY a.work_date DESC,a.clock_in_at DESC LIMIT ${Number(limit)}`, { days, ...scope.params });
      return { columns: ['Work Date','Staff Member','Clock In','Clock Out','Minutes','Status'], rows };
    }
    if (report === 'assignments') {
      const scope = canManage(user) ? { sql: '', params: {} } : { sql: ' AND COALESCE(a.assigned_staff_id,0)=:staffId', params: { staffId: user.id } };
      const [rows] = await pool.execute(`SELECT c.client_name Customer,c.account_number Account,c.cell_number Cell,COALESCE(s.full_name,'Unassigned') Assigned_To,c.city_town Town,c.line_status Status FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE c.is_active=1${scope.sql} ORDER BY Assigned_To,c.client_name LIMIT ${Number(limit)}`, scope.params);
      return { columns: ['Customer','Account','Cell','Assigned To','Town','Status'], rows };
    }
    if (report === 'opportunities') {
      const scope = canManage(user) ? { sql: '', params: {} } : { sql: ' AND COALESCE(a.assigned_staff_id,0)=:staffId', params: { staffId: user.id } };
      const [rows] = await pool.execute(`SELECT c.client_name Customer,c.account_number Account,c.cell_number Cell,DATE_FORMAT(c.next_upgrade_date,'%d %b %Y') Next_Upgrade,DATE_FORMAT(c.cancellation_date,'%d %b %Y') Cancellation_Date,c.lifecycle_status Lifecycle,COALESCE(s.full_name,'Unassigned') Assigned_To FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) LEFT JOIN staff_users s ON s.id=a.assigned_staff_id WHERE c.is_active=1 AND ((c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL :days DAY)) OR c.lifecycle_status='prospect' OR (c.cancellation_date IS NOT NULL AND DATE(c.cancellation_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL :days DAY)))${scope.sql} ORDER BY COALESCE(c.next_upgrade_date,c.cancellation_date),c.client_name LIMIT ${Number(limit)}`, { days, ...scope.params });
      return { columns: ['Customer','Account','Cell','Next Upgrade','Cancellation Date','Lifecycle','Assigned To'], rows };
    }
    const [rows] = await pool.execute(`SELECT DATE_FORMAT(i.created_at,'%d %b %Y, %H:%i') Created,COALESCE(i.client_name,'Unknown') Customer,COALESCE(s.full_name,'Unassigned') Staff_Member,COALESCE(ic.category_name,i.category_other,'Other') Category,i.status Status,DATE_FORMAT(i.follow_up_at,'%d %b %Y, %H:%i') Follow_Up FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id) WHERE i.created_at>=DATE_SUB(NOW(),INTERVAL :days DAY)${inquiryScope.sql} ORDER BY i.created_at DESC LIMIT ${Number(limit)}`, { days, ...inquiryScope.params });
    return { columns: ['Created','Customer','Staff member','Category','Status','Follow-up'], rows };
  }

  router.get('/api/reporting/table', requireAuth, async (req, res) => {
    const report = String(req.query.report || 'inquiries');
    const days = clampDays(req.query.days);
    try {
      const data = await reportData(report, days, req.user, 500);
      res.json({ ok: true, ...data });
    } catch (error) {
      console.error('Report table failed', error);
      res.status(500).json({ ok: false, error: error.code || 'REPORT_TABLE_FAILED' });
    }
  });

  router.get('/api/reporting/export.csv', requireAuth, async (req, res) => {
    const report = String(req.query.report || 'inquiries');
    const days = clampDays(req.query.days);
    try {
      const data = await reportData(report, days, req.user, 5000);
      const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const lines = [data.columns.map(escapeCsv).join(',')];
      for (const row of data.rows) lines.push(Object.values(row).map(escapeCsv).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="talk2me-${report}-${days}-days.csv"`);
      res.send(`\uFEFF${lines.join('\r\n')}`);
    } catch (error) {
      console.error('Report export failed', error);
      res.status(500).json({ ok: false, error: error.code || 'REPORT_EXPORT_FAILED' });
    }
  });

  return router;
};
