const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const OPEN_INQUIRY_STATUSES = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
const ACTIVE_TASK_STATUSES = "('unread','seen','in_progress')";
const QUICK_ACTIONS = new Set(['task', 'follow-up', 'callback', 'birthday', 'upgrade', 'prospect']);

function isManagementRole(user) {
  return Boolean(user && ['owner', 'admin', 'manager'].includes(user.role));
}

function text(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function nullable(value, max = 5000) {
  const result = text(value, max);
  return result || null;
}

function numberOrNull(value) {
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : null;
}

function validDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : value.replace('T', ' ').slice(0, 19);
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
    ((SELECT COUNT(*) FROM inquiries
      WHERE COALESCE(assigned_staff_id, staff_id) = :userId
        AND status IN ${OPEN_INQUIRY_STATUSES}
        AND follow_up_at IS NOT NULL
        AND DATE(follow_up_at) = CURRENT_DATE())
      + (SELECT COUNT(*) FROM customer_followups
        WHERE assigned_to = :userId AND status = 'open'
          AND DATE(scheduled_at) = CURRENT_DATE())) AS follow_up_today_count,
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
    ((SELECT COUNT(*) FROM inquiries
      WHERE COALESCE(assigned_staff_id, staff_id) = :userId
        AND status IN ${OPEN_INQUIRY_STATUSES}
        AND follow_up_at IS NOT NULL
        AND DATE(follow_up_at) = CURRENT_DATE())
      + (SELECT COUNT(*) FROM customer_callbacks
        WHERE assigned_to = :userId AND status = 'scheduled'
          AND DATE(scheduled_at) = CURRENT_DATE())) AS callbacks_today_count,
    ((SELECT COUNT(*) FROM clients
      WHERE created_by_staff_id = :userId
        AND is_active = 1
        AND lifecycle_status = 'prospect'
        AND COALESCE(lead_status,'new') IN ('new','contacted','qualified'))
      + (SELECT COUNT(*) FROM sales_prospects
        WHERE assigned_to = :userId AND status IN ('new','contacted','qualified'))) AS new_prospects_count`, { userId });

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
    res.json({ ok: true, status, serverTime: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

router.get('/os/my-work/follow-ups', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [newRows] = await db.execute(`SELECT f.id,f.client_id,f.customer_name client_name,f.contact_number cell_number,
      'Follow-up' category_name,f.reason query_text,f.scheduled_at follow_up_at
      FROM customer_followups f
      WHERE f.assigned_to=:userId AND f.status='open' AND DATE(f.scheduled_at)=CURRENT_DATE()
      ORDER BY f.scheduled_at`, { userId });
    const [legacyRows] = await db.execute(`SELECT i.id,i.client_id,i.client_name,i.cell_number,i.query_text,i.follow_up_at,
      COALESCE(ic.category_name,'Legacy inquiry') category_name
      FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
      WHERE COALESCE(i.assigned_staff_id,i.staff_id)=:userId
        AND i.status IN ${OPEN_INQUIRY_STATUSES}
        AND i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at)=CURRENT_DATE()
      ORDER BY i.follow_up_at`, { userId });
    const rows = [
      ...newRows.map(row => ({ ...row, url: `${res.locals.basePath}/os/productivity/follow-up/${row.id}` })),
      ...legacyRows.map(row => ({ ...row, url: row.client_id ? `${res.locals.basePath}/customers/${row.client_id}/360` : `${res.locals.basePath}/queries/${row.id}` }))
    ].sort((a, b) => new Date(a.follow_up_at) - new Date(b.follow_up_at));
    res.render('os-my-work', {
      title: 'Customer Follow-ups', rows,
      columns: ['client_name','cell_number','category_name','query_text','follow_up_at'],
      emptyMessage: 'No customer follow-ups are due today.'
    });
  } catch (error) { next(error); }
});

router.get('/os/my-work/callbacks', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [newRows] = await db.execute(`SELECT c.id,c.client_id,c.customer_name client_name,c.contact_number cell_number,
      'Callback' category_name,c.reason query_text,c.scheduled_at follow_up_at
      FROM customer_callbacks c
      WHERE c.assigned_to=:userId AND c.status='scheduled' AND DATE(c.scheduled_at)=CURRENT_DATE()
      ORDER BY c.scheduled_at`, { userId });
    const [legacyRows] = await db.execute(`SELECT i.id,i.client_id,i.client_name,i.cell_number,i.query_text,i.follow_up_at,
      COALESCE(ic.category_name,'Legacy inquiry') category_name
      FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
      WHERE COALESCE(i.assigned_staff_id,i.staff_id)=:userId
        AND i.status IN ${OPEN_INQUIRY_STATUSES}
        AND i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at)=CURRENT_DATE()
      ORDER BY i.follow_up_at`, { userId });
    const rows = [
      ...newRows.map(row => ({ ...row, url: `${res.locals.basePath}/os/productivity/callback/${row.id}` })),
      ...legacyRows.map(row => ({ ...row, url: row.client_id ? `${res.locals.basePath}/customers/${row.client_id}/360` : `${res.locals.basePath}/queries/${row.id}` }))
    ].sort((a, b) => new Date(a.follow_up_at) - new Date(b.follow_up_at));
    res.render('os-my-work', {
      title: 'Scheduled Callbacks', rows,
      columns: ['client_name','cell_number','category_name','query_text','follow_up_at'],
      emptyMessage: 'No scheduled callbacks today.'
    });
  } catch (error) { next(error); }
});

router.get('/os/my-work/prospects', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [newRows] = await db.execute(`SELECT id,prospect_name client_name,cell_number,email,city_town,status lead_status,created_at
      FROM sales_prospects
      WHERE assigned_to=:userId AND status IN ('new','contacted','qualified')
      ORDER BY created_at DESC`, { userId });
    const [legacyRows] = await db.execute(`SELECT id,client_name,cell_number,email,city_town,lead_status,created_at
      FROM clients
      WHERE created_by_staff_id=:userId AND is_active=1 AND lifecycle_status='prospect'
        AND COALESCE(lead_status,'new') IN ('new','contacted','qualified')
      ORDER BY created_at DESC`, { userId });
    const rows = [
      ...newRows.map(row => ({ ...row, url: `${res.locals.basePath}/os/productivity/prospect/${row.id}` })),
      ...legacyRows.map(row => ({ ...row, url: `${res.locals.basePath}/customers/${row.id}/360` }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.render('os-my-work', {
      title: 'New Prospects', rows,
      columns: ['client_name','cell_number','email','city_town','lead_status','created_at'],
      emptyMessage: 'No new prospects require attention.'
    });
  } catch (error) { next(error); }
});

router.get('/os/quick-add/:type', requireAuth, async (req, res) => {
  const type = String(req.params.type || '');
  if (!QUICK_ACTIONS.has(type)) return res.status(404).render('error', { title: 'Not found', message: 'This quick action does not exist.' });
  res.render('os-quick-add', {
    layout: false,
    title: { task: 'Add Task', 'follow-up': 'Add Customer Follow-up', callback: 'Schedule Callback', birthday: 'Add or Update Birthday', upgrade: 'Add or Update Upgrade', prospect: 'Add Prospect' }[type],
    type, error: null, saved: false, values: {}
  });
});

router.post('/os/quick-add/:type', requireAuth, async (req, res) => {
  const type = String(req.params.type || '');
  const userId = req.session.user.id;
  if (!QUICK_ACTIONS.has(type)) return res.status(404).render('error', { title: 'Not found', message: 'This quick action does not exist.' });
  const title = { task: 'Add Task', 'follow-up': 'Add Customer Follow-up', callback: 'Schedule Callback', birthday: 'Add or Update Birthday', upgrade: 'Add or Update Upgrade', prospect: 'Add Prospect' }[type];
  try {
    const clientId = numberOrNull(req.body.client_id);
    if (type === 'task') {
      const taskTitle = text(req.body.title, 200);
      if (!taskTitle) throw new Error('Enter a task title.');
      const dueAt = validDateTime(req.body.due_at);
      if (!dueAt) throw new Error('Select a valid due date and time.');
      const priority = ['normal','high','urgent'].includes(req.body.priority) ? req.body.priority : 'normal';
      await db.execute(`INSERT INTO staff_tasks
        (type,title,message,priority,status,assigned_to,created_by,due_at,related_client_id,email_status)
        VALUES ('task',:title,:message,:priority,'unread',:userId,:userId,:dueAt,:clientId,'not_configured')`, {
        title: taskTitle, message: nullable(req.body.notes), priority, userId, dueAt, clientId
      });
    } else if (type === 'follow-up') {
      if (!clientId) throw new Error('Select a customer.');
      const customerName = text(req.body.customer_name, 200);
      const scheduledAt = validDateTime(req.body.scheduled_at);
      const reason = text(req.body.reason, 255);
      if (!customerName || !scheduledAt || !reason) throw new Error('Select a customer, date and follow-up reason.');
      await db.execute(`INSERT INTO customer_followups
        (client_id,customer_name,contact_number,reason,notes,scheduled_at,assigned_to,created_by)
        VALUES (:clientId,:customerName,:contactNumber,:reason,:notes,:scheduledAt,:userId,:userId)`, {
        clientId, customerName, contactNumber: nullable(req.body.contact_number, 40), reason,
        notes: nullable(req.body.notes), scheduledAt, userId
      });
    } else if (type === 'callback') {
      if (!clientId) throw new Error('Select a customer.');
      const customerName = text(req.body.customer_name, 200);
      const contactNumber = text(req.body.callback_number || req.body.contact_number, 40);
      const scheduledAt = validDateTime(req.body.scheduled_at);
      const reason = text(req.body.reason, 255);
      if (!customerName || !contactNumber || !scheduledAt || !reason) throw new Error('Select a customer and enter the callback details.');
      await db.execute(`INSERT INTO customer_callbacks
        (client_id,customer_name,contact_number,reason,notes,scheduled_at,assigned_to,created_by)
        VALUES (:clientId,:customerName,:contactNumber,:reason,:notes,:scheduledAt,:userId,:userId)`, {
        clientId, customerName, contactNumber, reason, notes: nullable(req.body.notes), scheduledAt, userId
      });
    } else if (type === 'birthday') {
      if (!clientId) throw new Error('Select a customer.');
      const birthday = text(req.body.birthday, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new Error('Enter a valid birthday.');
      const [[client]] = await db.execute('SELECT id,id_number FROM clients WHERE id=:clientId LIMIT 1', { clientId });
      if (!client) throw new Error('Customer not found.');
      if (String(client.id_number || '').trim()) {
        await db.execute('UPDATE clients SET birthday=:birthday,updated_at=NOW() WHERE id_number=:idNumber', { birthday, idNumber: client.id_number });
      } else {
        await db.execute('UPDATE clients SET birthday=:birthday,updated_at=NOW() WHERE id=:clientId', { birthday, clientId });
      }
    } else if (type === 'upgrade') {
      if (!clientId) throw new Error('Select a mobile line.');
      const previous = text(req.body.previous_upgrade_date, 10);
      const term = Number(req.body.contract_term_months) === 36 ? 36 : 24;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(previous)) throw new Error('Enter a valid previous upgrade date.');
      await db.execute(`UPDATE clients SET previous_upgrade_date=:previous,contract_term_months=:term,
        next_upgrade_date=DATE_ADD(:previous,INTERVAL :term MONTH),upgrade_date=DATE_ADD(:previous,INTERVAL :term MONTH),updated_at=NOW()
        WHERE id=:clientId`, { previous, term, clientId });
    } else if (type === 'prospect') {
      const prospectName = text(req.body.prospect_name, 200);
      if (!prospectName) throw new Error('Enter the prospect name.');
      await db.execute(`INSERT INTO sales_prospects
        (prospect_name,cell_number,email,city_town,lead_source,interest,next_action_at,assigned_to,created_by)
        VALUES (:prospectName,:cellNumber,:email,:cityTown,:leadSource,:interest,:nextActionAt,:userId,:userId)`, {
        prospectName, cellNumber: nullable(req.body.cell_number, 40), email: nullable(req.body.email, 255),
        cityTown: nullable(req.body.city_town, 150), leadSource: nullable(req.body.lead_source, 150),
        interest: nullable(req.body.interest), nextActionAt: validDateTime(req.body.next_action_at), userId
      });
    }
    res.render('os-quick-add', { layout: false, title, type, error: null, saved: true, values: req.body });
  } catch (error) {
    res.status(400).render('os-quick-add', { layout: false, title, type, error: error.message, saved: false, values: req.body });
  }
});

router.get('/os/productivity/:kind/:id', requireAuth, async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '');
    const id = Number(req.params.id);
    const userId = req.session.user.id;
    const table = { 'follow-up': 'customer_followups', callback: 'customer_callbacks', prospect: 'sales_prospects' }[kind];
    if (!table || !Number.isInteger(id)) return res.status(404).render('error', { title: 'Not found', message: 'Record not found.' });
    const ownerClause = isManagementRole(req.session.user) ? '' : ' AND assigned_to=:userId';
    const [[record]] = await db.execute(`SELECT * FROM ${table} WHERE id=:id${ownerClause} LIMIT 1`, { id, userId });
    if (!record) return res.status(404).render('error', { title: 'Not found', message: 'Record not found.' });
    res.render('os-productivity-detail', { title: kind === 'follow-up' ? 'Customer Follow-up' : kind === 'callback' ? 'Scheduled Callback' : 'Prospect', kind, record });
  } catch (error) { next(error); }
});

router.post('/os/productivity/:kind/:id/status', requireAuth, async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '');
    const id = Number(req.params.id);
    const userId = req.session.user.id;
    const table = { 'follow-up': 'customer_followups', callback: 'customer_callbacks', prospect: 'sales_prospects' }[kind];
    const allowed = kind === 'follow-up' ? ['open','completed','cancelled','archived'] : kind === 'callback' ? ['scheduled','completed','cancelled','archived'] : ['new','contacted','qualified','converted','lost','archived'];
    const status = String(req.body.status || '');
    if (!table || !Number.isInteger(id) || !allowed.includes(status)) throw new Error('Invalid status update.');
    const ownerClause = isManagementRole(req.session.user) ? '' : ' AND assigned_to=:userId';
    if (kind === 'prospect') {
      await db.execute(`UPDATE sales_prospects SET status=:status,
        converted_at=CASE WHEN :status='converted' THEN NOW() ELSE converted_at END,
        converted_by=CASE WHEN :status='converted' THEN :userId ELSE converted_by END,
        archived_at=CASE WHEN :status='archived' THEN NOW() ELSE archived_at END
        WHERE id=:id${ownerClause}`, { status, userId, id });
    } else {
      await db.execute(`UPDATE ${table} SET status=:status,
        completed_at=CASE WHEN :status='completed' THEN NOW() ELSE completed_at END,
        completed_by=CASE WHEN :status='completed' THEN :userId ELSE completed_by END,
        archived_at=CASE WHEN :status='archived' THEN NOW() ELSE archived_at END
        WHERE id=:id${ownerClause}`, { status, userId, id });
    }
    res.redirect(`${res.locals.basePath}/os/productivity/${kind}/${id}`);
  } catch (error) { next(error); }
});

router.get('/api/os/notes', requireAuth, async (req, res, next) => {
  try {
    const archived = String(req.query.archived || '') === '1' ? 1 : 0;
    const [notes] = await db.execute(`SELECT id,title,note_text,is_pinned,is_archived,reminder_at,related_client_id,created_at,updated_at
      FROM staff_notes WHERE staff_user_id=:userId AND is_archived=:archived
      ORDER BY is_pinned DESC,updated_at DESC`, { userId: req.session.user.id, archived });
    res.json({ ok: true, notes });
  } catch (error) { next(error); }
});

router.post('/api/os/notes', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const id = numberOrNull(req.body.id);
    const title = nullable(req.body.title, 200);
    const noteText = text(req.body.note_text);
    if (!noteText) return res.status(400).json({ ok: false, error: 'Write something before saving the note.' });
    const reminderAt = validDateTime(req.body.reminder_at);
    const relatedClientId = numberOrNull(req.body.related_client_id);
    let noteId = id;
    if (id) {
      const [result] = await db.execute(`UPDATE staff_notes SET title=:title,note_text=:noteText,reminder_at=:reminderAt,
        related_client_id=:relatedClientId,updated_at=NOW() WHERE id=:id AND staff_user_id=:userId`,
      { title, noteText, reminderAt, relatedClientId, id, userId });
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'Note not found.' });
    } else {
      const [result] = await db.execute(`INSERT INTO staff_notes
        (staff_user_id,title,note_text,reminder_at,related_client_id)
        VALUES (:userId,:title,:noteText,:reminderAt,:relatedClientId)`,
      { userId, title, noteText, reminderAt, relatedClientId });
      noteId = result.insertId;
    }
    const [[note]] = await db.execute('SELECT * FROM staff_notes WHERE id=:id AND staff_user_id=:userId LIMIT 1', { id: noteId, userId });
    res.json({ ok: true, note });
  } catch (error) { next(error); }
});

router.post('/api/os/notes/:id/pin', requireAuth, async (req, res, next) => {
  try {
    await db.execute(`UPDATE staff_notes SET is_pinned=IF(is_pinned=1,0,1),updated_at=NOW()
      WHERE id=:id AND staff_user_id=:userId`, { id: Number(req.params.id), userId: req.session.user.id });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post('/api/os/notes/:id/archive', requireAuth, async (req, res, next) => {
  try {
    await db.execute(`UPDATE staff_notes SET is_archived=1,archived_at=NOW(),updated_at=NOW()
      WHERE id=:id AND staff_user_id=:userId`, { id: Number(req.params.id), userId: req.session.user.id });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post('/api/os/notes/:id/restore', requireAuth, async (req, res, next) => {
  try {
    await db.execute(`UPDATE staff_notes SET is_archived=0,archived_at=NULL,updated_at=NOW()
      WHERE id=:id AND staff_user_id=:userId`, { id: Number(req.params.id), userId: req.session.user.id });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

module.exports = router;
