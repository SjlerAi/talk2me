(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  let view = null;
  let type = 'upgrades';
  let days = 30;
  let items = [];
  let page = 1;
  let query = '';
  const pageSize = 20;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { Accept:'application/json', ...(options.headers || {}) }
    });
    if (response.status === 401) {
      location.replace('/login');
      throw new Error('AUTHENTICATION_REQUIRED');
    }
    return response;
  }

  function notify(message) {
    if (typeof window.toast === 'function') window.toast(message);
  }

  function normalise(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function recordDate(item) {
    if (type === 'birthdays') return item.birthday;
    if (type === 'renewals') return item.cancellation_date;
    return item.next_upgrade_date;
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-ZA', {
      day:'2-digit', month:'short', year:'numeric'
    }).format(new Date(value));
  }

  function groupItems() {
    const groups = new Map();

    for (const item of items) {
      const nameKey = normalise(item.client_name);
      const fallbackKey = normalise(item.cell_number) || normalise(item.email) || `id${item.id}`;
      const key = nameKey || fallbackKey;

      if (!groups.has(key)) {
        groups.set(key, {
          primary: item,
          records: [],
          search: ''
        });
      }
      groups.get(key).records.push(item);
    }

    return [...groups.values()].map(group => {
      group.records.sort((a, b) => {
        const left = String(a.account_number || a.package_name || '');
        const right = String(b.account_number || b.package_name || '');
        return left.localeCompare(right);
      });
      group.search = group.records.flatMap(item => [
        item.client_name,
        item.account_number,
        item.cell_number,
        item.email,
        item.city_town,
        item.package_name,
        item.handset,
        item.assigned_staff
      ]).join(' ').toLowerCase();
      return group;
    });
  }

  function filteredGroups() {
    const groups = groupItems();
    return query ? groups.filter(group => group.search.includes(query)) : groups;
  }

  function ensure() {
    if (view) return view;

    const style = document.createElement('style');
    style.textContent = `
      .opp-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}
      .opp-controls{display:flex;gap:8px;flex-wrap:wrap}
      .opp-controls button{border:1px solid var(--line);background:#fff;border-radius:10px;padding:10px 13px;font-weight:800;cursor:pointer}
      .opp-controls button.active{background:var(--blue);color:#fff}
      .opp-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:14px 0}
      .opp-search{flex:1;max-width:520px;height:42px;padding:0 14px;border:1px solid var(--line);border-radius:11px;background:#fff}
      .opp-search:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(23,143,201,.12)}
      .opp-page-info{color:var(--muted);font-size:13px;font-weight:700}
      .opp-list{display:grid;gap:12px}
      .opp-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;display:grid;grid-template-columns:1fr auto;gap:14px}
      .opp-title-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .opp-count{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 8px;border-radius:99px;background:var(--blue-soft);color:var(--blue-dark);font-size:11px;font-weight:900}
      .opp-meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:7px 0}
      .opp-records{display:grid;gap:7px;margin-top:10px}
      .opp-record{display:grid;grid-template-columns:minmax(90px,140px) 1fr minmax(110px,auto);gap:10px;padding:9px 10px;border:1px solid #edf3f6;border-radius:10px;background:var(--blue-pale);font-size:12px}
      .opp-record strong{font-size:12px}.opp-record span{color:var(--muted)}
      .opp-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
      .opp-actions button,.opp-actions a{border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 10px;font-weight:800;text-decoration:none;color:inherit;cursor:pointer}
      .opp-actions .primary{background:var(--red);color:#fff;border-color:var(--red)}
      .opp-pagination{display:flex;justify-content:center;align-items:center;gap:10px;margin:18px 0 4px}
      .opp-pagination button{min-width:100px;height:40px;border:1px solid var(--line);border-radius:10px;background:#fff;font-weight:800;cursor:pointer}
      .opp-pagination button:disabled{opacity:.45;cursor:not-allowed}
      .opp-pagination span{min-width:110px;text-align:center;font-weight:800;color:var(--muted)}
      @media(max-width:760px){.opp-card{grid-template-columns:1fr}.opp-toolbar{align-items:stretch;flex-direction:column}.opp-search{max-width:none;width:100%}.opp-record{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);

    view = document.createElement('section');
    view.className = 'content';
    view.id = 'opportunityView';
    view.hidden = true;
    view.innerHTML = `
      <div class="opp-head">
        <div><span>SALES & CLIENT CARE</span><h1>Opportunities</h1><p id="oppStatus">Loading opportunities...</p></div>
        <button class="secondary" id="oppRefresh">Refresh</button>
      </div>
      <div class="opp-controls" id="oppTypes">
        <button data-type="upgrades" class="active">Upgrades</button>
        <button data-type="birthdays">Birthdays</button>
        <button data-type="prospects">Prospects</button>
        <button data-type="renewals">Renewals / cancellations</button>
      </div>
      <div class="opp-controls" id="oppDays" style="margin:10px 0 0">
        <button data-days="0">Today</button><button data-days="7">7 days</button>
        <button data-days="30" class="active">30 days</button><button data-days="60">60 days</button>
      </div>
      <div class="opp-toolbar">
        <input class="opp-search" id="oppSearch" type="search" placeholder="Search customer, account, phone, package or handset">
        <div class="opp-page-info" id="oppPageInfo"></div>
      </div>
      <div class="opp-list" id="oppList"></div>
      <div class="opp-pagination" id="oppPagination">
        <button id="oppPrev">Previous</button><span id="oppPageLabel">Page 1 of 1</span><button id="oppNext">Next</button>
      </div>`;
    document.querySelector('main').appendChild(view);

    byId('oppRefresh').onclick = load;
    byId('oppTypes').onclick = event => {
      const button = event.target.closest('[data-type]');
      if (!button) return;
      type = button.dataset.type;
      page = 1;
      byId('oppTypes').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
      load();
    };
    byId('oppDays').onclick = event => {
      const button = event.target.closest('[data-days]');
      if (!button) return;
      days = Number(button.dataset.days);
      page = 1;
      byId('oppDays').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
      load();
    };

    let searchTimer;
    byId('oppSearch').oninput = event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = event.target.value.trim().toLowerCase();
        page = 1;
        render();
      }, 180);
    };

    byId('oppPrev').onclick = () => {
      if (page <= 1) return;
      page -= 1;
      render();
      window.scrollTo({ top:view.offsetTop - 20, behavior:'smooth' });
    };
    byId('oppNext').onclick = () => {
      const pages = Math.max(1, Math.ceil(filteredGroups().length / pageSize));
      if (page >= pages) return;
      page += 1;
      render();
      window.scrollTo({ top:view.offsetTop - 20, behavior:'smooth' });
    };

    return view;
  }

  function hide() {
    ['dashboardView','customerView','workView','approvalView','attendanceView','reportView','administrationView']
      .forEach(id => { const element = byId(id); if (element) element.hidden = true; });
  }

  function render() {
    const list = byId('oppList');
    const filtered = filteredGroups();
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > pages) page = pages;

    const start = (page - 1) * pageSize;
    const visible = filtered.slice(start, start + pageSize);
    byId('oppPageInfo').textContent = filtered.length
      ? `Showing ${start + 1}-${Math.min(start + pageSize, filtered.length)} of ${filtered.length} customers`
      : '0 customers';
    byId('oppPageLabel').textContent = `Page ${page} of ${pages}`;
    byId('oppPrev').disabled = page <= 1;
    byId('oppNext').disabled = page >= pages;
    byId('oppPagination').hidden = filtered.length <= pageSize;

    if (!visible.length) {
      list.innerHTML = '<div class="panel" style="padding:30px;text-align:center">No matching opportunities.</div>';
      return;
    }

    list.innerHTML = visible.map(group => {
      const primary = group.primary;
      const phoneItem = group.records.find(item => item.cell_number) || primary;
      const whatsapp = String(phoneItem.cell_number || '').replace(/\D/g, '');
      const records = group.records.map(record => `
        <div class="opp-record">
          <strong>${esc(record.account_number || 'No account')}</strong>
          <span>${esc([record.package_name, record.handset].filter(Boolean).join(' · ') || 'No package details')}</span>
          <span>${esc(formatDate(recordDate(record)))}</span>
        </div>`).join('');

      return `<article class="opp-card">
        <div>
          <div class="opp-title-row">
            <strong>${esc(primary.client_name)}</strong>
            ${group.records.length > 1 ? `<span class="opp-count">${group.records.length} records</span>` : ''}
          </div>
          <div class="opp-meta"><span>${esc(primary.assigned_staff)}</span><span>${esc(type)}</span></div>
          <div class="opp-records">${records}</div>
        </div>
        <div class="opp-actions">
          <button data-client="${primary.id}">Customer</button>
          ${phoneItem.cell_number ? `<a href="tel:${esc(phoneItem.cell_number)}">Call</a>` : ''}
          ${whatsapp ? `<a href="https://wa.me/${esc(whatsapp)}" target="_blank">WhatsApp</a>` : ''}
          <button data-contacted="${primary.id}">Mark contacted</button>
          <button class="primary" data-followup="${primary.id}">Follow-up</button>
        </div>
      </article>`;
    }).join('');

    list.querySelectorAll('[data-client]').forEach(button => {
      button.onclick = () => window.openCustomer?.(Number(button.dataset.client));
    });
    list.querySelectorAll('[data-contacted]').forEach(button => {
      button.onclick = () => contacted(button);
    });
    list.querySelectorAll('[data-followup]').forEach(button => {
      button.onclick = () => followup(button);
    });
  }

  async function load() {
    ensure();
    byId('oppStatus').textContent = 'Loading opportunities...';
    try {
      const response = await api(`/api/opportunities?type=${encodeURIComponent(type)}&days=${days}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'OPPORTUNITY_QUERY_FAILED');
      items = data.items || [];
      const groups = groupItems();
      byId('oppStatus').textContent = `${groups.length} customer${groups.length === 1 ? '' : 's'} · ${items.length} qualifying record${items.length === 1 ? '' : 's'} · ${data.teamView ? 'Team view' : 'Your assigned clients'}`;
      render();
    } catch (error) {
      byId('oppStatus').textContent = `Could not load opportunities: ${error.message}`;
    }
  }

  async function contacted(button) {
    button.disabled = true;
    try {
      const response = await api(`/api/opportunities/${button.dataset.contacted}/contacted`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ method:'manual' })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error);
      notify('Opportunity marked as contacted');
    } catch (error) {
      notify(`Could not update: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  async function followup(button) {
    if (typeof window.talk2meDialog !== 'function') {
      notify('Follow-up form is not ready. Refresh the page and try again.');
      return;
    }

    const result = await window.talk2meDialog({
      title:'Schedule follow-up',
      message:'Choose when this follow-up is due and add the action required.',
      confirmText:'Add follow-up',
      fields:[
        { label:'Follow-up date and time', type:'datetime-local' },
        { label:'Follow-up note', type:'textarea', rows:4, value:'Contact customer about available upgrade options.' }
      ]
    });
    if (!result.confirmed) return;

    const [when, note] = result.values;
    if (!when) {
      notify('Choose a follow-up date and time.');
      return;
    }

    button.disabled = true;
    try {
      const response = await api(`/api/opportunities/${button.dataset.followup}/follow-up`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ followUpAt:when, note:note || 'Opportunity follow-up' })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error);
      notify('Follow-up added to My Work');
      window.loadDashboard?.();
    } catch (error) {
      notify(`Could not schedule follow-up: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  async function show() {
    ensure();
    hide();
    view.hidden = false;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === 'opportunities');
    });
    await load();
  }

  document.querySelectorAll('[data-view="opportunities"]').forEach(item => {
    item.addEventListener('click', event => {
      event.preventDefault();
      show();
    });
  });
  window.showOpportunities = show;

  if (!document.querySelector('script[src$="reports.js"]')) {
    const script = document.createElement('script');
    script.src = './reports.js';
    document.body.appendChild(script);
  }
})();
