(() => {
  const launcherWindows = new Map();

  if (typeof window.toast !== 'function') {
    window.toast = message => {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.textContent = String(message || '');
      toast.classList.add('show');
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[<>"'&]/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[char]));
  }

  function windowName(item) {
    return `talk2me_tool_${Number(item.id) || String(item.icon_text || item.link_name).replace(/[^a-z0-9]/gi, '_')}`;
  }

  function openLauncher(item) {
    const name = windowName(item);
    let target = launcherWindows.get(name);
    try {
      if (!target || target.closed) {
        target = window.open(item.link_url, name);
        if (target) launcherWindows.set(name, target);
      }
      target?.focus();
    } catch (error) {
      console.error('Launcher open failed', error);
      target = window.open(item.link_url, name);
      if (target) {
        launcherWindows.set(name, target);
        target.focus();
      }
    }
  }

  function ensureToolbar() {
    let toolbar = document.getElementById('globalLauncherBar');
    if (toolbar) return toolbar;

    const topbar = document.querySelector('.topbar');
    if (!topbar) return null;

    const style = document.createElement('style');
    style.id = 'globalLauncherStyles';
    style.textContent = `
      .tools{display:none!important}
      .global-launcher-bar{display:flex;align-items:center;gap:8px;min-height:48px;padding:7px 28px;background:#fff;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:thin;position:sticky;top:73px;z-index:18}
      .global-launcher-bar[hidden]{display:none!important}
      .global-launcher-button{flex:0 0 auto;min-width:58px;height:34px;padding:0 11px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--blue-dark);font-size:12px;font-weight:900;letter-spacing:.02em;cursor:pointer;box-shadow:0 2px 7px rgba(20,47,66,.04)}
      .global-launcher-button:hover,.global-launcher-button:focus-visible{border-color:var(--red);color:var(--red);outline:none;transform:translateY(-1px)}
      .global-launcher-empty{font-size:12px;color:var(--muted)}
      @media(max-width:760px){.global-launcher-bar{padding:7px 14px;top:65px}.global-launcher-button{min-width:54px}}
    `;
    document.head.appendChild(style);

    toolbar = document.createElement('div');
    toolbar.id = 'globalLauncherBar';
    toolbar.className = 'global-launcher-bar';
    toolbar.setAttribute('aria-label', 'Daily work tools');
    topbar.insertAdjacentElement('afterend', toolbar);
    return toolbar;
  }

  async function loadLaunchers() {
    try {
      const response = await fetch('/api/launchers', { headers:{Accept:'application/json'} });
      if (!response.ok) return;
      const data = await response.json();
      const toolbar = ensureToolbar();
      if (!toolbar || !data.ok) return;

      const items = (data.items || []).slice(0, 10);
      toolbar.hidden = false;
      toolbar.innerHTML = items.length
        ? items.map(item => {
            const label = String(item.icon_text || item.link_name || 'OPEN').trim().slice(0, 5).toUpperCase();
            return `<button type="button" class="global-launcher-button" title="${escapeHtml(item.link_name)}" aria-label="Open ${escapeHtml(item.link_name)}" data-launcher-id="${Number(item.id)}">${escapeHtml(label)}</button>`;
          }).join('')
        : '<span class="global-launcher-empty">No work tools configured.</span>';

      toolbar.querySelectorAll('[data-launcher-id]').forEach(button => {
        const item = items.find(entry => Number(entry.id) === Number(button.dataset.launcherId));
        if (item) button.addEventListener('click', () => openLauncher(item));
      });
    } catch (error) {
      console.error('Launcher load failed', error);
    }
  }

  function loadAdministrationSystem() {
    if (document.querySelector('script[src$="administration-system.js"]')) return;
    const script = document.createElement('script');
    script.src = './administration-system.js';
    document.body.appendChild(script);
  }

  window.loadLaunchers = loadLaunchers;
  loadLaunchers();
  loadAdministrationSystem();
})();
