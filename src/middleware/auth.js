const db = require('../config/db');

const BUSINESS_TIMEZONE = 'Africa/Johannesburg';

function businessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function expireDailySession(req, res) {
  const basePath = res.locals.basePath || '';
  const loginSessionId = Number(req.session.loginSessionId || 0);
  const staffId = Number(req.session.user?.id || 0);

  (async () => {
    try {
      if (loginSessionId && staffId) {
        await db.execute(`UPDATE staff_login_sessions
          SET logout_at=COALESCE(logout_at,NOW()),last_activity_at=NOW(),
              session_status=CASE WHEN session_status='active' THEN 'logged_out' ELSE session_status END,
              logout_reason=CASE WHEN session_status='active' THEN 'daily_reauth' ELSE logout_reason END
          WHERE id=:id AND staff_id=:staffId`, { id: loginSessionId, staffId });
      }
    } catch (error) {
      console.error('Could not expire previous-day login session:', error.message);
    } finally {
      req.session.destroy(() => res.redirect(`${basePath}/login?reason=daily`));
    }
  })();
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  if (!req.session.loginDate || req.session.loginDate !== businessDate()) return expireDailySession(req, res);
  next();
}

function requireOwner(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  if (!req.session.loginDate || req.session.loginDate !== businessDate()) return expireDailySession(req, res);
  if (!['owner','manager'].includes(req.session.user.role)) return res.status(403).render('error', { title: 'Forbidden', message: 'Owner or manager access required.' });
  next();
}


function dailySessionMiddleware() {
  return (req, res, next) => {
    if (!req.session?.user) return next();

    const path = String(req.path || req.url || '').split('?')[0];
    if (path === '/login' || path === '/logout') return next();

    if (req.session.loginDate && req.session.loginDate === businessDate()) return next();
    return expireDailySession(req, res);
  };
}

module.exports = { requireAuth, requireOwner, businessDate, dailySessionMiddleware };
