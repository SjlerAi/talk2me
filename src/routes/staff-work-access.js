const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const CLOSED_TASK_STATUSES = ['completed', 'cancelled'];

function isManagementRole(user) {
  return Boolean(user && ['owner', 'admin', 'manager'].includes(String(user.role || '').toLowerCase()));
}

function sameUser(left, right) {
  const leftId = Number(left);
  const rightId = Number(right);
  return Number.isInteger(leftId) && Number.isInteger(rightId) && leftId === rightId;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function text(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function nullable(value, max = 5000) {
  const result = text(value, max);
  return result || null;
}

function validDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : String(value).replace('T', ' ').slice(0, 19);
}

function taskRedirect(req, res, taskId) {
  const panel = String(req.body?.panel || req.query?.panel || '') === '1' ? '?panel=1' : '';
  return res.redirect(`${res.locals.basePath}/tasks/${taskId}${panel}`);
}

router.get('/tasks', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.session.user.id);
    const isManagement = isManagementRole(req.session.user);
    const requestedView = String(req.query.view || 'active');
    const view = ['active', 'sent', 'all', 'archive'].includes(requestedView) ? requestedView : 'active';
    const ownerView = isManagement && view === 'all';
    const sentView = view === 'sent';
    const archiveView = view === 'archive';
    const q = text(req.query.q, 200);
    const staffFilter = isManagement ? positiveId(req.query.staff_id) : null;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : '';
    const params = { userId, q: `%${q}%`, from, to };
    const where = [];

    if (archiveView) {
      where.push("t.status IN ('completed','cancelled')");
      if (!isManagement || !staffFilter) where.push('(t.assigned_to=:userId OR t.created_by=:userId)');
    } else {
      where.push("t.status IN ('unread','seen','in_progress')");
      if (sentView) where.push('t.created_by=:userId');
      else if (!ownerView) where.push('t.assigned_to=:userId');
    }

    if (staffFilter) {
      params.staffFilter = staffFilter;
      where.push('(t.assigned_to=:staffFilter OR t.created_by=:staffFilter)');
    }
    if (q) where.push('(t.title LIKE :q OR t.message LIKE :q OR ass.full_name LIKE :q OR creator.full_name LIKE :q OR cl.client_name LIKE :q OR fa.customer_name LIKE :q OR fa.account_number LIKE :q)');
    if (from) where.push('t.created_at>=:from');
    if (to) where.push('t.created_at<DATE_ADD(:to,INTERVAL 1 DAY)');

    const [tasks] = await db.execute(`SELECT t.*, ass.full_name assigned_name, ass.email assigned_email,
      creator.full_name created_by_name, cl.client_name related_client_name,
      fa.customer_name related_fixed_name, fa.account_number related_fixed_account
      FROM staff_tasks t
      JOIN staff_users ass ON ass.id=t.assigned_to
      JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN clients cl ON cl.id=t.related_client_id
      LEFT JOIN fixed_accounts fa ON fa.id=t.related_fixed_account_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE t.status WHEN 'unread' THEN 0 WHEN 'seen' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
        t.due_at IS NULL, t.due_at ASC, t.created_at DESC
      LIMIT 1000`, params);

    const [staff] = isManagement
      ? await db.query('SELECT id,full_name FROM staff_users WHERE is_active=1 ORDER BY full_name')
      : [[]];
    const title = archiveView
      ? 'Completed Archive'
      : ownerView
        ? 'All Staff Active'
        : sentView
          ? 'Sent by Me — Active'
          : 'My Active Messages & Tasks';

    res.render('tasks-list', {
      title,
      tasks,
      view,
      ownerView,
      sentView,
      archiveView,
      isOwner: isManagement,
      staff,
      filters: { q, staffFilter, from, to }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/tasks/:id', requireAuth, async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return next();

  try {
    const userId = Number(req.session.user.id);
    const isManagement = isManagementRole(req.session.user);
    const [[task]] = await db.execute(`SELECT t.*, ass.full_name assigned_name, ass.email assigned_email,
      creator.full_name created_by_name, cl.client_name related_client_name,
      fa.customer_name related_fixed_name, fa.account_number related_fixed_account
      FROM staff_tasks t
      JOIN staff_users ass ON ass.id=t.assigned_to
      JOIN staff_users creator ON creator.id=t.created_by
      LEFT JOIN clients cl ON cl.id=t.related_client_id
      LEFT JOIN fixed_accounts fa ON fa.id=t.related_fixed_account_id
      WHERE t.id=:id LIMIT 1`, { id });

    if (!task) return res.status(404).render('error', { title: 'Not found', message: 'Task could not be found.' });

    const isAssignee = sameUser(task.assigned_to, userId);
    const isCreator = sameUser(task.created_by, userId);
    if (!isManagement && !isAssignee && !isCreator) {
      return res.status(403).render('error', {
        title: 'Access denied',
        message: 'This message or task was not sent by you or assigned to you.'
      });
    }

    if (isAssignee && task.status === 'unread') {
      await db.execute("UPDATE staff_tasks SET status='seen',seen_at=COALESCE(seen_at,NOW()) WHERE id=:id AND assigned_to=:userId", { id, userId });
    }

    const [comments] = await db.execute(`SELECT c.*,s.full_name
      FROM staff_task_comments c
      JOIN staff_users s ON s.id=c.staff_id
      WHERE c.task_id=:id
      ORDER BY c.created_at DESC`, { id });
    const effectiveStatus = task.status === 'unread' && isAssignee ? 'seen' : task.status;
    const archived = CLOSED_TASK_STATUSES.includes(effectiveStatus);
    const canControl = isManagement || isAssignee;

    res.render('task-detail', {
      title: `Task #${id}`,
      task: { ...task, status: effectiveStatus },
      comments,
      isOwner: isManagement,
      canUpdate: canControl && !archived,
      canReopen: canControl && archived,
      isArchived: archived,
      created: req.query.created
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tasks/:id/status', requireAuth, async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return next();

  try {
    const userId = Number(req.session.user.id);
    const isManagement = isManagementRole(req.session.user);
    const status = String(req.body.status || '');
    const allowed = isManagement
      ? ['seen', 'in_progress', 'completed', 'cancelled']
      : ['seen', 'in_progress', 'completed'];
    if (!allowed.includes(status)) {
      return res.status(400).render('error', { title: 'Invalid status', message: 'Invalid task status.' });
    }

    const [[task]] = await db.execute('SELECT * FROM staff_tasks WHERE id=:id LIMIT 1', { id });
    if (!task) return res.sendStatus(404);
    if (!isManagement && !sameUser(task.assigned_to, userId)) return res.sendStatus(403);

    const completionNote = nullable(req.body.completion_note);
    await db.execute(`UPDATE staff_tasks SET status=:status,
      seen_at=CASE WHEN :status IN ('seen','in_progress','completed') THEN COALESCE(seen_at,NOW()) ELSE seen_at END,
      started_at=CASE WHEN :status='in_progress' THEN COALESCE(started_at,NOW()) ELSE started_at END,
      completed_at=CASE WHEN :status='completed' THEN NOW() WHEN :status<>'completed' THEN NULL ELSE completed_at END,
      completion_note=CASE WHEN :status='completed' THEN :completionNote ELSE completion_note END
      WHERE id=:id`, { id, status, completionNote });

    const noteSuffix = completionNote ? ` — ${completionNote}` : '';
    await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment)
      VALUES (:id,:userId,:comment)`, {
      id,
      userId,
      comment: `Status changed from ${task.status} to ${status}${noteSuffix}`
    });

    return taskRedirect(req, res, id);
  } catch (error) {
    next(error);
  }
});

router.post('/tasks/:id/reopen', requireAuth, async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return next();

  try {
    const userId = Number(req.session.user.id);
    const isManagement = isManagementRole(req.session.user);
    const [[task]] = await db.execute('SELECT * FROM staff_tasks WHERE id=:id LIMIT 1', { id });
    if (!task) return res.sendStatus(404);
    if (!isManagement && !sameUser(task.assigned_to, userId)) return res.sendStatus(403);
    if (!CLOSED_TASK_STATUSES.includes(task.status)) return taskRedirect(req, res, id);

    await db.execute("UPDATE staff_tasks SET status='seen',completed_at=NULL,completion_note=NULL WHERE id=:id", { id });
    await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment)
      VALUES (:id,:userId,:comment)`, { id, userId, comment: `Reopened from ${task.status}` });
    return taskRedirect(req, res, id);
  } catch (error) {
    next(error);
  }
});

router.post('/tasks/:id/comments', requireAuth, async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return next();

  try {
    const userId = Number(req.session.user.id);
    const isManagement = isManagementRole(req.session.user);
    const comment = text(req.body.comment);
    const [[task]] = await db.execute('SELECT assigned_to,created_by FROM staff_tasks WHERE id=:id LIMIT 1', { id });
    if (!task) return res.sendStatus(404);
    if (!isManagement && !sameUser(task.assigned_to, userId) && !sameUser(task.created_by, userId)) return res.sendStatus(403);

    if (comment) {
      await db.execute(`INSERT INTO staff_task_comments (task_id,staff_id,comment)
        VALUES (:id,:userId,:comment)`, { id, userId, comment });
    }
    return taskRedirect(req, res, id);
  } catch (error) {
    next(error);
  }
});

router.get('/api/os/notes', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.session.user.id);
    const archived = String(req.query.archived || '') === '1' ? 1 : 0;
    const [notes] = await db.execute(`SELECT id,title,note_text,is_pinned,is_archived,reminder_at,
      related_client_id,created_at,updated_at
      FROM staff_notes
      WHERE staff_user_id=:userId AND is_archived=:archived
      ORDER BY is_pinned DESC,updated_at DESC,created_at DESC`, { userId, archived });
    res.json({ ok: true, notes });
  } catch (error) {
    next(error);
  }
});

router.post('/api/os/notes', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.session.user.id);
    const id = positiveId(req.body.id);
    const title = nullable(req.body.title, 200);
    const noteText = text(req.body.note_text);
    if (!noteText) return res.status(400).json({ ok: false, error: 'Write something before saving the note.' });

    const reminderAt = validDateTime(req.body.reminder_at);
    const relatedClientId = positiveId(req.body.related_client_id);
    let noteId = id;

    if (id) {
      const [result] = await db.execute(`UPDATE staff_notes
        SET title=:title,note_text=:noteText,reminder_at=:reminderAt,
          related_client_id=:relatedClientId,updated_at=NOW()
        WHERE id=:id AND staff_user_id=:userId`, {
        id,
        userId,
        title,
        noteText,
        reminderAt,
        relatedClientId
      });
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'Note not found.' });
    } else {
      const [result] = await db.execute(`INSERT INTO staff_notes
        (staff_user_id,title,note_text,reminder_at,related_client_id)
        VALUES (:userId,:title,:noteText,:reminderAt,:relatedClientId)`, {
        userId,
        title,
        noteText,
        reminderAt,
        relatedClientId
      });
      noteId = result.insertId;
    }

    const [[note]] = await db.execute(`SELECT * FROM staff_notes
      WHERE id=:id AND staff_user_id=:userId LIMIT 1`, { id: noteId, userId });
    res.json({ ok: true, note });
  } catch (error) {
    next(error);
  }
});

async function updateOwnedNote(req, res, next, sql) {
  try {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid note.' });
    const [result] = await db.execute(sql, { id, userId: Number(req.session.user.id) });
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'Note not found.' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

router.post('/api/os/notes/:id/pin', requireAuth, (req, res, next) => updateOwnedNote(req, res, next,
  `UPDATE staff_notes SET is_pinned=IF(is_pinned=1,0,1),updated_at=NOW()
   WHERE id=:id AND staff_user_id=:userId`));

router.post('/api/os/notes/:id/archive', requireAuth, (req, res, next) => updateOwnedNote(req, res, next,
  `UPDATE staff_notes SET is_archived=1,archived_at=NOW(),updated_at=NOW()
   WHERE id=:id AND staff_user_id=:userId`));

router.post('/api/os/notes/:id/restore', requireAuth, (req, res, next) => updateOwnedNote(req, res, next,
  `UPDATE staff_notes SET is_archived=0,archived_at=NULL,updated_at=NOW()
   WHERE id=:id AND staff_user_id=:userId`));

module.exports = router;
