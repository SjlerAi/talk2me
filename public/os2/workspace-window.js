(() => {
  const companionWindows = new Map();
  let launchers = [];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  function keyFor(item) {
    return `talk2me_tool_${Number(item.id) || String(item.icon_text || item.link_name).replace(/[^a-z0-9]/gi, '_')}`;
  }

  function ensureTaskbar() {
    let bar = document.getElementById('os2OpenWindowsBar');
    if (bar) return bar;

    if (!document.getElementById('os2CompanionWindowStyles')) {
      const style = document.createElement('style');
      style.id = 'os2CompanionWindowStyles';
      style.textContent = `
        .os2-open-windows{position:fixed;left:0;right:0;bottom:0;z-index:1900;display:flex;align-items:center;gap:8px;min-height:46px;padding:6px 14px;background:#eef4f8;border-top:1px solid var(--line);box-shadow:0 -6px 20px rgba(20,47,66,.08)}
        .os2-open-windows[hidden]{display:none!important}
        .os2-open-label{flex:0 0 auto;font-size:11px;font-weight:900;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
        .os2-open-items{display:flex;gap:8px;min-width:0;overflow-x:auto;scrollbar-width:thin}
        .os2-window-chip{display:flex;align-items:center;gap:8px;flex:0 0 auto;max-width:240px;height:34px;padding:0 8px 0 11px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font-weight:800;box-shadow:0 2px 8px rgba(20,47,66,.05)}
        .os2-window-chip button{border:0;background:transparent;cursor:pointer;font:inherit;color:inherit;padding:0}
        .os2-window-chip .focus{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .os2-window-chip .state{font-size:10px;color:#147a4d}
        .os2-window-chip .close{font-size:18px;color:var(--muted);line-height:1}
        body{padding-bottom:46px}
        @media(max-width:760px){.os2-open-windows{padding:6px 8px}.os2-open-label{display:none}.os2-window-chip{max-width:190px}}
      `;
      document.head.appendChild(style);
    }

    bar = document.createElement('div');
    bar.id = 'os2OpenWindowsBar';
    bar.className = 'os2-open-windows';
    bar.hidden = true;
    bar.innerHTML = '<span class="os2-open-label">Open windows</span><div class="os2-open-items" id="os2OpenWindowItems"></div>';
    document.body.appendChild(bar);
    return bar;
  }

  function renderTaskbar() {
    const bar = ensureTaskbar();
    const items = document.getElementById('os2OpenWindowItems');
    const entries = [...companionWindows.entries()].filter(([, entry]) => entry.window && !entry.window.closed);

    for (const [key, entry] of [...companionWindows.entries()]) {
      if (!entry.window || entry.window.closed) companionWindows.delete(key);
    }

    bar.hidden = entries.length === 0;
    if (!entries.length) {
      items.innerHTML = '';
      return;
    }

    items.innerHTML = entries.map(([key, entry]) => `
      <div class="os2-window-chip" data-window-key="${esc(key)}">
        <button type="button" class="focus" title="Bring ${esc(entry.item.link_name)} to front">${esc(entry.item.icon_text || entry.item.link_name)}</button>
        <span class="state">open</span>
        <button type="button" class="close" title="Close ${esc(entry.item.link_name)}">×</button>
      </div>`).join('');

    items.querySelectorAll('[data-window-key]').forEach(chip => {
      const key = chip.dataset.windowKey;
      chip.querySelector('.focus').onclick = () => focusWindow(key);
      chip.querySelector('.close').onclick = () => closeWindow(key);
    });
  }

  function focusWindow(key) {
    const entry = companionWindows.get(key);
    if (!entry || !entry.window || entry.window.closed) {
      companionWindows.delete(key);
      renderTaskbar();
      return;
    }
    try { entry.window.focus(); } catch {}
  }

  function closeWindow(key) {
    const entry = companionWindows.get(key);
    if (entry?.window && !entry.window.closed) {
      try { entry.window.close(); } catch {}
    }
    companionWindows.delete(key);
    renderTaskbar();
  }

  function companionFeatures() {
    const screenWidth = window.screen?.availWidth || window.innerWidth || 1366;
    const screenHeight = window.screen?.availHeight || window.innerHeight || 768;
    const width = Math.max(760, Math.round(screenWidth * 0.82));
    const height = Math.max(560, Math.round(screenHeight * 0.84));
    const left = Math.max(0, Math.round((screenWidth - width) / 2));
    const top = Math.max(0, Math.round((screenHeight - height) / 2));
    return `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no,location=yes`;
  }

  function openTool(item) {
    const key = keyFor(item);
    const current = companionWindows.get(key);

    if (current?.window && !current.window.closed) {
      try { current.window.focus(); } catch {}
      return current.window;
    }

    const target = window.open(item.link_url, key, companionFeatures());
    if (!target) {
      window.toast?.('Allow pop-ups for Talk2Me to open this work tool.');
      return null;
    }

    companionWindows.set(key, { window: target, item });
    renderTaskbar();
    try { target.focus(); } catch {}
    return target;
  }

  async function loadLaunchers() {
    try {
      const response = await fetch('/api/launchers', { headers:{Accept:'application/json'}, cache:'no-store' });
      const data = await response.json();
      if (response.ok && data.ok) launchers = data.items || [];
    } catch (error) {
      console.error('Could not load companion tools', error);
    }
    return launchers;
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('.global-launcher-button[data-launcher-id]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const id = Number(button.dataset.launcherId);
    let item = launchers.find(entry => Number(entry.id) === id);
    if (!item) {
      await loadLaunchers();
      item = launchers.find(entry => Number(entry.id) === id);
    }
    if (!item) {
      window.toast?.('Could not open this work tool');
      return;
    }
    openTool(item);
  }, true);

  setInterval(() => {
    let changed = false;
    for (const [key, entry] of companionWindows.entries()) {
      if (!entry.window || entry.window.closed) {
        companionWindows.delete(key);
        changed = true;
      }
    }
    if (changed) renderTaskbar();
  }, 1500);

  loadLaunchers();
  window.openTalk2MeTool = openTool;
  window.focusTalk2MeTool = focusWindow;
})();
