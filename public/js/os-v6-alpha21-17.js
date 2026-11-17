(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  const config = configNode ? JSON.parse(configNode.textContent || '{}') : {};
  const basePath = String(config.basePath || '');
  const appVersion = String(config.appVersion || '');
  const assetVersion = String(config.assetVersion || appVersion || '');
  const uatAssetVersion = `${assetVersion}-widgets-7`;
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
    addStylesheet('data-task-workflow', `${basePath}/public/css/task-workflow.css?v=${encodeURIComponent(assetVersion)}`);
    addScript('data-task-workflow', `${basePath}/public/js/task-workflow-notifications.js?v=${encodeURIComponent(assetVersion)}`);
  }

  function loadUatProductivityAssets() {
    addStylesheet('data-uat-productivity', `${basePath}/public/css/productivity-uat.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addStylesheet('data-uat-responsive-polish', `${basePath}/public/css/uat-responsive-polish.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addStylesheet('data-uat-launcher-strip', `${basePath}/public/css/uat-launcher-strip.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addStylesheet('data-uat-work-widgets', `${basePath}/public/css/uat-work-widgets.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addStylesheet('data-uat-work-operating-model', `${basePath}/public/css/uat-work-operating-model.css?v=${encodeURIComponent(uatAssetVersion)}-approved1`);
    addStylesheet('data-uat-widget-polish', `${basePath}/public/css/uat-widget-polish.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addStylesheet('data-uat-mobile-first', `${basePath}/public/css/uat-mobile-first.css?v=${encodeURIComponent(uatAssetVersion)}`);
    addScript('data-uat-responsive-polish', `${basePath}/public/js/uat-responsive-polish.js?v=${encodeURIComponent(uatAssetVersion)}`);
    addScript('data-uat-reminder-fix', `${basePath}/public/js/uat-reminder-dialog-fix.js?v=${encodeURIComponent(uatAssetVersion)}`);
    // Optional work widgets must not gate the primary My Day calendar.
    // My Day is loaded directly by the OS shell before this enhancement loader.
    addScript('data-uat-productivity', `${basePath}/public/js/productivity-uat.js?v=${encodeURIComponent(uatAssetVersion)}`, () => {
      addScript('data-uat-command-centre-sidebar', `${basePath}/public/js/uat-command-centre-sidebar.js?v=${encodeURIComponent(uatAssetVersion)}`);
      addScript('data-uat-work-widgets', `${basePath}/public/js/uat-work-widgets.js?v=${encodeURIComponent(uatAssetVersion)}`, () => {
        addScript('data-uat-work-operating-model', `${basePath}/public/js/uat-work-operating-model.js?v=${encodeURIComponent(uatAssetVersion)}-approved1`, () => {
          addScript('data-uat-widget-polish', `${basePath}/public/js/uat-widget-polish.js?v=${encodeURIComponent(uatAssetVersion)}`);
        });
      });
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


/* Lightweight UAT usage telemetry: records feature opens, never form/customer content. */
(() => {
  if (window.__talk2meUsageClientLoaded) return;
  window.__talk2meUsageClientLoaded = true;

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode) return;
  let config = {};
  try { config = JSON.parse(configNode.textContent || '{}'); } catch (_) {}
  const basePath = String(config.basePath || '');

  function track({event_type='ui_action',screen_key='',module_name='',route_path='',
    action='',window_key='',window_kind='',outcome=''}) {
    // Labels and actions only. No customer details, entered text, search
    // phrases, external portal URLs or messages are transmitted.
    const payload = {event_type,screen_key,module_name,route_path,
      action,window_key,window_kind,outcome};
    fetch(`${basePath}/api/usage/events`, {
      method:'POST',
      credentials:'same-origin',
      cache:'no-store',
      keepalive:true,
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(payload)
    }).catch(()=>{});
  }

  window.Talk2MeUsage = { track };

  // Explicit, allowlisted human button attempts. Never record free text,
  // search content, customer numbers, message bodies or external URLs.
  // Completed work is counted separately from server-side task/change records.
  const trackedWorkButtons = [
    ['[data-chat-tab]', 'message_tab_clicked', 'messages'],
    ['[data-chat-send]', 'message_send_clicked', 'messages'],
    ['[data-chat-voice]', 'voice_record_clicked', 'messages'],
    ['[data-system-read]', 'system_notice_read_clicked', 'messages'],
    ['[data-task-status]', 'task_status_clicked', 'work'],
    ['[data-task-complete]', 'task_complete_clicked', 'work'],
    ['[data-task-decision]', 'task_review_clicked', 'work'],
    ['[data-task-back]', 'task_back_clicked', 'work'],
    ['[data-task-comment-form] button[type="submit"]', 'task_comment_send_clicked', 'work']
  ];
  document.addEventListener('click', event => {
    const target=event.target;
    if (!target?.closest) return;
    for (const [selector, action, screen] of trackedWorkButtons) {
      if (!target.closest(selector)) continue;
      track({event_type:'ui_action',screen_key:screen,
        module_name:'work',route_path:'/workspace',action});
      return;
    }
  }, true);

  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-os-app],[data-os-route],[data-os-launch],[data-os-managed-launcher],[data-widget-add],[data-home-add-task],[data-home-add-reminder]');
    if (!target) return;

    const app = target.dataset.osApp || '';
    const route = target.dataset.osRoute || '';
    const launcher = target.dataset.osLaunch || target.dataset.osManagedLauncher || '';
    const addAction = target.dataset.widgetAdd || (target.hasAttribute('data-home-add-task') ? 'task' : target.hasAttribute('data-home-add-reminder') ? 'reminder' : '');
    const key = app || launcher || addAction || (route ? 'route' : 'unknown');

    track({
      event_type:'feature_open',
      screen_key:key,
      module_name:app === 'work' || app === 'tasks' || app === 'messages' ? 'work' : (app || launcher || addAction || 'navigation'),
      route_path:route || location.pathname,
      action:key
    });
  }, true);
})();
