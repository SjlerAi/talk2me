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
      const [[mine]] = await pool.execute(`SELECT id, staff_id, work_date, clock_in_at, clock_out_at, status,
          TIMESTAMPDIFF(MINUTE, clock_in_at, COALESCE(clock_out_at, NOW())) minutes_today
        FROM attendance_sessions
        WHERE staff_id=:staffId AND work_date=CURRENT_DATE()
        ORDER BY id DESC LIMIT 1`, { staffId: req.user.id });

      let team = [];
      if (canManage(req.user)) {
        const [rows] = await pool.execute(`SELECT a.id, a.staff_id, s.full_name, s.role, a.work_date,
            a.clock_in_at, a.clock_out_at, a.status,
            TIMESTAMPDIFF(MINUTE, a.clock_in_at, COALESCE(a.clock_out_at, NOW())) minutes_today,
            CASE WHEN TIME(a.clock_in_at) > '08:15:00' THEN 1 ELSE 0 END late
          FROM attendance_sessions a
          JOIN staff_users s ON s.id=a.staff_id
          WHERE a.work_date=CURRENT_DATE()
          ORDER BY a.clock_in_at ASC, s.full_name ASC`);
        team = rows;
      }

      res.json({
        ok: true,
        canManage: canManage(req.user),
        mine: mine || null,
        team,
        clockedIn: Boolean(mine && mine.status === 'active' && !mine.clock_out_at)
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
      const [[existing]] = await connection.execute(`SELECT id, status, clock_out_at FROM attendance_sessions
        WHERE staff_id=:staffId AND work_date=CURRENT_DATE() ORDER BY id DESC LIMIT 1 FOR UPDATE`, { staffId: req.user.id });
      if (existing && existing.status === 'active' && !existing.clock_out_at) {
        await connection.rollback();
        return res.status(409).json({ ok: false, error: 'ALREADY_CLOCKED_IN' });
      }
      if (existing) {
        await connection.rollback();
        return res.status(409).json({ ok: false, error: 'ATTENDANCE_ALREADY_COMPLETED_TODAY' });
      }

      const [result] = await connection.execute(`INSERT INTO attendance_sessions
        (staff_id, work_date, clock_in_at, clock_out_at, status, created_at, updated_at)
        VALUES (:staffId, CURRENT_DATE(), NOW(), NULL, 'active', NOW(), NOW())`, { staffId: req.user.id });
      await audit(connection, req, 'attendance_clock_in', result.insertId, `${req.user.full_name} clocked in`, null, { status: 'active' });
      await connection.commit();
      res.status(201).json({ ok: true, attendanceId: Number(result.insertId) });
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
        WHERE staff_id=:staffId AND work_date=CURRENT_DATE() ORDER BY id DESC LIMIT 1 FOR UPDATE`, { staffId: req.user.id });
      if (!session || session.status !== 'active' || session.clock_out_at) {
        await connection.rollback();
        return res.status(409).json({ ok: false, error: 'NOT_CLOCKED_IN' });
      }
      await connection.execute(`UPDATE attendance_sessions SET clock_out_at=NOW(), status='completed', updated_at=NOW() WHERE id=:id`, { id: session.id });
      await audit(connection, req, 'attendance_clock_out', session.id, `${req.user.full_name} clocked out`, { status: session.status, clock_out_at: session.clock_out_at }, { status: 'completed' });
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
      const status = outDate ? 'completed' : 'active';
      await connection.execute(`UPDATE attendance_sessions SET clock_in_at=:clockIn, clock_out_at=:clockOut, status=:status, updated_at=NOW() WHERE id=:id`, {
        id,
        clockIn: inDate,
        clockOut: outDate,
        status
      });
      await audit(connection, req, 'attendance_corrected', id, `Attendance corrected${note ? `: ${note}` : ''}`, {
        clock_in_at: before.clock_in_at,
        clock_out_at: before.clock_out_at,
        status: before.status
      }, { clock_in_at: inDate, clock_out_at: outDate, status, note });
      await connection.commit();
      res.json({ ok: true, attendanceId: id });
    } catch (error) {
      await connection.rollback();
      console.error('Attendance correction failed', error);
      res.status(500).json({ ok: false, error: error.code || 'ATTENDANCE_CORRECTION_FAILED' });
    } finally {
      connection.release();
    }
  });

  return router;
};
