const ALLOWED_VIEWS = new Set(['active', 'today', 'priority', 'progress', 'approval', 'sent', 'notifications', 'archive', 'all']);

module.exports = function taskReturnNavigation(req, res, next) {
  if (req.method !== 'POST' || !/^\/tasks\/\d+\/(status|accept|return|comments|my-priority)$/.test(req.path)) {
    return next();
  }

  const requestedView = String(req.body?.return_view || '').trim();
  if (!ALLOWED_VIEWS.has(requestedView)) return next();

  const originalRedirect = res.redirect.bind(res);
  res.redirect = function redirectToTaskManager(statusOrUrl, maybeUrl) {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
    const originalUrl = typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl;
    const destination = String(originalUrl || '');

    if (!/\/tasks\/\d+(?:\?|$)/.test(destination)) {
      return originalRedirect(status, destination);
    }

    const query = new URLSearchParams({ view: requestedView });
    if (String(req.body?.panel || req.query?.panel || '') === '1') query.set('panel', '1');
    return originalRedirect(status, `${res.locals.basePath}/tasks?${query.toString()}`);
  };

  next();
};
