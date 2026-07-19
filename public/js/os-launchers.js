(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode || !window.Talk2MeOS?.windows) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const launchers = Array.isArray(config.launchers) ? config.launchers : [];
  const byKey = Object.fromEntries(launchers.map(item => [item.slot_key, item]));
  const windows = window.Talk2MeOS.windows;

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

  function openSeparate(item, key) {
    const child = window.open(item.portal_url, `talk2me-${key}`, 'noopener,noreferrer');
    if (!child) toast(`${item.display_name} could not open`, 'Allow pop-ups for this Talk2Me site and try again.');
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
        body.innerHTML = `<div style="height:100%;display:grid;grid-template-rows:auto 1fr"><div class="t2m-os-supplier-toolbar"><div><strong>${esc(item.display_name)}</strong><small style="display:block">This site may block embedded access. Use the separate-window button when it does.</small></div><button class="t2m-os-secondary-button" type="button">Open separately ↗</button></div><iframe title="${esc(item.display_name)}" src="${esc(item.portal_url)}"></iframe></div>`;
        body.querySelector('button').onclick = () => openSeparate(item, key);
      }
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-os-managed-launcher]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openManagedLauncher(button.dataset.osManagedLauncher);
  }, true);
})();
