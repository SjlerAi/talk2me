'use strict';

const db = require('../config/db');

function startOfTodaySql() {
  return 'CURRENT_DATE()';
}

function rangeSql(rangeKey = 'today') {
  switch (String(rangeKey || 'today').toLowerCase()) {
    case 'week':
    case 'weekly':
    case 'this_week':
      return {
        key: 'this_week',
        label: 'This week',
        fromExpr: 'DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY)',
        toExpr: 'NOW()'
      };
    case 'last7':
    case 'last_7_days':
      return { key: 'last_7_days', label: 'Last 7 days', fromExpr: 'DATE_SUB(NOW(), INTERVAL 7 DAY)', toExpr: 'NOW()' };
    case 'month':
    case 'month_to_date':
      return { key: 'month_to_date', label: 'Month to date', fromExpr: "DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')", toExpr: 'NOW()' };
    case 'today':
    default:
      return { key: 'today', label: 'Today', fromExpr: startOfTodaySql(), toExpr: 'NOW()' };
  }
}

async function scalar(sql, params = {}) {
  try {
    const [[row]] = await db.execute(sql, params);
    const value = row ? Object.values(row)[0] : 0;
    return { value: Number(value || 0), available: true };
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

function metric(name, result) {
  return { name, value: result.value, available: result.available };
}

async function buildOfficeReport({ rangeKey = 'today', requestedBy = null, requestSource = 'backoffice', commandText = null } = {}) {
  const range = rangeSql(rangeKey);
  const between = `BETWEEN ${range.fromExpr} AND ${range.toExpr}`;

  const [activeStaff, inquiryCreated, inquiryClosed, tasksCreated, tasksCompleted, clientsCreated, overdueTasks, pendingTasks, auditedActions] = await Promise.all([
    scalar(`SELECT COUNT(DISTINCT staff_id) AS total FROM attendance_sessions WHERE status='active'`),
    scalar(`SELECT COUNT(*) AS total FROM inquiries WHERE created_at ${between}`),
    scalar(`SELECT COUNT(*) AS total FROM inquiries WHERE status IN ('closed','completed','resolved') AND updated_at ${between}`),
    scalar(`SELECT COUNT(*) AS total FROM staff_tasks WHERE created_at ${between}`),
    scalar(`SELECT COUNT(*) AS total FROM staff_tasks WHERE completed_at ${between}`),
    scalar(`SELECT COUNT(*) AS total FROM clients WHERE created_at ${between}`),
    scalar(`SELECT COUNT(*) AS total FROM staff_tasks WHERE status NOT IN ('completed','cancelled') AND due_at IS NOT NULL AND due_at < NOW()`),
    scalar(`SELECT COUNT(*) AS total FROM staff_tasks WHERE status NOT IN ('completed','cancelled')`),
    scalar(`SELECT COUNT(*) AS total FROM audit_log WHERE created_at ${between}`)
  ]);

  const staffActivity = await rows(`
    SELECT su.id, COALESCE(NULLIF(su.full_name,''), NULLIF(CONCAT_WS(' ',su.first_name,su.surname),''), su.email) AS staff_name,
           MIN(a.clock_in_at) AS first_clock_in,
           MAX(COALESCE(a.clock_out_at,a.updated_at)) AS last_activity,
           SUM(CASE WHEN a.status='active' THEN 1 ELSE 0 END) AS active_sessions
    FROM attendance_sessions a
    JOIN staff_users su ON su.id=a.staff_id
    WHERE a.clock_in_at ${between}
    GROUP BY su.id, staff_name
    ORDER BY first_clock_in ASC
  `);

  const recentAudit = await rows(`
    SELECT al.created_at, al.action_type, al.entity_type, al.entity_id,
           COALESCE(NULLIF(su.full_name,''), NULLIF(CONCAT_WS(' ',su.first_name,su.surname),''), su.email, 'System') AS staff_name,
           al.description
    FROM audit_log al
    LEFT JOIN staff_users su ON su.id=al.staff_id
    WHERE al.created_at ${between}
    ORDER BY al.created_at DESC
    LIMIT 30
  `);

  const screenUsage = await rows(`
    SELECT COALESCE(screen_key,'unknown') AS screen_key, COUNT(*) AS uses,
           COUNT(DISTINCT staff_id) AS staff_count,
           MAX(occurred_at) AS last_used_at
    FROM crm_usage_events
    WHERE event_type='screen_view' AND occurred_at ${between}
    GROUP BY screen_key
    ORDER BY uses DESC, screen_key ASC
    LIMIT 20
  `);

  const report = {
    generatedAt: new Date().toISOString(),
    range,
    metrics: [
      metric('Staff working now', activeStaff),
      metric('New inquiries', inquiryCreated),
      metric('Inquiries completed', inquiryClosed),
      metric('Tasks created', tasksCreated),
      metric('Tasks completed', tasksCompleted),
      metric('New customers / prospects', clientsCreated),
      metric('Outstanding tasks', pendingTasks),
      metric('Overdue tasks', overdueTasks),
      metric('Audited CRM actions', auditedActions)
    ],
    staffActivity: staffActivity.rows,
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
      requestedBy,
      requestSource,
      commandText,
      rangeKey: range.key,
      rangeLabel: range.label,
      reportJson: JSON.stringify(report)
    });
  } catch (error) {
    // The report itself must still be usable if run logging is unavailable.
  }

  return report;
}

function parseCommand(commandText = '') {
  const text = String(commandText || '').trim().toLowerCase();
  if (!text || text === 'check for me' || text === 'check') return { rangeKey: 'today' };
  if (text.includes('last 7') || text.includes('seven day')) return { rangeKey: 'last_7_days' };
  if (text.includes('week')) return { rangeKey: 'this_week' };
  if (text.includes('month')) return { rangeKey: 'month_to_date' };
  return { rangeKey: 'today' };
}

module.exports = { buildOfficeReport, parseCommand, rangeSql };
