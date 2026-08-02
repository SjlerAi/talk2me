(() => {
  const existingSearch = document.getElementById('search');
  const results = document.getElementById('results');
  if (!existingSearch || !results || existingSearch.dataset.controllerInstalled === '1') return;

  // Replace the original input so this controller is the single owner of OS2 customer search.
  const search = existingSearch.cloneNode(true);
  search.dataset.controllerInstalled = '1';
  existingSearch.replaceWith(search);

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const normaliseText = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();
  const formatDate = value => value
    ? new Intl.DateTimeFormat('en-ZA', { day:'2-digit', month:'short', year:'numeric' }).format(new Date(value))
    : '—';
  const statusClass = status => {
    const value = String(status || '').toLowerCase();
    if (['resolved','completed','active','accepted'].includes(value)) return 'done';
    if (['open','follow_up','in_progress','created','assigned','scheduled'].includes(value)) return 'progress';
    return 'pending';
  };

  let timer = null;
  let controller = null;
  let sequence = 0;
  let selectedOs2Customer = null;

  function hideResults() {
    results.classList.remove('show');
  }

  function showResults() {
    if (results.innerHTML.trim()) results.classList.add('show');
  }

  function renderCustomers(customers) {
    results.innerHTML = customers.length
      ? customers.map(item => {
          const account = item.account_numbers || 'No account';
          const phone = item.primary_mobile || 'No phone';
          const secondary = item.primary_email || item.town || '';
          return `<div class="result" data-id="${Number(item.id)}" data-name="${escapeHtml(item.display_name)}"><b>${escapeHtml(item.display_name)}</b><span>${escapeHtml(account)} · ${escapeHtml(phone)} · ${escapeHtml(secondary)}</span></div>`;
        }).join('')
      : '<div class="result"><b>No customers found</b><span>Try another name, number, email or account.</span></div>';
    showResults();
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, {
      headers: { Accept:'application/json' },
      cache: 'no-store',
      signal
    });
    if (response.status === 401) {
      window.location.replace('/login');
      return null;
    }
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'REQUEST_FAILED');
    return data;
  }

  async function fetchCustomers(value, signal) {
    const data = await fetchJson(`/api/os2/customers/search?q=${encodeURIComponent(value)}`, signal);
    return data ? (Array.isArray(data.customers) ? data.customers : []) : null;
  }

  async function runSearch(value, requestSequence) {
    if (controller) controller.abort();
    controller = new AbortController();

    try {
      const customers = await fetchCustomers(value, controller.signal);
      if (!customers) return;
      if (requestSequence !== sequence || normaliseText(search.value) !== normaliseText(value)) return;
      renderCustomers(customers);
    } catch (error) {
      if (error.name === 'AbortError' || requestSequence !== sequence) return;
      results.innerHTML = `<div class="result"><b>Search unavailable</b><span>${escapeHtml(error.message)}</span></div>`;
      showResults();
    }
  }

  async function openOs2Customer(id) {
    hideResults();
    const dashboard = byId('dashboardView');
    const work = byId('workView');
    const customerView = byId('customerView');
    if (dashboard) dashboard.hidden = true;
    if (work) work.hidden = true;
    if (customerView) customerView.hidden = false;

    byId('customerName').textContent = 'Loading customer…';
    byId('customerSummary').textContent = 'Reading Customer 360 from the OS2 database.';

    try {
      const data = await fetchJson(`/api/os2/customers/${encodeURIComponent(id)}/360`);
      if (!data) return;
      selectedOs2Customer = data.customer || null;
      window.__os2SelectedCustomer = selectedOs2Customer;

      const customer = data.customer || {};
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      const mobileLines = Array.isArray(data.mobileLines) ? data.mobileLines : [];
      const fixedServices = Array.isArray(data.fixedServices) ? data.fixedServices : [];
      const workItems = Array.isArray(data.workItems) ? data.workItems : [];
      const primaryAccount = accounts.find(item => Number(item.is_primary) === 1) || accounts[0] || {};

      byId('customerName').textContent = customer.display_name || 'Unnamed customer';
      byId('customerSummary').textContent = `${primaryAccount.account_number || 'No account number'} · ${mobileLines.length} mobile line${mobileLines.length === 1 ? '' : 's'} · ${fixedServices.length} fixed service${fixedServices.length === 1 ? '' : 's'}`;

      byId('customerDetails').innerHTML = [
        ['Account', primaryAccount.account_number],
        ['Primary mobile', customer.primary_mobile],
        ['Email', customer.primary_email],
        ['Town', customer.town],
        ['Responsible person', customer.responsible_person],
        ['Customer type', customer.customer_type]
      ].map(([label, value]) => `<div class="detail"><span>${label}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('');

      byId('customerStatus').innerHTML = `
        <div><span>Assigned staff</span><strong>${escapeHtml(customer.owner_name || 'Unassigned')}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(customer.status || customer.lifecycle_status || 'active')}</strong></div>
        <div><span>Accounts</span><strong>${accounts.length}</strong></div>
        <div><span>Open work</span><strong>${workItems.length}</strong></div>`;

      byId('lineCount').textContent = mobileLines.length;
      byId('customerLines').innerHTML = mobileLines.length
        ? mobileLines.map(line => `<tr><td>${escapeHtml(line.mobile_number || '—')}</td><td>${escapeHtml(line.package_name || '—')}</td><td>${escapeHtml(line.handset || '—')}</td><td>${formatDate(line.next_upgrade_date)}</td><td><span class="status ${statusClass(line.line_status || line.status)}">${escapeHtml(line.line_status || line.status || 'unknown')}</span></td></tr>`).join('')
        : '<tr><td colspan="5">No mobile lines found.</td></tr>';

      // Until the integrated inquiry endpoint is attached to this compact view,
      // show active OS2 work history rather than legacy inquiry rows.
      byId('inquiryCount').textContent = workItems.length;
      byId('customerInquiries').innerHTML = workItems.length
        ? workItems.map(item => `<article class="timeline-item"><div class="timeline-dot"></div><div><div class="timeline-top"><strong>${escapeHtml(item.title || item.work_type || 'Work item')}</strong><span class="status ${statusClass(item.lifecycle_state)}">${escapeHtml(item.lifecycle_state || 'open')}</span></div><p>${escapeHtml(item.description || 'No notes recorded')}</p><small>${formatDate(item.created_at)} · ${escapeHtml(item.assignee_name || customer.owner_name || 'Unassigned')}</small></div></article>`).join('')
        : '<div class="empty-state">No active OS2 work linked to this customer.</div>';

      document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'customers'));
    } catch (error) {
      byId('customerName').textContent = 'Customer unavailable';
      byId('customerSummary').textContent = error.message;
    }
  }

  // Override the legacy customer loader. All top-search selections now use OS2 Customer 360.
  window.openCustomer = openOs2Customer;
  window.openOs2Customer = openOs2Customer;

  // Replace the old copy-phone listener so it uses the OS2 primary mobile field.
  const oldCopyPhone = byId('copyPhone');
  if (oldCopyPhone) {
    const copyPhone = oldCopyPhone.cloneNode(true);
    oldCopyPhone.replaceWith(copyPhone);
    copyPhone.addEventListener('click', async () => {
      const phone = selectedOs2Customer?.primary_mobile;
      if (!phone) return;
      try { await navigator.clipboard.writeText(phone); }
      catch (_) { window.prompt('Copy phone number', phone); }
    });
  }

  search.addEventListener('input', () => {
    clearTimeout(timer);
    sequence += 1;
    const requestSequence = sequence;
    const value = search.value.trim();

    if (controller) controller.abort();
    if (value.length < 2) {
      results.innerHTML = '';
      hideResults();
      return;
    }

    results.innerHTML = '<div class="result"><b>Searching…</b><span>Reading the OS2 database</span></div>';
    showResults();
    timer = setTimeout(() => runSearch(value, requestSequence), 250);
  });

  search.addEventListener('focus', () => {
    if (search.value.trim().length >= 2) showResults();
  });

  results.addEventListener('click', event => {
    const item = event.target.closest('[data-id]');
    if (!item) return;
    hideResults();
    search.value = item.dataset.name || '';
    openOs2Customer(item.dataset.id);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideResults();
  }, true);
})();
