const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const OPEN_INQUIRY_STATUSES = "('open','follow_up','waiting_customer','waiting_network','waiting_supplier')";
const ACTIVE_TASK_STATUSES = "('unread','seen','in_progress')";

function isManagementRole(user) {
  return Boolean(user && ['owner', 'admin', 'manager'].includes(user.role));
}

function normaliseSaPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  return /^27\d{9}$/.test(digits) ? digits : null;
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
    res.json({ ok: true, status, serverTime: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

router.get('/os/my-work/:section', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const section = String(req.params.section || '');
    let title = 'My Work';
    let emptyMessage = 'No items found.';
    let columns = [];
    let rows = [];

    if (section === 'overdue-tasks' || section === 'tasks-today' || section === 'unread-messages') {
      const filters = ["t.assigned_to=:userId", `t.status IN ${ACTIVE_TASK_STATUSES}`];
      if (section === 'overdue-tasks') {
        title = 'Overdue Tasks'; emptyMessage = 'No overdue tasks.'; filters.push('t.due_at IS NOT NULL AND t.due_at<NOW()');
      } else if (section === 'tasks-today') {
        title = 'Tasks Due Today'; emptyMessage = 'No tasks are due today.'; filters.push('t.due_at IS NOT NULL AND DATE(t.due_at)=CURRENT_DATE()');
      } else {
        title = 'Unread Messages'; emptyMessage = 'No unread messages.'; filters.push("t.status='unread'");
      }
      [rows] = await db.execute(`SELECT t.id,t.title,t.message,t.priority,t.status,t.due_at,t.created_at,
        creator.full_name created_by_name,cl.client_name
        FROM staff_tasks t JOIN staff_users creator ON creator.id=t.created_by
        LEFT JOIN clients cl ON cl.id=t.related_client_id
        WHERE ${filters.join(' AND ')}
        ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,t.due_at IS NULL,t.due_at,t.created_at DESC`, { userId });
      columns = ['title','client_name','priority','due_at','created_by_name'];
      rows = rows.map(row => ({ ...row, url: `${res.locals.basePath}/tasks/${row.id}` }));
    } else if (section === 'follow-ups' || section === 'callbacks') {
      title = section === 'follow-ups' ? 'Customer Follow-ups' : 'Scheduled Callbacks';
      emptyMessage = section === 'follow-ups' ? 'No customer follow-ups are due today.' : 'No scheduled callbacks today.';
      [rows] = await db.execute(`SELECT i.id,i.client_id,i.client_name,i.cell_number,i.query_text,i.priority,i.status,i.follow_up_at,ic.category_name
        FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id
        WHERE COALESCE(i.assigned_staff_id,i.staff_id)=:userId
          AND i.status IN ${OPEN_INQUIRY_STATUSES}
          AND i.follow_up_at IS NOT NULL AND DATE(i.follow_up_at)=CURRENT_DATE()
        ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,i.follow_up_at,i.created_at DESC`, { userId });
      columns = ['client_name','cell_number','category_name','query_text','follow_up_at'];
      rows = rows.map(row => ({ ...row, url: row.client_id ? `${res.locals.basePath}/customers/${row.client_id}/360` : `${res.locals.basePath}/queries/${row.id}` }));
    } else if (section === 'birthdays') {
      title = 'Birthdays Today'; emptyMessage = 'No birthdays for your assigned customers today.';
      [rows] = await db.execute(`SELECT MIN(c.id) id,MAX(c.client_name) client_name,MAX(c.cell_number) cell_number,MAX(c.email) email,MAX(c.birthday) birthday,COUNT(*) line_count
        FROM clients c JOIN client_assignments a ON a.is_active=1 AND a.assigned_staff_id=:userId
          AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number))
        WHERE c.birthday IS NOT NULL AND MONTH(c.birthday)=MONTH(CURRENT_DATE()) AND DAY(c.birthday)=DAY(CURRENT_DATE())
        GROUP BY COALESCE(NULLIF(c.id_number,''),CONCAT('client:',c.id)) ORDER BY client_name`, { userId });
      columns = ['client_name','cell_number','email','birthday','line_count'];
      rows = rows.map(row => ({ ...row, url: `${res.locals.basePath}/customers/${row.id}/360` }));
    } else if (section === 'upgrades') {
      title = 'Upgrades Due'; emptyMessage = 'No upgrades are due for your assigned customers.';
      [rows] = await db.execute(`SELECT DISTINCT c.id,c.client_name,c.cell_number,c.account_number,c.package_name,c.handset,c.next_upgrade_date
        FROM clients c JOIN client_assignments a ON a.is_active=1 AND a.assigned_staff_id=:userId
          AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number))
        WHERE c.line_status<>'cancelled' AND c.next_upgrade_date IS NOT NULL
          AND DATE(c.next_upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY)
        ORDER BY c.next_upgrade_date,c.client_name`, { userId });
      columns = ['client_name','cell_number','account_number','package_name','handset','next_upgrade_date'];
      rows = rows.map(row => ({ ...row, url: `${res.locals.basePath}/customers/${row.id}/360` }));
    } else if (section === 'prospects') {
      title = 'New Prospects'; emptyMessage = 'No new prospects require attention.';
      [rows] = await db.execute(`SELECT c.id,c.client_name,c.cell_number,c.email,c.city_town,c.lead_status,c.created_at
        FROM clients c
        WHERE c.created_by_staff_id=:userId AND c.is_active=1 AND c.lifecycle_status='prospect'
          AND COALESCE(c.lead_status,'new') IN ('new','contacted','qualified')
        ORDER BY c.created_at DESC`, { userId });
      columns = ['client_name','cell_number','email','city_town','lead_status','created_at'];
      rows = rows.map(row => ({ ...row, url: `${res.locals.basePath}/customers/${row.id}/360` }));
    } else {
      return res.status(404).render('error', { title: 'Not found', message: 'This work list does not exist.' });
    }

    res.render('os-my-work', { title, rows, columns, emptyMessage });
  } catch (error) {
    next(error);
  }
});

router.get('/customers/:id/add-mobile', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[client]] = await db.execute('SELECT id,client_name,email,account_number,account_id FROM clients WHERE id=:id LIMIT 1', { id });
    if (!client) return res.status(404).render('error', { title: 'Customer not found', message: 'The customer could not be found.' });
    if (String(client.account_number || '').trim() && client.account_id) return next();
    res.render('mobile-line-request', {
      title: 'Add Provisional Mobile Line',
      client: { ...client, canonical_account_number: 'Pending manager allocation' },
      provisional: true,
      formAction: `${res.locals.basePath}/customers/${id}/request-provisional-mobile-line`,
      backUrl: `${res.locals.basePath}/customers/${id}/360`,
      error: null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/customers/:id/request-provisional-mobile-line', requireAuth, async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [[client]] = await conn.execute('SELECT * FROM clients WHERE id=:id FOR UPDATE', { id });
    if (!client) throw new Error('Customer not found');
    const cell = String(req.body.cell_number || '').trim();
    if (!cell) throw new Error('Enter the mobile line number.');
    const phone = normaliseSaPhone(cell);
    if (phone) {
      const [[duplicate]] = await conn.execute('SELECT id FROM clients WHERE cell_number_normalised=:phone LIMIT 1', { phone });
      if (duplicate) throw new Error('This cellphone number is already recorded.');
    }
    const previous = req.body.previous_upgrade_date || null;
    const term = Number(req.body.contract_term_months) === 36 ? 36 : 24;
    const [created] = await conn.execute(`INSERT INTO clients
      (account_id,account_number,client_name,cell_number,cell_number_normalised,email,package_name,handset,previous_upgrade_date,contract_term_months,next_upgrade_date,upgrade_date,customer_type,lifecycle_status,line_status,created_by_staff_id,is_active,notes)
      VALUES (NULL,NULL,:clientName,:cell,:phone,:email,:packageName,:handset,:previous,:term,DATE_ADD(:previous,INTERVAL :term MONTH),DATE_ADD(:previous,INTERVAL :term MONTH),'unknown','client','active',:createdBy,1,:notes)`, {
      clientName: String(req.body.client_name || client.client_name || '').trim(),
      cell, phone, email: String(req.body.email || client.email || '').trim().toLowerCase() || null,
      packageName: String(req.body.package_name || '').trim() || null,
      handset: String(req.body.handset || '').trim() || null,
      previous, term, createdBy: req.session.user.id,
      notes: `Provisional mobile line awaiting account number. Parent client ID ${client.id}.`
    });
    await conn.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active)
      VALUES (:clientId,NULL,:staffId,:staffId,1)
      ON DUPLICATE KEY UPDATE assigned_staff_id=VALUES(assigned_staff_id),assigned_by=VALUES(assigned_by),is_active=1,updated_at=NOW()`, {
      clientId: created.insertId, staffId: req.session.user.id
    });
    const proposed = {
      provisional_client_ids: [client.id, created.insertId],
      provisional_line_id: created.insertId,
      client_name: client.client_name,
      cell_number: cell,
      requested_account_number: null
    };
    const [request] = await conn.execute(`INSERT INTO data_change_requests
      (request_type,entity_type,record_id,client_id,account_number,summary,reason,proposed_data_json,required_approval_role,status,requested_by)
      VALUES ('assign_account_number','clients',:recordId,:clientId,NULL,:summary,:reason,:json,'manager','pending_manager',:requestedBy)`, {
      recordId: created.insertId,
      clientId: client.id,
      summary: `Assign account number for ${client.client_name || cell}`,
      reason: 'Mobile line captured while customer was present. Account number must be completed by management.',
      json: JSON.stringify(proposed),
      requestedBy: req.session.user.id
    });
    await conn.execute(`INSERT INTO staff_tasks (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
      SELECT 'notification','Account number required',:message,'high',s.id,:createdBy,NOW(),:clientId,'not_configured'
      FROM staff_users s WHERE s.is_active=1 AND s.role IN ('owner','manager','admin')`, {
      message: `${req.session.user.full_name} captured a provisional mobile line for ${client.client_name || cell}. Open Approvals and assign the official account number. Request #${request.insertId}.`,
      createdBy: req.session.user.id,
      clientId: client.id
    });
    await conn.commit();
    res.redirect(`${res.locals.basePath}/customers/${client.id}/360?change_requested=account-number`);
  } catch (error) {
    await conn.rollback();
    next(error);
  } finally {
    conn.release();
  }
});

router.post('/approvals/:id/decision', requireAuth, async (req, res, next) => {
  const [[requestType]] = await db.execute('SELECT request_type FROM data_change_requests WHERE id=:id LIMIT 1', { id: Number(req.params.id) });
  if (!requestType || requestType.request_type !== 'assign_account_number') return next();
  if (!isManagementRole(req.session.user)) return res.status(403).render('error', { title: 'Access denied', message: 'Only management can assign account numbers.' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[request]] = await conn.execute('SELECT * FROM data_change_requests WHERE id=:id FOR UPDATE', { id: Number(req.params.id) });
    if (!request || !['pending_manager','pending_owner'].includes(request.status)) throw new Error('This request is no longer pending.');
    if (req.body.decision === 'reject') {
      await conn.execute("UPDATE data_change_requests SET status='rejected',reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment WHERE id=:id", {
        user: req.session.user.id, comment: req.body.comment || null, id: request.id
      });
      await conn.commit();
      return res.redirect(`${res.locals.basePath}/approvals`);
    }
    const accountNumber = String(req.body.account_number || '').trim();
    if (!accountNumber) throw new Error('Enter the official account number before approving.');
    const normalised = accountNumber.replace(/\s+/g, '').toUpperCase();
    const proposed = JSON.parse(request.proposed_data_json || '{}');
    const clientIds = [...new Set((proposed.provisional_client_ids || [request.client_id, request.record_id]).map(Number).filter(Boolean))];
    if (!clientIds.length) throw new Error('No provisional customer records were attached to this request.');
    await conn.execute(`INSERT INTO customer_accounts (account_number,account_number_normalised,display_name,assigned_staff_id,assigned_by,assignment_confirmed_at)
      VALUES (:account,:normalised,:displayName,:staffId,:assignedBy,NOW())
      ON DUPLICATE KEY UPDATE display_name=COALESCE(NULLIF(customer_accounts.display_name,''),VALUES(display_name)),assigned_staff_id=COALESCE(customer_accounts.assigned_staff_id,VALUES(assigned_staff_id)),assigned_by=COALESCE(customer_accounts.assigned_by,VALUES(assigned_by)),assignment_confirmed_at=COALESCE(customer_accounts.assignment_confirmed_at,NOW())`, {
      account: accountNumber,
      normalised,
      displayName: proposed.client_name || accountNumber,
      staffId: request.requested_by,
      assignedBy: req.session.user.id
    });
    const [[account]] = await conn.execute('SELECT id,account_number FROM customer_accounts WHERE account_number_normalised=:normalised LIMIT 1', { normalised });
    const placeholders = clientIds.map(() => '?').join(',');
    await conn.query(`UPDATE clients SET account_id=?,account_number=?,updated_at=NOW() WHERE id IN (${placeholders})`, [account.id, account.account_number, ...clientIds]);
    for (const clientId of clientIds) {
      await conn.execute(`INSERT INTO client_assignments (client_id,account_number,assigned_staff_id,assigned_by,is_active)
        VALUES (:clientId,:accountNumber,:staffId,:assignedBy,1)
        ON DUPLICATE KEY UPDATE account_number=VALUES(account_number),assigned_staff_id=VALUES(assigned_staff_id),assigned_by=VALUES(assigned_by),is_active=1,updated_at=NOW()`, {
        clientId, accountNumber: account.account_number, staffId: request.requested_by, assignedBy: req.session.user.id
      });
    }
    await conn.execute("UPDATE data_change_requests SET status='applied',account_number=:accountNumber,reviewed_by=:user,reviewed_at=NOW(),review_comment=:comment,applied_at=NOW() WHERE id=:id", {
      accountNumber: account.account_number,
      user: req.session.user.id,
      comment: req.body.comment || null,
      id: request.id
    });
    await conn.execute(`INSERT INTO staff_tasks (type,title,message,priority,assigned_to,created_by,due_at,related_client_id,email_status)
      VALUES ('notification','Account number assigned',:message,'normal',:assignedTo,:createdBy,NOW(),:clientId,'not_configured')`, {
      message: `Account ${account.account_number} was assigned to ${proposed.client_name || 'the provisional customer'} and its captured mobile line.`,
      assignedTo: request.requested_by,
      createdBy: req.session.user.id,
      clientId: request.client_id
    });
    await conn.commit();
    res.redirect(`${res.locals.basePath}/approvals`);
  } catch (error) {
    await conn.rollback();
    next(error);
  } finally {
    conn.release();
  }
});

module.exports = router;
