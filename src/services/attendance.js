const db = require('../config/db');

let schemaReady = false;
let schemaPromise = null;

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '')
    .split(',')[0].trim().slice(0, 45) || null;
}

async function ensureAttendanceSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await db.execute(`CREATE TABLE IF NOT EXISTS attendance_settings (
      id TINYINT UNSIGNED NOT NULL,
      timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Johannesburg',
      annual_leave_days DECIMAL(6,2) NOT NULL DEFAULT 15.00,
      late_grace_minutes INT NOT NULL DEFAULT 10,
      auto_clock_in_on_login TINYINT(1) NOT NULL DEFAULT 1,
      auto_clock_out_on_logout TINYINT(1) NOT NULL DEFAULT 1,
      updated_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`CREATE TABLE IF NOT EXISTS attendance_schedule_days (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      iso_day TINYINT UNSIGNED NOT NULL,
      day_name VARCHAR(20) NOT NULL,
      is_workday TINYINT(1) NOT NULL DEFAULT 1,
      start_time TIME NULL,
      end_time TIME NULL,
      break_minutes INT NOT NULL DEFAULT 0,
      updated_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_attendance_schedule_day (iso_day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`CREATE TABLE IF NOT EXISTS attendance_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      staff_id INT NOT NULL,
      login_session_id BIGINT NULL,
      work_date DATE NOT NULL,
      clock_in_at DATETIME NOT NULL,
      clock_out_at DATETIME NULL,
      status ENUM('active','closed','adjusted','manual') NOT NULL DEFAULT 'active',
      clock_in_source ENUM('login','manual','adjustment') NOT NULL DEFAULT 'login',
      clock_out_source ENUM('logout','manual','adjustment','missing') NULL,
      clock_in_ip VARCHAR(45) NULL,
      clock_out_ip VARCHAR(45) NULL,
      user_agent VARCHAR(1000) NULL,
      notes VARCHAR(1000) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_attendance_staff_date (staff_id,work_date),
      KEY idx_attendance_active (staff_id,status),
      KEY idx_attendance_login_session (login_session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`CREATE TABLE IF NOT EXISTS attendance_adjustments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      attendance_session_id BIGINT UNSIGNED NOT NULL,
      staff_id INT NOT NULL,
      original_clock_in_at DATETIME NULL,
      original_clock_out_at DATETIME NULL,
      adjusted_clock_in_at DATETIME NULL,
      adjusted_clock_out_at DATETIME NULL,
      reason VARCHAR(1000) NOT NULL,
      adjusted_by INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_attendance_adjustment_session (attendance_session_id),
      KEY idx_attendance_adjustment_staff (staff_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`CREATE TABLE IF NOT EXISTS leave_types (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      name VARCHAR(100) NOT NULL,
      is_paid TINYINT(1) NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_leave_type_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`CREATE TABLE IF NOT EXISTS staff_leave_records (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      staff_id INT NOT NULL,
      leave_type_id INT UNSIGNED NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      leave_days DECIMAL(6,2) NOT NULL,
      status ENUM('pending','approved','cancelled') NOT NULL DEFAULT 'approved',
      reason VARCHAR(1000) NULL,
      approved_by INT NULL,
      created_by INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_staff_leave_dates (staff_id,start_date,end_date),
      KEY idx_staff_leave_status (status,start_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.execute(`INSERT INTO attendance_settings
      (id,timezone,annual_leave_days,late_grace_minutes,auto_clock_in_on_login,auto_clock_out_on_logout)
      VALUES (1,'Africa/Johannesburg',15.00,10,1,1)
      ON DUPLICATE KEY UPDATE id=VALUES(id)`);

    const schedule = [
      [1, 'Monday', 1, '07:45:00', '17:00:00', 0],
      [2, 'Tuesday', 1, '07:45:00', '17:00:00', 0],
      [3, 'Wednesday', 1, '07:45:00', '17:00:00', 0],
      [4, 'Thursday', 1, '07:45:00', '17:00:00', 0],
      [5, 'Friday', 1, '07:45:00', '17:00:00', 0],
      [6, 'Saturday', 1, '08:30:00', '12:00:00', 0],
      [7, 'Sunday', 0, null, null, 0]
    ];
    for (const [isoDay, dayName, isWorkday, startTime, endTime, breakMinutes] of schedule) {
      await db.execute(`INSERT INTO attendance_schedule_days
        (iso_day,day_name,is_workday,start_time,end_time,break_minutes)
        VALUES (:isoDay,:dayName,:isWorkday,:startTime,:endTime,:breakMinutes)
        ON DUPLICATE KEY UPDATE iso_day=VALUES(iso_day)`, {
        isoDay, dayName, isWorkday, startTime, endTime, breakMinutes
      });
    }

    const leaveTypes = [
      ['annual', 'Annual leave', 1, 1],
      ['sick', 'Sick leave', 1, 2],
      ['family', 'Family responsibility leave', 1, 3],
      ['unpaid', 'Unpaid leave', 0, 4],
      ['other', 'Other authorised leave', 1, 5]
    ];
    for (const [code, name, paid, sortOrder] of leaveTypes) {
      await db.execute(`INSERT INTO leave_types (code,name,is_paid,sort_order)
        VALUES (:code,:name,:paid,:sortOrder)
        ON DUPLICATE KEY UPDATE name=VALUES(name),is_paid=VALUES(is_paid),sort_order=VALUES(sort_order)`, {
        code, name, paid, sortOrder
      });
    }
    schemaReady = true;
  })().finally(() => { schemaPromise = null; });
  return schemaPromise;
}

async function getSettings() {
  await ensureAttendanceSchema();
  const [[settings]] = await db.execute('SELECT * FROM attendance_settings WHERE id=1');
  const [schedule] = await db.query('SELECT * FROM attendance_schedule_days ORDER BY iso_day');
  return { settings, schedule };
}

async function clockIn({ staffId, loginSessionId = null, req = null }) {
  await ensureAttendanceSchema();
  const [[settings]] = await db.execute('SELECT auto_clock_in_on_login FROM attendance_settings WHERE id=1');
  if (!settings?.auto_clock_in_on_login) return null;

  const [[existing]] = await db.execute(`SELECT id FROM attendance_sessions
    WHERE staff_id=:staffId AND status='active' ORDER BY clock_in_at DESC LIMIT 1`, { staffId });
  if (existing) return existing.id;

  const [result] = await db.execute(`INSERT INTO attendance_sessions
    (staff_id,login_session_id,work_date,clock_in_at,status,clock_in_source,clock_in_ip,user_agent)
    VALUES (:staffId,:loginSessionId,CURRENT_DATE(),NOW(),'active','login',:ip,:userAgent)`, {
    staffId,
    loginSessionId,
    ip: req ? requestIp(req) : null,
    userAgent: req ? String(req.get('user-agent') || '').slice(0, 1000) || null : null
  });
  return result.insertId;
}

async function clockOut({ staffId, loginSessionId = null, req = null, source = 'logout' }) {
  await ensureAttendanceSchema();
  const [[settings]] = await db.execute('SELECT auto_clock_out_on_logout FROM attendance_settings WHERE id=1');
  if (!settings?.auto_clock_out_on_logout && source === 'logout') return null;

  const params = { staffId, loginSessionId, ip: req ? requestIp(req) : null, source };
  const [result] = await db.execute(`UPDATE attendance_sessions SET
      clock_out_at=NOW(),status='closed',clock_out_source=:source,clock_out_ip=:ip
    WHERE staff_id=:staffId AND status='active'
      AND (:loginSessionId IS NULL OR login_session_id=:loginSessionId)
    ORDER BY clock_in_at DESC LIMIT 1`, params);
  if (!result.affectedRows && loginSessionId) {
    await db.execute(`UPDATE attendance_sessions SET
        clock_out_at=NOW(),status='closed',clock_out_source=:source,clock_out_ip=:ip
      WHERE staff_id=:staffId AND status='active'
      ORDER BY clock_in_at DESC LIMIT 1`, params);
  }
  return true;
}

async function getAttendanceState(staffId) {
  await ensureAttendanceSchema();
  const [[active]] = await db.execute(`SELECT id,clock_in_at,work_date,TIMESTAMPDIFF(MINUTE,clock_in_at,NOW()) worked_minutes
    FROM attendance_sessions WHERE staff_id=:staffId AND status='active'
    ORDER BY clock_in_at DESC LIMIT 1`, { staffId });
  return active || null;
}

async function countWorkdays(startDate, endDate) {
  await ensureAttendanceSchema();
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  const [schedule] = await db.query('SELECT iso_day,is_workday FROM attendance_schedule_days');
  const workdays = new Set(schedule.filter(row => row.is_workday).map(row => Number(row.iso_day)));
  let count = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (workdays.has(iso)) count += 1;
  }
  return count;
}

module.exports = {
  ensureAttendanceSchema,
  getSettings,
  clockIn,
  clockOut,
  getAttendanceState,
  countWorkdays,
  requestIp
};
