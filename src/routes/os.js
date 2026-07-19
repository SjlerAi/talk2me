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
        AND due_at < NOW()) AS overdue_task_count`, { userId });

  return {
    queueCount: Number(row?.queue_count || 0),
    taskCount: Number(row?.task_count || 0),
    unreadMessageCount: Number(row?.unread_message_count || 0),
    overdueTaskCount: Number(row?.overdue_task_count || 0)
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
