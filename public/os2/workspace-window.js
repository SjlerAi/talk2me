(() => {
  const windows = new Map();
  let launchers = [];
  let zIndex = 2200;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  function ensureStyles() {
    if (document.getElementById('os2WorkspaceWindowStyles')) return;
    const style = document.createElement('style');
    style.id = 'os2WorkspaceWindowStyles';
    style.textContent = `
      .os2-workspace-window{position:fixed;left:calc(50% - 440px);top:110px;width:min(880px,calc(100vw - 40px));height:min(680px,calc(100vh - 145px));min-width:360px;min-height:260px;z-index:2200;display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 70px rgba(15,39,53,.28);overflow:hidden;resize:both}
      .os2-workspace-window.active{box-shadow:0 28px 85px rgba(15,39,53,.36)}
      .os2-workspace-window.minimised{width:320px!important;height:52px!important;min-height:52px;resize:none;top:auto!important;bottom:18px}
      .os2-workspace-titlebar{height:52px;flex:0 0 52px;display:flex;align-items:center;gap:10px;padding:0 12px 0 16px;background:#fff;border-top:6px solid var(--red);border-bottom:1px solid var(--line);cursor:move;user-select:none}
      .os2-workspace-title{min-width:0;flex:1;font-weight:900;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .os2-workspace-url{font-size:11px;color:var(--muted);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
      .os2-workspace-actions{display:flex;gap:6px;margin-left:auto}
      .os2-workspace-actions button{width:34px;height:32px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);font-weight:900;cursor:pointer}
      .os2-workspace-actions button:hover{border-color:var(--red);color:var(--red)}
      .os2-workspace-body{position:relative;flex:1;min-height:0;background:#f3f8fb}
      .os2-workspace-window.minimised .os2-workspace-body{display:none}
      .os2-workspace-frame{display:block;width:100%;height:100%;border:0;background:#fff}
      .os2-workspace-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#f3f8fb;color:var(--muted);font-weight:800;pointer-events:none}
      .os2-workspace-help{position:absolute;left:14px;right:14px;bottom:14px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.94);border:1px solid var(--line);box-shadow:0 6px 18px rgba(15,39,53,.10);font-size:12px;color:var(--muted);display:none}
      .os2-workspace-help.show{display:block}
      @media(max-width:760px){.os2-workspace-window{left:10px!important;top:86px!important;width:calc(100vw - 20px)!important;height:calc(100vh - 106px)!important;min-width:0;min-height:0;resize:none}.os2-workspace-url{display:none}.os2-workspace-window.minimised{left:10px!important;right:10px;width:auto!important;height:52px!important;top:auto!important;bottom:10px}}
    `;
    document.head.appendChild(style);
  }

  async function loadLaunchers() {
    try {
      const response = await fetch('/api/launchers', { headers:{Accept:'application/json'}, cache:'no-store' });
      const data = await response.json();
      if (response.ok && data.ok) launchers = data.items || [];
    } catch (error) {
      console.error('Could not load workspace tools', error);
    }
    return launchers;
  }

  function keyFor(item) {
    return `tool-${Number(item.id) || String(item.icon_text || item.link_name).replace(/[^a-z0-9]/gi,'-')}`;
  }

  function bringToFront(panel) {
    zIndex += 1;
    document.querySelectorAll('.os2-workspace-window').forEach(item => item.classList.remove('active'));
    panel.style.zIndex = String(zIndex);
    panel.classList.add('active');
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener('pointerdown', event => {
      if (event.target.closest('button') || panel.classList.contains('minimised') || window.innerWidth <= 760) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      handle.setPointerCapture(event.pointerId);
      bringToFront(panel);
    });

    handle.addEventListener('pointermove', event => {
      if (!dragging) return;
      const maxLeft = Math.max(0, window.innerWidth - 160);
      const maxTop = Math.max(0, window.innerHeight - 70);
      panel.style.left = `${Math.min(maxLeft, Math.max(0, startLeft + event.clientX - startX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(0, startTop + event.clientY - startY))}px`;
    });

    const stop = event => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(event.pointerId); } catch {}
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function createWindow(item) {
    ensureStyles();
    const key = keyFor(item);
    const panel = document.createElement('section');
    panel.className = 'os2-workspace-window';
    panel.dataset.toolKey = key;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', item.link_name || 'Work tool');
    panel.innerHTML = `
      <header class="os2-workspace-titlebar">
        <div class="os2-workspace-title">${esc(item.link_name || item.icon_text || 'Work tool')}</div>
        <div class="os2-workspace-url">${esc(item.link_url)}</div>
        <div class="os2-workspace-actions">
          <button type="button" data-action="reload" title="Reload">↻</button>
          <button type="button" data-action="minimise" title="Minimise">—</button>
          <button type="button" data-action="close" title="Close">×</button>
        </div>
      </header>
      <div class="os2-workspace-body">
        <div class="os2-workspace-loading">Opening ${esc(item.link_name || 'tool')}…</div>
        <iframe class="os2-workspace-frame" title="${esc(item.link_name || 'Work tool')}" src="${esc(item.link_url)}" referrerpolicy="strict-origin-when-cross-origin" allow="clipboard-read; clipboard-write"></iframe>
        <div class="os2-workspace-help">This external system may block embedded viewing. The OS2 window remains available so the tool can be retried or closed safely.</div>
      </div>`;
    document.body.appendChild(panel);

    const frame = panel.querySelector('.os2-workspace-frame');
    const loading = panel.querySelector('.os2-workspace-loading');
    const help = panel.querySelector('.os2-workspace-help');
    const titlebar = panel.querySelector('.os2-workspace-titlebar');

    frame.addEventListener('load', () => {
      loading.style.display = 'none';
      clearTimeout(panel.__helpTimer);
      panel.__helpTimer = setTimeout(() => help.classList.add('show'), 5000);
    });

    panel.addEventListener('pointerdown', () => bringToFront(panel));
    makeDraggable(panel, titlebar);

    panel.querySelector('[data-action="reload"]').onclick = () => {
      help.classList.remove('show');
      loading.style.display = 'flex';
      frame.src = item.link_url;
    };
    panel.querySelector('[data-action="minimise"]').onclick = () => {
      panel.classList.toggle('minimised');
      panel.querySelector('[data-action="minimise"]').textContent = panel.classList.contains('minimised') ? '□' : '—';
      bringToFront(panel);
    };
    panel.querySelector('[data-action="close"]').onclick = () => {
      clearTimeout(panel.__helpTimer);
      windows.delete(key);
      panel.remove();
    };

    windows.set(key, panel);
    bringToFront(panel);
    return panel;
  }

  function openTool(item) {
    const key = keyFor(item);
    let panel = windows.get(key);
    if (!panel || !document.body.contains(panel)) panel = createWindow(item);
    panel.classList.remove('minimised');
    const minimise = panel.querySelector('[data-action="minimise"]');
    if (minimise) minimise.textContent = '—';
    bringToFront(panel);
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

  loadLaunchers();
  window.openTalk2MeTool = openTool;
})();
