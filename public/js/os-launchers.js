(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode || !window.Talk2MeOS?.windows) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const launchers = Array.isArray(config.launchers) ? config.launchers : [];
  const byKey = Object.fromEntries(launchers.map(item => [item.slot_key, item]));
  const windows = window.Talk2MeOS.windows;
  const taskbarItems = document.getElementById('os-taskbar-items');
  const externalTabs = new Map();
  let activeExternalKey = null;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function toast(title, message) {
    const region = document.getElementById('os-toast-region');
    if (!region) return;
    const node = document.createElement('div');
    node.className = 't2m-os-toast';
    node.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    region.appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  function renderExternalTaskbar() {
    if (!taskbarItems) return;
    taskbarItems.querySelectorAll('[data-external-task]').forEach(node => node.remove());

    for (const [key, record] of externalTabs.entries()) {
      if (!record.tab || record.tab.closed) continue;
      const wrapper = document.createElement('span');
      wrapper.dataset.externalTask = key;
      wrapper.style.cssText = 'height:34px;display:flex;align-items:center;border:1px solid rgba(0,114,188,.38);border-radius:8px;background:#fff;overflow:hidden;box-shadow:0 2px 8px rgba(32,40,50,.08)';
      wrapper.innerHTML = `<button type="button" data-external-switch="${esc(key)}" title="Switch to ${esc(record.item.display_name)} tab" aria-label="Switch to ${esc(record.item.display_name)} tab" style="cursor:pointer;height:32px;display:flex;align-items:center;gap:7px;padding:0 10px;border:0;background:${activeExternalKey === key ? '#dff1fc' : '#fff'};color:#263746;font-weight:800"><b>${esc(record.item.icon_text || record.item.display_name.slice(0, 1))}</b><span>${esc(record.item.display_name)}</span><small style="color:#0072bc;font-weight:800">tab</small></button><button type="button" data-external-close="${esc(key)}" title="Close ${esc(record.item.display_name)} tab" aria-label="Close ${esc(record.item.display_name)} tab" style="cursor:pointer;width:32px;height:32px;border:0;border-left:1px solid #d7e0e8;background:#fff;color:#697684;font-size:18px">×</button>`;
      taskbarItems.appendChild(wrapper);
    }
  }

  const originalRenderTaskbar = windows.renderTaskbar.bind(windows);
  windows.renderTaskbar = function renderTaskbarWithExternal(activeId) {
    originalRenderTaskbar(activeId);
    renderExternalTaskbar();
  };

  function tabName(key) {
    return `talk2me-system-${String(key).replace(/[^a-z0-9_-]/gi, '-')}`;
  }

  function rememberTab(item, key, tab) {
    externalTabs.set(key, { item, tab, name: tabName(key) });
    activeExternalKey = key;
    renderExternalTaskbar();
  }

  function openNewTab(item, key) {
    const name = tabName(key);
    const tab = window.open(item.portal_url, name);
    if (!tab) {
      toast(`${item.display_name} could not open`, 'Allow pop-ups and redirects for this Talk2Me site, then try again.');
      return null;
    }

    rememberTab(item, key, tab);
    try { tab.focus(); } catch (_) {}
    return tab;
  }

  function switchToTab(key) {
    const record = externalTabs.get(key);
    if (!record || !record.tab || record.tab.closed) {
      externalTabs.delete(key);
      renderExternalTaskbar();
      const item = byKey[key];
      if (item) openNewTab(item, key);
      return;
    }

    activeExternalKey = key;
    renderExternalTaskbar();

    let target = record.tab;
    try {
      const namedTab = window.open('', record.name);
      if (namedTab) {
        target = namedTab;
        record.tab = namedTab;
      }
    } catch (_) {}

    try { target.focus(); } catch (_) {}
    setTimeout(() => {
      try { target.focus(); } catch (_) {}
    }, 50);
  }

  function closeExternal(key) {
    const record = externalTabs.get(key);
    if (!record) return;
    const confirmed = window.confirm(`Are you sure you want to close ${record.item.display_name} and return to the Talk2Me workspace?`);
    if (!confirmed) return;

    try {
      if (record.tab && !record.tab.closed) record.tab.close();
    } catch (_) {}

    externalTabs.delete(key);
    if (activeExternalKey === key) activeExternalKey = null;
    renderExternalTaskbar();
    try { window.focus(); } catch (_) {}
  }

  function openExternal(item, key) {
    const existing = externalTabs.get(key);
    if (existing?.tab && !existing.tab.closed) {
      switchToTab(key);
      return;
    }
    openNewTab(item, key);
  }

  function openManagedLauncher(key) {
    const item = byKey[key];
    if (!item) return;
    if (!item.portal_url) {
      toast(`${item.display_name} is not configured`, 'The owner must add its secure URL in Administration > Workstation Launchers.');
      return;
    }

    if (item.open_mode !== 'embedded') {
      openExternal(item, key);
      return;
    }

    windows.open({
      id: `managed-launcher:${key}`,
      appKey: `managed-launcher:${key}`,
      title: item.display_name,
      icon: item.icon_text || item.display_name.slice(0, 1),
      subtitle: 'External business system',
      width: 1120,
      height: 690,
      render(body) {
        body.innerHTML = `<div style="height:100%;display:grid;grid-template-rows:auto 1fr"><div class="t2m-os-supplier-toolbar"><div><strong>${esc(item.display_name)}</strong><small style="display:block">This site may block embedded access. Open it in a browser tab when it does.</small></div><button class="t2m-os-secondary-button" type="button">Open browser tab ↗</button></div><iframe title="${esc(item.display_name)}" src="${esc(item.portal_url)}"></iframe></div>`;
        body.querySelector('button').onclick = () => openExternal(item, key);
      }
    });
  }

  document.addEventListener('click', event => {
    const switchButton = event.target.closest('[data-external-switch]');
    if (switchButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      switchToTab(switchButton.dataset.externalSwitch);
      return;
    }

    const closeButton = event.target.closest('[data-external-close]');
    if (closeButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeExternal(closeButton.dataset.externalClose);
      return;
    }

    const button = event.target.closest('[data-os-managed-launcher]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openManagedLauncher(button.dataset.osManagedLauncher);
  }, true);

  setInterval(() => {
    let changed = false;
    for (const [key, record] of externalTabs.entries()) {
      if (!record.tab || record.tab.closed) {
        externalTabs.delete(key);
        if (activeExternalKey === key) activeExternalKey = null;
        changed = true;
      }
    }
    if (changed) renderExternalTaskbar();
  }, 1000);

  renderExternalTaskbar();
})();
