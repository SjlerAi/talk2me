(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  const config = configNode ? JSON.parse(configNode.textContent || '{}') : {};
  const basePath = String(config.basePath || '');
  const appVersion = String(config.appVersion || '');
  const uatAssetVersion = `${appVersion}-responsive-2`;
  let redirecting = false;

  function addStylesheet(marker, href) {
    if (document.querySelector(`link[${marker}]`)) return;
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.setAttribute(marker, '1');
    stylesheet.href = href;
    document.head.appendChild(stylesheet);
  }

  function addScript(marker, src, onload) {
    if (document.querySelector(`script[${marker}]`)) {
      if (typeof onload === 'function') onload();
      return;
    }
    const script = document.createElement('script');
    script.async = false;
    script.setAttribute(marker, '1');
    script.src = src;
    if (typeof onload === 'function') script.addEventListener('load', onload, { once: true });
    document.head.appendChild(script);
  }

  function loadWorkflowAssets() {
    addStylesheet('data-task-workflow', `${basePath}/public/css/task-workflow.css?v=${encodeURIComponent(appVersion)}`);
    addScript('data-task-workflow', `${basePath}/public/js/task-workflow-notifications.js?v=${encodeURIComponent(appVersion)}`);
  }

  function loadUatProductivityAssets() {
    addStylesheet('data-uat-productivity', `${basePath}/public/css/productivity-uat.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addStylesheet('data-calendar-home-uat', `${basePath}/public/css/calendar-home-uat.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addStylesheet('data-uat-responsive-polish', `${basePath}/public/css/uat-responsive-polish.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addScript('data-uat-responsive-polish', `${basePath}/public/js/uat-responsive-polish.js?v=${encodeURIComponent(uatAssetVersion)}`);
    addScript('data-uat-reminder-fix', `${basePath}/public/js/uat-reminder-dialog-fix.js?v=${encodeURIComponent(uatAssetVersion)}`);
    addScript('data-uat-productivity', `${basePath}/public/js/productivity-uat.js?v=${encodeURIComponent(uatAssetVersion)}`, () => {
      addScript('data-calendar-home-uat', `${basePath}/public/js/calendar-home-uat.js?v=${encodeURIComponent(uatAssetVersion)}`);
    });
  }

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

  loadWorkflowAssets();
  loadUatProductivityAssets();
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