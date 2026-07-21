const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const attendance = require('../services/attendance');

const router = express.Router();

function isManagement(user) {
  return Boolean(user && ['owner', 'admin', 'manager'].includes(user.role));
}

function requireManagement(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  if (!isManagement(req.session.user)) {
    return res.status(403).render('error', { title: 'Access denied', message: 'Attendance administration is only available to management.' });
  }
  next();
}

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function validDate(value) {
  const result = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function validDateTime(value) {
  const result = clean(value, 19).replace('T', ' ');
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(result) ? result : null;
}

function hoursLabel(minutes) {
  const total = Number(minutes || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

router.post('/logout', async (req, res) => {
  try {
    if (req.session.user) {
      await attendance.clockOut({
        staffId: req.session.user.id,
        loginSessionId: req.session.loginSessionId || null,
        req,
        source: 'logout'
      });
      if (req.session.loginSessionId) {
        await db.execute(`UPDATE staff_login_sessions SET logout_at=NOW(),last_activity_at=NOW(),
          session_status='logged_out',logout_reason='manual'
          WHERE id=:id AND staff_id=:staffId AND session_status='active'`, {
          id: req.session.loginSessionId, staffId: req.session.user.id
        });
      }
    }
  } catch (error) {
    console.error('Could not record attendance logout', error);
  }
  req.session.destroy(() => res.redirect(`${res.locals.basePath}/login`));
});

router.use(async (req, res, next) => {
  if (!req.session.user) return next();
  try {
    await attendance.ensureAttendanceSchema();
    let state = await attendance.getAttendanceState(req.session.user.id);
    if (!state) {
      await attendance.clockIn({
        staffId: req.session.user.id,
        loginSessionId: req.session.loginSessionId || null,
        req
      });
      state = await attendance.getAttendanceState(req.session.user.id);
    }
    res.locals.attendanceState = state;
    next();
  } catch (error) {
    console.error('Attendance state unavailable', error);
    res.locals.attendanceState = null;
    next();
  }
});

router.get('/attendance/my', requireAuth, async (req, res, next) => {
  try {
    await attendance.ensureAttendanceSchema();
    const userId = req.session.user.id;
    const active = await attendance.getAttendanceState(userId);
    const [sessions] = await db.execute(`SELECT id,work_date,clock_in_at,clock_out_at,status,clock_in_source,clock_out_source,
      TIMESTAMPDIFF(MINUTE,clock_in_at,COALESCE(clock_out_at,NOW())) worked_minutes
      FROM attendance_sessions WHERE staff_id=:userId ORDER BY clock_in_at DESC LIMIT 31`, { userId });
    const [leave] = await db.execute(`SELECT l.*,t.name leave_type_name
      FROM staff_leave_records l JOIN leave_types t ON t.id=l.leave_type_id
      WHERE l.staff_id=:userId ORDER BY l.start_date DESC LIMIT 20`, { userId });
    const [[leaveSummary]] = await db.execute(`SELECT COALESCE(SUM(l.leave_days),0) used_days
      FROM staff_leave_records l JOIN leave_types t ON t.id=l.leave_type_id
      WHERE l.staff_id=:userId AND l.status='approved' AND t.code='annual'
        AND YEAR(l.start_date)=YEAR(CURRENT_DATE())`, { userId });
    const { settings, schedule } = await attendance.getSettings();
    res.render('attendance-my', {
      title: 'My Attendance', active, sessions, leave, settings, schedule,
      annualUsed: Number(leaveSummary?.used_days || 0),
      annualRemaining: Math.max(0, Number(settings.annual_leave_days || 0) - Number(leaveSummary?.used_days || 0)),
      hoursLabel
    });
  } catch (error) { next(error); }
});

router.get('/backoffice/attendance', requireAuth, requireManagement, async (req, res, next) => {
  try {
    await attendance.ensureAttendanceSchema();
    const { settings, schedule } = await attendance.getSettings();
    const [staff] = await db.query(`SELECT id,full_name,role,email FROM staff_users WHERE is_active=1 ORDER BY full_name`);
    const [todaySessions] = await db.query(`SELECT a.*,s.full_name
      FROM attendance_sessions a JOIN staff_users s ON s.id=a.staff_id
      WHERE a.work_date=CURRENT_DATE() ORDER BY a.clock_in_at`);
    const [todayLeave] = await db.query(`SELECT l.staff_id,t.name leave_type_name,l.start_date,l.end_date
      FROM staff_leave_records l JOIN leave_types t ON t.id=l.leave_type_id
      WHERE l.status='approved' AND CURRENT_DATE() BETWEEN l.start_date AND l.end_date`);
    const [recentSessions] = await db.query(`SELECT a.*,s.full_name,
      TIMESTAMPDIFF(MINUTE,a.clock_in_at,COALESCE(a.clock_out_at,NOW())) worked_minutes
      FROM attendance_sessions a JOIN staff_users s ON s.id=a.staff_id
      WHERE a.work_date>=DATE_SUB(CURRENT_DATE(),INTERVAL 31 DAY)
      ORDER BY a.clock_in_at DESC LIMIT 250`);
    const [leaveTypes] = await db.query(`SELECT * FROM leave_types WHERE is_active=1 ORDER BY sort_order,name`);
    const [leaveRecords] = await db.query(`SELECT l.*,s.full_name,t.name leave_type_name,approver.full_name approved_by_name
      FROM staff_leave_records l
      JOIN staff_users s ON s.id=l.staff_id
      JOIN leave_types t ON t.id=l.leave_type_id
      LEFT JOIN staff_users approver ON approver.id=l.approved_by
      ORDER BY l.start_date DESC,l.id DESC LIMIT 100`);
    const [adjustments] = await db.query(`SELECT x.*,s.full_name,manager.full_name adjusted_by_name
      FROM attendance_adjustments x
      JOIN staff_users s ON s.id=x.staff_id
      JOIN staff_users manager ON manager.id=x.adjusted_by
      ORDER BY x.created_at DESC LIMIT 50`);

    const sessionByStaff = new Map();
    for (const row of todaySessions) {
      const current = sessionByStaff.get(Number(row.staff_id)) || { rows: [], minutes: 0, active: false, firstIn: null, lastOut: null };
      current.rows.push(row);
      current.minutes += Math.max(0, Math.round((new Date(row.clock_out_at || Date.now()) - new Date(row.clock_in_at)) / 60000));
      current.active = current.active || row.status === 'active';
      if (!current.firstIn || new Date(row.clock_in_at) < new Date(current.firstIn)) current.firstIn = row.clock_in_at;
      if (row.clock_out_at && (!current.lastOut || new Date(row.clock_out_at) > new Date(current.lastOut))) current.lastOut = row.clock_out_at;
      sessionByStaff.set(Number(row.staff_id), current);
    }
    const leaveByStaff = new Map(todayLeave.map(row => [Number(row.staff_id), row]));
    const register = staff.map(person => {
      const info = sessionByStaff.get(Number(person.id));
      const leaveToday = leaveByStaff.get(Number(person.id));
      return {
        ...person,
        firstIn: info?.firstIn || null,
        lastOut: info?.lastOut || null,
        minutes: info?.minutes || 0,
        active: Boolean(info?.active),
        leaveToday,
        status: leaveToday ? 'On leave' : info?.active ? 'Clocked in' : info ? 'Clocked out' : 'Not clocked in'
      };
    });

    res.render('attendance-admin', {
      title: 'Attendance Register', settings, schedule, staff, register, recentSessions,
      leaveTypes, leaveRecords, adjustments, hoursLabel,
      saved: req.query.saved || null,
      error: null
    });
  } catch (error) { next(error); }
});

router.post('/backoffice/attendance/settings', requireAuth, requireManagement, async (req, res, next) => {
  try {
    await attendance.ensureAttendanceSchema();
    const annualLeaveDays = Number(req.body.annual_leave_days);
    const graceMinutes = Number(req.body.late_grace_minutes);
    if (!Number.isFinite(annualLeaveDays) || annualLeaveDays < 0 || annualLeaveDays > 100) throw new Error('Enter a valid annual leave allowance.');
    if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 180) throw new Error('Enter a valid late grace period.');

    await db.execute(`UPDATE attendance_settings SET annual_leave_days=:annualLeaveDays,
      late_grace_minutes=:graceMinutes,auto_clock_in_on_login=:autoIn,auto_clock_out_on_logout=:autoOut,
      timezone=:timezone,updated_by=:updatedBy WHERE id=1`, {
      annualLeaveDays,
      graceMinutes,
      autoIn: req.body.auto_clock_in_on_login === '1' ? 1 : 0,
      autoOut: req.body.auto_clock_out_on_logout === '1' ? 1 : 0,
      timezone: clean(req.body.timezone, 80) || 'Africa/Johannesburg',
      updatedBy: req.session.user.id
    });

    for (let isoDay = 1; isoDay <= 7; isoDay += 1) {
      const isWorkday = req.body[`is_workday_${isoDay}`] === '1' ? 1 : 0;
      const startTime = isWorkday ? clean(req.body[`start_time_${isoDay}`], 8) : null;
      const endTime = isWorkday ? clean(req.body[`end_time_${isoDay}`], 8) : null;
      const breakMinutes = Math.max(0, Math.min(300, Number(req.body[`break_minutes_${isoDay}`] || 0)));
      if (isWorkday && (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime))) {
        throw new Error('Every working day needs a start and finish time.');
      }
      await db.execute(`UPDATE attendance_schedule_days SET is_workday=:isWorkday,start_time=:startTime,
        end_time=:endTime,break_minutes=:breakMinutes,updated_by=:updatedBy WHERE iso_day=:isoDay`, {
        isWorkday, startTime, endTime, breakMinutes, updatedBy: req.session.user.id, isoDay
      });
    }
    res.redirect(`${res.locals.basePath}/backoffice/attendance?saved=settings`);
  } catch (error) { next(error); }
});

router.post('/backoffice/attendance/manual-entry', requireAuth, requireManagement, async (req, res, next) => {
  try {
    await attendance.ensureAttendanceSchema();
    const staffId = Number(req.body.staff_id);
    const clockInAt = validDateTime(req.body.clock_in_at);
    const clockOutAt = validDateTime(req.body.clock_out_at);
    const reason = clean(req.body.reason);
    if (!staffId || !clockInAt || !clockOutAt || !reason) throw new Error('Select a staff member, both times and a reason.');
    if (new Date(clockOutAt) <= new Date(clockInAt)) throw new Error('Clock-out must be after clock-in.');
    await db.execute(`INSERT INTO attendance_sessions
      (staff_id,work_date,clock_in_at,clock_out_at,status,clock_in_source,clock_out_source,notes)
      VALUES (:staffId,DATE(:clockInAt),:clockInAt,:clockOutAt,'manual','manual','manual',:notes)`, {
      staffId, clockInAt, clockOutAt, notes: `Manual entry by ${req.session.user.full_name}: ${reason}`
    });
    res.redirect(`${res.locals.basePath}/backoffice/attendance?saved=manual`);
  } catch (error) { next(error); }
});

router.post('/backoffice/attendance/adjust', requireAuth, requireManagement, async (req, res, next) => {
  try {
    await attendance.ensureAttendanceSchema();
    const sessionId = Number(req.body.session_id);
    const adjustedIn = validDateTime(req.body.adjusted_clock_in_at);
    const adjustedOut = validDateTime(req.body.adjusted_clock_out_at);
    const reason = clean(req.body.reason);
    if (!sessionId || !adjustedIn || !adjustedOut || !reason) throw new Error('Select a record, enter both corrected times and provide a reason.');
    if (new Date(adjustedOut) <= new Date(adjustedIn)) throw new Error('Corrected clock-out must be after clock-in.');
    const [[session]] = await db.execute('SELECT * FROM attendance_sessions WHERE id=:id LIMIT 1', { id: sessionId });
    if (!session) throw new Error('Attendance record not found.');
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`INSERT INTO attendance_adjustments
        (attendance_session_id,staff_id,original_clock_in_at,original_clock_out_at,adjusted_clock_in_at,adjusted_clock_out_at,reason,adjusted_by)
        VALUES (:sessionId,:staffId,:originalIn,:originalOut,:adjustedIn,:adjustedOut,:reason,:adjustedBy)`, {
        sessionId, staffId: session.staff_id, originalIn: session.clock_in_at, originalOut: session.clock_out_at,
        adjustedIn, adjustedOut, reason, adjustedBy: req.session.user.id
      });
      await conn.execute(`UPDATE attendance_sessions SET work_date=DATE(:adjustedIn),clock_in_at=:adjustedIn,
        clock_out_at=:adjustedOut,status='adjusted',clock_in_source='adjustment',clock_out_source='adjustment',
        notes=CONCAT_WS(' | ',notes,:note) WHERE id=:sessionId`, {
        adjustedIn, adjustedOut, note: `Adjusted by ${req.session.user.full_name}: ${reason}`, sessionId
      });
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally { conn.release(); }
    res.redirect(`${res.locals.basePath}/backoffice/attendance?saved=adjustment`);
  } catch (error) { next(error); }
});

router.post('/backoffice/attendance/leave', requireAuth, requireManagement, async (req, res, next) => {
  try {
    await attendance.ensureAttendanceSchema();
    const staffId = Number(req.body.staff_id);
    const leaveTypeId = Number(req.body.leave_type_id);
    const startDate = validDate(req.body.start_date);
    const endDate = validDate(req.body.end_date);
    const reason = clean(req.body.reason);
    if (!staffId || !leaveTypeId || !startDate || !endDate) throw new Error('Select staff, leave type and dates.');
    if (new Date(endDate) < new Date(startDate)) throw new Error('Leave end date cannot be before the start date.');
    const manualDays = Number(req.body.leave_days);
    const leaveDays = Number.isFinite(manualDays) && manualDays > 0 ? manualDays : await attendance.countWorkdays(startDate, endDate);
    if (!leaveDays) throw new Error('The selected dates contain no configured working days.');
    await db.execute(`INSERT INTO staff_leave_records
      (staff_id,leave_type_id,start_date,end_date,leave_days,status,reason,approved_by,created_by)
      VALUES (:staffId,:leaveTypeId,:startDate,:endDate,:leaveDays,'approved',:reason,:approvedBy,:createdBy)`, {
      staffId, leaveTypeId, startDate, endDate, leaveDays, reason: reason || null,
      approvedBy: req.session.user.id, createdBy: req.session.user.id
    });
    res.redirect(`${res.locals.basePath}/backoffice/attendance?saved=leave`);
  } catch (error) { next(error); }
});

router.post('/backoffice/attendance/leave/:id/cancel', requireAuth, requireManagement, async (req, res, next) => {
  try {
    await attendance.ensureAttendanceSchema();
    await db.execute(`UPDATE staff_leave_records SET status='cancelled',updated_at=NOW() WHERE id=:id`, { id: Number(req.params.id) });
    res.redirect(`${res.locals.basePath}/backoffice/attendance?saved=leave-cancelled`);
  } catch (error) { next(error); }
});

module.exports = router;
