(() => {
  if (!document.querySelector('script[src$="toast-runtime.js"]')) {
    const toastScript = document.createElement('script');
    toastScript.src = './toast-runtime.js';
    document.body.appendChild(toastScript);
  }

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  function formatDateTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-ZA', {
      day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
    }).format(new Date(value));
  }

  function auditDetails(item) {
    try {
      const after = item.after_json ? JSON.parse(item.after_json) : null;
      if (after?.note) return after.note;
    } catch {}
    return item.description || 'Audit action recorded';
  }

  async function renderSystem() {
    const body = document.getElementById('adminBody');
    const tabs = document.getElementById('adminTabs');
    if (!body || !tabs) return;

    tabs.querySelectorAll('[data-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === 'system');
    });
    body.innerHTML = '<section class="admin-card"><h2>System status</h2><p>Loading system information and audit trail...</p></section>';

    try {
      const response = await fetch('/api/administration', {
        headers:{Accept:'application/json'},
        cache:'no-store'
      });
      if (response.status === 401) {
        location.replace('/login');
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'ADMINISTRATION_LOAD_FAILED');

      const system = data.system || {};
      const audit = data.audit || [];
      body.innerHTML = `
        <section class="admin-card">
          <h2>System status</h2>
          <div class="admin-system">
            <div><span>Version</span><strong>${esc(system.version)}</strong></div>
            <div><span>Environment</span><strong>${esc(system.environment)}</strong></div>
            <div><span>Database</span><strong>${esc(system.database)}</strong></div>
            <div><span>Active sessions</span><strong>${Number(system.activeSessions || 0)}</strong></div>
            <div><span>Active customers</span><strong>${Number(system.activeClients || 0)}</strong></div>
            <div><span>Site</span><strong>talk2me.kloka.co.za</strong></div>
          </div>
        </section>
        <section class="admin-card" style="margin-top:16px">
          <div class="admin-head">
            <div><h2>Recent audit trail</h2><p>Latest 100 recorded system actions.</p></div>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Date</th><th>Staff member</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>
                ${audit.length ? audit.map(item => `
                  <tr>
                    <td>${esc(formatDateTime(item.created_at))}</td>
                    <td><strong>${esc(item.staff_name)}</strong></td>
                    <td>${esc(String(item.action_type || '').replaceAll('_',' '))}</td>
                    <td>${esc(item.entity_type)} #${esc(item.entity_id)}</td>
                    <td style="white-space:normal;min-width:280px">${esc(auditDetails(item))}</td>
                  </tr>`).join('') : '<tr><td colspan="5">No audit records found.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>`;
    } catch (error) {
      body.innerHTML = `<section class="admin-card"><h2>System status</h2><p>Could not load system audit: ${esc(error.message)}</p></section>`;
    }
  }

  document.addEventListener('click', event => {
    const systemTab = event.target.closest('#adminTabs [data-tab="system"]');
    if (systemTab) {
      event.preventDefault();
      event.stopImmediatePropagation();
      renderSystem();
      return;
    }

    const refresh = event.target.closest('#adminRefresh');
    const activeSystem = document.querySelector('#adminTabs [data-tab="system"].active');
    if (refresh && activeSystem) {
      event.preventDefault();
      event.stopImmediatePropagation();
      renderSystem();
    }
  }, true);

  window.renderAdministrationSystem = renderSystem;
})();
