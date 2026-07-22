const db = require('../config/db');
const attendance = require('./attendance');

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

async function ensureColumn(tableName, columnName, definition) {
  const [rows] = await db.execute(`SHOW COLUMNS FROM \`${tableName}\` LIKE :columnName`, { columnName });
  if (!rows.length) await db.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
}

async function ensureNightlyLogoutSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await attendance.ensureAttendanceSchema();
    await ensureColumn('attendance_settings', 'auto_logout_enabled', "auto_logout_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER auto_clock_out_on_logout");
    await ensureColumn('attendance_settings', 'auto_logout_time', "auto_logout_time TIME NOT NULL DEFAULT '22:00:00' AFTER auto_logout_enabled");
    await ensureColumn('attendance_settings', 'last_auto_logout_date', 'last_auto_logout_date DATE NULL AFTER auto_logout_time');

    const [sourceColumn] = await db.execute("SHOW COLUMNS FROM attendance_sessions LIKE 'clock_out_source'");
    const sourceType = String(sourceColumn[0]?.Type || '');
    if (!sourceType.includes('default_logout')) {
      await db.query(`ALTER TABLE attendance_sessions MODIFY COLUMN clock_out_source
        ENUM('logout','manual','adjustment','missing','default_logout') NULL`);
    }

    schemaReady = true;
  })().finally(() => { schemaPromise = null; });

  return schemaPromise;
}

async function getNightlyLogoutSettings() {
  await ensureNightlyLogoutSchema();
  const [[settings]] = await db.execute(`SELECT timezone,auto_logout_enabled,auto_logout_time,
      DATE_FORMAT(last_auto_logout_date,'%Y-%m-%d') last_auto_logout_date
    FROM attendance_settings WHERE id=1`);
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
          clock_out_at=:cutoff,status='closed',clock_out_source='default_logout',
          notes=CONCAT_WS(' | ',notes,'Default logout applied by Talk2Me')
        WHERE status='active'`, { cutoff });

      await conn.execute(`UPDATE staff_login_sessions SET
          logout_at=:cutoff,last_activity_at=LEAST(COALESCE(last_activity_at,:cutoff),:cutoff),session_status='logged_out'
        WHERE session_status='active'`, { cutoff });

      await conn.execute('DELETE FROM app_sessions');
      await conn.execute('UPDATE attendance_settings SET last_auto_logout_date=:runDate WHERE id=1', { runDate: current.date });
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
