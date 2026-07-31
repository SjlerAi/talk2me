const express = require('express');

module.exports = function createAttendanceRouter({ pool, requireAuth, requestIp }) {
  const router = express.Router();

  function canManage(user) {
    return ['owner', 'manager'].includes(user.role);
  }

  async function audit(connection, req, actionType, entityId, description, beforeJson, afterJson) {
    await connection.execute(`INSERT INTO audit_log
      (staff_id, action_type, entity_type, entity_id, description, before_json, after_json, ip_address, user_agent, created_at)
      VALUES (:staffId, :actionType, 'attendance_sessions', :entityId, :description, :beforeJson, :afterJson, :ip, :userAgent, NOW())`, {
      staffId: req.user.id,
      actionType,
      entityId,
      description,
      beforeJson: beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson: afterJson ? JSON.stringify(afterJson) : null,
      ip: requestIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
  }

  router.get('/api/attendance', requireAuth, async (req, res) => {
    try {
      const [[summary]] = await pool.execute(`SELECT
          MIN(clock_in_at) first_clock_in_at,
          SUM(TIMESTAMPDIFF(MINUTE, clock_in_at, COALESCE(clock_out_at, NOW()))) minutes_today,
          COUNT(*) session_count,
          SUM(CASE WHEN status='active' AND clock_out_at IS NULL THEN 1 ELSE 0 END) active_sessions
        FROM attendance_sessions
        WHERE staff_id=:staffId AND work_date=CURRENT_DATE()`, { staffId: req.user.id });

      const [[activeSession]] = await pool.execute(`SELECT id, staff_id, work_date, clock_in_at, clock_out_at, status
        FROM attendance_sessions
        WHERE staff_id=:staffId AND work_date=CURRENT_DATE() AND status='active' AND clock_out_at IS NULL
        ORDER BY id DESC LIMIT 1`, { staffId: req.user.id });

      const [mySessions] = await pool.execute(`SELECT id, staff_id, work_date, clock_in_at, clock_out_at, status,
          TIMESTAMPDIFF(MINUTE, clock_in_at, COALESCE(clock_out_at, NOW())) session_minutes
        FROM attendance_sessions
        WHERE staff_id=:staffId AND work_date=CURRENT_DATE()
        ORDER BY clock_in_at ASC, id ASC`, { staffId: req.user.id });

      let team = [];
      if (canManage(req.user)) {
        const [rows] = await pool.execute(`SELECT a.id, a.staff_id, s.full_name, s.role, a.work_date,
            a.clock_in_at, a.clock_out_at, a.status,
            TIMESTAMPDIFF(MINUTE, a.clock_in_at, COALESCE(a.clock_out_at, NOW())) session_minutes,
            totals.minutes_today,
            CASE WHEN TIME(a.clock_in_at) > '08:15:00' AND a.id=totals.first_session_id THEN 1 ELSE 0 END late
          FROM attendance_sessions a
          JOIN staff_users s ON s.id=a.staff_id
          JOIN (
            SELECT staff_id,
              MIN(id) first_session_id,
              SUM(TIMESTAMPDIFF(MINUTE, clock_in_at, COALESCE(clock_out_at, NOW()))) minutes_today
            FROM attendance_sessions
            WHERE work_date=CURRENT_DATE()
            GROUP BY staff_id
          ) totals ON totals.staff_id=a.staff_id
          WHERE a.work_date=CURRENT_DATE()
          ORDER BY s.full_name ASC, a.clock_in_at ASC, a.id ASC`);
        team = rows;
      }

      res.json({
        ok: true,
        canManage: canManage(req.user),
        mine: Number(summary?.session_count || 0) ? {
          first_clock_in_at: summary.first_clock_in_at,
          minutes_today: Number(summary.minutes_today || 0),
          session_count: Number(summary.session_count || 0),
          activeSession: activeSession || null,
          sessions: mySessions
        } : null,
        team,
        clockedIn: Boolean(activeSession)
      });
    } catch (error) {
      console.error('Attendance query failed', error);
      res.status(500).json({ ok: false, error: error.code || 'ATTENDANCE_QUERY_FAILED' });
    }
  });

  router.post('/api/attendance/clock-in', requireAuth, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[active]] = await connection.execute(`SELECT id FROM attendance_sessions
        WHERE staff_id=:staffId AND work_date=CURRENT_DATE() AND status='active' AND clock_out_at IS NULL
        ORDER BY id DESC LIMIT 1 FOR UPDATE`, { staffId: req.user.id });
      if (active) {
        await connection.rollback();
        return res.status(409).json({ ok: false, error: 'ALREADY_CLOCKED_IN' });
      }

      const [result] = await connection.execute(`INSERT INTO attendance_sessions
        (staff_id, work_date, clock_in_at, clock_out_at, status, created_at, updated_at)
        VALUES (:staffId, CURRENT_DATE(), NOW(), NULL, 'active', NOW(), NOW())`, { staffId: req.user.id });
      const [[countRow]] = await connection.execute(`SELECT COUNT(*) total FROM attendance_sessions WHERE staff_id=:staffId AND work_date=CURRENT_DATE()`, { staffId: req.user.id });
      await audit(connection, req, 'attendance_clock_in', result.insertId, `${req.user.full_name} clocked in`, null, {
        status: 'active',
        session_number: Number(countRow.total || 1)
      });
      await connection.commit();
      res.status(201).json({ ok: true, attendanceId: Number(result.insertId), sessionNumber: Number(countRow.total || 1) });
    } catch (error) {
      await connection.rollback();
      console.error('Clock in failed', error);
      res.status(500).json({ ok: false, error: error.code || 'CLOCK_IN_FAILED' });
    } finally {
      connection.release();
    }
  });

  router.post('/api/attendance/clock-out', requireAuth, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[session]] = await connection.execute(`SELECT id, clock_in_at, clock_out_at, status FROM attendance_sessions
        WHERE staff_id=:staffId AND work_date=CURRENT_DATE() AND status='active' AND clock_out_at IS NULL
        ORDER BY id DESC LIMIT 1 FOR UPDATE`, { staffId: req.user.id });
      if (!session) {
        await connection.rollback();
        return res.status(409).json({ ok: false, error: 'NOT_CLOCKED_IN' });
      }
      await connection.execute(`UPDATE attendance_sessions SET clock_out_at=NOW(), status='completed', updated_at=NOW() WHERE id=:id`, { id: session.id });
      await audit(connection, req, 'attendance_clock_out', session.id, `${req.user.full_name} clocked out`, {
        status: session.status,
        clock_out_at: session.clock_out_at
      }, { status: 'completed' });
      await connection.commit();
      res.json({ ok: true, attendanceId: Number(session.id) });
    } catch (error) {
      await connection.rollback();
      console.error('Clock out failed', error);
      res.status(500).json({ ok: false, error: error.code || 'CLOCK_OUT_FAILED' });
    } finally {
      connection.release();
    }
  });

  router.post('/api/attendance/:id/correct', requireAuth, async (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ ok: false, error: 'INSUFFICIENT_PERMISSION' });
    const id = Number(req.params.id);
    const clockIn = String(req.body.clockIn || '').trim();
    const clockOut = String(req.body.clockOut || '').trim();
    const note = String(req.body.note || '').trim().slice(0, 1000);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ ok: false, error: 'INVALID_ATTENDANCE_ID' });
    if (!clockIn) return res.status(400).json({ ok: false, error: 'CLOCK_IN_REQUIRED' });
    if (!note) return res.status(400).json({ ok: false, error: 'CORRECTION_REASON_REQUIRED' });
    const inDate = new Date(clockIn);
    const outDate = clockOut ? new Date(clockOut) : null;
    if (Number.isNaN(inDate.getTime()) || (outDate && Number.isNaN(outDate.getTime()))) return res.status(400).json({ ok: false, error: 'INVALID_ATTENDANCE_TIME' });
    if (outDate && outDate <= inDate) return res.status(400).json({ ok: false, error: 'CLOCK_OUT_MUST_BE_AFTER_CLOCK_IN' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[before]] = await connection.execute('SELECT * FROM attendance_sessions WHERE id=:id FOR UPDATE', { id });
      if (!before) {
        await connection.rollback();
        return res.status(404).json({ ok: false, error: 'ATTENDANCE_NOT_FOUND' });
      }
      if (!outDate) {
        const [[otherActive]] = await connection.execute(`SELECT id FROM attendance_sessions
          WHERE staff_id=:staffId AND work_date=DATE(:clockIn) AND status='active' AND clock_out_at IS NULL AND id<>:id
          LIMIT 1 FOR UPDATE`, { staffId: before.staff_id, clockIn: inDate, id });
        if (otherActive) {
          await connection.rollback();
          return res.status(409).json({ ok: false, error: 'STAFF_ALREADY_HAS_ACTIVE_SESSION' });
        }
      }
      const status = outDate ? 'completed' : 'active';
      await connection.execute(`UPDATE attendance_sessions SET work_date=DATE(:clockIn), clock_in_at=:clockIn, clock_out_at=:clockOut, status=:status, updated_at=NOW() WHERE id=:id`, {
        id,
        clockIn: inDate,
        clockOut: outDate,
        status
      });
      await audit(connection, req, 'attendance_corrected', id, `Attendance corrected: ${note}`, {
        clock_in_at: before.clock_in_at,
        clock_out_at: before.clock_out_at,
        status: before.status
      }, { clock_in_at: inDate, clock_out_at: outDate, status, note });
      await connection.commit();
      res.json({ ok: true, attendanceId: id });
    } catch (error) {
      await connection.rollback();
      console.error('Attendance correction failed', error);
      res.status(500).json({ ok: false, error: error.code || error.message || 'ATTENDANCE_CORRECTION_FAILED' });
    } finally {
      connection.release();
    }
  });

  return router;
};
