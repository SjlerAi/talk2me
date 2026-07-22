(() => {
  'use strict';

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
