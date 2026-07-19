(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode || !window.Talk2MeOS?.windows) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const launchers = Array.isArray(config.launchers) ? config.launchers : [];
  const byKey = Object.fromEntries(launchers.map(item => [item.slot_key, item]));
  const windows = window.Talk2MeOS.windows;
  const taskbarItems = document.getElementById('os-taskbar-items');
  const externalWindows = new Map();
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

  function popupGeometry() {
    const availableWidth = Number(window.screen?.availWidth || window.outerWidth || 1366);
    const availableHeight = Number(window.screen?.availHeight || window.outerHeight || 768);
    const width = Math.max(760, Math.min(1180, availableWidth - 180));
    const height = Math.max(560, Math.min(760, availableHeight - 140));
    const browserLeft = Number(window.screenX ?? window.screenLeft ?? 0);
    const browserTop = Number(window.screenY ?? window.screenTop ?? 0);
    const browserWidth = Number(window.outerWidth || availableWidth);
    const browserHeight = Number(window.outerHeight || availableHeight);
    const left = Math.max(0, Math.round(browserLeft + (browserWidth - width) / 2));
    const top = Math.max(0, Math.round(browserTop + (browserHeight - height) / 2));
    return { width, height, left, top };
  }

  function renderExternalTaskbar() {
    if (!taskbarItems) return;
    taskbarItems.querySelectorAll('[data-external-task]').forEach(node => node.remove());

    for (const [key, record] of externalWindows.entries()) {
      if (!record.child || record.child.closed) continue;
      const wrapper = document.createElement('span');
      wrapper.dataset.externalTask = key;
      wrapper.style.cssText = 'height:34px;display:flex;align-items:center;border:1px solid rgba(0,114,188,.28);border-radius:8px;background:#fff;overflow:hidden;box-shadow:0 2px 8px rgba(32,40,50,.08)';
      wrapper.innerHTML = `<button type="button" data-external-focus="${esc(key)}" title="Bring ${esc(record.item.display_name)} back to the foreground" style="height:32px;display:flex;align-items:center;gap:7px;padding:0 10px;border:0;background:${activeExternalKey === key ? '#e7f3fb' : '#fff'};color:#263746;font-weight:800"><b>${esc(record.item.icon_text || record.item.display_name.slice(0, 1))}</b><span>${esc(record.item.display_name)}</span><small style="color:#697684">external</small></button><button type="button" data-external-close="${esc(key)}" title="Close ${esc(record.item.display_name)}" aria-label="Close ${esc(record.item.display_name)}" style="width:32px;height:32px;border:0;border-left:1px solid #d7e0e8;background:#fff;color:#697684;font-size:18px">×</button>`;
      taskbarItems.appendChild(wrapper);
    }
  }

  const originalRenderTaskbar = windows.renderTaskbar.bind(windows);
  windows.renderTaskbar = function renderTaskbarWithExternal(activeId) {
    originalRenderTaskbar(activeId);
    renderExternalTaskbar();
  };

  function rememberExternal(item, key, child) {
    externalWindows.set(key, { item, child });
    activeExternalKey = key;
    renderExternalTaskbar();
  }

  function focusExternal(key) {
    const record = externalWindows.get(key);
    if (!record || !record.child || record.child.closed) {
      externalWindows.delete(key);
      renderExternalTaskbar();
      const item = byKey[key];
      if (item) openSeparate(item, key);
      return;
    }
    activeExternalKey = key;
    renderExternalTaskbar();
    try { record.child.focus(); } catch (_) {}
  }

  function closeExternal(key) {
    const record = externalWindows.get(key);
    if (!record) return;
    const confirmed = window.confirm(`Are you sure you want to close ${record.item.display_name} and return to the Talk2Me workspace?`);
    if (!confirmed) return;
    try { if (record.child && !record.child.closed) record.child.close(); } catch (_) {}
    externalWindows.delete(key);
    if (activeExternalKey === key) activeExternalKey = null;
    renderExternalTaskbar();
    try { window.focus(); } catch (_) {}
  }

  function openSeparate(item, key) {
    const existing = externalWindows.get(key);
    if (existing?.child && !existing.child.closed) {
      focusExternal(key);
      return;
    }

    const size = popupGeometry();
    const features = [
      'popup=yes',
      `width=${size.width}`,
      `height=${size.height}`,
      `left=${size.left}`,
      `top=${size.top}`,
      'resizable=yes',
      'scrollbars=yes',
      'status=yes'
    ].join(',');

    const child = window.open('about:blank', `talk2me-${key}`, features);
    if (!child) {
      toast(`${item.display_name} could not open`, 'Allow pop-ups for this Talk2Me site and try again.');
      return;
    }

    rememberExternal(item, key, child);
    try { child.opener = null; } catch (_) {}
    try { child.location.replace(item.portal_url); } catch (_) { child.location.href = item.portal_url; }
    try { child.focus(); } catch (_) {}
  }

  function openManagedLauncher(key) {
    const item = byKey[key];
    if (!item) return;
    if (!item.portal_url) {
      toast(`${item.display_name} is not configured`, 'The owner must add its secure URL in Administration > Workstation Launchers.');
      return;
    }

    if (item.open_mode !== 'embedded') {
      openSeparate(item, key);
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
        body.innerHTML = `<div style="height:100%;display:grid;grid-template-rows:auto 1fr"><div class="t2m-os-supplier-toolbar"><div><strong>${esc(item.display_name)}</strong><small style="display:block">This site may block embedded access. Use the floating-window button when it does.</small></div><button class="t2m-os-secondary-button" type="button">Open floating window ↗</button></div><iframe title="${esc(item.display_name)}" src="${esc(item.portal_url)}"></iframe></div>`;
        body.querySelector('button').onclick = () => openSeparate(item, key);
      }
    });
  }

  document.addEventListener('click', event => {
    const focusButton = event.target.closest('[data-external-focus]');
    if (focusButton) {
      event.preventDefault();
      focusExternal(focusButton.dataset.externalFocus);
      return;
    }

    const closeButton = event.target.closest('[data-external-close]');
    if (closeButton) {
      event.preventDefault();
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
    for (const [key, record] of externalWindows.entries()) {
      if (!record.child || record.child.closed) {
        externalWindows.delete(key);
        if (activeExternalKey === key) activeExternalKey = null;
        changed = true;
      }
    }
    if (changed) renderExternalTaskbar();
  }, 1000);

  renderExternalTaskbar();
})();
