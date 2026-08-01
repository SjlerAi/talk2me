'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const createMyWorkRouter = require('./my-work-routes');
const createAssignmentRouter = require('./assignment-routes');
const createApprovalRouter = require('./approval-routes');
const createNotificationRouter = require('./notification-routes');
const createAttendanceRouter = require('./attendance-routes');
const createOpportunityRouter = require('./opportunity-routes');
const createReportRouter = require('./report-routes');
const createImportRouter = require('./import-routes');
const createAdministrationRouter = require('./administration-routes');
const createIntegratedRouter = require('./integrated-routes');
const createDocumentRouter = require('./document-routes');
const createOperationalRouter = require('./operational-routes');
const { permissionsFor } = require('./core/permissions');

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, '..', 'public', 'os2');
const sessionHours = 8;
const sessionCookie = 'os2_session';
const dbConfigured = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const pool = dbConfigured ? mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  namedPlaceholders: true,
  charset: 'utf8mb4'
}) : null;

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(publicDir, { index: false, etag: true, maxAge: process.env.NODE_ENV === 'production' ? '5m' : 0 }));

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index < 0) return cookies;
    const key = item.slice(0, index).trim();
    if (key) cookies[key] = decodeURIComponent(item.slice(index + 1).trim());
    return cookies;
  }, {});
}
function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64);
}
function sessionExpiresAt() { return new Date(Date.now() + sessionHours * 60 * 60 * 1000); }
function setSessionCookie(res, token, expires) {
  const parts = [`${sessionCookie}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${expires.toUTCString()}`, `Max-Age=${sessionHours * 3600}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  const parts = [`${sessionCookie}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
async function writeSessionAudit(req, user, actionType, description) {
  if (!pool || !user) return;
  try {
    await pool.execute(`INSERT INTO audit_log
      (staff_id,action_type,entity_type,entity_id,description,ip_address,user_agent,created_at)
      VALUES (:staffId,:actionType,'session',:entityId,:description,:ip,:userAgent,NOW())`, {
      staffId: Number(user.id), actionType, entityId: Number(user.id), description,
      ip: requestIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
  } catch (error) { console.error('Session audit failed', error.code || error.message); }
}
async function loadSession(req, res, next) {
  req.user = null;
  req.sessionToken = null;
  if (!pool) return next();
  const token = parseCookies(req)[sessionCookie];
  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) return next();
  try {
    const [[row]] = await pool.execute('SELECT session_data FROM app_sessions WHERE session_id=:token AND expires_at>NOW() LIMIT 1', { token });
    if (!row) { clearSessionCookie(res); return next(); }
    const data = JSON.parse(row.session_data || '{}');
    if (!data.os2 || !data.user?.id) { clearSessionCookie(res); return next(); }
    req.user = data.user;
    req.sessionToken = token;
  } catch (error) { console.error('Session load failed', error.code || error.message); }
  return next();
}
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok:false, error:'AUTHENTICATION_REQUIRED' });
  return res.redirect('/login');
}
function requireRole(...roles) {
  return (req, res, next) => req.user && roles.includes(String(req.user.role).toLowerCase())
    ? next()
    : res.status(req.user ? 403 : 401).json({ ok:false, error:req.user ? 'INSUFFICIENT_PERMISSION' : 'AUTHENTICATION_REQUIRED' });
}
async function count(sql, params = {}) {
  const [[row]] = await pool.execute(sql, params);
  return Number(row.total || 0);
}

app.use(loadSession);
app.get('/health', async (req, res) => {
  const database = { configured: dbConfigured, connected: false };
  if (pool) {
    try { await pool.query('SELECT 1'); database.connected = true; database.name = process.env.DB_NAME; }
    catch (error) { database.error = error.code || 'DB_CONNECTION_FAILED'; }
  }
  res.status(database.configured && !database.connected ? 503 : 200).json({
    ok: !database.configured || database.connected,
    application: 'Talk2Me OS2 integrated rebuild',
    version: require('./package.json').version,
    environment: process.env.NODE_ENV || 'development',
    authentication: { enabled:true, signedIn:Boolean(req.user) },
    database,
    time: new Date().toISOString()
  });
});
app.get('/login', (req, res) => req.user ? res.redirect('/') : res.sendFile(path.join(publicDir, 'login.html')));
app.post('/api/auth/login', async (req, res) => {
  if (!pool) return res.status(503).json({ ok:false, error:'DATABASE_NOT_CONFIGURED' });
  const identity = String(req.body.identity || '').trim();
  const password = String(req.body.password || '');
  if (!identity || !password) return res.status(400).json({ ok:false, error:'ENTER_USERNAME_AND_PASSWORD' });
  try {
    const [[user]] = await pool.execute(`SELECT id,full_name,username,email,role,password_hash
      FROM staff_users WHERE is_active=1 AND
      (LOWER(username)=LOWER(:identity) OR LOWER(email)=LOWER(:identity)) LIMIT 1`, { identity });
    const valid = Boolean(user?.password_hash) && await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ ok:false, error:'INVALID_LOGIN' });
    const token = crypto.randomBytes(32).toString('hex');
    const expires = sessionExpiresAt();
    const sessionUser = {
      id: Number(user.id), full_name:user.full_name, username:user.username,
      email:user.email, role:String(user.role || 'staff').toLowerCase()
    };
    await pool.execute(`INSERT INTO app_sessions
      (session_id,session_data,expires_at,created_at,updated_at)
      VALUES (:token,:sessionData,:expires,NOW(),NOW())`, {
      token, sessionData:JSON.stringify({ os2:true, user:sessionUser, createdAt:new Date().toISOString() }), expires
    });
    await pool.execute('UPDATE staff_users SET last_login_at=NOW() WHERE id=:id', { id:user.id });
    setSessionCookie(res, token, expires);
    await writeSessionAudit(req, sessionUser, 'os2_login', `Signed in to Talk2Me OS2 as ${sessionUser.role}`);
    return res.json({ ok:true, user:sessionUser, permissions:[...permissionsFor(sessionUser.role)] });
  } catch (error) {
    console.error('Login failed', error.code || error.message);
    return res.status(500).json({ ok:false, error:'LOGIN_FAILED' });
  }
});
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    if (req.sessionToken) await pool.execute('DELETE FROM app_sessions WHERE session_id=:token', { token:req.sessionToken });
    await writeSessionAudit(req, req.user, 'os2_logout', 'Signed out of Talk2Me OS2');
  } finally { clearSessionCookie(res); }
  res.json({ ok:true });
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({
  ok:true, user:req.user, permissions:[...permissionsFor(req.user.role, req.user.permissions)]
}));

app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const [approvals, overdue, clockedIn, activeStaff, customers, openWork] = await Promise.all([
      count("SELECT COUNT(*) total FROM os2_approval_requests WHERE status IN ('pending','deferred')"),
      count("SELECT COUNT(*) total FROM os2_work_items WHERE lifecycle_state NOT IN ('accepted','archived') AND due_at<NOW()"),
      count("SELECT COUNT(DISTINCT staff_id) total FROM attendance_sessions WHERE work_date=CURRENT_DATE() AND status='active' AND clock_out_at IS NULL"),
      count('SELECT COUNT(*) total FROM staff_users WHERE is_active=1'),
      count('SELECT COUNT(*) total FROM os2_master_customers WHERE archived_at IS NULL'),
      count("SELECT COUNT(*) total FROM os2_work_items WHERE lifecycle_state NOT IN ('accepted','archived')")
    ]);
    const [activity] = await pool.execute(`SELECT action_type,entity_type,entity_id,description,created_at
      FROM os2_audit_log ORDER BY created_at DESC LIMIT 10`);
    res.json({ ok:true, user:req.user, metrics:{ approvals,overdue,clockedIn,activeStaff,customers,openWork }, activity });
  } catch (error) {
    console.error('Dashboard failed', error.code || error.message);
    res.status(500).json({ ok:false, error:'DASHBOARD_QUERY_FAILED' });
  }
});

app.use(createIntegratedRouter({ pool, requireAuth }));
app.use(createDocumentRouter({ pool, requireAuth }));
app.use(createOperationalRouter({ pool, requireAuth }));
app.use(createMyWorkRouter({ pool, requireAuth, requestIp }));
app.use(createAssignmentRouter({ pool, requireAuth, requestIp }));
app.use(createApprovalRouter({ pool, requireAuth, requestIp }));
app.use(createNotificationRouter({ pool, requireAuth, requestIp }));
app.use(createAttendanceRouter({ pool, requireAuth, requestIp }));
app.use(createOpportunityRouter({ pool, requireAuth, requestIp }));
app.use(createReportRouter({ pool, requireAuth, requestIp }));
app.use(createImportRouter({ pool, requireAuth, requestIp }));
app.use(createAdministrationRouter({ pool, requireAuth, requestIp }));

app.get('/api/admin/session-check', requireRole('owner','manager'), (req, res) => res.json({ ok:true, role:req.user.role }));
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use((error, req, res, next) => {
  console.error('Unhandled OS2 error', error.code || error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ ok:false, error:'UNEXPECTED_SYSTEM_ERROR' });
});
app.get('*', (req, res) => req.user ? res.redirect('/') : res.redirect('/login'));

setInterval(() => {
  if (pool) pool.execute('DELETE FROM app_sessions WHERE expires_at<=NOW()')
    .catch(error => console.error('Session cleanup failed', error.code || error.message));
}, 60 * 60 * 1000).unref();

app.listen(port, () => console.log(`Talk2Me OS2 ${require('./package.json').version} running on port ${port}; database ${dbConfigured ? 'configured' : 'not configured'}`));
