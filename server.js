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
  res.locals.unreadTaskCount = 0;
  next();
});

function registerPwaRoute(route, handler) {
  app.get(route, handler);
  if (BASE_PATH) app.get(`${BASE_PATH}${route}`, handler);
}

registerPwaRoute('/manifest.webmanifest', (req, res) => {
  const scope = `${BASE_PATH || ''}/` || '/';
  res.type('application/manifest+json').send({
    id: `${BASE_PATH || ''}/workspace`,
    name: 'Talk2Me OS',
    short_name: 'Talk2Me',
    description: 'Talk2Me customer and staff command centre',
    start_url: `${BASE_PATH || ''}/workspace`,
    scope,
    display: 'standalone',
    background_color: '#202832',
    theme_color: '#202832',
    icons: [
      { src: `${BASE_PATH || ''}/public/images/favicon-192x192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${BASE_PATH || ''}/public/images/favicon-512x512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${BASE_PATH || ''}/public/images/favicon-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  });
});

registerPwaRoute('/offline', (req, res) => {
  res.status(503).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#202832"><title>Talk2Me is offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#202832;color:#fff;font-family:system-ui,sans-serif}.card{max-width:560px;margin:24px;padding:34px;border-radius:18px;background:#fff;color:#202832;box-shadow:0 24px 70px rgba(0,0,0,.35)}h1{margin-top:0}p{line-height:1.6;color:#5d6875}</style></head><body><main class="card"><h1>Talk2Me is offline</h1><p>A secure internet connection is required to access customer information. Reconnect and reopen Talk2Me.</p></main></body></html>`);
});

registerPwaRoute('/service-worker.js', (req, res) => {
  const base = BASE_PATH || '';
  const version = String(packageInfo.version || 'dev').replace(/[^a-zA-Z0-9._-]/g, '-');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('application/javascript').send(`
const CACHE_NAME = 'talk2me-static-${version}';
const BASE = ${JSON.stringify(base)};
const OFFLINE_URL = BASE + '/offline';
const PRECACHE = [
  OFFLINE_URL,
  BASE + '/public/images/favicon-192x192.png',
  BASE + '/public/images/favicon-512x512.png',
  BASE + '/public/images/talk2me-logo.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('talk2me-static-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  const isStatic = url.pathname.startsWith(BASE + '/public/');
  if (!isStatic) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(request);
    const network = fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
`);
});

app.use('/public', express.static(path.join(__dirname, 'public')));
if (BASE_PATH) app.use(`${BASE_PATH}/public`, express.static(path.join(__dirname, 'public')));

const provisionalFixedSave = require('./src/routes/provisional-fixed-save');
app.use('/', provisionalFixedSave);
if (BASE_PATH) app.use(BASE_PATH, provisionalFixedSave);

const provisionalMobileSave = require('./src/routes/provisional-mobile-save');
app.use('/', provisionalMobileSave);
if (BASE_PATH) app.use(BASE_PATH, provisionalMobileSave);

const customer360Safe = require('./src/routes/customer-360-safe');
app.use('/', customer360Safe);
if (BASE_PATH) app.use(BASE_PATH, customer360Safe);

const osLauncherSettings = require('./src/routes/os-launcher-settings');
app.use('/', osLauncherSettings);
if (BASE_PATH) app.use(BASE_PATH, osLauncherSettings);

const osOperations = require('./src/routes/os-operations');
app.use('/', osOperations);
if (BASE_PATH) app.use(BASE_PATH, osOperations);

const osProductivity = require('./src/routes/os-productivity');
app.use('/', osProductivity);
if (BASE_PATH) app.use(BASE_PATH, osProductivity);

const osCustomerActions = require('./src/routes/os-customer-actions');
app.use('/', osCustomerActions);
if (BASE_PATH) app.use(BASE_PATH, osCustomerActions);

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
