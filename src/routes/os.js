const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const OPEN_INQUIRY_STATUSES = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
const ACTIVE_TASK_STATUSES = "('unread','seen','in_progress')";

function isManagementRole(user) {
  return Boolean(user && ['owner', 'admin', 'manager'].includes(user.role));
}

async function loadOsStatus(userId) {
  const [[row]] = await db.execute(`SELECT
    (SELECT COUNT(*) FROM inquiries
      WHERE COALESCE(assigned_staff_id, staff_id) = :userId
        AND status IN ${OPEN_INQUIRY_STATUSES}) AS queue_count,
    (SELECT COUNT(*) FROM staff_tasks
      WHERE assigned_to = :userId
        AND status IN ${ACTIVE_TASK_STATUSES}) AS task_count,
    (SELECT COUNT(*) FROM staff_tasks
      WHERE assigned_to = :userId
        AND status = 'unread') AS unread_message_count,
    (SELECT COUNT(*) FROM staff_tasks
      WHERE assigned_to = :userId
        AND status IN ${ACTIVE_TASK_STATUSES}
        AND due_at IS NOT NULL
        AND due_at < NOW()) AS overdue_task_count,
    (SELECT COUNT(*) FROM staff_tasks
      WHERE assigned_to = :userId
        AND status IN ${ACTIVE_TASK_STATUSES}
        AND due_at IS NOT NULL
        AND DATE(due_at) = CURRENT_DATE()) AS due_today_task_count,
    (SELECT COUNT(*) FROM inquiries
      WHERE COALESCE(assigned_staff_id, staff_id) = :userId
        AND status IN ${OPEN_INQUIRY_STATUSES}
        AND follow_up_at IS NOT NULL
        AND DATE(follow_up_at) = CURRENT_DATE()) AS follow_up_today_count,
    (SELECT COUNT(DISTINCT COALESCE(NULLIF(c.id_number,''), CONCAT('client:',c.id)))
      FROM clients c
      JOIN client_assignments a ON a.is_active = 1
        AND a.assigned_staff_id = :userId
        AND (a.client_id = c.id OR (a.account_number <> '' AND a.account_number = c.account_number))
      WHERE c.birthday IS NOT NULL
        AND MONTH(c.birthday) = MONTH(CURRENT_DATE())
        AND DAY(c.birthday) = DAY(CURRENT_DATE())) AS birthdays_today_count,
    (SELECT COUNT(DISTINCT c.id)
      FROM clients c
      JOIN client_assignments a ON a.is_active = 1
        AND a.assigned_staff_id = :userId
        AND (a.client_id = c.id OR (a.account_number <> '' AND a.account_number = c.account_number))
      WHERE c.line_status <> 'cancelled'
        AND c.next_upgrade_date IS NOT NULL
        AND DATE(c.next_upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)) AS upgrades_due_count,
    (SELECT COUNT(*) FROM inquiries
      WHERE COALESCE(assigned_staff_id, staff_id) = :userId
        AND status IN ${OPEN_INQUIRY_STATUSES}
        AND follow_up_at IS NOT NULL
        AND DATE(follow_up_at) = CURRENT_DATE()) AS callbacks_today_count,
    (SELECT COUNT(*) FROM clients
      WHERE created_by_staff_id = :userId
        AND is_active = 1
        AND lifecycle_status = 'prospect'
        AND COALESCE(lead_status,'new') IN ('new','contacted','qualified')) AS new_prospects_count`, { userId });

  return {
    queueCount: Number(row?.queue_count || 0),
    taskCount: Number(row?.task_count || 0),
    unreadMessageCount: Number(row?.unread_message_count || 0),
    overdueTaskCount: Number(row?.overdue_task_count || 0),
    dueTodayTaskCount: Number(row?.due_today_task_count || 0),
    followUpTodayCount: Number(row?.follow_up_today_count || 0),
    birthdaysTodayCount: Number(row?.birthdays_today_count || 0),
    upgradesDueCount: Number(row?.upgrades_due_count || 0),
    callbacksTodayCount: Number(row?.callbacks_today_count || 0),
    newProspectsCount: Number(row?.new_prospects_count || 0)
  };
}

router.get('/workspace', requireAuth, async (req, res, next) => {
  try {
    const status = await loadOsStatus(req.session.user.id);
    res.render('os-shell', {
      layout: false,
      title: 'Talk2Me OS',
      status,
      isManagement: isManagementRole(req.session.user)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/os/status', requireAuth, async (req, res, next) => {
  try {
    const status = await loadOsStatus(req.session.user.id);
    res.json({
      ok: true,
      status,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
