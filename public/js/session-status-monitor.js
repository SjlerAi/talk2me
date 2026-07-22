(() => {
  'use strict';

  const script = document.currentScript;
  const basePath = String(script?.dataset.basePath || '');
  let redirecting = false;

  async function checkSession() {
    if (redirecting) return;
    try {
      const response = await fetch(`${basePath}/api/session-status`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (response.status !== 401) return;
      redirecting = true;
      const target = `${basePath}/login?reason=default_logout`;
      if (window.top && window.top !== window) window.top.location.replace(target);
      else window.location.replace(target);
    } catch (_) {
      // Temporary network problems must not force staff out of the workstation.
    }
  }

  checkSession();
  const timer = setInterval(checkSession, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkSession();
  });
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
})();
