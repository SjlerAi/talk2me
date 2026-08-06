(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');
  const layer = document.getElementById('os-window-layer');
  const searchInput = document.getElementById('os-global-search');
  const searchResults = document.getElementById('os-search-results');
  const toastRegion = document.getElementById('os-toast-region');
  const taskbarItems = document.getElementById('os-taskbar-items');
  const shell = document.getElementById('talk2me-os');
  const sidebarToggle = document.getElementById('os-sidebar-toggle');
  const windowGeometry = window.Talk2MeWindowGeometry;
  const windowInset = windowGeometry.DEFAULT_INSET;
  const supplierKey = 'talk2me-os-v6-suppliers';
  const notesKey = `talk2me-os-v6-notes-${config.user?.id || 'user'}`;
  const sidebarPreferenceKey = `talk2me-os-sidebar-collapsed-${config.user?.id || 'user'}`;

  function renderSidebar(state) {
    shell.classList.toggle('is-sidebar-collapsed', state.collapsed);
    shell.classList.toggle('has-work-windows', state.hasOpenWindows);
    shell.classList.toggle('has-maximized-window', state.maximized);
    sidebarToggle.setAttribute('aria-expanded', String(!state.collapsed));
    sidebarToggle.setAttribute('aria-label', state.collapsed ? 'Expand application sidebar' : 'Collapse application sidebar');
    sidebarToggle.title = state.collapsed ? 'Expand application sidebar' : 'Collapse application sidebar';
    sidebarToggle.querySelector('span').textContent = state.collapsed ? '»' : '«';
    sidebarToggle.querySelector('strong').textContent = state.collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  }

  const sidebarState = new window.Talk2MeSidebarState.SidebarState({
    storage: window.localStorage,
    preferenceKey: sidebarPreferenceKey,
    onChange: renderSidebar
  });

  const suppliersDefault = {
    vodacom: { name: 'Vodacom', icon: 'V', url: '' },
    mtn: { name: 'MTN', icon: 'MTN', url: '' },
    telkom: { name: 'Telkom', icon: 'T', url: '' },
    sage: { name: 'Sage', icon: 'S', url: '' }
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
      this.fitFrame = 0;
      this.onViewportResize = () => this.scheduleFit();
      window.addEventListener('resize', this.onViewportResize);
    }

    syncSidebar() {
      sidebarState.updateWindowCounts({
        internal: this.windows.size,
        maximized: [...this.windows.values()].filter(record => record.maximized).length
      });
    }

    readLayer() {
      return windowGeometry.layerSize(layer.getBoundingClientRect());
    }

    readRect(record) {
      return {
        left: record.node.offsetLeft,
        top: record.node.offsetTop,
        width: record.node.offsetWidth,
        height: record.node.offsetHeight
      };
    }

    applyRect(record, rect) {
      Object.assign(record.node.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        '--t2m-window-left': `${rect.left}px`,
        '--t2m-window-top': `${rect.top}px`,
        '--t2m-window-width': `${rect.width}px`,
        '--t2m-window-height': `${rect.height}px`
      });
    }

    fitRecord(record, area = this.readLayer()) {
      if (record.minimized) return;
      if (record.maximized) {
        if (record.restore) record.restore = windowGeometry.clampFloatingRect(record.restore, area, windowInset);
        this.applyRect(record, windowGeometry.maximizedRect(area));
        return;
      }
      const target = record.largeRouteWindow && !record.userAdjusted
        ? windowGeometry.defaultFloatingRect(area, windowInset)
        : windowGeometry.clampFloatingRect(this.readRect(record), area, windowInset);
      this.applyRect(record, target);
    }

    fitToArea() {
      const area = this.readLayer();
      for (const record of this.windows.values()) this.fitRecord(record, area);
    }

    scheduleFit() {
      if (this.fitFrame) return;
      this.fitFrame = window.requestAnimationFrame(() => {
        this.fitFrame = 0;
        this.fitToArea();
      });
    }

    open(options) {
      const existing = this.windows.get(options.id);
      if (existing) {
        this.restore(options.id);
        this.focus(options.id);
        return existing;
      }

      const area = this.readLayer();
      const offset = (this.cascade++ % 7) * 24;
      const node = document.createElement('section');
      node.className = 't2m-os-window';
      node.dataset.windowId = options.id;
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-label', options.title);
      node.innerHTML = `<header class="t2m-os-window-titlebar" data-drag>
        <span class="t2m-os-window-app-icon">${esc(options.icon || '▣')}</span>
        <span class="t2m-os-window-title"><strong>${esc(options.title)}</strong><small>${esc(options.subtitle || 'Talk2Me OS')}</small></span>
        <span class="t2m-os-window-controls">
          <button type="button" data-action="minimize" aria-label="Minimize" title="Minimize">—</button>
          <button type="button" data-action="maximize" aria-label="Maximize" title="Maximize">□</button>
          <button type="button" data-action="close" aria-label="Close" title="Close">×</button>
        </span></header><div class="t2m-os-window-body"></div><span class="t2m-os-window-resize" data-resize></span>`;
      layer.appendChild(node);
      const initialRect = options.url
        ? windowGeometry.defaultFloatingRect(area, windowInset)
        : windowGeometry.clampFloatingRect({
          left: 36 + offset,
          top: 22 + offset,
          width: options.width || 900,
          height: options.height || 620
        }, area, windowInset);
      const record = {
        options,
        node,
        minimized: false,
        maximized: false,
        restore: null,
        largeRouteWindow: Boolean(options.url),
        userAdjusted: false
      };
      this.applyRect(record, initialRect);
      this.windows.set(options.id, record);
      this.syncSidebar();
      this.install(record);
      this.render(record);
      this.focus(options.id);
      this.sync(options.appKey || options.id);
      this.renderTaskbar();
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
          record.userAdjusted = true;
          const target = windowGeometry.clampFloatingRect({
            ...this.readRect(record),
            left: left + e.clientX - x,
            top: top + e.clientY - y
          }, this.readLayer(), windowInset);
          this.applyRect(record, target);
        };
        const done = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', done);
          handle.removeEventListener('pointercancel', done);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', done);
        handle.addEventListener('pointercancel', done);
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
          record.userAdjusted = true;
          const target = windowGeometry.clampFloatingRect({
            ...this.readRect(record),
            width: width + e.clientX - x,
            height: height + e.clientY - y
          }, this.readLayer(), windowInset);
          this.applyRect(record, target);
        };
        const done = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', done);
          handle.removeEventListener('pointercancel', done);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', done);
        handle.addEventListener('pointercancel', done);
      });
    }

    focus(id) {
      const record = this.windows.get(id); if (!record) return;
      this.windows.forEach(item => item.node.classList.remove('is-focused'));
      record.node.classList.add('is-focused');
      record.node.style.zIndex = String(++this.z);
      this.renderTaskbar(id);
    }

    minimize(id) {
      const record = this.windows.get(id); if (!record) return;
      record.minimized = true; record.node.classList.add('is-minimized');
      this.sync(record.options.appKey || id);
      this.renderTaskbar();
    }

    restore(id) {
      const record = this.windows.get(id); if (!record) return;
      record.minimized = false; record.node.classList.remove('is-minimized');
      this.fitRecord(record);
      this.sync(record.options.appKey || id);
      this.focus(id);
    }

    maximize(id) {
      const record = this.windows.get(id); if (!record) return;
      const button = record.node.querySelector('[data-action="maximize"]');
      if (!record.maximized) {
        const area = this.readLayer();
        record.restore = windowGeometry.clampFloatingRect(this.readRect(record), area, windowInset);
        this.applyRect(record, windowGeometry.maximizedRect(area));
        record.node.classList.add('is-maximized'); record.maximized = true;
        button.setAttribute('aria-label', 'Restore');
        button.title = 'Restore';
        button.textContent = '❐';
      } else {
        record.node.classList.remove('is-maximized'); record.maximized = false;
        this.applyRect(record, windowGeometry.clampFloatingRect(record.restore || this.readRect(record), this.readLayer(), windowInset));
        button.setAttribute('aria-label', 'Maximize');
        button.title = 'Maximize';
        button.textContent = '□';
      }
      this.syncSidebar();
      this.focus(id);
    }

    close(id) {
      const record = this.windows.get(id); if (!record) return;
      const appKey = record.options.appKey || id;
      record.node.remove(); this.windows.delete(id); this.sync(appKey);
      this.syncSidebar();
      this.renderTaskbar();
    }

    sync(appKey) {
      const related = [...this.windows.values()].filter(item => (item.options.appKey || item.options.id) === appKey);
      document.querySelectorAll(`[data-os-app="${CSS.escape(appKey)}"]`).forEach(button => {
        button.classList.toggle('is-open', related.length > 0);
        button.classList.toggle('is-minimized', related.length > 0 && related.every(item => item.minimized));
      });
    }

    renderTaskbar(activeId) {
      if (!taskbarItems) return;
      taskbarItems.innerHTML = [...this.windows.entries()].map(([id, record]) => `<button type="button" class="t2m-os-taskbar-item ${record.minimized ? 'is-minimized' : ''} ${activeId === id ? 'is-active' : ''}" data-taskbar-window="${esc(id)}"><b>${esc(record.options.icon || '▣')}</b><span>${esc(record.options.title)}</span></button>`).join('');
    }
  }

  const windows = new WindowManager();
  const apps = {
    queue: { id: 'queue', appKey: 'queue', title: 'Queue', icon: '▤', subtitle: 'Open customer work', url: `${basePath}/work-centre?view=all`, width: 1080, height: 670 },
    tasks: { id: 'tasks', appKey: 'tasks', title: 'Tasks', icon: '✓', subtitle: 'My active work', url: `${basePath}/tasks`, width: 1000, height: 650 },
    messages: { id: 'messages', appKey: 'messages', title: 'Messages', icon: '●', subtitle: 'Staff communication', url: `${basePath}/tasks?view=active`, width: 960, height: 640 },
    notifications: { id: 'notifications', appKey: 'notifications', title: 'Notifications', icon: '🔔', subtitle: 'New and overdue work', url: `${basePath}/tasks?view=active`, width: 900, height: 610 },
    reports: { id: 'reports', appKey: 'reports', title: 'Reports', icon: '▦', subtitle: 'Management information', url: config.isManagement ? `${basePath}/reports?type=birthdays` : `${basePath}/tasks`, width: 1100, height: 690 }
  };

  function settings() {
    windows.open({ id: 'settings', appKey: 'settings', title: 'Settings', icon: '⚙', width: 760, height: 570, render(body) {
      const suppliers = readSuppliers();
      body.innerHTML = `<div class="t2m-os-native"><h2>Talk2Me OS Settings</h2><p>Configure secure supplier portal links for this workstation.</p><form class="t2m-os-settings-form" id="supplier-settings">${Object.entries(suppliers).map(([key, item]) => `<div class="t2m-os-settings-row"><label for="supplier-${key}">${esc(item.name)}</label><input id="supplier-${key}" name="${key}" type="url" placeholder="https://..." value="${esc(item.url)}"></div>`).join('')}<button class="t2m-os-primary-button" type="submit">Save supplier links</button></form></div>`;
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
    if (app === 'help') return windows.open({ id: 'help', appKey: 'help', title: 'Help Centre', icon: '?', width: 760, height: 590, render(body) {
      body.innerHTML = `<div class="t2m-os-native"><h2>Talk2Me Help Centre</h2><p>Use this area for the operating manual and role-specific guidance.</p><ul class="t2m-os-help-list"><li><strong>Customer search</strong><br>Find mobile and fixed customers from the universal search bar.</li><li><strong>Supplier systems</strong><br>Open Vodacom, MTN, Telkom or Sage from the top launcher.</li><li><strong>Tasks and messages</strong><br>Use the left menu to manage assigned work and staff communication.</li><li><strong>Windows</strong><br>Move, resize, minimise, restore or maximise any application window.</li></ul></div>`;
    }});
    if (app === 'notes') return windows.open({ id: 'notes', appKey: 'notes', title: 'Notes', icon: '✎', width: 680, height: 540, render(body) {
      body.innerHTML = '<div class="t2m-os-native t2m-os-notes"><div><h2>My Notes</h2><p>Private notes saved in this browser.</p></div><textarea aria-label="My notes" placeholder="Write a note…"></textarea><small>Saved locally</small></div>';
      const area = body.querySelector('textarea'); area.value = localStorage.getItem(notesKey) || '';
      area.oninput = () => localStorage.setItem(notesKey, area.value);
    }});
    if (app === 'calendar') return windows.open({ id: 'calendar', appKey: 'calendar', title: 'Calendar', icon: '□', width: 780, height: 560, render(body) { body.innerHTML = '<div class="t2m-os-native t2m-os-placeholder"><span>□</span><h2>Calendar</h2><p>The calendar module will be connected in a later phase.</p></div>'; }});
    if (app === 'calculator') return windows.open({ id: 'calculator', appKey: 'calculator', title: 'Calculator', icon: '#', width: 430, height: 570, render(body) {
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
  function openRoute(url, title, icon = '▣') {
    windows.open({ id: `route:${url}`, appKey: 'route', title, icon, subtitle: 'Talk2Me application', url, width: 1100, height: 690 });
  }
  function openCustomers() {
    openRoute(`${basePath}/backoffice/clients`, 'Customer Centre', 'C');
  }

  function openSupplier(key) {
    const supplier = readSuppliers()[key];
    if (!supplier?.url) { settings(); return toast(`${supplier?.name || 'Supplier'} not configured`, 'Add the secure portal URL in Settings.'); }
    windows.open({ id: `supplier:${key}`, appKey: `supplier:${key}`, title: supplier.name, icon: supplier.icon, subtitle: 'External supplier system', width: 1120, height: 690, render(body) {
      body.innerHTML = `<div style="height:100%;display:grid;grid-template-rows:48px 1fr"><div class="t2m-os-supplier-toolbar"><span>${esc(supplier.url)}</span><button class="t2m-os-secondary-button" type="button">Open separately ↗</button></div><iframe title="${esc(supplier.name)}" src="${esc(supplier.url)}"></iframe></div>`;
      body.querySelector('button').onclick = () => window.open(supplier.url, `talk2me-${key}`, 'noopener,noreferrer');
    }});
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#os-sidebar-toggle')) sidebarState.toggleManually();
    const app = event.target.closest('[data-os-app]'); if (app) openApp(app.dataset.osApp);
    const supplier = event.target.closest('[data-os-supplier]'); if (supplier) openSupplier(supplier.dataset.osSupplier);
    if (event.target.closest('[data-os-launch="customers"]')) openCustomers();
    const route = event.target.closest('[data-os-route]'); if (route) openRoute(route.dataset.osRoute, route.dataset.routeTitle || 'Talk2Me', route.dataset.routeIcon || '▣');
    const taskbar = event.target.closest('[data-taskbar-window]'); if (taskbar) {
      const id = taskbar.dataset.taskbarWindow; const record = windows.windows.get(id);
      if (record?.minimized) windows.restore(id); else windows.focus(id);
    }
    const collapse = event.target.closest('[data-widget-collapse]'); if (collapse) {
      const widget = collapse.closest('.t2m-os-desk-widget'); widget.classList.toggle('is-collapsed'); collapse.textContent = widget.classList.contains('is-collapsed') ? '+' : '−';
    }
    if (!event.target.closest('.t2m-os-search')) closeSearch();
  });

  let results = [], timer, controller;
  function closeSearch() { searchResults.hidden = true; searchResults.innerHTML = ''; searchInput.setAttribute('aria-expanded', 'false'); }
  function openCustomer(row) {
    if (!row) return; const fixed = row.record_type === 'fixed';
    windows.open({ id: `${fixed ? 'fixed' : 'customer'}:${row.id}`, appKey: 'customer', title: row.client_name || 'Customer', icon: fixed ? 'T' : 'C', subtitle: [row.account_number, row.cell_number].filter(Boolean).join(' · ') || 'Customer record', url: row.url, width: 1120, height: 700 });
    searchInput.value = ''; closeSearch();
  }
  async function search(query) {
    controller?.abort(); controller = new AbortController(); searchResults.hidden = false; searchResults.innerHTML = '<div class="t2m-os-search-message">Searching…</div>';
    try {
      const response = await fetch(`${basePath}/search/all?q=${encodeURIComponent(query)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Search failed'); results = await response.json(); searchInput.setAttribute('aria-expanded', 'true');
      searchResults.innerHTML = results.length ? results.map((row, index) => `<button type="button" class="t2m-os-search-result" data-result="${index}"><span>${row.record_type === 'fixed' ? 'T' : 'C'}</span><span class="t2m-os-search-result-copy"><strong>${esc(row.client_name || 'Unnamed customer')}</strong><span>${esc([row.cell_number || row.branch_name, row.account_number, row.solution_id || row.handset].filter(Boolean).join(' · '))}</span></span><small>${row.record_type === 'fixed' ? 'FIXED' : 'MOBILE'}</small></button>`).join('') : `<div class="t2m-os-search-message"><strong>No customer found</strong><br>${esc(query)}</div>`;
      if (results.length === 1 && query.replace(/\D/g, '').length >= 10) openCustomer(results[0]);
    } catch (error) { if (error.name !== 'AbortError') searchResults.innerHTML = '<div class="t2m-os-search-message">Search temporarily unavailable.</div>'; }
  }
  searchInput.oninput = () => { clearTimeout(timer); const value = searchInput.value.trim(); if (value.length < 2) return closeSearch(); timer = setTimeout(() => search(value), 160); };
  searchInput.onkeydown = event => { if (event.key === 'Escape') closeSearch(); if (event.key === 'Enter' && results.length) { event.preventDefault(); openCustomer(results[0]); } };
  searchResults.onclick = event => { const node = event.target.closest('[data-result]'); if (node) openCustomer(results[Number(node.dataset.result)]); };
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); } });

  function badge(name, value) { document.querySelectorAll(`[data-badge="${CSS.escape(name)}"]`).forEach(node => { node.textContent = String(value || 0); node.hidden = !value; }); }
  function statusValue(name, value) { document.querySelectorAll(`[data-status="${CSS.escape(name)}"]`).forEach(node => { node.textContent = String(value || 0); }); }
  async function refresh() {
    try {
      const response = await fetch(`${basePath}/api/os/status`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return; const status = (await response.json()).status || {};
      badge('queue', status.queueCount); badge('tasks', status.taskCount); badge('messages', status.unreadMessageCount); badge('notifications', status.unreadMessageCount);
      ['overdueTaskCount','dueTodayTaskCount','followUpTodayCount','unreadMessageCount','birthdaysTodayCount','upgradesDueCount','callbacksTodayCount','newProspectsCount'].forEach(name => statusValue(name, status[name]));
    } catch (_) {}
  }
  setInterval(refresh, 15000);
  window.Talk2MeOS = {
    windows, openApp, openSupplier, openRoute, refresh, sidebarState,
    setExternalWindowCount(count) { sidebarState.updateWindowCounts({ external: count }); }
  };
})();
