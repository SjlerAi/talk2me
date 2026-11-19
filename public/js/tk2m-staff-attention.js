(() => {
  'use strict';
  // Restrict to live TK2M's top-level window; never duplicate inside its iframes.
  if (window.location.hostname !== 'crm.tk2m.co.za' || window.top !== window
      || document.getElementById('tk2m-attention-backdrop')) return;
  const configNode = document.getElementById('talk2me-os-config');
  const config = configNode ? JSON.parse(configNode.textContent || '{}') : {};
  const base = String(config.basePath || '');
  const version = String(config.assetVersion || config.appVersion || '1');
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = base + '/public/css/tk2m-staff-attention.css?v=' + encodeURIComponent(version);
  document.head.appendChild(css);

  const backdrop = document.createElement('div');
  backdrop.id = 'tk2m-attention-backdrop';
  backdrop.className = 'tk2m-attention-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('role', 'alertdialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'tk2m-attention-heading');
  backdrop.setAttribute('aria-describedby', 'tk2m-attention-preview');
  backdrop.innerHTML =
    '<section class="tk2m-attention-card" tabindex="-1">' +
    '<header class="tk2m-attention-head"><span class="tk2m-attention-bell" aria-hidden="true">!</span>' +
    '<h2 id="tk2m-attention-heading"></h2>' +
    '<button type="button" class="tk2m-attention-close" aria-label="Acknowledge and close alert" title="Acknowledge and close">×</button>' +
    '</header><div class="tk2m-attention-body">' +
    '<p class="tk2m-attention-category" id="tk2m-attention-category"></p>' +
    '<p class="tk2m-attention-preview" id="tk2m-attention-preview"></p>' +
    '<p class="tk2m-attention-meta" id="tk2m-attention-meta"></p>' +
    '<p class="tk2m-attention-error" id="tk2m-attention-error" aria-live="assertive" hidden></p>' +
    '<button type="button" class="tk2m-attention-open">Open message or task</button>' +
    '</div></section>';
  document.body.appendChild(backdrop);
  const heading = backdrop.querySelector('#tk2m-attention-heading');
  const category = backdrop.querySelector('#tk2m-attention-category');
  const preview = backdrop.querySelector('#tk2m-attention-preview');
  const meta = backdrop.querySelector('#tk2m-attention-meta');
  const errorNode = backdrop.querySelector('#tk2m-attention-error');
  const closeButton = backdrop.querySelector('.tk2m-attention-close');
  const openButton = backdrop.querySelector('.tk2m-attention-open');
  let current = null, busy = false, polling = false;

  function hide() {
    backdrop.hidden = true;
    document.body.classList.remove('tk2m-attention-active');
    current = null;
  }
  function display(item) {
    current = item;
    const message = item.kind === 'chat' || item.title === 'New message';
    heading.textContent = (message ? 'MESSAGE FROM ' : 'TASK FROM ') + String(item.sender || 'Colleague');
    category.textContent = String(item.title || 'New work').toUpperCase();
    preview.textContent = String(item.preview || 'Open to see the details.');
    const stamp = item.createdAt && new Date(item.createdAt);
    meta.textContent = stamp && !Number.isNaN(stamp.getTime()) ? 'Received: ' + stamp.toLocaleString('en-ZA') : 'New work received';
    openButton.textContent = message ? 'Open message' : 'Open task';
    errorNode.hidden = true;
    backdrop.hidden = false;
    document.body.classList.add('tk2m-attention-active');
    closeButton.focus();
  }
  async function refresh() {
    if (busy || polling) return;
    polling = true;
    try {
      const response = await fetch(base + '/api/staff-attention/pending', {
        cache:'no-store', credentials:'same-origin', headers:{Accept:'application/json'}
      });
      if (!response.ok) throw new Error('Alert service unavailable');
      const data = await response.json();
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      if (current) {
        if (alerts.some(item => item.kind === current.kind && Number(item.id) === Number(current.id))) return;
        // A read/acknowledgment on another device should clear this duplicate.
        hide();
      }
      if (alerts.length) display(alerts[0]);
    } catch (_) {
      // Never discard an already shown alert because polling failed.
    } finally { polling = false; }
  }
  function openItem(item) {
    if (item.kind === 'chat') {
      if (typeof window.Talk2MeWidgets?.openConversation === 'function') {
        window.Talk2MeWidgets.openConversation(item.conversation);
      } else if (typeof window.Talk2MeWidgets?.openChat === 'function') {
        window.Talk2MeWidgets.openChat();
      } else {
        document.querySelector('[data-os-app="messages"]')?.click();
      }
      return;
    }
    const id = Number(item.taskId);
    if (typeof window.Talk2MeWidgets?.openTask === 'function') {
      window.Talk2MeWidgets.openTask(id);
    } else if (typeof window.Talk2MeOS?.openRoute === 'function') {
      window.Talk2MeOS.openRoute(base + '/tasks/' + id, 'Task ' + id, '✓');
    } else {
      window.location.assign(base + '/tasks/' + id);
    }
  }
  async function acknowledge(method) {
    if (!current || busy) return;
    const item = current;
    busy = true;
    closeButton.disabled = true;
    openButton.disabled = true;
    errorNode.hidden = true;
    try {
      const response = await fetch(base + '/api/staff-attention/ack', {
        method:'POST',cache:'no-store',credentials:'same-origin',
        headers:{'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({kind:item.kind,id:item.id,method})
      });
      if (!response.ok) {
        if (response.status === 404) { hide(); return; }
        throw new Error('Could not record the acknowledgment. Please try again.');
      }
      hide();
      if (method === 'open') openItem(item);
    } catch (error) {
      errorNode.textContent = String(error.message || 'Acknowledgment failed.');
      errorNode.hidden = false;
    } finally {
      busy = false;
      closeButton.disabled = false;
      openButton.disabled = false;
      refresh();
    }
  }
  closeButton.addEventListener('click', () => acknowledge('dismiss'));
  openButton.addEventListener('click', () => acknowledge('open'));
  document.addEventListener('keydown', event => {
    if (backdrop.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); closeButton.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      (document.activeElement === closeButton ? openButton : closeButton).focus();
    } else if (!backdrop.contains(event.target)) {
      event.stopImmediatePropagation(); closeButton.focus();
    }
  }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pageshow', refresh);
  refresh();
  window.setInterval(refresh, 8000);
})();
