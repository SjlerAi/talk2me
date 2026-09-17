'use strict';

const db = require('../config/db');

let schemaReady = false;
let schemaPromise = null;

async function ensureOfficeIntelligenceSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await db.execute(`CREATE TABLE IF NOT EXISTS crm_usage_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      staff_id BIGINT UNSIGNED NULL,
      event_type VARCHAR(40) NOT NULL,
      screen_key VARCHAR(120) NULL,
      route_path VARCHAR(255) NULL,
      module_name VARCHAR(120) NULL,
      entity_type VARCHAR(80) NULL,
      entity_id BIGINT UNSIGNED NULL,
      http_method VARCHAR(12) NULL,
      http_status SMALLINT UNSIGNED NULL,
      metadata_json JSON NULL,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_crm_usage_occurred (occurred_at),
      KEY idx_crm_usage_staff_date (staff_id,occurred_at),
      KEY idx_crm_usage_screen_date (screen_key,occurred_at),
      KEY idx_crm_usage_event_date (event_type,occurred_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`CREATE TABLE IF NOT EXISTS office_intelligence_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      requested_by BIGINT UNSIGNED NULL,
      request_source ENUM('backoffice','mobile','scheduled','email') NOT NULL DEFAULT 'backoffice',
      command_text VARCHAR(500) NULL,
      range_key VARCHAR(40) NOT NULL DEFAULT 'today',
      range_label VARCHAR(160) NULL,
      report_json JSON NULL,
      email_recipient VARCHAR(255) NULL,
      email_status ENUM('not_requested','pending','sent','failed') NOT NULL DEFAULT 'not_requested',
      email_error VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_office_intel_runs_created (created_at),
      KEY idx_office_intel_runs_requester (requested_by,created_at),
      KEY idx_office_intel_runs_source (request_source,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`CREATE TABLE IF NOT EXISTS office_intelligence_config (
      id TINYINT UNSIGNED NOT NULL,
      timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Johannesburg',
      report_hour TINYINT UNSIGNED NOT NULL DEFAULT 18,
      report_minute TINYINT UNSIGNED NOT NULL DEFAULT 0,
      scheduled_report_enabled TINYINT(1) NOT NULL DEFAULT 0,
      recipient_staff_id BIGINT UNSIGNED NULL,
      recipient_email VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`INSERT INTO office_intelligence_config
      (id,timezone,report_hour,report_minute,scheduled_report_enabled)
      VALUES (1,'Africa/Johannesburg',18,0,0)
      ON DUPLICATE KEY UPDATE id=VALUES(id)`);
    schemaReady = true;
  })().finally(() => { schemaPromise = null; });
  return schemaPromise;
}

function rangeSql(rangeKey = 'today') {
  switch (String(rangeKey || 'today').toLowerCase()) {
    case 'week':
    case 'weekly':
    case 'this_week':
      return { key: 'this_week', label: 'This week', fromExpr: 'DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY)', toExpr: 'NOW()' };
    case 'last7':
    case 'last_7_days':
      return { key: 'last_7_days', label: 'Last 7 days', fromExpr: 'DATE_SUB(NOW(), INTERVAL 7 DAY)', toExpr: 'NOW()' };
    case 'month':
    case 'month_to_date':
      return { key: 'month_to_date', label: 'Month to date', fromExpr: "DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')", toExpr: 'NOW()' };
    default:
      return { key: 'today', label: 'Today', fromExpr: 'CURRENT_DATE()', toExpr: 'NOW()' };
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
  await ensureOfficeIntelligenceSchema();
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
    availability: { staffActivity: staffActivity.available, recentAudit: recentAudit.available, screenUsage: screenUsage.available }
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
    // Reporting remains available even if run logging fails.
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

module.exports = { buildOfficeReport, ensureOfficeIntelligenceSchema, parseCommand, rangeSql };
