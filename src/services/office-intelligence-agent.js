'use strict';

const db = require('../config/db');
const { ensureOfficeIntelligenceSchema, rangeSql } = require('./office-intelligence');

const ACTIVE_TASK = `(t.status IN ('unread','seen','in_progress') OR (t.status='completed' AND w.workflow_state='awaiting_sender_ack'))`;
const OPEN_INQUIRY = `i.status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier')`;

async function scalar(sql, params = {}) {
  try {
    const [[row]] = await db.execute(sql, params);
    return { value: Number(row ? Object.values(row)[0] || 0 : 0), available: true };
  } catch (error) {
    return { value: 0, available: false, error: error.message };
  }
}

async function rows(sql, params = {}) {
  try {
    const [result] = await db.execute(sql, params);
    return { rows: result, available: true };
  } catch (error) {
    return { rows: [], available: false, error: error.message };
  }
}

function metric(key, name, result) {
  return { key, name, value: result.value, available: result.available };
}

async function buildStaffSummaries(range) {
  const between = `BETWEEN ${range.fromExpr} AND ${range.toExpr}`;
  const result = await rows(`
    SELECT su.id,
      COALESCE(NULLIF(su.full_name,''),NULLIF(CONCAT_WS(' ',su.first_name,su.surname),''),su.email) AS staff_name,
      EXISTS(SELECT 1 FROM attendance_sessions a WHERE a.staff_id=su.id AND a.status='active') AS working_now,
      (SELECT MIN(a.clock_in_at) FROM attendance_sessions a WHERE a.staff_id=su.id AND a.clock_in_at ${between}) AS first_clock_in,
      (SELECT COUNT(*) FROM inquiries i
        WHERE COALESCE(i.assigned_staff_id,i.staff_id)=su.id AND i.created_at ${between}) AS inquiries_created,
      (SELECT COUNT(*) FROM inquiries i
        WHERE COALESCE(i.assigned_staff_id,i.staff_id)=su.id AND ${OPEN_INQUIRY}) AS inquiries_open,
      (SELECT COUNT(*) FROM staff_tasks t LEFT JOIN staff_task_workflow w ON w.task_id=t.id
        WHERE t.assigned_to=su.id AND ${ACTIVE_TASK}) AS tasks_open,
      (SELECT COUNT(*) FROM staff_tasks t
        WHERE t.assigned_to=su.id AND t.completed_at ${between}) AS tasks_completed,
      (SELECT COUNT(*) FROM staff_tasks t
        WHERE t.created_by=su.id AND t.created_at ${between}) AS tasks_created,
      (SELECT COUNT(*) FROM audit_log al
        WHERE al.staff_id=su.id AND al.created_at ${between}) AS audited_actions
    FROM staff_users su
    WHERE su.is_active=1
    ORDER BY working_now DESC, staff_name ASC`);
  return result.rows;
}

async function buildStaffDetail(staffId, range) {
  const id = Number(staffId || 0);
  if (!id) return null;
  const between = `BETWEEN ${range.fromExpr} AND ${range.toExpr}`;
  const [staff] = (await rows(`
    SELECT id,COALESCE(NULLIF(full_name,''),NULLIF(CONCAT_WS(' ',first_name,surname),''),email) AS staff_name,email,role
    FROM staff_users WHERE id=:id LIMIT 1`, { id })).rows;
  if (!staff) return null;

  const [attendance, inquiries, assignedTasks, createdTasks, audit] = await Promise.all([
    rows(`SELECT clock_in_at,clock_out_at,status,COALESCE(clock_out_at,updated_at) AS last_activity
      FROM attendance_sessions
      WHERE staff_id=:id AND (clock_in_at ${between} OR status='active')
      ORDER BY COALESCE(clock_out_at,updated_at,clock_in_at) DESC LIMIT 30`, { id }),

    rows(`SELECT i.id,i.created_at,i.updated_at,i.completed_at,
      COALESCE(NULLIF(i.client_name,''),NULLIF(i.cell_number,''),'Inquiry') AS client_name,
      i.status,i.query_text,
      CASE WHEN ${OPEN_INQUIRY} THEN 1 ELSE 0 END AS currently_open
      FROM inquiries i
      WHERE COALESCE(i.assigned_staff_id,i.staff_id)=:id
        AND (${OPEN_INQUIRY} OR i.created_at ${between} OR i.updated_at ${between} OR i.completed_at ${between})
      ORDER BY currently_open DESC,COALESCE(i.updated_at,i.created_at) DESC LIMIT 100`, { id }),

    rows(`SELECT t.id,t.title,t.message,t.status,t.priority,t.due_at,t.created_at,t.updated_at,t.completed_at,
      COALESCE(w.workflow_state,CASE WHEN t.status='completed' THEN 'accepted' ELSE 'active' END) AS workflow_state,
      CASE WHEN ${ACTIVE_TASK} THEN 1 ELSE 0 END AS currently_open
      FROM staff_tasks t
      LEFT JOIN staff_task_workflow w ON w.task_id=t.id
      WHERE t.assigned_to=:id
        AND (${ACTIVE_TASK} OR t.created_at ${between} OR t.updated_at ${between} OR t.completed_at ${between})
      ORDER BY currently_open DESC,
        CASE WHEN t.due_at IS NOT NULL AND t.due_at<NOW() THEN 0 ELSE 1 END,
        COALESCE(t.updated_at,t.completed_at,t.created_at) DESC
      LIMIT 150`, { id }),

    rows(`SELECT t.id,t.title,t.status,t.priority,t.assigned_to,t.created_at
      FROM staff_tasks t
      WHERE t.created_by=:id AND t.created_at ${between}
      ORDER BY t.created_at DESC LIMIT 80`, { id }),

    rows(`SELECT created_at,action_type,entity_type,entity_id,description
      FROM audit_log
      WHERE staff_id=:id AND created_at ${between}
      ORDER BY created_at DESC LIMIT 80`, { id })
  ]);

  return {
    staff,
    attendance: attendance.rows,
    inquiries: inquiries.rows,
    assignedTasks: assignedTasks.rows,
    createdTasks: createdTasks.rows,
    audit: audit.rows
  };
}

async function buildMetricDetail(metricKey, range) {
  if (!metricKey) return null;
  const between = `BETWEEN ${range.fromExpr} AND ${range.toExpr}`;
  const key = String(metricKey);
  const definitions = {
    staff_working: {
      title: 'Staff working now',
      query: `SELECT su.id,COALESCE(NULLIF(su.full_name,''),su.email) AS primary_text,
        CONCAT('Clocked in ',DATE_FORMAT(MIN(a.clock_in_at),'%H:%i')) AS secondary_text,
        MAX(COALESCE(a.updated_at,a.clock_in_at)) AS event_time
        FROM attendance_sessions a JOIN staff_users su ON su.id=a.staff_id
        WHERE a.status='active' GROUP BY su.id,primary_text ORDER BY primary_text`
    },
    new_inquiries: {
      title: 'New inquiries',
      query: `SELECT i.id,COALESCE(NULLIF(i.client_name,''),NULLIF(i.cell_number,''),'Inquiry') AS primary_text,
        CONCAT(COALESCE(i.status,'open'),' · ',COALESCE(NULLIF(su.full_name,''),'Unassigned')) AS secondary_text,
        i.created_at AS event_time
        FROM inquiries i LEFT JOIN staff_users su ON su.id=COALESCE(i.assigned_staff_id,i.staff_id)
        WHERE i.created_at ${between} ORDER BY i.created_at DESC LIMIT 120`
    },
    inquiries_completed: {
      title: 'Completed inquiries',
      query: `SELECT i.id,COALESCE(NULLIF(i.client_name,''),NULLIF(i.cell_number,''),'Inquiry') AS primary_text,
        CONCAT(COALESCE(i.status,'completed'),' · ',COALESCE(NULLIF(su.full_name,''),'Unassigned')) AS secondary_text,
        COALESCE(i.completed_at,i.updated_at) AS event_time
        FROM inquiries i LEFT JOIN staff_users su ON su.id=COALESCE(i.completed_by,i.assigned_staff_id,i.staff_id)
        WHERE i.status IN ('closed','completed','resolved','cancelled')
          AND COALESCE(i.completed_at,i.updated_at) ${between}
        ORDER BY event_time DESC LIMIT 120`
    },
    tasks_created: {
      title: 'Tasks created',
      query: `SELECT t.id,t.title AS primary_text,
        CONCAT(COALESCE(t.status,'open'),' · assigned to ',COALESCE(NULLIF(su.full_name,''),'Unknown')) AS secondary_text,
        t.created_at AS event_time
        FROM staff_tasks t LEFT JOIN staff_users su ON su.id=t.assigned_to
        WHERE t.created_at ${between} ORDER BY t.created_at DESC LIMIT 120`
    },
    tasks_completed: {
      title: 'Tasks completed',
      query: `SELECT t.id,t.title AS primary_text,
        CONCAT('Completed · ',COALESCE(NULLIF(su.full_name,''),'Unknown')) AS secondary_text,
        t.completed_at AS event_time
        FROM staff_tasks t LEFT JOIN staff_users su ON su.id=t.assigned_to
        WHERE t.completed_at ${between} ORDER BY t.completed_at DESC LIMIT 120`
    },
    new_customers: {
      title: 'New customers / prospects',
      query: `SELECT c.id,COALESCE(NULLIF(c.client_name,''),NULLIF(c.email,''),NULLIF(c.cell_number,''),'Customer') AS primary_text,
        CONCAT(COALESCE(c.lifecycle_status,'customer'),' · ',COALESCE(c.cell_number,'')) AS secondary_text,
        c.created_at AS event_time
        FROM clients c WHERE c.created_at ${between} ORDER BY c.created_at DESC LIMIT 120`
    },
    outstanding_tasks: {
      title: 'Outstanding tasks',
      query: `SELECT t.id,t.title AS primary_text,
        CONCAT(CASE WHEN t.status='completed' AND w.workflow_state='awaiting_sender_ack' THEN 'awaiting sender approval' ELSE t.status END,
          ' · ',COALESCE(NULLIF(su.full_name,''),'Unknown')) AS secondary_text,
        COALESCE(t.due_at,t.updated_at,t.created_at) AS event_time
        FROM staff_tasks t
        LEFT JOIN staff_task_workflow w ON w.task_id=t.id
        LEFT JOIN staff_users su ON su.id=t.assigned_to
        WHERE ${ACTIVE_TASK}
        ORDER BY t.due_at IS NULL,t.due_at ASC,t.created_at DESC LIMIT 200`
    },
    overdue_tasks: {
      title: 'Overdue tasks',
      query: `SELECT t.id,t.title AS primary_text,
        CONCAT('Due ',DATE_FORMAT(t.due_at,'%d %b %H:%i'),' · ',COALESCE(NULLIF(su.full_name,''),'Unknown')) AS secondary_text,
        t.due_at AS event_time
        FROM staff_tasks t
        LEFT JOIN staff_task_workflow w ON w.task_id=t.id
        LEFT JOIN staff_users su ON su.id=t.assigned_to
        WHERE ${ACTIVE_TASK} AND t.due_at IS NOT NULL AND t.due_at<NOW()
        ORDER BY t.due_at ASC LIMIT 200`
    },
    audited_actions: {
      title: 'Audited CRM actions',
      query: `SELECT al.id,COALESCE(NULLIF(al.description,''),al.action_type) AS primary_text,
        CONCAT(COALESCE(NULLIF(su.full_name,''),'System'),' · ',al.action_type) AS secondary_text,
        al.created_at AS event_time
        FROM audit_log al LEFT JOIN staff_users su ON su.id=al.staff_id
        WHERE al.created_at ${between} ORDER BY al.created_at DESC LIMIT 120`
    }
  };
  const definition = definitions[key];
  if (!definition) return null;
  const result = await rows(definition.query);
  return { key, title: definition.title, rows: result.rows, available: result.available };
}


let responsibilitySchemaReady = false;
let responsibilitySchemaPromise = null;

async function ensureAgentResponsibilitySchema() {
  await ensureOfficeIntelligenceSchema();
  if (responsibilitySchemaReady) return;
  if (responsibilitySchemaPromise) return responsibilitySchemaPromise;

  responsibilitySchemaPromise = (async () => {
    await db.execute(\`CREATE TABLE IF NOT EXISTS agent_task_watches (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      task_id BIGINT UNSIGNED NOT NULL,
      issued_by BIGINT UNSIGNED NOT NULL,
      assigned_to BIGINT UNSIGNED NOT NULL,
      due_at DATETIME NOT NULL,
      alert_enabled TINYINT(1) NOT NULL DEFAULT 1,
      overdue_alerted_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_agent_task_watch_task (task_id),
      KEY idx_agent_task_watch_due (alert_enabled,due_at,overdue_alerted_at),
      KEY idx_agent_task_watch_assignee (assigned_to,due_at),
      KEY idx_agent_task_watch_issuer (issued_by,due_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci\`);

    await db.execute(\`CREATE TABLE IF NOT EXISTS agent_responsibility_checks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      work_date DATE NOT NULL,
      staff_id BIGINT UNSIGNED NOT NULL,
      source_type VARCHAR(40) NOT NULL,
      source_key VARCHAR(160) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'completed',
      completed_at DATETIME NULL,
      completed_by BIGINT UNSIGNED NULL,
      note VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_agent_responsibility_check (work_date,staff_id,source_type,source_key),
      KEY idx_agent_responsibility_staff_date (staff_id,work_date,status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci\`);

    await db.execute(\`CREATE TABLE IF NOT EXISTS staff_task_workflow (
      task_id BIGINT UNSIGNED NOT NULL,
      workflow_state VARCHAR(40) NOT NULL DEFAULT 'active',
      my_priority_date DATE NULL,
      completed_by BIGINT UNSIGNED NULL,
      completed_at DATETIME NULL,
      acknowledged_by BIGINT UNSIGNED NULL,
      acknowledged_at DATETIME NULL,
      returned_by BIGINT UNSIGNED NULL,
      returned_at DATETIME NULL,
      return_reason TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id),
      KEY idx_task_workflow_state (workflow_state,updated_at),
      KEY idx_task_workflow_priority (my_priority_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci\`);

    await db.execute(\`CREATE TABLE IF NOT EXISTS staff_task_notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      task_id BIGINT UNSIGNED NOT NULL,
      recipient_staff_id BIGINT UNSIGNED NOT NULL,
      actor_staff_id BIGINT UNSIGNED NULL,
      event_type VARCHAR(50) NOT NULL,
      notification_text VARCHAR(500) NOT NULL,
      action_required TINYINT(1) NOT NULL DEFAULT 0,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      resolved_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_task_notifications_recipient (recipient_staff_id,resolved_at,is_read,created_at),
      KEY idx_task_notifications_task (task_id,recipient_staff_id,action_required,resolved_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci\`);

    responsibilitySchemaReady = true;
  })().finally(() => { responsibilitySchemaPromise = null; });

  return responsibilitySchemaPromise;
}

function normaliseAgentDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return \`\${match[1]} \${match[2]}:\${match[3] || '00'}\`;
}

function responsibilityState({ completed=false, dueAt=null, waitingApproval=false, checked=false }) {
  if (completed || checked) return waitingApproval ? 'awaiting_approval' : 'completed';
  if (dueAt && new Date(dueAt).getTime() < Date.now()) return 'overdue';
  return 'outstanding';
}

async function buildDailyResponsibilities(staffId) {
  await ensureAgentResponsibilitySchema();
  const id = Number(staffId || 0);
  if (!id) return { items: [], upcomingUpgrades: [], summary: { expected:0, completed:0, outstanding:0, overdue:0 } };

  const [checks,tasks,followups,callbacks,inquiries,birthdays,upgrades,upcomingUpgrades] = await Promise.all([
    rows(\`SELECT source_type,source_key,status,completed_at,completed_by,note
      FROM agent_responsibility_checks
      WHERE staff_id=:id AND work_date=CURRENT_DATE()\`, { id }),

    rows(\`SELECT t.id,t.title,t.message,t.priority,t.status,t.due_at,t.created_at,t.updated_at,t.completed_at,
      COALESCE(w.workflow_state,CASE WHEN t.status='completed' THEN 'accepted' ELSE 'active' END) AS workflow_state
      FROM staff_tasks t
      LEFT JOIN staff_task_workflow w ON w.task_id=t.id
      WHERE t.assigned_to=:id
        AND (
          DATE(t.due_at)=CURRENT_DATE()
          OR (\${ACTIVE_TASK} AND t.due_at IS NOT NULL AND t.due_at<NOW())
          OR DATE(t.completed_at)=CURRENT_DATE()
          OR (DATE(t.created_at)=CURRENT_DATE() AND t.due_at IS NULL)
        )
      ORDER BY CASE WHEN \${ACTIVE_TASK} AND t.due_at IS NOT NULL AND t.due_at<NOW() THEN 0 ELSE 1 END,
        t.due_at IS NULL,t.due_at,t.created_at DESC
      LIMIT 250\`, { id }),

    rows(\`SELECT id,client_id,customer_name,contact_number,reason,notes,scheduled_at,status,completed_at,created_at
      FROM customer_followups
      WHERE assigned_to=:id
        AND (
          DATE(scheduled_at)=CURRENT_DATE()
          OR (status='open' AND scheduled_at<NOW())
          OR DATE(completed_at)=CURRENT_DATE()
        )
      ORDER BY CASE WHEN status='open' AND scheduled_at<NOW() THEN 0 ELSE 1 END,scheduled_at
      LIMIT 150\`, { id }),

    rows(\`SELECT id,client_id,customer_name,contact_number,reason,notes,scheduled_at,status,completed_at,created_at
      FROM customer_callbacks
      WHERE assigned_to=:id
        AND (
          DATE(scheduled_at)=CURRENT_DATE()
          OR (status='scheduled' AND scheduled_at<NOW())
          OR DATE(completed_at)=CURRENT_DATE()
        )
      ORDER BY CASE WHEN status='scheduled' AND scheduled_at<NOW() THEN 0 ELSE 1 END,scheduled_at
      LIMIT 150\`, { id }),

    rows(\`SELECT i.id,i.client_id,i.client_name,i.cell_number,i.query_text,i.status,i.follow_up_at,i.created_at,i.updated_at,i.completed_at
      FROM inquiries i
      WHERE COALESCE(i.assigned_staff_id,i.staff_id)=:id
        AND (
          \${OPEN_INQUIRY}
          OR DATE(COALESCE(i.completed_at,i.updated_at))=CURRENT_DATE()
        )
      ORDER BY CASE WHEN \${OPEN_INQUIRY} AND i.follow_up_at IS NOT NULL AND i.follow_up_at<NOW() THEN 0 ELSE 1 END,
        i.follow_up_at IS NULL,i.follow_up_at,COALESCE(i.updated_at,i.created_at) DESC
      LIMIT 200\`, { id }),

    rows(\`SELECT DISTINCT c.id,c.client_name,c.cell_number,c.birthday,c.account_number
      FROM clients c
      JOIN client_assignments ca ON ca.is_active=1 AND ca.assigned_staff_id=:id
        AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
      WHERE c.is_active=1 AND c.birthday IS NOT NULL
        AND MONTH(c.birthday)=MONTH(CURRENT_DATE()) AND DAY(c.birthday)=DAY(CURRENT_DATE())
      ORDER BY c.client_name
      LIMIT 150\`, { id }),

    rows(\`SELECT DISTINCT c.id,c.client_name,c.cell_number,c.next_upgrade_date,c.account_number,c.package_name
      FROM clients c
      JOIN client_assignments ca ON ca.is_active=1 AND ca.assigned_staff_id=:id
        AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
      WHERE c.is_active=1 AND COALESCE(c.line_status,'active')<>'cancelled'
        AND c.next_upgrade_date IS NOT NULL AND DATE(c.next_upgrade_date)=CURRENT_DATE()
      ORDER BY c.client_name
      LIMIT 150\`, { id }),

    rows(\`SELECT DISTINCT c.id,c.client_name,c.cell_number,c.next_upgrade_date,c.account_number,c.package_name
      FROM clients c
      JOIN client_assignments ca ON ca.is_active=1 AND ca.assigned_staff_id=:id
        AND (ca.client_id=c.id OR (COALESCE(ca.account_number,'')<>'' AND ca.account_number=c.account_number))
      WHERE c.is_active=1 AND COALESCE(c.line_status,'active')<>'cancelled'
        AND c.next_upgrade_date IS NOT NULL
        AND DATE(c.next_upgrade_date) > CURRENT_DATE()
        AND DATE(c.next_upgrade_date) <= DATE_ADD(CURRENT_DATE(),INTERVAL 7 DAY)
      ORDER BY c.next_upgrade_date,c.client_name
      LIMIT 150\`, { id })
  ]);

  const checked = new Map(checks.rows.map(x => [\`\${x.source_type}:\${x.source_key}\`, x]));
  const items = [];

  for (const t of tasks.rows) {
    const waitingApproval = String(t.status)==='completed' && String(t.workflow_state)==='awaiting_sender_ack';
    items.push({
      sourceType:'task', sourceKey:String(t.id), title:t.title || 'Task', detail:t.message || '',
      dueAt:t.due_at, occurredAt:t.completed_at || t.updated_at || t.created_at,
      status:responsibilityState({completed:String(t.status)==='completed',dueAt:t.due_at,waitingApproval}),
      priority:t.priority || 'normal'
    });
  }

  for (const f of followups.rows) {
    items.push({
      sourceType:'follow_up',sourceKey:String(f.id),title:\`Follow-up · \${f.customer_name || 'Customer'}\`,
      detail:f.reason || f.notes || '',dueAt:f.scheduled_at,occurredAt:f.completed_at || f.created_at,
      status:responsibilityState({completed:String(f.status)==='completed',dueAt:f.scheduled_at}),priority:'normal'
    });
  }

  for (const cb of callbacks.rows) {
    items.push({
      sourceType:'callback',sourceKey:String(cb.id),title:\`Callback · \${cb.customer_name || 'Customer'}\`,
      detail:cb.reason || cb.notes || '',dueAt:cb.scheduled_at,occurredAt:cb.completed_at || cb.created_at,
      status:responsibilityState({completed:String(cb.status)==='completed',dueAt:cb.scheduled_at}),priority:'normal'
    });
  }

  for (const i of inquiries.rows) {
    const completed = ['closed','completed','resolved','cancelled'].includes(String(i.status));
    items.push({
      sourceType:'inquiry',sourceKey:String(i.id),title:\`Inquiry · \${i.client_name || i.cell_number || 'Customer'}\`,
      detail:i.query_text || '',dueAt:i.follow_up_at,occurredAt:i.completed_at || i.updated_at || i.created_at,
      status:responsibilityState({completed,dueAt:i.follow_up_at}),priority:'normal'
    });
  }

  for (const b of birthdays.rows) {
    const key = \`client:\${b.id}\`;
    const check = checked.get(\`birthday:\${key}\`);
    items.push({
      sourceType:'birthday',sourceKey:key,title:\`Birthday · \${b.client_name || 'Customer'}\`,
      detail:b.cell_number || b.account_number || '',dueAt:null,occurredAt:b.birthday,
      status:responsibilityState({checked:Boolean(check && check.status==='completed')}),priority:'normal',manualCheck:true
    });
  }

  for (const u of upgrades.rows) {
    const key = \`client:\${u.id}\`;
    const check = checked.get(\`upgrade:\${key}\`);
    items.push({
      sourceType:'upgrade',sourceKey:key,title:\`Upgrade due · \${u.client_name || 'Customer'}\`,
      detail:[u.cell_number,u.package_name].filter(Boolean).join(' · '),dueAt:u.next_upgrade_date,occurredAt:u.next_upgrade_date,
      status:responsibilityState({checked:Boolean(check && check.status==='completed'),dueAt:u.next_upgrade_date}),priority:'normal',manualCheck:true
    });
  }

  const summary = { expected:items.length, completed:0, outstanding:0, overdue:0 };
  for (const item of items) {
    if (item.status === 'completed' || item.status === 'awaiting_approval') summary.completed += 1;
    else if (item.status === 'overdue') summary.overdue += 1;
    else summary.outstanding += 1;
  }

  return { items, upcomingUpgrades:upcomingUpgrades.rows, summary };
}

async function buildTeamDailyOverview(staffSummaries) {
  const list = Array.isArray(staffSummaries) ? staffSummaries : [];
  const daily = await Promise.all(list.map(s => buildDailyResponsibilities(s.id)));
  return list.map((s,index) => ({ ...s, daily:daily[index].summary }));
}

async function sendAgentInstruction({ issuedBy, assignedTo, title, message, dueAt, priority='normal' } = {}) {
  await ensureAgentResponsibilitySchema();
  const issuerId = Number(issuedBy || 0);
  const assigneeId = Number(assignedTo || 0);
  const cleanTitle = String(title || '').trim().slice(0,180);
  const cleanMessage = String(message || '').trim().slice(0,5000);
  const cleanDueAt = normaliseAgentDateTime(dueAt);
  const cleanPriority = ['normal','high','urgent'].includes(String(priority)) ? String(priority) : 'normal';
  if (!issuerId || !assigneeId || !cleanTitle || !cleanDueAt) throw new Error('Staff member, task title and completion date/time are required.');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[staff]] = await conn.execute('SELECT id,full_name,email,is_active FROM staff_users WHERE id=:id LIMIT 1',{id:assigneeId});
    if (!staff || !Number(staff.is_active)) throw new Error('The selected staff member is not active.');

    const [created] = await conn.execute(\`INSERT INTO staff_tasks
      (type,title,message,priority,status,assigned_to,created_by,due_at,email_status)
      VALUES ('task',:title,:message,:priority,'unread',:assignedTo,:createdBy,:dueAt,'not_configured')\`, {
      title:cleanTitle,message:cleanMessage || cleanTitle,priority:cleanPriority,
      assignedTo:assigneeId,createdBy:issuerId,dueAt:cleanDueAt
    });
    const taskId = created.insertId;

    await conn.execute(\`INSERT INTO staff_task_workflow (task_id,workflow_state)
      VALUES (:taskId,'active') ON DUPLICATE KEY UPDATE task_id=VALUES(task_id)\`, { taskId });

    await conn.execute(\`INSERT INTO staff_task_notifications
      (task_id,recipient_staff_id,actor_staff_id,event_type,notification_text,action_required)
      VALUES (:taskId,:recipientId,:actorId,'agent_instruction',:text,1)\`, {
      taskId,recipientId:assigneeId,actorId:issuerId,
      text:\`Management instruction: \${cleanTitle} · due \${cleanDueAt}\`
    });

    await conn.execute(\`INSERT INTO agent_task_watches
      (task_id,issued_by,assigned_to,due_at,alert_enabled)
      VALUES (:taskId,:issuedBy,:assignedTo,:dueAt,1)
      ON DUPLICATE KEY UPDATE due_at=VALUES(due_at),alert_enabled=1,updated_at=NOW()\`, {
      taskId,issuedBy:issuerId,assignedTo:assigneeId,dueAt:cleanDueAt
    });

    await conn.commit();
    return { taskId, staffName:staff.full_name || staff.email, dueAt:cleanDueAt };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function markResponsibilityComplete({ staffId, sourceType, sourceKey, completedBy, note=null } = {}) {
  await ensureAgentResponsibilitySchema();
  const id = Number(staffId || 0);
  const actor = Number(completedBy || 0);
  const type = String(sourceType || '');
  const key = String(sourceKey || '').slice(0,160);
  if (!id || !actor || !['birthday','upgrade'].includes(type) || !key) throw new Error('Invalid responsibility completion request.');

  await db.execute(\`INSERT INTO agent_responsibility_checks
    (work_date,staff_id,source_type,source_key,status,completed_at,completed_by,note)
    VALUES (CURRENT_DATE(),:staffId,:sourceType,:sourceKey,'completed',NOW(),:completedBy,:note)
    ON DUPLICATE KEY UPDATE status='completed',completed_at=NOW(),completed_by=VALUES(completed_by),note=VALUES(note),updated_at=NOW()\`, {
    staffId:id,sourceType:type,sourceKey:key,completedBy:actor,note:String(note || '').trim().slice(0,500) || null
  });
}

async function refreshOverdueWatches() {
  await ensureAgentResponsibilitySchema();
  const candidates = await rows(\`SELECT w.id,w.task_id,w.issued_by,w.assigned_to,w.due_at,t.title,
    COALESCE(NULLIF(su.full_name,''),su.email,'Staff') AS assignee_name
    FROM agent_task_watches w
    JOIN staff_tasks t ON t.id=w.task_id
    LEFT JOIN staff_task_workflow tw ON tw.task_id=t.id
    LEFT JOIN staff_users su ON su.id=w.assigned_to
    WHERE w.alert_enabled=1 AND w.overdue_alerted_at IS NULL AND w.due_at<NOW()
      AND (t.status IN ('unread','seen','in_progress') OR (t.status='completed' AND tw.workflow_state='awaiting_sender_ack'))
    ORDER BY w.due_at\`);

  for (const item of candidates.rows) {
    const [claim] = await db.execute(\`UPDATE agent_task_watches
      SET overdue_alerted_at=NOW(),updated_at=NOW()
      WHERE id=:id AND overdue_alerted_at IS NULL\`, { id:item.id });
    if (!claim.affectedRows) continue;
    try {
      await db.execute(\`INSERT INTO staff_task_notifications
        (task_id,recipient_staff_id,actor_staff_id,event_type,notification_text,action_required)
        VALUES (:taskId,:recipientId,NULL,'agent_deadline_missed',:text,0)\`, {
        taskId:item.task_id,recipientId:item.issued_by,
        text:\`Deadline missed: \${item.assignee_name} has not completed “\${item.title}”.\`
      });
    } catch (_) {}
  }

  const current = await rows(\`SELECT w.id,w.task_id,w.issued_by,w.assigned_to,w.due_at,w.overdue_alerted_at,t.title,t.status,
    COALESCE(NULLIF(su.full_name,''),su.email,'Staff') AS assignee_name
    FROM agent_task_watches w
    JOIN staff_tasks t ON t.id=w.task_id
    LEFT JOIN staff_task_workflow tw ON tw.task_id=t.id
    LEFT JOIN staff_users su ON su.id=w.assigned_to
    WHERE w.alert_enabled=1 AND w.due_at<NOW()
      AND (t.status IN ('unread','seen','in_progress') OR (t.status='completed' AND tw.workflow_state='awaiting_sender_ack'))
    ORDER BY w.due_at ASC
    LIMIT 100\`);
  return current.rows;
}

async function buildAgentOfficeReport({ rangeKey='today', requestedBy=null, requestSource='backoffice', commandText=null, metricKey=null, staffId=null } = {}) {
  await ensureAgentResponsibilitySchema();
  const range = rangeSql(rangeKey);
  const between = `BETWEEN ${range.fromExpr} AND ${range.toExpr}`;

  const [activeStaff,inquiryCreated,inquiryClosed,tasksCreated,tasksCompleted,clientsCreated,overdueTasks,pendingTasks,auditedActions] = await Promise.all([
    scalar(`SELECT COUNT(DISTINCT staff_id) FROM attendance_sessions WHERE status='active'`),
    scalar(`SELECT COUNT(*) FROM inquiries WHERE created_at ${between}`),
    scalar(`SELECT COUNT(*) FROM inquiries WHERE status IN ('closed','completed','resolved','cancelled') AND COALESCE(completed_at,updated_at) ${between}`),
    scalar(`SELECT COUNT(*) FROM staff_tasks WHERE created_at ${between}`),
    scalar(`SELECT COUNT(*) FROM staff_tasks WHERE completed_at ${between}`),
    scalar(`SELECT COUNT(*) FROM clients WHERE created_at ${between}`),
    scalar(`SELECT COUNT(*) FROM staff_tasks t LEFT JOIN staff_task_workflow w ON w.task_id=t.id WHERE ${ACTIVE_TASK} AND t.due_at IS NOT NULL AND t.due_at<NOW()`),
    scalar(`SELECT COUNT(*) FROM staff_tasks t LEFT JOIN staff_task_workflow w ON w.task_id=t.id WHERE ${ACTIVE_TASK}`),
    scalar(`SELECT COUNT(*) FROM audit_log WHERE created_at ${between}`)
  ]);

  const [staffActivity,recentAudit,screenUsage,staffSummaries,metricDetail,selectedStaff] = await Promise.all([
    rows(`SELECT su.id,COALESCE(NULLIF(su.full_name,''),NULLIF(CONCAT_WS(' ',su.first_name,su.surname),''),su.email) AS staff_name,
      MIN(a.clock_in_at) AS first_clock_in,MAX(COALESCE(a.clock_out_at,a.updated_at)) AS last_activity,
      SUM(CASE WHEN a.status='active' THEN 1 ELSE 0 END) AS active_sessions
      FROM attendance_sessions a JOIN staff_users su ON su.id=a.staff_id
      WHERE a.clock_in_at ${between}
      GROUP BY su.id,staff_name ORDER BY first_clock_in ASC`),
    rows(`SELECT al.created_at,al.action_type,al.entity_type,al.entity_id,
      COALESCE(NULLIF(su.full_name,''),su.email,'System') AS staff_name,al.description
      FROM audit_log al LEFT JOIN staff_users su ON su.id=al.staff_id
      WHERE al.created_at ${between} ORDER BY al.created_at DESC LIMIT 40`),
    rows(`SELECT COALESCE(screen_key,'unknown') AS screen_key,COUNT(*) AS uses,
      COUNT(DISTINCT staff_id) AS staff_count,MAX(occurred_at) AS last_used_at
      FROM crm_usage_events WHERE event_type='screen_view' AND occurred_at ${between}
      GROUP BY screen_key ORDER BY uses DESC,screen_key ASC LIMIT 20`),
    buildStaffSummaries(range),
    buildMetricDetail(metricKey,range),
    buildStaffDetail(staffId,range)
  ]);

  const [teamDaily,selectedDaily,deadlineAlerts] = await Promise.all([
    buildTeamDailyOverview(staffSummaries),
    staffId ? buildDailyResponsibilities(staffId) : Promise.resolve(null),
    refreshOverdueWatches()
  ]);
  if (selectedStaff && selectedDaily) selectedStaff.daily = selectedDaily;

  const report = {
    generatedAt: new Date().toISOString(),
    range,
    metrics: [
      metric('staff_working','Staff working now',activeStaff),
      metric('new_inquiries','New inquiries',inquiryCreated),
      metric('inquiries_completed','Inquiries completed',inquiryClosed),
      metric('tasks_created','Tasks created',tasksCreated),
      metric('tasks_completed','Tasks completed',tasksCompleted),
      metric('new_customers','New customers / prospects',clientsCreated),
      metric('outstanding_tasks','Outstanding tasks',pendingTasks),
      metric('overdue_tasks','Overdue tasks',overdueTasks),
      metric('audited_actions','Audited CRM actions',auditedActions)
    ],
    staffActivity: staffActivity.rows,
    staffSummaries: teamDaily,
    selectedStaff,
    deadlineAlerts,
    metricDetail,
    recentAudit: recentAudit.rows,
    screenUsage: screenUsage.rows,
    availability: {
      staffActivity: staffActivity.available,
      recentAudit: recentAudit.available,
      screenUsage: screenUsage.available
    }
  };

  try {
    await db.execute(`INSERT INTO office_intelligence_runs
      (requested_by,request_source,command_text,range_key,range_label,report_json)
      VALUES (:requestedBy,:requestSource,:commandText,:rangeKey,:rangeLabel,:reportJson)`, {
      requestedBy,requestSource,commandText,rangeKey:range.key,rangeLabel:range.label,reportJson:JSON.stringify(report)
    });
  } catch (_) {}

  return report;
}

module.exports = {
  buildAgentOfficeReport,
  ensureAgentResponsibilitySchema,
  buildDailyResponsibilities,
  sendAgentInstruction,
  markResponsibilityComplete,
  refreshOverdueWatches
};
