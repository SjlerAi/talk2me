(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  const config = configNode ? JSON.parse(configNode.textContent || '{}') : {};
  const basePath = String(config.basePath || '');
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
      window.location.replace(`${basePath}/login?reason=default_logout`);
    } catch (_) {
      // Do not sign staff out for temporary network errors.
    }
  }

  checkSession();
  setInterval(checkSession, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkSession();
  });

  document.addEventListener('load', event => {
    const frame = event.target;
    if (!(frame instanceof HTMLIFrameElement)) return;
    if (!frame.closest('.t2m-os-window-body')) return;

    try {
      const current = new URL(frame.contentWindow.location.href);
      if (current.origin !== window.location.origin) return;
      if (current.searchParams.get('panel') === '1') return;
      if (/\/workspace\/?$/.test(current.pathname)) return;

      current.searchParams.set('panel', '1');
      frame.contentWindow.location.replace(current.href);
    } catch (_) {
      // Cross-origin supplier systems cannot be inspected and are left untouched.
    }
  }, true);
})();
