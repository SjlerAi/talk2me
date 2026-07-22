const db = require('../config/db');

let schemaReady = false;
let schemaPromise = null;
let running = false;

function localParts(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function timeMinutes(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 22 * 60;
}

async function ensureNightlyLogoutSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await db.execute(`CREATE TABLE IF NOT EXISTS nightly_logout_settings (
      id TINYINT UNSIGNED NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      logout_time TIME NOT NULL DEFAULT '22:00:00',
      timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Johannesburg',
      last_run_date DATE NULL,
      updated_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`INSERT INTO nightly_logout_settings
      (id,enabled,logout_time,timezone)
      VALUES (1,1,'22:00:00','Africa/Johannesburg')
      ON DUPLICATE KEY UPDATE id=VALUES(id)`);

    schemaReady = true;
  })().finally(() => { schemaPromise = null; });

  return schemaPromise;
}

async function getNightlyLogoutSettings() {
  await ensureNightlyLogoutSchema();
  const [[settings]] = await db.execute(`SELECT timezone,enabled auto_logout_enabled,
      logout_time auto_logout_time,DATE_FORMAT(last_run_date,'%Y-%m-%d') last_auto_logout_date
    FROM nightly_logout_settings WHERE id=1`);
  return settings || {
    timezone: 'Africa/Johannesburg',
    auto_logout_enabled: 1,
    auto_logout_time: '22:00:00',
    last_auto_logout_date: null
  };
}

async function runAutomaticLogout(now = new Date()) {
  if (running) return { ran: false, reason: 'already_running' };
  running = true;
  try {
    const settings = await getNightlyLogoutSettings();
    if (!settings.auto_logout_enabled) return { ran: false, reason: 'disabled' };

    const zone = settings.timezone || 'Africa/Johannesburg';
    const current = localParts(zone, now);
    const cutoffMinutes = timeMinutes(settings.auto_logout_time);
    const lastRun = settings.last_auto_logout_date || '';

    if (current.minuteOfDay < cutoffMinutes) return { ran: false, reason: 'before_cutoff' };
    if (lastRun === current.date) return { ran: false, reason: 'already_completed' };

    const cutoff = `${current.date} ${String(settings.auto_logout_time || '22:00:00').slice(0, 8)}`;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [attendanceResult] = await conn.execute(`UPDATE attendance_sessions SET
          clock_out_at=:cutoff,status='closed',clock_out_source='missing',
          notes=CONCAT_WS(' | ',notes,'Default logout applied by Talk2Me')
        WHERE status='active'`, { cutoff });

      await conn.execute(`UPDATE staff_login_sessions SET
          logout_at=:cutoff,last_activity_at=LEAST(COALESCE(last_activity_at,:cutoff),:cutoff),
          session_status='logged_out',logout_reason='automatic'
        WHERE session_status='active'`, { cutoff });

      await conn.execute('DELETE FROM app_sessions');
      await conn.execute('UPDATE nightly_logout_settings SET last_run_date=:runDate WHERE id=1', { runDate: current.date });
      await conn.commit();

      return { ran: true, closedAttendance: attendanceResult.affectedRows, cutoff };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } finally {
    running = false;
  }
}

function startNightlyLogoutWorker() {
  const run = () => runAutomaticLogout().catch(error => console.error('Nightly automatic logout failed', error));
  setTimeout(run, 5000);
  const timer = setInterval(run, 30000);
  timer.unref?.();
  return timer;
}

module.exports = {
  ensureNightlyLogoutSchema,
  getNightlyLogoutSettings,
  runAutomaticLogout,
  startNightlyLogoutWorker,
  localParts
};
