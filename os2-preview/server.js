const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const app = express();
const port = process.env.PORT || 3000;
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
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(publicDir, { index: false, etag: true, maxAge: process.env.NODE_ENV === 'production' ? '5m' : 0 }));

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index < 0) return cookies;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64);
}

function sessionExpiresAt() {
  return new Date(Date.now() + sessionHours * 60 * 60 * 1000);
}

function setSessionCookie(res, token, expires) {
  const parts = [`${sessionCookie}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${expires.toUTCString()}`, `Max-Age=${sessionHours * 60 * 60}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${sessionCookie}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function writeAudit(req, user, actionType, description) {
  if (!pool || !user) return;
  try {
    await pool.execute(`INSERT INTO audit_log
      (staff_id, action_type, entity_type, entity_id, description, ip_address, user_agent, created_at)
      VALUES (:staffId, :actionType, 'session', :entityId, :description, :ip, :userAgent, NOW())`, {
      staffId: user.id,
      actionType,
      entityId: user.id,
      description,
      ip: requestIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
  } catch (error) {
    console.error('OS2 audit write failed', error.code || error.message);
  }
}

async function loadSession(req, res, next) {
  req.user = null;
  req.sessionToken = null;
  if (!pool) return next();
  const token = parseCookies(req)[sessionCookie];
  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) return next();
  try {
    const [[row]] = await pool.execute('SELECT session_data FROM app_sessions WHERE session_id=:token AND expires_at>NOW() LIMIT 1', { token });
    if (!row) {
      clearSessionCookie(res);
      return next();
    }
    const data = JSON.parse(row.session_data || '{}');
    if (!data.os2 || !data.user?.id) {
      clearSessionCookie(res);
      return next();
    }
    req.user = data.user;
    req.sessionToken = token;
  } catch (error) {
    console.error('OS2 session load failed', error.code || error.message);
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'AUTHENTICATION_REQUIRED' });
  return res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'AUTHENTICATION_REQUIRED' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, error: 'INSUFFICIENT_PERMISSION' });
    next();
  };
}

async function count(sql, params = {}) {
  const [[row]] = await pool.execute(sql, params);
  return Number(row.total || 0);
}

app.use(loadSession);

app.get('/health', async (req, res) => {
  let database = { configured: dbConfigured, connected: false };
  if (pool) {
    try { await pool.query('SELECT 1'); database.connected = true; database.name = process.env.DB_NAME; }
    catch (error) { database.error = error.code || 'DB_CONNECTION_FAILED'; }
  }
  res.status(database.configured && !database.connected ? 503 : 200).json({
    ok: !database.configured || database.connected,
    application: 'Talk2Me OS2',
    environment: process.env.NODE_ENV || 'development',
    authentication: { enabled: true, signedIn: Boolean(req.user) },
    database,
    time: new Date().toISOString()
  });
});

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.post('/api/auth/login', async (req, res) => {
  if (!pool) return res.status(503).json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });
  const identity = String(req.body.identity || '').trim();
  const password = String(req.body.password || '');
  if (!identity || !password) return res.status(400).json({ ok: false, error: 'ENTER_USERNAME_AND_PASSWORD' });
  try {
    const [[user]] = await pool.execute(`SELECT id, full_name, username, email, role, password_hash FROM staff_users
      WHERE is_active=1 AND (LOWER(username)=LOWER(:identity) OR LOWER(email)=LOWER(:identity)) LIMIT 1`, { identity });
    const valid = Boolean(user?.password_hash) && await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: 'INVALID_LOGIN' });
    const token = crypto.randomBytes(32).toString('hex');
    const expires = sessionExpiresAt();
    const sessionUser = { id: Number(user.id), full_name: user.full_name, username: user.username, email: user.email, role: user.role };
    const sessionData = JSON.stringify({ os2: true, user: sessionUser, createdAt: new Date().toISOString() });
    await pool.execute(`INSERT INTO app_sessions (session_id, session_data, expires_at, created_at, updated_at)
      VALUES (:token, :sessionData, :expires, NOW(), NOW())`, { token, sessionData, expires });
    await pool.execute('UPDATE staff_users SET last_login_at=NOW() WHERE id=:id', { id: user.id });
    setSessionCookie(res, token, expires);
    await writeAudit(req, sessionUser, 'os2_login', `Signed in to Talk2Me OS2 as ${sessionUser.role}`);
    res.json({ ok: true, user: sessionUser });
  } catch (error) {
    console.error('OS2 login failed', error);
    res.status(500).json({ ok: false, error: error.code || 'LOGIN_FAILED' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    if (req.sessionToken) await pool.execute('DELETE FROM app_sessions WHERE session_id=:token', { token: req.sessionToken });
    await writeAudit(req, req.user, 'os2_logout', 'Signed out of Talk2Me OS2');
  } finally {
    clearSessionCookie(res);
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user, permissions: {
    canManage: ['owner', 'manager'].includes(req.user.role),
    canDelete: req.user.role === 'owner',
    canWrite: true
  } });
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const [approvals, overdue, unassigned, clockedIn, activeStaff, upgrades, birthdays, callbacks, prospects] = await Promise.all([
      count("SELECT COUNT(*) total FROM data_change_requests WHERE status IN ('pending_manager','pending_owner')"),
      count("SELECT COUNT(*) total FROM staff_tasks WHERE status IN ('unread','seen','in_progress') AND due_at IS NOT NULL AND due_at < NOW()"),
      count(`SELECT COUNT(DISTINCT COALESCE(NULLIF(c.account_number,''), CONCAT('client:',c.id))) total FROM clients c LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number)) WHERE c.is_active=1 AND a.id IS NULL`),
      count("SELECT COUNT(DISTINCT staff_id) total FROM attendance_sessions WHERE work_date=CURRENT_DATE() AND status='active' AND clock_out_at IS NULL"),
      count("SELECT COUNT(*) total FROM staff_users WHERE is_active=1"),
      count("SELECT COUNT(DISTINCT id) total FROM clients WHERE is_active=1 AND next_upgrade_date IS NOT NULL AND DATE(next_upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)"),
      count("SELECT COUNT(DISTINCT id) total FROM clients WHERE is_active=1 AND birthday IS NOT NULL AND MONTH(birthday)=MONTH(CURRENT_DATE()) AND DAY(birthday)=DAY(CURRENT_DATE())"),
      count("SELECT COUNT(*) total FROM inquiries WHERE status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND follow_up_at IS NOT NULL AND DATE(follow_up_at)=CURRENT_DATE()"),
      count("SELECT COUNT(*) total FROM clients WHERE is_active=1 AND lifecycle_status='prospect' AND COALESCE(lead_status,'new') IN ('new','contacted','qualified')")
    ]);
    const [activity] = await pool.execute(`SELECT COALESCE(s.full_name,'Unassigned') staff_member,
      COALESCE(i.action_taken,i.query_text,'Inquiry updated') latest_action,
      COALESCE(i.client_name,'Unknown customer') customer, i.status,
      DATE_FORMAT(i.updated_at,'%H:%i') activity_time
      FROM inquiries i LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id)
      ORDER BY i.updated_at DESC LIMIT 5`);
    res.json({ ok: true, user: req.user, metrics: { approvals, overdue, unassigned, clockedIn, activeStaff, upgrades, birthdays, callbacks, prospects }, activity });
  } catch (error) {
    console.error('Dashboard query failed', error);
    res.status(500).json({ ok: false, error: error.code || 'DASHBOARD_QUERY_FAILED' });
  }
});

app.get('/api/customers/search', requireAuth, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.json({ ok: true, customers: [] });
  try {
    const like = `%${query}%`;
    const [rows] = await pool.execute(`SELECT id, client_name, account_number, cell_number, email, city_town FROM clients
      WHERE is_active=1 AND (client_name LIKE :like OR account_number LIKE :like OR cell_number LIKE :like OR
      cell_number_normalised LIKE :like OR alt_number LIKE :like OR email LIKE :like OR city_town LIKE :like OR
      id_number LIKE :like OR package_name LIKE :like OR handset LIKE :like OR main_contact_name LIKE :like OR
      main_contact_number LIKE :like) ORDER BY client_name ASC, account_number ASC LIMIT 10`, { like });
    res.json({ ok: true, customers: rows });
  } catch (error) {
    console.error('Customer search failed', error);
    res.status(500).json({ ok: false, error: error.code || 'CUSTOMER_SEARCH_FAILED' });
  }
});

app.get('/api/inquiry-options', requireAuth, async (req, res) => {
  try {
    const [categories] = await pool.execute('SELECT id, category_name FROM inquiry_categories WHERE is_active=1 ORDER BY sort_order, category_name');
    res.json({ ok: true, categories, statuses: ['open','resolved','follow_up','waiting_customer','waiting_network','waiting_supplier'], contactTypes: ['walk_in','phone_call','whatsapp','email','other'] });
  } catch (error) {
    console.error('Inquiry options failed', error);
    res.status(500).json({ ok: false, error: error.code || 'INQUIRY_OPTIONS_FAILED' });
  }
});

app.post('/api/inquiries', requireAuth, async (req, res) => {
  const clientId = Number(req.body.clientId);
  const categoryId = Number(req.body.categoryId);
  const status = String(req.body.status || 'resolved');
  const contactType = String(req.body.contactType || 'walk_in');
  const priority = String(req.body.priority || 'normal');
  const queryText = String(req.body.queryText || '').trim().slice(0, 5000);
  const resultFound = String(req.body.resultFound || '').trim().slice(0, 5000);
  const actionTaken = String(req.body.actionTaken || '').trim().slice(0, 5000);
  const categoryOther = String(req.body.categoryOther || '').trim().slice(0, 120) || null;
  const followUpRaw = String(req.body.followUpAt || '').trim();
  const validStatuses = new Set(['open','resolved','follow_up','waiting_customer','waiting_network','waiting_supplier']);
  const validContactTypes = new Set(['walk_in','phone_call','whatsapp','email','other']);
  if (!Number.isInteger(clientId) || clientId < 1) return res.status(400).json({ ok: false, error: 'SELECT_A_CUSTOMER' });
  if (!Number.isInteger(categoryId) || categoryId < 1) return res.status(400).json({ ok: false, error: 'SELECT_A_CATEGORY' });
  if (!validStatuses.has(status)) return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
  if (!validContactTypes.has(contactType)) return res.status(400).json({ ok: false, error: 'INVALID_CONTACT_TYPE' });
  if (!queryText && !resultFound && !actionTaken) return res.status(400).json({ ok: false, error: 'ENTER_INQUIRY_DETAILS' });
  if (status === 'follow_up' && !followUpRaw) return res.status(400).json({ ok: false, error: 'FOLLOW_UP_DATE_REQUIRED' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[customer]] = await connection.execute('SELECT id, client_name, cell_number, email FROM clients WHERE id=:clientId AND is_active=1 LIMIT 1', { clientId });
    if (!customer) {
      await connection.rollback();
      return res.status(404).json({ ok: false, error: 'CUSTOMER_NOT_FOUND' });
    }
    const [[category]] = await connection.execute('SELECT id, category_name FROM inquiry_categories WHERE id=:categoryId AND is_active=1 LIMIT 1', { categoryId });
    if (!category) {
      await connection.rollback();
      return res.status(400).json({ ok: false, error: 'INVALID_CATEGORY' });
    }
    const followUpAt = followUpRaw ? new Date(followUpRaw) : null;
    if (followUpRaw && Number.isNaN(followUpAt.getTime())) {
      await connection.rollback();
      return res.status(400).json({ ok: false, error: 'INVALID_FOLLOW_UP_DATE' });
    }
    const completedAt = status === 'resolved' ? new Date() : null;
    const completedBy = status === 'resolved' ? req.user.id : null;
    const [result] = await connection.execute(`INSERT INTO inquiries
      (client_id, service_type, staff_id, assigned_staff_id, walkin_or_call, client_name, cell_number, email,
       category_id, category_other, query_text, result_found, action_taken, status, follow_up_at,
       completed_at, completed_by, owner_visible, priority, created_at, updated_at)
      VALUES (:clientId, 'mobile', :staffId, :staffId, :contactType, :clientName, :cellNumber, :email,
       :categoryId, :categoryOther, :queryText, :resultFound, :actionTaken, :status, :followUpAt,
       :completedAt, :completedBy, 1, :priority, NOW(), NOW())`, {
      clientId,
      staffId: req.user.id,
      contactType,
      clientName: customer.client_name,
      cellNumber: customer.cell_number || null,
      email: customer.email || null,
      categoryId,
      categoryOther,
      queryText: queryText || null,
      resultFound: resultFound || null,
      actionTaken: actionTaken || null,
      status,
      followUpAt,
      completedAt,
      completedBy,
      priority: priority === 'urgent' ? 'urgent' : 'normal'
    });
    const inquiryId = Number(result.insertId);
    const afterJson = JSON.stringify({ client_id: clientId, category_id: categoryId, category: category.category_name, status, follow_up_at: followUpAt, priority, contact_type: contactType });
    await connection.execute(`INSERT INTO audit_log
      (staff_id, action_type, entity_type, entity_id, description, before_json, after_json, ip_address, user_agent, created_at)
      VALUES (:staffId, 'inquiry_created', 'inquiries', :inquiryId, :description, NULL, :afterJson, :ip, :userAgent, NOW())`, {
      staffId: req.user.id,
      inquiryId,
      description: `Created inquiry for ${customer.client_name}`,
      afterJson,
      ip: requestIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
    await connection.commit();
    res.status(201).json({ ok: true, inquiryId, customerId: clientId, message: 'Inquiry saved successfully.' });
  } catch (error) {
    await connection.rollback();
    console.error('Inquiry creation failed', error);
    res.status(500).json({ ok: false, error: error.code || 'INQUIRY_CREATE_FAILED' });
  } finally {
    connection.release();
  }
});

app.get('/api/customers/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ ok: false, error: 'INVALID_CUSTOMER_ID' });
  try {
    const [[customer]] = await pool.execute(`SELECT c.*, COALESCE(sa.full_name, su.full_name, 'Unassigned') assigned_staff
      FROM clients c LEFT JOIN customer_accounts ca ON ca.id=c.account_id
      LEFT JOIN staff_users sa ON sa.id=ca.assigned_staff_id
      LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number))
      LEFT JOIN staff_users su ON su.id=a.assigned_staff_id WHERE c.id=:id LIMIT 1`, { id });
    if (!customer) return res.status(404).json({ ok: false, error: 'CUSTOMER_NOT_FOUND' });
    const accountNumber = customer.account_number || '';
    const [lines] = await pool.execute(`SELECT id, cell_number, package_name, handset, line_status, previous_upgrade_date, next_upgrade_date, monthly_invoice_amount FROM clients WHERE is_active=1 AND ((:accountNumber<>'' AND account_number=:accountNumber) OR id=:id) ORDER BY next_upgrade_date ASC, id ASC`, { accountNumber, id });
    const lineIds = lines.map(line => line.id);
    let inquiries = [];
    if (lineIds.length) {
      const placeholders = lineIds.map(() => '?').join(',');
      const [rows] = await pool.query(`SELECT i.id, i.created_at, i.status, i.priority, i.service_type, i.query_text, i.result_found, i.action_taken, i.follow_up_at, COALESCE(ic.category_name,i.category_other,'Other') category, COALESCE(s.full_name,'Unassigned') staff_member FROM inquiries i LEFT JOIN inquiry_categories ic ON ic.id=i.category_id LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id) WHERE i.client_id IN (${placeholders}) ORDER BY i.created_at DESC LIMIT 20`, lineIds);
      inquiries = rows;
    }
    res.json({ ok: true, customer, lines, inquiries });
  } catch (error) {
    console.error('Customer 360 query failed', error);
    res.status(500).json({ ok: false, error: error.code || 'CUSTOMER_360_FAILED' });
  }
});

app.get('/api/admin/session-check', requireRole('owner', 'manager'), (req, res) => res.json({ ok: true, role: req.user.role }));
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('*', (req, res) => req.user ? res.redirect('/') : res.redirect('/login'));

setInterval(() => {
  if (pool) pool.execute('DELETE FROM app_sessions WHERE expires_at<=NOW()').catch(error => console.error('Session cleanup failed', error.code || error.message));
}, 60 * 60 * 1000).unref();

app.listen(port, () => console.log(`Talk2Me OS2 running on port ${port}; authenticated inquiry writes enabled; database ${dbConfigured ? 'configured' : 'not configured'}`));
