'use strict';

(() => {
  const root = document.getElementById('staffImportIdentities');
  if (!root) return;
  const staffId = Number(root.dataset.staffId || 0);
  const basePath = root.dataset.basePath || '';
  const list = root.querySelector('[data-code-list]');
  const form = root.querySelector('[data-code-form]');
  const input = root.querySelector('[name="external_code"]');
  const message = root.querySelector('[data-code-message]');

  function text(value) { return String(value ?? ''); }
  function setMessage(value, isError = false) {
    message.textContent = value || '';
    message.style.color = isError ? '#b42318' : '';
  }
  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Could not update staff import identity.');
    return payload;
  }
  function render(codes) {
    list.innerHTML = '';
    if (!codes.length) {
      const p = document.createElement('p');
      p.textContent = 'No report / agent codes captured yet.';
      list.appendChild(p);
      return;
    }
    for (const code of codes) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.margin = '8px 0';
      const label = document.createElement('span');
      label.textContent = `${text(code.external_code)}${code.is_active ? '' : ' (inactive)'}`;
      row.appendChild(label);
      if (code.is_active) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn small';
        button.textContent = 'Deactivate';
        button.addEventListener('click', async () => {
          try {
            setMessage('');
            const payload = await request(`${basePath}/backoffice/staff/${staffId}/import-identities/${code.id}/deactivate`, { method: 'POST', body: '{}' });
            setMessage(payload.message);
            await load();
          } catch (error) { setMessage(error.message, true); }
        });
        row.appendChild(button);
      }
      list.appendChild(row);
    }
  }
  async function load() {
    try {
      const payload = await request(`${basePath}/backoffice/staff/${staffId}/import-identities`, { method: 'GET', headers: {} });
      render(payload.codes || []);
    } catch (error) {
      list.innerHTML = '';
      setMessage(error.message, true);
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const code = text(input.value).trim();
    if (!code) return;
    try {
      setMessage('');
      const payload = await request(`${basePath}/backoffice/staff/${staffId}/import-identities`, {
        method: 'POST', body: JSON.stringify({ external_code: code })
      });
      input.value = '';
      setMessage(payload.message);
      await load();
    } catch (error) { setMessage(error.message, true); }
  });
  load();
})();
