const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public', 'os2');

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
app.use(express.json());
app.use(express.static(publicDir, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '5m' : 0
}));

async function count(sql, params = {}) {
  const [[row]] = await pool.execute(sql, params);
  return Number(row.total || 0);
}

app.get('/health', async (req, res) => {
  let database = { configured: dbConfigured, connected: false };
  if (pool) {
    try {
      await pool.query('SELECT 1');
      database.connected = true;
      database.name = process.env.DB_NAME;
    } catch (error) {
      database.error = error.code || 'DB_CONNECTION_FAILED';
    }
  }
  res.status(database.configured && !database.connected ? 503 : 200).json({
    ok: !database.configured || database.connected,
    application: 'Talk2Me OS2',
    environment: process.env.NODE_ENV || 'development',
    database,
    time: new Date().toISOString()
  });
});

app.get('/api/dashboard', async (req, res) => {
  if (!pool) return res.status(503).json({ ok: false, error: 'Database environment variables are not configured.' });
  try {
    const [approvals, overdue, unassigned, clockedIn, activeStaff, upgrades, birthdays, callbacks, prospects] = await Promise.all([
      count("SELECT COUNT(*) total FROM data_change_requests WHERE status IN ('pending_manager','pending_owner')"),
      count("SELECT COUNT(*) total FROM staff_tasks WHERE status IN ('unread','seen','in_progress') AND due_at IS NOT NULL AND due_at < NOW()"),
      count(`SELECT COUNT(DISTINCT COALESCE(NULLIF(c.account_number,''), CONCAT('client:',c.id))) total
        FROM clients c
        LEFT JOIN client_assignments a ON a.is_active=1 AND (a.client_id=c.id OR (a.account_number<>'' AND a.account_number=c.account_number))
        WHERE c.is_active=1 AND a.id IS NULL`),
      count("SELECT COUNT(DISTINCT staff_id) total FROM attendance_sessions WHERE work_date=CURRENT_DATE() AND status='active' AND clock_out_at IS NULL"),
      count("SELECT COUNT(*) total FROM staff_users WHERE is_active=1"),
      count("SELECT COUNT(DISTINCT id) total FROM clients WHERE is_active=1 AND next_upgrade_date IS NOT NULL AND DATE(next_upgrade_date) BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)"),
      count("SELECT COUNT(DISTINCT id) total FROM clients WHERE is_active=1 AND birthday IS NOT NULL AND MONTH(birthday)=MONTH(CURRENT_DATE()) AND DAY(birthday)=DAY(CURRENT_DATE())"),
      count("SELECT COUNT(*) total FROM inquiries WHERE status IN ('open','follow_up','waiting_customer','waiting_network','waiting_supplier') AND follow_up_at IS NOT NULL AND DATE(follow_up_at)=CURRENT_DATE()"),
      count("SELECT COUNT(*) total FROM clients WHERE is_active=1 AND lifecycle_status='prospect' AND COALESCE(lead_status,'new') IN ('new','contacted','qualified')")
    ]);

    const [activity] = await pool.execute(`SELECT
      COALESCE(s.full_name,'Unassigned') staff_member,
      COALESCE(i.action_taken,i.query_text,'Inquiry updated') latest_action,
      COALESCE(i.client_name,'Unknown customer') customer,
      i.status,
      DATE_FORMAT(i.updated_at,'%H:%i') activity_time
      FROM inquiries i
      LEFT JOIN staff_users s ON s.id=COALESCE(i.assigned_staff_id,i.staff_id)
      ORDER BY i.updated_at DESC LIMIT 5`);

    res.json({
      ok: true,
      metrics: { approvals, overdue, unassigned, clockedIn, activeStaff, upgrades, birthdays, callbacks, prospects },
      activity
    });
  } catch (error) {
    console.error('Dashboard query failed', error);
    res.status(500).json({ ok: false, error: error.code || 'DASHBOARD_QUERY_FAILED' });
  }
});

app.get('/api/customers/search', async (req, res) => {
  if (!pool) return res.status(503).json({ ok: false, error: 'Database environment variables are not configured.' });
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.json({ ok: true, customers: [] });
  try {
    const like = `%${query}%`;
    const [rows] = await pool.execute(`SELECT
        id,
        client_name,
        account_number,
        cell_number,
        email,
        city_town
      FROM clients
      WHERE is_active=1 AND (
        client_name LIKE :like OR
        account_number LIKE :like OR
        cell_number LIKE :like OR
        cell_number_normalised LIKE :like OR
        alt_number LIKE :like OR
        email LIKE :like OR
        city_town LIKE :like OR
        id_number LIKE :like OR
        package_name LIKE :like OR
        handset LIKE :like OR
        main_contact_name LIKE :like OR
        main_contact_number LIKE :like
      )
      ORDER BY client_name ASC, account_number ASC
      LIMIT 10`, { like });
    res.json({ ok: true, customers: rows });
  } catch (error) {
    console.error('Customer search failed', error);
    res.status(500).json({ ok: false, error: error.code || 'CUSTOMER_SEARCH_FAILED' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Talk2Me OS2 running on port ${port}; database ${dbConfigured ? 'configured' : 'not configured'}`);
});
