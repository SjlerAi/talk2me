const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const IS_UAT = String(process.env.UAT_MODE || '').trim().toLowerCase() === 'true';
const MANAGEMENT_ROLES = new Set(['owner', 'admin', 'manager']);
const OPEN_INQUIRY_STATUSES = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
const ACTIVE_TASK_STATUSES = "('unread','seen','in_progress')";
let schemaPromise;

function isManagement(user) {
  return Boolean(user && MANAGEMENT_ROLES.has(String(user.role || '').toLowerCase()));
}

function clean(value, max = 5000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function dateOnly(value) {
  const raw = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return raw;
}

function dateTime(value, fallbackDate = null) {
  const raw = clean(value, 19);
  if (raw) {
    const normalized = raw.replace('T', ' ');
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isNaN(parsed.getTime())) return normalized.length === 16 ? `${normalized}:00` : normalized;
  }
  if (fallbackDate) return `${fallbackDate} 09:00:00`;
  return null;
}

function sqlDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sqlTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + days);
  return sqlDate(date);
}

function within(dateText, start, end) {
  return Boolean(dateText && dateText >= start && dateText <= end);
}

function birthdayOccurrences(birthday, start, end) {
  const raw = sqlDate(birthday);
  if (!raw) return [];
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const dates = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const parsed = new Date(`${candidate}T12:00:00`);
    if (parsed.getMonth() + 1 === month && parsed.getDate() === day && within(candidate, start, end)) dates.push(candidate);
  }
  return dates;
}

async function ensureSchema() {
  if (!IS_UAT) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`CREATE TABLE IF NOT EXISTS staff_scratchpads (
        staff_id BIGINT UNSIGNED NOT NULL,
        note_text MEDIUMTEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (staff_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await db.query(`CREATE TABLE IF NOT EXISTS calendar_personal_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        item_type VARCHAR(30) NOT NULL DEFAULT 'reminder',
        title VARCHAR(255) NOT NULL,
        details TEXT NULL,
        starts_at DATETIME NOT NULL,
        ends_at DATETIME NULL,
        assigned_to BIGINT UNSIGNED NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        client_id BIGINT UNSIGNED NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'open',
        completed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_calendar_personal_assignee_date (assigned_to, starts_at, status),
        KEY idx_calendar_personal_creator (created_by, created_at),
        KEY idx_calendar_personal_client (client_id, starts_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

router.get('/api/productivity/health', async (req, res) => {
  if (!IS_UAT) return res.sendStatus(404);
  try {
    await ensureSchema();
    const [rows] = await db.execute(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('staff_scratchpads','calendar_personal_items')
      ORDER BY TABLE_NAME`);
    const names = rows.map(row => row.TABLE_NAME);
    res.json({
      status: names.length === 2 ? 'ok' : 'error',
      environment: 'uat',
      database: 'connected',
      scratchpad: names.includes('staff_scratchpads'),
      calendar: names.includes('calendar_personal_items')
    });
  } catch (error) {
    res.status(503).json({ status: 'error', environment: 'uat', database: 'unavailable' });
  }
});

router.get('/api/scratchpad', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const staffId = Number(req.session.user.id);
    const [[row]] = await db.execute('SELECT note_text, updated_at FROM staff_scratchpads WHERE staff_id=:staffId LIMIT 1', { staffId });
    res.json({ ok: true, note: row?.note_text || '', updatedAt: row?.updated_at || null });
  } catch (error) { next(error); }
});

router.put('/api/scratchpad', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const staffId = Number(req.session.user.id);
    const note = String(req.body?.note == null ? '' : req.body.note).slice(0, 20000);
    await db.execute(`INSERT INTO staff_scratchpads (staff_id,note_text)
      VALUES (:staffId,:note)
      ON DUPLICATE KEY UPDATE note_text=VALUES(note_text),updated_at=NOW()`, { staffId, note });
    res.json({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

router.get('/calendar', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const management = isManagement(req.session.user);
    const selectedDate = dateOnly(req.query.date) || sqlDate(new Date());
    const [staff] = management
      ? await db.query('SELECT id,full_name FROM staff_users WHERE is_active=1 ORDER BY full_name')
      : [[]];
    res.render('calendar-hub', {
      title: 'My Day & Calendar',
      selectedDate,
      isManagement: management,
      staff,
      userId: Number(req.session.user.id)
    });
  } catch (error) { next(error); }
});

router.get('/api/calendar/events', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = Number(req.session.user.id);
    const management = isManagement(req.session.user);
    const scope = management && String(req.query.scope || '') === 'team' ? 'team' : 'mine';
    const today = sqlDate(new Date());
    const start = dateOnly(req.query.start) || addDays(today, -7);
    const end = dateOnly(req.query.end) || addDays(today, 35);
    const span = Math.round((new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000);
    if (span < 0 || span > 70) return res.status(400).json({ ok: false, error: 'Calendar range must be between 0 and 70 days.' });

    const team = scope === 'team' ? 1 : 0;
    const params = { userId, start, end, team };
    const events = [];

    const [personal] = await db.execute(`SELECT p.*,ass.full_name assigned_name,c.client_name
      FROM calendar_personal_items p
      JOIN staff_users ass ON ass.id=p.assigned_to
      LEFT JOIN clients c ON c.id=p.client_id
      WHERE DATE(p.starts_at) BETWEEN :start AND :end
        AND (:team=1 OR p.assigned_to=:userId)
      ORDER BY p.starts_at,p.id`, params);
    for (const row of personal) {
      events.push({
        id: `personal:${row.id}`, source: 'personal', sourceId: row.id, type: row.item_type || 'reminder',
        title: row.title, details: row.details || '', date: sqlDate(row.starts_at), time: sqlTime(row.starts_at),
        status: row.status, assignedTo: row.assigned_to, assignedName: row.assigned_name,
        clientId: row.client_id || null, clientName: row.client_name || null,
        url: row.client_id ? `${res.locals.basePath}/customers/${row.client_id}/360` : null,
        editable: true
      });
    }

    const [tasks] = await db.execute(`SELECT t.id,t.title,t.message,t.priority,t.status,t.due_at,t.assigned_to,
      ass.full_name assigned_name,t.related_client_id,c.client_name
      FROM staff_tasks t JOIN staff_users ass ON ass.id=t.assigned_to
      LEFT JOIN clients c ON c.id=t.related_client_id
      WHERE t.due_at IS NOT NULL AND DATE(t.due_at) BETWEEN :start AND :end
        AND (:team=1 OR t.assigned_to=:userId)
      ORDER BY t.due_at,t.id`, params);
    for (const row of tasks) {
      events.push({
        id: `task:${row.id}`, source: 'task', sourceId: row.id, type: 'task', title: row.title,
        details: row.message || '', date: sqlDate(row.due_at), time: sqlTime(row.due_at), status: row.status,
        priority: row.priority, assignedTo: row.assigned_to, assignedName: row.assigned_name,
        clientId: row.related_client_id || null, clientName: row.client_name || null,
        url: `${res.locals.basePath}/tasks/${row.id}`, editable: false
      });
    }

    const [followups] = await db.execute(`SELECT f.id,f.client_id,f.customer_name,f.contact_number,f.reason,f.notes,f.scheduled_at,
      f.assigned_to,f.status,ass.full_name assigned_name
      FROM customer_followups f JOIN staff_users ass ON ass.id=f.assigned_to
      WHERE DATE(f.scheduled_at) BETWEEN :start AND :end
        AND (:team=1 OR f.assigned_to=:userId)
      ORDER BY f.scheduled_at,f.id`, params);
    for (const row of followups) {
      events.push({
        id: `followup:${row.id}`, source: 'followup', sourceId: row.id, type: 'follow-up',
        title: row.customer_name ? `Follow-up · ${row.customer_name}` : 'Customer follow-up',
        details: [row.reason, row.notes, row.contact_number].filter(Boolean).join(' · '),
        date: sqlDate(row.scheduled_at), time: sqlTime(row.scheduled_at), status: row.status,
        assignedTo: row.assigned_to, assignedName: row.assigned_name, clientId: row.client_id || null,
        clientName: row.customer_name || null,
        url: row.client_id ? `${res.locals.basePath}/customers/${row.client_id}/360` : `${res.locals.basePath}/os/productivity/follow-up/${row.id}`,
        editable: false
      });
    }

    const [callbacks] = await db.execute(`SELECT c.id,c.client_id,c.customer_name,c.contact_number,c.reason,c.notes,c.scheduled_at,
      c.assigned_to,c.status,ass.full_name assigned_name
      FROM customer_callbacks c JOIN staff_users ass ON ass.id=c.assigned_to
      WHERE DATE(c.scheduled_at) BETWEEN :start AND :end
        AND (:team=1 OR c.assigned_to=:userId)
      ORDER BY c.scheduled_at,c.id`, params);
    for (const row of callbacks) {
      events.push({
        id: `callback:${row.id}`, source: 'callback', sourceId: row.id, type: 'callback',
        title: row.customer_name ? `Callback · ${row.customer_name}` : 'Scheduled callback',
        details: [row.reason, row.notes, row.contact_number].filter(Boolean).join(' · '),
        date: sqlDate(row.scheduled_at), time: sqlTime(row.scheduled_at), status: row.status,
        assignedTo: row.assigned_to, assignedName: row.assigned_name, clientId: row.client_id || null,
        clientName: row.customer_name || null,
        url: row.client_id ? `${res.locals.basePath}/customers/${row.client_id}/360` : `${res.locals.basePath}/os/productivity/callback/${row.id}`,
        editable: false
      });
    }

    const [legacyFollowups] = await db.execute(`SELECT i.id,i.client_id,i.client_name,i.cell_number,i.query_text,i.action_taken,
      i.follow_up_at,i.status,COALESCE(i.assigned_staff_id,i.staff_id) assigned_to,ass.full_name assigned_name
      FROM inquiries i
      LEFT JOIN staff_users ass ON ass.id=COALESCE(i.assigned_staff_id,i.staff_id)
      WHERE i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at) BETWEEN :start AND :end
        AND i.status IN ${OPEN_INQUIRY_STATUSES}
        AND (:team=1 OR COALESCE(i.assigned_staff_id,i.staff_id)=:userId)
      ORDER BY i.follow_up_at,i.id`, params);
    for (const row of legacyFollowups) {
      events.push({
        id: `inquiry:${row.id}`, source: 'inquiry', sourceId: row.id, type: 'follow-up',
        title: row.client_name ? `Follow-up · ${row.client_name}` : 'Inquiry follow-up',
        details: [row.query_text, row.action_taken, row.cell_number].filter(Boolean).join(' · '),
        date: sqlDate(row.follow_up_at), time: sqlTime(row.follow_up_at), status: row.status,
        assignedTo: row.assigned_to || null, assignedName: row.assigned_name || 'Unassigned',
        clientId: row.client_id || null, clientName: row.client_name || null,
        url: row.client_id ? `${res.locals.basePath}/customers/${row.client_id}/360` : `${res.locals.basePath}/queries/${row.id}`,
        editable: false
      });
    }

    const assignmentScope = team
      ? ''
      : 'AND a.assigned_staff_id=:userId';
    const [clients] = await db.execute(`SELECT DISTINCT c.id,c.id_number,c.account_number,c.client_name,c.cell_number,c.birthday,
      c.next_upgrade_date,c.upgrade_date,a.assigned_staff_id,ass.full_name assigned_name
      FROM clients c
      LEFT JOIN client_assignments a ON a.is_active=1
        AND (a.client_id=c.id OR (COALESCE(a.account_number,'')<>'' AND a.account_number=c.account_number))
      LEFT JOIN staff_users ass ON ass.id=a.assigned_staff_id
      WHERE c.is_active=1
        AND (c.birthday IS NOT NULL OR COALESCE(c.next_upgrade_date,c.upgrade_date) IS NOT NULL)
        ${assignmentScope}
      ORDER BY c.id`, params);

    const birthdaySeen = new Set();
    const upgradeSeen = new Set();
    for (const row of clients) {
      if (row.birthday) {
        const identity = clean(row.id_number, 30) || `client:${row.id}`;
        for (const occurrence of birthdayOccurrences(row.birthday, start, end)) {
          const key = `${identity}:${occurrence}`;
          if (birthdaySeen.has(key)) continue;
          birthdaySeen.add(key);
          events.push({
            id: `birthday:${identity}:${occurrence}`, source: 'birthday', sourceId: row.id, type: 'birthday',
            title: `Birthday · ${row.client_name || 'Customer'}`, details: row.cell_number || '', date: occurrence,
            time: null, status: 'open', assignedTo: row.assigned_staff_id || null,
            assignedName: row.assigned_name || 'Unassigned', clientId: row.id, clientName: row.client_name || null,
            url: `${res.locals.basePath}/customers/${row.id}/360`, editable: false
          });
        }
      }

      const upgradeDate = sqlDate(row.next_upgrade_date || row.upgrade_date);
      if (within(upgradeDate, start, end)) {
        const key = `${row.id}:${upgradeDate}`;
        if (!upgradeSeen.has(key)) {
          upgradeSeen.add(key);
          events.push({
            id: `upgrade:${row.id}:${upgradeDate}`, source: 'upgrade', sourceId: row.id, type: 'upgrade',
            title: `Upgrade · ${row.client_name || row.cell_number || 'Mobile customer'}`,
            details: [row.cell_number, row.account_number].filter(Boolean).join(' · '), date: upgradeDate,
            time: null, status: 'open', assignedTo: row.assigned_staff_id || null,
            assignedName: row.assigned_name || 'Unassigned', clientId: row.id, clientName: row.client_name || null,
            url: `${res.locals.basePath}/customers/${row.id}/360`, editable: false
          });
        }
      }
    }

    const order = { callback: 1, 'follow-up': 2, task: 3, appointment: 4, reminder: 5, birthday: 6, upgrade: 7 };
    events.sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')) || (order[a.type] || 99) - (order[b.type] || 99) || a.title.localeCompare(b.title));
    res.json({ ok: true, scope, start, end, events });
  } catch (error) { next(error); }
});

router.post('/api/calendar/items', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const currentUserId = Number(req.session.user.id);
    const management = isManagement(req.session.user);
    const title = clean(req.body.title, 255);
    const itemType = ['reminder', 'appointment', 'other'].includes(String(req.body.item_type || '')) ? String(req.body.item_type) : 'reminder';
    const selectedDate = dateOnly(req.body.date);
    const startsAt = dateTime(req.body.starts_at, selectedDate);
    const details = clean(req.body.details, 5000) || null;
    const requestedAssignee = positiveId(req.body.assigned_to);
    const assignedTo = management && requestedAssignee ? requestedAssignee : currentUserId;
    const clientId = positiveId(req.body.client_id);
    if (!title || !startsAt) return res.status(400).json({ ok: false, error: 'Enter a title and valid date/time.' });

    if (management && requestedAssignee) {
      const [[staff]] = await db.execute('SELECT id FROM staff_users WHERE id=:id AND is_active=1 LIMIT 1', { id: requestedAssignee });
      if (!staff) return res.status(400).json({ ok: false, error: 'Assigned staff member was not found.' });
    }

    const [result] = await db.execute(`INSERT INTO calendar_personal_items
      (item_type,title,details,starts_at,assigned_to,created_by,client_id)
      VALUES (:itemType,:title,:details,:startsAt,:assignedTo,:createdBy,:clientId)`, {
      itemType, title, details, startsAt, assignedTo, createdBy: currentUserId, clientId
    });
    res.json({ ok: true, id: result.insertId });
  } catch (error) { next(error); }
});

router.post('/api/calendar/items/:id/status', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const id = positiveId(req.params.id);
    if (!id) return res.sendStatus(404);
    const userId = Number(req.session.user.id);
    const management = isManagement(req.session.user);
    const status = String(req.body.status || '') === 'completed' ? 'completed' : 'open';
    const [result] = await db.execute(`UPDATE calendar_personal_items
      SET status=:status,completed_at=${status === 'completed' ? 'NOW()' : 'NULL'},updated_at=NOW()
      WHERE id=:id AND (:management=1 OR assigned_to=:userId OR created_by=:userId)`, {
      status, id, management: management ? 1 : 0, userId
    });
    if (!result.affectedRows) return res.sendStatus(404);
    res.json({ ok: true, status });
  } catch (error) { next(error); }
});

router.delete('/api/calendar/items/:id', requireAuth, async (req, res, next) => {
  try {
    await ensureSchema();
    const id = positiveId(req.params.id);
    if (!id) return res.sendStatus(404);
    const userId = Number(req.session.user.id);
    const management = isManagement(req.session.user);
    const [result] = await db.execute(`DELETE FROM calendar_personal_items
      WHERE id=:id AND (:management=1 OR assigned_to=:userId OR created_by=:userId)`, {
      id, management: management ? 1 : 0, userId
    });
    if (!result.affectedRows) return res.sendStatus(404);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
