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
const createControlledImportRouter = require('./controlled-import-routes');
const createIntelligenceRouter = require('./intelligence-routes');
const createCollaborationRouter = require('./collaboration-routes');
const createServiceLifecycleRouter = require('./service-lifecycle-routes');
const createCommunicationsRouter = require('./communications-routes');
const createSecurityRouter = require('./security-routes');
const createCustomerAccessRouter = require('./customer-access-routes');
const { createCustomerAccessGuard } = require('./customer-access-control');
const { permissionsFor } = require('./core/permissions');
const { requestId, securityHeaders, sameOrigin, rateLimit, hashIdentity, recordSecurityEvent } = require('./security-controls');

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
app.set('trust proxy', 1);
app.use(requestId);
app.use(securityHeaders);
app.use(rateLimit({ windowMs: 60_000, max: 240, keyPrefix: 'app' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(sameOrigin);
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
    const [[row]] = await pool.execute(`SELECT session_data FROM app_sessions
      WHERE session_id=:token AND expires_at>NOW() AND revoked_at IS NULL LIMIT 1`, { token });
    if (!row) { clearSessionCookie(res); return next(); }
    const data = JSON.parse(row.session_data || '{}');
    if (!data.os2 || !data.user?.id) { clearSessionCookie(res); return next(); }
    req.user = data.user;
    req.sessionToken = token;
    pool.execute(`UPDATE app_sessions SET last_seen_at=NOW(),updated_at=NOW() WHERE session_id=:token AND (last_seen_at IS NULL OR last_seen_at<NOW()-INTERVAL 5 MINUTE)`, { token })
      .catch(error => console.error('Session touch failed', error.code || error.message));
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
    requestId:req.requestId,
    time: new Date().toISOString()
  });
});
app.get('/login', (req, res) => req.user ? res.redirect('/') : res.sendFile(path.join(publicDir, 'login.html')));
app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, max: 12, keyPrefix: 'login' }), async (req, res) => {
  if (!pool) return res.status(503).json({ ok:false, error:'DATABASE_NOT_CONFIGURED' });
  const identity = String(req.body.identity || '').trim();
  const password = String(req.body.password || '');
  if (!identity || !password) return res.status(400).json({ ok:false, error:'ENTER_USERNAME_AND_PASSWORD' });
  const identityHash = hashIdentity(identity);
  try {
    const [[recent]] = await pool.execute(`SELECT COUNT(*) total FROM os2_login_attempts
      WHERE identity_hash=:identityHash AND was_successful=0 AND attempted_at>NOW()-INTERVAL 15 MINUTE`, { identityHash });
    if (Number(recent.total) >= 8) {
      await recordSecurityEvent(pool, req, { eventType:'login_temporarily_blocked', severity:'high', details:{ identityHash } });
      return res.status(429).json({ ok:false, error:'LOGIN_TEMPORARILY_BLOCKED' });
    }
    const [[user]] = await pool.execute(`SELECT id,full_name,username,email,role,password_hash
      FROM staff_users WHERE is_active=1 AND
      (LOWER(username)=LOWER(:identity) OR LOWER(email)=LOWER(:identity)) LIMIT 1`, { identity });
    const valid = Boolean(user?.password_hash) && await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await pool.execute(`INSERT INTO os2_login_attempts(identity_hash,ip_address,was_successful,failure_reason,attempted_at)
        VALUES(:identityHash,:ip,0,'invalid_credentials',NOW())`, { identityHash, ip:requestIp(req) });
      await recordSecurityEvent(pool, req, { eventType:'login_failed', severity:'warning', details:{ identityHash } });
      return res.status(401).json({ ok:false, error:'INVALID_LOGIN' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = sessionExpiresAt();
    const sessionUser = {
      id: Number(user.id), full_name:user.full_name, username:user.username,
      email:user.email, role:String(user.role || 'staff').toLowerCase()
    };
    await pool.execute(`INSERT INTO app_sessions
      (session_id,session_data,expires_at,created_at,updated_at,last_seen_at,ip_address,user_agent)
      VALUES (:token,:sessionData,:expires,NOW(),NOW(),NOW(),:ip,:userAgent)`, {
      token, sessionData:JSON.stringify({ os2:true, user:sessionUser, createdAt:new Date().toISOString() }), expires,
      ip:requestIp(req), userAgent:String(req.headers['user-agent'] || '').slice(0,255)
    });
    await pool.execute(`INSERT INTO os2_login_attempts(identity_hash,ip_address,was_successful,attempted_at)
      VALUES(:identityHash,:ip,1,NOW())`, { identityHash, ip:requestIp(req) });
    await pool.execute('UPDATE staff_users SET last_login_at=NOW() WHERE id=:id', { id:user.id });
    setSessionCookie(res, token, expires);
    await writeSessionAudit(req, sessionUser, 'os2_login', `Signed in to Talk2Me OS2 as ${sessionUser.role}`);
    await recordSecurityEvent(pool, req, { eventType:'login_succeeded', severity:'info', staffId:user.id });
    return res.json({ ok:true, user:sessionUser, permissions:[...permissionsFor(sessionUser.role)] });
  } catch (error) {
    console.error('Login failed', error.code || error.message);
    return res.status(500).json({ ok:false, error:'LOGIN_FAILED' });
  }
});
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    if (req.sessionToken) await pool.execute(`UPDATE app_sessions SET revoked_at=NOW(),revoked_reason='logout' WHERE session_id=:token`, { token:req.sessionToken });
    await writeSessionAudit(req, req.user, 'os2_logout', 'Signed out of Talk2Me OS2');
    await recordSecurityEvent(pool, req, { eventType:'logout', severity:'info' });
  } finally { clearSessionCookie(res); }
  res.json({ ok:true });
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({
  ok:true, user:req.user, permissions:[...permissionsFor(req.user.role, req.user.permissions)], requestId:req.requestId
}));

app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const managementDashboard = ['owner','manager','admin'].includes(String(req.user.role || '').toLowerCase());
    const staffId = Number(req.user.id);
    if (managementDashboard) {
      const [approvals, overdue, clockedIn, activeStaff, customers, openWork] = await Promise.all([
        count("SELECT COUNT(*) total FROM os2_approval_requests WHERE status IN ('pending','deferred')"),
        count("SELECT COUNT(*) total FROM os2_work_items WHERE lifecycle_state NOT IN ('accepted','archived') AND due_at<NOW()"),
        count("SELECT COUNT(DISTINCT staff_id) total FROM attendance_sessions WHERE work_date=CURRENT_DATE() AND status='active' AND clock_out_at IS NULL"),
        count('SELECT COUNT(*) total FROM staff_users WHERE is_active=1'),
        count('SELECT COUNT(*) total FROM os2_master_customers WHERE archived_at IS NULL AND id IS NOT NULL'),
        count("SELECT COUNT(*) total FROM os2_work_items WHERE lifecycle_state NOT IN ('accepted','archived')")
      ]);
      const [activity] = await pool.execute(`SELECT action_type,entity_type,entity_id,description,created_at
        FROM os2_audit_log WHERE actor_staff_id IS NOT NULL ORDER BY created_at DESC LIMIT 10`);
      return res.json({ ok:true, scope:'management', user:req.user, metrics:{ approvals,overdue,clockedIn,activeStaff,customers,openWork }, activity });
    }

    const [accessibleRows] = await pool.execute(`SELECT DISTINCT master_customer_id FROM (
      SELECT master_customer_id FROM os2_customer_ownership
        WHERE assigned_staff_id=:staffId AND is_current=1
          AND (access_expires_at IS NULL OR access_expires_at>NOW())
      UNION
      SELECT master_customer_id FROM os2_customer_access_grants
        WHERE staff_id=:staffId AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at>NOW())
    ) accessible_customers`, { staffId:req.user.id });
    const customerIds = accessibleRows.map(row => Number(row.master_customer_id)).filter(id => Number.isInteger(id) && id > 0);
    const customerParams = { staffId:req.user.id, customerIds:customerIds.length ? customerIds : [0] };
    const [approvals, overdue, customers, openWork] = await Promise.all([
      count("SELECT COUNT(*) total FROM os2_approval_requests WHERE requested_by=:staffId AND status IN ('pending','deferred')", customerParams),
      count("SELECT COUNT(*) total FROM os2_work_items WHERE assignee_staff_id=:staffId AND lifecycle_state NOT IN ('accepted','archived') AND due_at<NOW()", customerParams),
      count('SELECT COUNT(*) total FROM os2_master_customers WHERE archived_at IS NULL AND id IN (:customerIds)', customerParams),
      count("SELECT COUNT(*) total FROM os2_work_items WHERE assignee_staff_id=:staffId AND lifecycle_state NOT IN ('accepted','archived') AND (master_customer_id IS NULL OR master_customer_id IN (:customerIds))", customerParams)
    ]);
    const [activity] = await pool.execute(`SELECT action_type,entity_type,entity_id,description,created_at
      FROM os2_audit_log WHERE actor_staff_id=:staffId
        AND (master_customer_id IS NULL OR master_customer_id IN (:customerIds))
      ORDER BY created_at DESC LIMIT 10`, customerParams);
    return res.json({
      ok:true,
      scope:'staff',
      user:req.user,
      metrics:{ approvals,overdue,clockedIn:null,activeStaff:null,customers,openWork },
      activity
    });
  } catch (error) {
    console.error('Dashboard failed', error.code || error.message);
    res.status(500).json({ ok:false, error:'DASHBOARD_QUERY_FAILED' });
  }
});

app.use(createCustomerAccessGuard({ pool }));
app.use(createCustomerAccessRouter({ pool, requireAuth }));
app.use(createIntegratedRouter({ pool, requireAuth }));
app.use(createDocumentRouter({ pool, requireAuth }));
app.use(createOperationalRouter({ pool, requireAuth }));
app.use(createServiceLifecycleRouter({ pool, requireAuth }));
app.use(createControlledImportRouter({ pool, requireAuth }));
app.use(createIntelligenceRouter({ pool, requireAuth }));
app.use(createCollaborationRouter({ pool, requireAuth }));
app.use(createCommunicationsRouter({ pool, requireAuth }));
app.use(createSecurityRouter({ pool, requireAuth }));
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
app.use(async (error, req, res, next) => {
  console.error('Unhandled OS2 error', req.requestId, error.code || error.message);
  await recordSecurityEvent(pool, req, { eventType:'unhandled_application_error', severity:'high', details:{ code:error.code || null, message:error.message || null } });
  if (res.headersSent) return next(error);
  res.status(500).json({ ok:false, error:'UNEXPECTED_SYSTEM_ERROR', requestId:req.requestId });
});
app.get('*', (req, res) => req.user ? res.redirect('/') : res.redirect('/login'));

setInterval(() => {
  if (pool) pool.execute(`DELETE FROM app_sessions WHERE expires_at<=NOW() OR revoked_at<NOW()-INTERVAL 30 DAY`)
    .catch(error => console.error('Session cleanup failed', error.code || error.message));
}, 60 * 60 * 1000).unref();

app.listen(port, () => console.log(`Talk2Me OS2 ${require('./package.json').version} running on port ${port}; database ${dbConfigured ? 'configured' : 'not configured'}`));
