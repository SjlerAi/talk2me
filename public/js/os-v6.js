(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');
  const layer = document.getElementById('os-window-layer');
  const emptyState = document.getElementById('os-workspace-empty');
  const searchInput = document.getElementById('os-global-search');
  const searchResults = document.getElementById('os-search-results');
  const toastRegion = document.getElementById('os-toast-region');
  const supplierKey = 'talk2me-os-v6-suppliers';
  const notesKey = `talk2me-os-v6-notes-${config.user?.id || 'user'}`;

  const suppliersDefault = {
    vodacom: { name: 'Vodacom', icon: '📱', url: '' },
    mtn: { name: 'MTN', icon: '📡', url: '' },
    telkom: { name: 'Telkom', icon: '☎', url: '' },
    sage: { name: 'Sage', icon: '💼', url: '' }
  };

  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function toast(title, message) {
    const node = document.createElement('div');
    node.className = 't2m-os-toast';
    node.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    toastRegion.appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  function readSuppliers() {
    try {
      const saved = JSON.parse(localStorage.getItem(supplierKey) || '{}');
      return Object.fromEntries(Object.entries(suppliersDefault).map(([key, value]) => [key, { ...value, ...(saved[key] || {}) }]));
    } catch (_) {
      return JSON.parse(JSON.stringify(suppliersDefault));
    }
  }

  function panelUrl(url) {
    const parsed = new URL(url, location.href);
    if (parsed.origin === location.origin) parsed.searchParams.set('panel', '1');
    return parsed.href;
  }

  class WindowManager {
    constructor() {
      this.windows = new Map();
      this.z = 100;
      this.cascade = 0;
    }

    open(options) {
      const existing = this.windows.get(options.id);
      if (existing) {
        this.restore(options.id);
        this.focus(options.id);
        return existing;
      }

      const area = layer.getBoundingClientRect();
      const width = Math.min(options.width || 900, Math.max(360, area.width - 28));
      const height = Math.min(options.height || 620, Math.max(240, area.height - 28));
      const offset = (this.cascade++ % 7) * 24;
      const node = document.createElement('section');
      node.className = 't2m-os-window';
      node.dataset.windowId = options.id;
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-label', options.title);
      Object.assign(node.style, {
        width: `${width}px`, height: `${height}px`,
        left: `${Math.max(8, Math.min(36 + offset, area.width - width - 8))}px`,
        top: `${Math.max(8, Math.min(22 + offset, area.height - height - 8))}px`
      });
      node.innerHTML = `<header class="t2m-os-window-titlebar" data-drag>
        <span class="t2m-os-window-app-icon">${esc(options.icon || '▣')}</span>
        <span class="t2m-os-window-title"><strong>${esc(options.title)}</strong><small>${esc(options.subtitle || 'Talk2Me OS')}</small></span>
        <span class="t2m-os-window-controls">
          <button type="button" data-action="minimize" aria-label="Minimize">—</button>
          <button type="button" data-action="maximize" aria-label="Maximize">□</button>
          <button type="button" data-action="close" aria-label="Close">×</button>
        </span></header><div class="t2m-os-window-body"></div><span class="t2m-os-window-resize" data-resize></span>`;
      layer.appendChild(node);
      const record = { options, node, minimized: false, maximized: false, restore: null };
      this.windows.set(options.id, record);
      this.install(record);
      this.render(record);
      this.focus(options.id);
      this.sync(options.appKey || options.id);
      emptyState.hidden = true;
      return record;
    }

    render(record) {
      const body = record.node.querySelector('.t2m-os-window-body');
      if (record.options.url) {
        body.innerHTML = '<div class="t2m-os-window-loader">Loading application…</div>';
        const frame = document.createElement('iframe');
        frame.title = record.options.title;
        frame.src = panelUrl(record.options.url);
        frame.addEventListener('load', () => body.querySelector('.t2m-os-window-loader')?.remove(), { once: true });
        body.appendChild(frame);
      } else if (record.options.render) {
        record.options.render(body, record);
      }
    }

    install(record) {
      const { node, options } = record;
      node.addEventListener('pointerdown', () => this.focus(options.id));
      node.querySelector('[data-action="close"]').onclick = () => this.close(options.id);
      node.querySelector('[data-action="minimize"]').onclick = () => this.minimize(options.id);
      node.querySelector('[data-action="maximize"]').onclick = () => this.maximize(options.id);
      node.querySelector('[data-drag]').ondblclick = event => {
        if (!event.target.closest('.t2m-os-window-controls')) this.maximize(options.id);
      };
      this.drag(record);
      this.resize(record);
    }

    drag(record) {
      const handle = record.node.querySelector('[data-drag]');
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || record.maximized || event.target.closest('.t2m-os-window-controls')) return;
        event.preventDefault();
        this.focus(record.options.id);
        const x = event.clientX, y = event.clientY, left = record.node.offsetLeft, top = record.node.offsetTop;
        handle.setPointerCapture(event.pointerId);
        const move = e => {
          const area = layer.getBoundingClientRect();
          record.node.style.left = `${Math.min(Math.max(0, left + e.clientX - x), Math.max(0, area.width - 80))}px`;
          record.node.style.top = `${Math.min(Math.max(0, top + e.clientY - y), Math.max(0, area.height - 47))}px`;
        };
        const done = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', done); };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', done);
      });
    }

    resize(record) {
      const handle = record.node.querySelector('[data-resize]');
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || record.maximized) return;
        event.preventDefault(); event.stopPropagation();
        const x = event.clientX, y = event.clientY, width = record.node.offsetWidth, height = record.node.offsetHeight;
        handle.setPointerCapture(event.pointerId);
        const move = e => {
          const area = layer.getBoundingClientRect();
          record.node.style.width = `${Math.min(area.width - record.node.offsetLeft, Math.max(360, width + e.clientX - x))}px`;
          record.node.style.height = `${Math.min(area.height - record.node.offsetTop, Math.max(240, height + e.clientY - y))}px`;
        };
        const done = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', done); };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', done);
      });
    }

    focus(id) {
      const record = this.windows.get(id); if (!record) return;
      this.windows.forEach(item => item.node.classList.remove('is-focused'));
      record.node.classList.add('is-focused');
      record.node.style.zIndex = String(++this.z);
    }

    minimize(id) {
      const record = this.windows.get(id); if (!record) return;
      record.minimized = true; record.node.classList.add('is-minimized');
      this.sync(record.options.appKey || id);
    }

    restore(id) {
      const record = this.windows.get(id); if (!record) return;
      record.minimized = false; record.node.classList.remove('is-minimized');
      this.sync(record.options.appKey || id);
    }

    maximize(id) {
      const record = this.windows.get(id); if (!record) return;
      if (!record.maximized) {
        record.restore = { left: record.node.style.left, top: record.node.style.top, width: record.node.style.width, height: record.node.style.height };
        Object.assign(record.node.style, { left: '0', top: '0', width: '100%', height: '100%' });
        record.node.classList.add('is-maximized'); record.maximized = true;
      } else {
        Object.assign(record.node.style, record.restore || {});
        record.node.classList.remove('is-maximized'); record.maximized = false;
      }
      this.focus(id);
    }

    close(id) {
      const record = this.windows.get(id); if (!record) return;
      const appKey = record.options.appKey || id;
      record.node.remove(); this.windows.delete(id); this.sync(appKey);
      emptyState.hidden = this.windows.size > 0;
    }

    sync(appKey) {
      const related = [...this.windows.values()].filter(item => (item.options.appKey || item.options.id) === appKey);
      document.querySelectorAll(`[data-os-app="${CSS.escape(appKey)}"]`).forEach(button => {
        button.classList.toggle('is-open', related.length > 0);
        button.classList.toggle('is-minimized', related.length > 0 && related.every(item => item.minimized));
      });
    }
  }

  const windows = new WindowManager();
  const apps = {
    queue: { id: 'queue', appKey: 'queue', title: 'Queue', icon: '📨', subtitle: 'Open customer work', url: `${basePath}/work-centre?view=all`, width: 1080, height: 670 },
    tasks: { id: 'tasks', appKey: 'tasks', title: 'Tasks', icon: '✔', subtitle: 'My active work', url: `${basePath}/tasks`, width: 1000, height: 650 },
    messages: { id: 'messages', appKey: 'messages', title: 'Messages', icon: '💬', subtitle: 'Staff communication', url: `${basePath}/tasks?view=active`, width: 960, height: 640 },
    notifications: { id: 'notifications', appKey: 'notifications', title: 'Notifications', icon: '🔔', subtitle: 'Unread work', url: `${basePath}/tasks?view=active`, width: 900, height: 610 },
    reports: { id: 'reports', appKey: 'reports', title: 'Reports', icon: '▦', subtitle: 'Management information', url: config.isManagement ? `${basePath}/reports?type=birthdays` : `${basePath}/tasks`, width: 1100, height: 690 }
  };

  function settings() {
    windows.open({ id: 'settings', appKey: 'settings', title: 'Settings', icon: '⚙', width: 760, height: 570, render(body) {
      const suppliers = readSuppliers();
      body.innerHTML = `<div class="t2m-os-native"><h2>Talk2Me OS Settings</h2><p>Configure secure supplier portal links for this workstation.</p><form class="t2m-os-settings-form" id="supplier-settings">${Object.entries(suppliers).map(([key, item]) => `<div class="t2m-os-settings-row"><label for="supplier-${key}">${item.icon} ${esc(item.name)}</label><input id="supplier-${key}" name="${key}" type="url" placeholder="https://..." value="${esc(item.url)}"></div>`).join('')}<button class="t2m-os-primary-button" type="submit">Save supplier links</button></form></div>`;
      body.querySelector('form').onsubmit = event => {
        event.preventDefault(); const data = new FormData(event.currentTarget); const next = readSuppliers();
        for (const key of Object.keys(next)) {
          const url = String(data.get(key) || '').trim();
          if (url && !/^https:\/\//i.test(url)) return toast('Link not saved', `${next[key].name} must start with https://`);
          next[key].url = url;
        }
        localStorage.setItem(supplierKey, JSON.stringify(next)); toast('Settings saved', 'Supplier links were saved on this workstation.');
      };
    }});
  }

  function native(app) {
    if (app === 'settings') return settings();
    if (app === 'notes') return windows.open({ id: 'notes', appKey: 'notes', title: 'Notes', icon: '📝', width: 680, height: 540, render(body) {
      body.innerHTML = '<div class="t2m-os-native t2m-os-notes"><div><h2>My Notes</h2><p>Private notes saved in this browser.</p></div><textarea aria-label="My notes" placeholder="Write a note…"></textarea><small>Saved locally</small></div>';
      const area = body.querySelector('textarea'); area.value = localStorage.getItem(notesKey) || '';
      area.oninput = () => localStorage.setItem(notesKey, area.value);
    }});
    if (app === 'calendar') return windows.open({ id: 'calendar', appKey: 'calendar', title: 'Calendar', icon: '📅', width: 780, height: 560, render(body) { body.innerHTML = '<div class="t2m-os-native t2m-os-placeholder"><span>📅</span><h2>Calendar</h2><p>The OS window is ready. Calendar data will be connected in the next module.</p></div>'; }});
    if (app === 'calculator') return windows.open({ id: 'calculator', appKey: 'calculator', title: 'Calculator', icon: '⌗', width: 430, height: 570, render(body) {
      const keys = ['C','(',')','÷','7','8','9','×','4','5','6','−','1','2','3','+','0','.','⌫','='];
      body.innerHTML = `<div class="t2m-os-native"><div class="t2m-os-calculator"><input class="t2m-os-calculator-display" aria-label="Calculator display"><div class="t2m-os-calculator-grid">${keys.map(key => `<button type="button" data-key="${key}">${key}</button>`).join('')}</div></div></div>`;
      const display = body.querySelector('input'); body.onclick = event => { const button = event.target.closest('[data-key]'); if (!button) return; const key = button.dataset.key;
        if (key === 'C') display.value = ''; else if (key === '⌫') display.value = display.value.slice(0, -1); else if (key === '=') {
          const expression = display.value.replaceAll('×','*').replaceAll('÷','/').replaceAll('−','-');
          if (!/^[0-9+\-*/().%\s]+$/.test(expression)) return toast('Calculator', 'Unsupported expression.');
          try { const answer = Function(`"use strict";return (${expression})`)(); display.value = Number.isFinite(answer) ? String(answer) : 'Error'; } catch (_) { display.value = 'Error'; }
        } else display.value += key;
      };
    }});
  }

  function openApp(app) { apps[app] ? windows.open(apps[app]) : native(app); }

  function openSupplier(key) {
    const supplier = readSuppliers()[key];
    if (!supplier?.url) { settings(); return toast(`${supplier?.name || 'Supplier'} not configured`, 'Add the secure portal URL in Settings.'); }
    windows.open({ id: `supplier:${key}`, title: supplier.name, icon: supplier.icon, subtitle: 'External supplier system', width: 1120, height: 690, render(body) {
      body.innerHTML = `<div style="height:100%;display:grid;grid-template-rows:48px 1fr"><div class="t2m-os-supplier-toolbar"><span>${esc(supplier.url)}</span><button class="t2m-os-secondary-button" type="button">Open separately ↗</button></div><iframe title="${esc(supplier.name)}" src="${esc(supplier.url)}"></iframe></div>`;
      body.querySelector('button').onclick = () => window.open(supplier.url, `talk2me-${key}`, 'noopener,noreferrer');
    }});
  }

  document.addEventListener('click', event => {
    const app = event.target.closest('[data-os-app]'); if (app) openApp(app.dataset.osApp);
    const supplier = event.target.closest('[data-os-supplier]'); if (supplier) openSupplier(supplier.dataset.osSupplier);
    if (event.target.closest('[data-os-launch="customer"]')) searchInput.focus();
    if (!event.target.closest('.t2m-os-search')) closeSearch();
  });

  let results = [], timer, controller;
  function closeSearch() { searchResults.hidden = true; searchResults.innerHTML = ''; searchInput.setAttribute('aria-expanded', 'false'); }
  function openCustomer(row) {
    if (!row) return; const fixed = row.record_type === 'fixed';
    windows.open({ id: `${fixed ? 'fixed' : 'customer'}:${row.id}`, appKey: 'customer', title: row.client_name || 'Customer', icon: fixed ? '☎' : '👤', subtitle: [row.account_number, row.cell_number].filter(Boolean).join(' · ') || 'Customer record', url: row.url, width: 1120, height: 700 });
    searchInput.value = ''; closeSearch();
  }
  async function search(query) {
    controller?.abort(); controller = new AbortController(); searchResults.hidden = false; searchResults.innerHTML = '<div class="t2m-os-search-message">Searching…</div>';
    try {
      const response = await fetch(`${basePath}/search/all?q=${encodeURIComponent(query)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Search failed'); results = await response.json(); searchInput.setAttribute('aria-expanded', 'true');
      searchResults.innerHTML = results.length ? results.map((row, index) => `<button type="button" class="t2m-os-search-result" data-result="${index}"><span>${row.record_type === 'fixed' ? '☎' : '👤'}</span><span class="t2m-os-search-result-copy"><strong>${esc(row.client_name || 'Unnamed customer')}</strong><span>${esc([row.cell_number || row.branch_name, row.account_number, row.solution_id || row.handset].filter(Boolean).join(' · '))}</span></span><small>${row.record_type === 'fixed' ? 'FIXED' : 'MOBILE'}</small></button>`).join('') : `<div class="t2m-os-search-message"><strong>No customer found</strong><br>${esc(query)}</div>`;
      if (results.length === 1 && query.replace(/\D/g, '').length >= 10) openCustomer(results[0]);
    } catch (error) { if (error.name !== 'AbortError') searchResults.innerHTML = '<div class="t2m-os-search-message">Search temporarily unavailable.</div>'; }
  }
  searchInput.oninput = () => { clearTimeout(timer); const value = searchInput.value.trim(); if (value.length < 2) return closeSearch(); timer = setTimeout(() => search(value), 160); };
  searchInput.onkeydown = event => { if (event.key === 'Escape') closeSearch(); if (event.key === 'Enter' && results.length) { event.preventDefault(); openCustomer(results[0]); } };
  searchResults.onclick = event => { const node = event.target.closest('[data-result]'); if (node) openCustomer(results[Number(node.dataset.result)]); };
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); } });

  function badge(name, value) { document.querySelectorAll(`[data-badge="${CSS.escape(name)}"]`).forEach(node => { node.textContent = String(value || 0); node.hidden = !value; }); }
  async function refresh() {
    try {
      const response = await fetch(`${basePath}/api/os/status`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return; const status = (await response.json()).status || {};
      badge('queue', status.queueCount); badge('tasks', status.taskCount); badge('messages', status.unreadMessageCount); badge('notifications', status.unreadMessageCount);
    } catch (_) {}
  }
  setInterval(refresh, 15000);
  window.Talk2MeOS = { windows, openApp, openSupplier, refresh };
})();
