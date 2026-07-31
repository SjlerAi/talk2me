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

  function ensureDialogStyles() {
    if (document.getElementById('talk2meDialogStyles')) return;
    const style = document.createElement('style');
    style.id = 'talk2meDialogStyles';
    style.textContent = `
      .talk2me-dialog-backdrop{position:fixed;inset:0;z-index:3000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(16,38,52,.46);backdrop-filter:blur(3px)}
      .talk2me-dialog-backdrop.open{display:flex}
      .talk2me-dialog{width:min(520px,100%);background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 24px 70px rgba(15,39,53,.26);overflow:hidden}
      .talk2me-dialog-accent{height:7px;background:var(--red)}
      .talk2me-dialog-body{padding:24px}
      .talk2me-dialog h2{margin:0 0 8px;color:var(--ink);font-size:24px}
      .talk2me-dialog p{margin:0 0 18px;color:var(--muted);line-height:1.5}
      .talk2me-dialog label{display:grid;gap:7px;margin:0 0 14px;font-weight:800;font-size:12px;color:var(--ink)}
      .talk2me-dialog input,.talk2me-dialog textarea,.talk2me-dialog select{width:100%;padding:12px 13px;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink);font:inherit;outline:none}
      .talk2me-dialog input:focus,.talk2me-dialog textarea:focus,.talk2me-dialog select:focus{border-color:var(--red);box-shadow:0 0 0 3px rgba(238,31,41,.10)}
      .talk2me-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
      .talk2me-dialog-actions button{min-width:104px;height:44px;padding:0 18px;border-radius:11px;border:1px solid var(--line);font-weight:900;cursor:pointer}
      .talk2me-dialog-actions .cancel{background:#fff;color:var(--ink)}
      .talk2me-dialog-actions .confirm{background:var(--red);border-color:var(--red);color:#fff}
      @media(max-width:560px){.talk2me-dialog-body{padding:20px}.talk2me-dialog-actions{flex-direction:column-reverse}.talk2me-dialog-actions button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog() {
    ensureDialogStyles();
    let backdrop = document.getElementById('talk2meDialogBackdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'talk2meDialogBackdrop';
    backdrop.className = 'talk2me-dialog-backdrop';
    backdrop.innerHTML = '<div class="talk2me-dialog" role="dialog" aria-modal="true"><div class="talk2me-dialog-accent"></div><form class="talk2me-dialog-body" id="talk2meDialogForm"><h2 id="talk2meDialogTitle"></h2><p id="talk2meDialogMessage"></p><div id="talk2meDialogFields"></div><div class="talk2me-dialog-actions"><button type="button" class="cancel" id="talk2meDialogCancel">Cancel</button><button type="submit" class="confirm" id="talk2meDialogConfirm">Save</button></div></form></div>';
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function closeDialog(result) {
    const backdrop = document.getElementById('talk2meDialogBackdrop');
    if (!backdrop) return;
    backdrop.classList.remove('open');
    const resolve = backdrop.__resolve;
    backdrop.__resolve = null;
    if (resolve) resolve(result);
  }

  window.talk2meDialog = options => new Promise(resolve => {
    const backdrop = ensureDialog();
    const form = document.getElementById('talk2meDialogForm');
    const fields = Array.isArray(options?.fields) ? options.fields : [];
    document.getElementById('talk2meDialogTitle').textContent = String(options?.title || 'Talk2Me');
    document.getElementById('talk2meDialogMessage').textContent = String(options?.message || '');
    document.getElementById('talk2meDialogConfirm').textContent = String(options?.confirmText || 'Save');
    document.getElementById('talk2meDialogCancel').textContent = String(options?.cancelText || 'Cancel');
    document.getElementById('talk2meDialogFields').innerHTML = fields.map((field, index) => {
      const id = `talk2meDialogField${index}`;
      const value = String(field.value ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      if (field.type === 'textarea') return `<label>${field.label || ''}<textarea id="${id}" rows="${field.rows || 4}" placeholder="${field.placeholder || ''}">${value}</textarea></label>`;
      return `<label>${field.label || ''}<input id="${id}" type="${field.type || 'text'}" value="${value}" placeholder="${field.placeholder || ''}" ${field.required === false ? '' : 'required'}></label>`;
    }).join('');
    backdrop.__resolve = resolve;
    backdrop.classList.add('open');
    form.onsubmit = event => {
      event.preventDefault();
      const values = fields.map((field, index) => document.getElementById(`talk2meDialogField${index}`)?.value ?? '');
      closeDialog({ confirmed:true, values });
    };
    document.getElementById('talk2meDialogCancel').onclick = () => closeDialog({ confirmed:false, values:[] });
    backdrop.onclick = event => { if (event.target === backdrop) closeDialog({ confirmed:false, values:[] }); };
    setTimeout(() => document.getElementById('talk2meDialogField0')?.focus(), 0);
  });

  window.talk2mePrompt = async options => {
    const result = await window.talk2meDialog({ ...options, fields:[{ label:options?.label || '', type:options?.type || 'text', value:options?.value || '', placeholder:options?.placeholder || '', required:options?.required !== false }] });
    return result.confirmed ? result.values[0] : null;
  };

  window.talk2meConfirm = async options => {
    const result = await window.talk2meDialog({ ...options, fields:[], confirmText:options?.confirmText || 'Confirm' });
    return result.confirmed;
  };

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
