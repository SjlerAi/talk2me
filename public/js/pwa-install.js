(() => {
  'use strict';

  const script = document.currentScript;
  const basePath = String(script?.dataset?.basePath || '');
  const installButton = document.querySelector('[data-install-talk2me]');
  let deferredPrompt = null;

  function notify(title, message, actionLabel, action) {
    const region = document.getElementById('os-toast-region') || document.body;
    const notice = document.createElement('div');
    notice.className = 't2m-os-toast t2m-pwa-notice';
    notice.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
    if (actionLabel && action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = actionLabel;
      button.style.cssText = 'margin-top:10px;border:0;border-radius:8px;padding:8px 12px;background:#ed1c24;color:#fff;font-weight:800;cursor:pointer';
      button.addEventListener('click', action);
      notice.appendChild(button);
    }
    region.appendChild(notice);
    if (!action) setTimeout(() => notice.remove(), 5000);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installButton) installButton.hidden = true;
    notify('Talk2Me installed', 'Talk2Me OS is now available from Windows and can be pinned to the taskbar.');
  });

  if (installButton) {
    installButton.addEventListener('click', async () => {
      if (!deferredPrompt) {
        notify('Install Talk2Me', 'Use the browser app-install icon or menu to install Talk2Me on this computer.');
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installButton.hidden = true;
    });
  }

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(`${basePath}/service-worker.js`, {
        scope: `${basePath || ''}/`
      });

      function offerUpdate(worker) {
        if (!worker) return;
        notify(
          'Talk2Me update available',
          'Finish your current work, then reload to use the latest version.',
          'Reload and update',
          () => worker.postMessage({ type: 'SKIP_WAITING' })
        );
      }

      if (registration.waiting) offerUpdate(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (error) {
      console.error('Talk2Me PWA registration failed:', error);
    }
  });
})();
