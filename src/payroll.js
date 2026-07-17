function minutesOfDay(date) { return date.getHours() * 60 + date.getMinutes(); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function parseClock(value, fallback) {
  const m = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function calculateDay({ sessions, workingLunchMinutes = 0, adjustments = { normal:0, ot15:0, ot20:0 }, dayType='WEEKDAY' }) {
  const normalStart = parseClock(process.env.NORMAL_START, '07:30');
  const normalEnd = parseClock(process.env.NORMAL_END, '16:30');
  const grace = Number(process.env.GRACE_MINUTES || 10);
  const normalCap = Number(process.env.NORMAL_DAY_MINUTES || 480);
  let actualMinutes = 0, normal = 0, ot15 = 0, ot20 = 0, autoClosed = false;
  for (const session of sessions) {
    if (!session.clock_out_time) continue;
    const start = new Date(session.clock_in_time); const end = new Date(session.clock_out_time);
    const raw = Math.max(0, Math.round((end - start) / 60000));
    actualMinutes += raw;
    if (Number(session.auto_closed_flag) === 1 || session.closed_by_type === 'auto') { autoClosed = true; continue; }
    let s = minutesOfDay(start), e = minutesOfDay(end);
    if (Math.abs(s - normalStart) <= grace) s = normalStart;
    if (Math.abs(e - normalEnd) <= grace) e = normalEnd;
    if (dayType === 'SUNDAY' || dayType === 'PUBLIC_HOLIDAY') ot20 += Math.max(0, e - s);
    else {
      normal += Math.max(0, Math.min(e, normalEnd) - Math.max(s, normalStart));
      ot15 += Math.max(0, normalStart - s) + Math.max(0, e - normalEnd);
    }
  }
  if (autoClosed && sessions.length) { normal = Math.max(normal, normalCap); ot15 = 0; ot20 = 0; }
  normal = clamp(normal, 0, normalCap);
  ot15 += Number(workingLunchMinutes || 0);
  normal += Number(adjustments.normal || 0); ot15 += Number(adjustments.ot15 || 0); ot20 += Number(adjustments.ot20 || 0);
  return { actualMinutes, normalMinutes: Math.max(0, normal), ot15Minutes: Math.max(0, ot15), ot20Minutes: Math.max(0, ot20), workingLunchMinutes: Number(workingLunchMinutes || 0), autoClosed };
}
function decimalHours(minutes) { return Math.round((Number(minutes || 0) / 60) * 100) / 100; }
module.exports = { calculateDay, decimalHours };
