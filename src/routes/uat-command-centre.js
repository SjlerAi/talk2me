'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';

router.get('/command-centre', requireAuth, async (req, res, next) => {
  if (!IS_UAT) return next();
  try {
    const openStatuses = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
    const [[stats]] = await db.query(`SELECT
      (SELECT COUNT(*) FROM inquiries WHERE status IN ${openStatuses}) open_inquiries,
      (SELECT COUNT(*) FROM inquiries WHERE status IN ${openStatuses} AND follow_up_at<NOW()) overdue_inquiries,
      (SELECT COUNT(*) FROM inquiries WHERE status IN ${openStatuses} AND DATE(follow_up_at)=CURRENT_DATE()) due_today,
      (SELECT COUNT(*) FROM inquiries WHERE status IN ${openStatuses} AND COALESCE(assigned_staff_id,staff_id) IS NULL) unassigned_work,
      (SELECT COUNT(*) FROM staff_tasks WHERE status IN ('unread','seen','in_progress')) open_tasks,
      (SELECT COUNT(*) FROM staff_tasks WHERE status IN ('unread','seen','in_progress') AND due_at<NOW()) overdue_tasks,
      (SELECT COUNT(*) FROM clients WHERE line_status<>'cancelled' AND next_upgrade_date=CURRENT_DATE()) upgrades_today,
      (SELECT COUNT(*) FROM clients WHERE line_status<>'cancelled' AND next_upgrade_date<CURRENT_DATE()) overdue_upgrades,
      (SELECT COUNT(DISTINCT COALESCE(NULLIF(id_number,''),CONCAT('client:',id))) FROM clients WHERE birthday IS NOT NULL AND MONTH(birthday)=MONTH(CURRENT_DATE()) AND DAY(birthday)=DAY(CURRENT_DATE())) birthdays_today,
      (SELECT COUNT(*) FROM clients WHERE DATE(created_at)=CURRENT_DATE() AND lifecycle_status='prospect') walkins_today,
      (SELECT COUNT(*) FROM clients c WHERE c.is_active=1 AND NOT EXISTS(SELECT 1 FROM client_assignments a WHERE a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)))) unassigned_clients,
      (SELECT COUNT(*) FROM fixed_services WHERE service_status='active') active_fixed_services,
      (SELECT COUNT(*) FROM fixed_accounts WHERE assigned_staff_id IS NULL) unassigned_fixed_accounts,
      (SELECT COUNT(*) FROM data_change_requests WHERE request_type='claim_account' AND status IN ('pending_manager','pending_owner')) pending_claims`);

    const [attention] = await db.query(`
      SELECT 'inquiry' item_type,i.id item_id,i.client_id,i.client_name,i.cell_number,
        COALESCE(ass.full_name,cap.full_name,'Unassigned') owner_name,
        CASE WHEN i.follow_up_at<NOW() THEN 'Overdue inquiry' WHEN DATE(i.follow_up_at)=CURRENT_DATE() THEN 'Follow-up due today' ELSE 'Open inquiry' END reason,
        i.follow_up_at due_at,i.priority,i.status
      FROM inquiries i LEFT JOIN staff_users ass ON ass.id=i.assigned_staff_id LEFT JOIN staff_users cap ON cap.id=i.staff_id
      WHERE i.status IN ${openStatuses}
      UNION ALL
      SELECT 'task',t.id,t.related_client_id,COALESCE(c.client_name,t.title),c.cell_number,s.full_name,
        CASE WHEN t.due_at<NOW() THEN 'Overdue task' ELSE 'Task due today' END,t.due_at,t.priority,t.status
      FROM staff_tasks t JOIN staff_users s ON s.id=t.assigned_to LEFT JOIN clients c ON c.id=t.related_client_id
      WHERE t.status IN ('unread','seen','in_progress') AND (t.due_at<NOW() OR DATE(t.due_at)=CURRENT_DATE())
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,due_at IS NULL,due_at LIMIT 30`);

    const [upgrades] = await db.query(`SELECT c.id,c.client_name,c.cell_number,c.account_number,c.handset,c.next_upgrade_date,
      DATEDIFF(c.next_upgrade_date,CURRENT_DATE()) days_until,COALESCE(s.full_name,'Unassigned') assigned_name
      FROM clients c LEFT JOIN client_assignments a ON a.id=(SELECT a2.id FROM client_assignments a2 WHERE a2.is_active=1 AND (a2.client_id=c.id OR (a2.account_number<>'' AND a2.account_number=c.account_number)) ORDER BY (a2.client_id=c.id) DESC LIMIT 1)
      LEFT JOIN staff_users s ON s.id=a.assigned_staff_id
      WHERE c.line_status<>'cancelled' AND c.next_upgrade_date BETWEEN DATE_SUB(CURRENT_DATE(),INTERVAL 30 DAY) AND DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY)
      ORDER BY c.next_upgrade_date LIMIT 20`);

    const [birthdays] = await db.query(`SELECT MIN(id) id,MAX(client_name) client_name,MAX(cell_number) cell_number,MAX(email) email,MAX(birthday) birthday,COUNT(*) line_count
      FROM clients WHERE birthday IS NOT NULL AND MONTH(birthday)=MONTH(CURRENT_DATE()) AND DAY(birthday)=DAY(CURRENT_DATE())
      GROUP BY COALESCE(NULLIF(id_number,''),CONCAT('client:',id)) ORDER BY client_name LIMIT 20`);

    return res.render('command-centre', {
      title: 'Command Centre',
      stats: stats || {},
      attention,
      upgrades,
      birthdays
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
