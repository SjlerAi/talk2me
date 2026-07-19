require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const crypto = require('crypto');
const db = require('./src/config/db');
const packageInfo = require('./package.json');

const app = express();
app.set('trust proxy', 1);

const configuredBasePath = String(process.env.BASE_PATH || '/talk2me').trim();
const BASE_PATH = configuredBasePath === '/' ? '' : '/' + configuredBasePath.split('/').filter(Boolean).join('/');
const PORT = process.env.PORT || 3000;
const sessionSecure = String(process.env.SESSION_SECURE || 'false').toLowerCase() === 'true';
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

class MySqlSessionStore extends session.Store {
  key(sid) { return crypto.createHash('sha256').update(String(sid)).digest('hex'); }
  get(sid, callback) {
    db.execute('SELECT session_data FROM app_sessions WHERE session_id=:id AND expires_at>NOW() LIMIT 1', { id:this.key(sid) })
      .then(([rows]) => {
        if (!rows[0]) return callback(null, null);
        try { callback(null, JSON.parse(rows[0].session_data)); } catch (error) { callback(error); }
      }).catch(callback);
  }
  set(sid, value, callback=()=>{}) {
    const cookieExpiry=value?.cookie?.expires ? new Date(value.cookie.expires) : new Date(Date.now()+EIGHT_HOURS_MS);
    const expiresAt=Number.isNaN(cookieExpiry.getTime()) ? new Date(Date.now()+EIGHT_HOURS_MS) : cookieExpiry;
    db.execute(`INSERT INTO app_sessions (session_id,session_data,expires_at)
      VALUES (:id,:data,:expiresAt)
      ON DUPLICATE KEY UPDATE session_data=VALUES(session_data),expires_at=VALUES(expires_at),updated_at=NOW()`, {
      id:this.key(sid), data:JSON.stringify(value), expiresAt
    }).then(()=>callback(null)).catch(callback);
  }
  destroy(sid, callback=()=>{}) {
    db.execute('DELETE FROM app_sessions WHERE session_id=:id',{id:this.key(sid)}).then(()=>callback(null)).catch(callback);
  }
  touch(sid, value, callback=()=>{}) { callback(null); }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  name: 'talk2me.sid',
  secret: process.env.SESSION_SECRET,
  store: new MySqlSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: sessionSecure, maxAge: EIGHT_HOURS_MS }
}));

app.use((req, res, next) => {
  res.locals.basePath = BASE_PATH;
  res.locals.currentUser = req.session.user || null;
  res.locals.appName = process.env.APP_NAME || 'Talk2Me CRM';
  res.locals.appVersion = packageInfo.version || process.env.APP_VERSION || 'dev';
  res.locals.appBuild = process.env.APP_BUILD || '2026-07-13';
  res.locals.panelMode = String(req.query.panel || '') === '1';
  res.locals.voipUrlTemplate = process.env.VOIP_URL_TEMPLATE || '';
  next();
});

app.use('/public', express.static(path.join(__dirname, 'public')));
if (BASE_PATH) app.use(`${BASE_PATH}/public`, express.static(path.join(__dirname, 'public')));

// Save provisional mobile lines before the older handlers so one route owns the
// full duplicate check, transaction and user-facing error state.
const provisionalMobileSave = require('./src/routes/provisional-mobile-save');
app.use('/', provisionalMobileSave);
if (BASE_PATH) app.use(BASE_PATH, provisionalMobileSave);

// Customer 360 is mounted first so customers without an official account number
// still open safely and show their pending account status.
const customer360Safe = require('./src/routes/customer-360-safe');
app.use('/', customer360Safe);
if (BASE_PATH) app.use(BASE_PATH, customer360Safe);

const osOperations = require('./src/routes/os-operations');
app.use('/', osOperations);
if (BASE_PATH) app.use(BASE_PATH, osOperations);

const osRoutes = require('./src/routes/os');
app.use('/', osRoutes);
if (BASE_PATH) app.use(BASE_PATH, osRoutes);

const routes = require('./src/routes');
app.use('/', routes);
if (BASE_PATH) app.use(BASE_PATH, routes);

app.get('/', (req, res) => res.redirect(`${BASE_PATH}/login`));
if (BASE_PATH) app.get(BASE_PATH, (req, res) => res.redirect(`${BASE_PATH}/login`));
app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'Page not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server error', message: 'Something went wrong. Check server logs.' });
});
app.listen(PORT, () => console.log(`Talk2Me CRM running on port ${PORT} with base path ${BASE_PATH}`));