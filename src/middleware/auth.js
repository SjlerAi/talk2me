function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  next();
}
function requireOwner(req, res, next) {
  if (!req.session.user) return res.redirect(`${res.locals.basePath}/login`);
  if (!['owner','manager'].includes(req.session.user.role)) return res.status(403).render('error', { title: 'Forbidden', message: 'Owner or manager access required.' });
  next();
}
module.exports = { requireAuth, requireOwner };
