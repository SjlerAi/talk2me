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

async function buildAgentOfficeReport({ rangeKey='today', requestedBy=null, requestSource='backoffice', commandText=null, metricKey=null, staffId=null } = {}) {
  await ensureOfficeIntelligenceSchema();
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
    staffSummaries,
    selectedStaff,
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

module.exports = { buildAgentOfficeReport };
