(() => {
  'use strict';

  const page = document.querySelector('[data-launcher-settings-saved]');
  if (!page || page.dataset.launcherSettingsSaved !== '1') return;

  const targets = [];
  if (window.parent && window.parent !== window) targets.push(window.parent);
  if (window.opener && !window.opener.closed) targets.push(window.opener);

  for (const target of targets) {
    try {
      target.postMessage({ type: 'talk2me:launcher-settings-saved' }, window.location.origin);
    } catch (_) {}
  }
})();
