const express = require('express');

const OPEN_STATUSES = ['open', 'follow_up', 'waiting_customer', 'waiting_network', 'waiting_supplier'];
const UPDATE_STATUSES = new Set(['open', 'resolved', 'follow_up', 'waiting_customer', 'waiting_network', 'waiting_supplier']);

module.exports = function createMyWorkRouter({ pool, requireAuth, requestIp }) {
  const router = express.Router();

  function accessSql(user) {
    if (['owner', 'manager'].includes(user.role)) return { clause: '1=1', params: {} };
    return {
      clause: 'COALESCE(i.assigned_staff_id, i.staff_id)=:currentStaffId',
      params: { currentStaffId: user.id }
    };
  }

  router.get('/api/my-work', requireAuth, async (req, res) => {
    const filter = String(req.query.filter || 'all');
    const validFilters = new Set(['all', 'overdue', 'today', 'waiting', 'open']);
    if (!validFilters.has(filter)) return res.status(400).json({ ok: false, error: 'INVALID_WORK_FILTER' });

    const access = accessSql(req.user);
    const filterSql = {
      all: '',
      overdue: 'AND i.follow_up_at IS NOT NULL AND i.follow_up_at < NOW()',
      today: 'AND i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at)=CURRENT_DATE()',
      waiting: "AND i.status IN ('waiting_customer','waiting_network','waiting_supplier')",
      open: "AND i.status IN ('open','follow_up')"
    }[filter];

    try {
      const params = { ...access.params };
      const [items] = await pool.execute(`SELECT
          i.id, i.client_id, i.client_name, i.cell_number, i.status, i.priority,
          i.query_text, i.result_found, i.action_taken, i.follow_up_at,
          i.created_at, i.updated_at,
          COALESCE(ic.category_name, i.category_other, 'Other') category,
          COALESCE(s.full_name, 'Unassigned') assigned_staff,
          CASE
            WHEN i.follow_up_at IS NOT NULL AND i.follow_up_at < NOW() THEN 'overdue'
            WHEN i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at)=CURRENT_DATE() THEN 'today'
            ELSE 'normal'
          END urgency
        FROM inquiries i
        LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
        LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id)
        WHERE ${access.clause}
          AND i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')
          ${filterSql}
        ORDER BY
          CASE WHEN i.follow_up_at IS NULL THEN 1 ELSE 0 END,
          i.follow_up_at ASC,
          i.updated_at DESC
        LIMIT 100`, params);

      const [[counts]] = await pool.execute(`SELECT
          COUNT(*) total,
          SUM(i.follow_up_at IS NOT NULL AND i.follow_up_at < NOW()) overdue,
          SUM(i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at)=CURRENT_DATE()) due_today,
          SUM(i.status IN ('waiting_customer','waiting_network','waiting_supplier')) waiting,
          SUM(i.status IN ('open','follow_up')) open_items
        FROM inquiries i
        WHERE ${access.clause}
          AND i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')`, params);

      res.json({
        ok: true,
        filter,
        scope: ['owner', 'manager'].includes(req.user.role) ? 'team' : 'personal',
        counts: {
          total: Number(counts.total || 0),
          overdue: Number(counts.overdue || 0),
          today: Number(counts.due_today || 0),
          waiting: Number(counts.waiting || 0),
          open: Number(counts.open_items || 0)
        },
        items
      });
    } catch (error) {
      console.error('My Work query failed', error);
      res.status(500).json({ ok: false, error: error.code || 'MY_WORK_QUERY_FAILED' });
    }
  });

  router.post('/api/inquiries/:id/work-update', requireAuth, async (req, res) => {
    const inquiryId = Number(req.params.id);
    const status = String(req.body.status || '').trim();
    const note = String(req.body.note || '').trim().slice(0, 3000);
    const followUpRaw = String(req.body.followUpAt || '').trim();

    if (!Number.isInteger(inquiryId) || inquiryId < 1) return res.status(400).json({ ok: false, error: 'INVALID_INQUIRY_ID' });
    if (!UPDATE_STATUSES.has(status)) return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
    if (status === 'follow_up' && !followUpRaw) return res.status(400).json({ ok: false, error: 'FOLLOW_UP_DATE_REQUIRED' });

    const followUpAt = followUpRaw ? new Date(followUpRaw) : null;
    if (followUpRaw && Number.isNaN(followUpAt.getTime())) return res.status(400).json({ ok: false, error: 'INVALID_FOLLOW_UP_DATE' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[inquiry]] = await connection.execute(`SELECT id, client_id, client_name, status, follow_up_at,
          assigned_staff_id, staff_id, action_taken
        FROM inquiries WHERE id=:inquiryId LIMIT 1 FOR UPDATE`, { inquiryId });
      if (!inquiry) {
        await connection.rollback();
        return res.status(404).json({ ok: false, error: 'INQUIRY_NOT_FOUND' });
      }

      const responsibleId = Number(inquiry.assigned_staff_id || inquiry.staff_id || 0);
      const canManageAny = ['owner', 'manager'].includes(req.user.role);
      if (!canManageAny && responsibleId !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ ok: false, error: 'NOT_ASSIGNED_TO_YOU' });
      }

      const stamp = new Intl.DateTimeFormat('en-ZA', {
        timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
      const noteLine = note ? `[${stamp} - ${req.user.full_name}] ${note}` : '';
      const actionTaken = noteLine
        ? [String(inquiry.action_taken || '').trim(), noteLine].filter(Boolean).join('\n')
        : inquiry.action_taken;
      const completedAt = status === 'resolved' ? new Date() : null;
      const completedBy = status === 'resolved' ? req.user.id : null;
      const nextFollowUp = status === 'follow_up' || status.startsWith('waiting_') ? followUpAt : null;

      await connection.execute(`UPDATE inquiries SET
          status=:status,
          follow_up_at=:followUpAt,
          completed_at=:completedAt,
          completed_by=:completedBy,
          action_taken=:actionTaken,
          updated_at=NOW()
        WHERE id=:inquiryId`, {
        status,
        followUpAt: nextFollowUp,
        completedAt,
        completedBy,
        actionTaken,
        inquiryId
      });

      const beforeJson = JSON.stringify({ status: inquiry.status, follow_up_at: inquiry.follow_up_at });
      const afterJson = JSON.stringify({ status, follow_up_at: nextFollowUp, note_added: Boolean(note) });
      await connection.execute(`INSERT INTO audit_log
        (staff_id, action_type, entity_type, entity_id, description, before_json, after_json, ip_address, user_agent, created_at)
        VALUES (:staffId, 'inquiry_work_updated', 'inquiries', :inquiryId, :description,
          :beforeJson, :afterJson, :ip, :userAgent, NOW())`, {
        staffId: req.user.id,
        inquiryId,
        description: `Updated inquiry for ${inquiry.client_name || 'customer'} to ${status}`,
        beforeJson,
        afterJson,
        ip: requestIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
      });

      await connection.commit();
      res.json({ ok: true, inquiryId, customerId: inquiry.client_id, status });
    } catch (error) {
      await connection.rollback();
      console.error('My Work update failed', error);
      res.status(500).json({ ok: false, error: error.code || 'MY_WORK_UPDATE_FAILED' });
    } finally {
      connection.release();
    }
  });

  return router;
};
