(() => {
  const search = document.getElementById('search');
  const results = document.getElementById('results');
  if (!search || !results || search.dataset.controllerInstalled === '1') return;
  search.dataset.controllerInstalled = '1';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const normalise = value => String(value ?? '')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f\u00a0\s]+/g, '')
    .trim();

  let timer = null;
  let controller = null;
  let sequence = 0;
  let dismissed = false;

  function hideResults() {
    results.classList.remove('show');
  }

  function showResults() {
    if (results.innerHTML.trim()) results.classList.add('show');
  }

  function renderCustomers(customers) {
    results.innerHTML = customers.length
      ? customers.map(item => `<div class="result" data-id="${Number(item.id)}" data-name="${escapeHtml(item.client_name)}"><b>${escapeHtml(item.client_name)}</b><span>${escapeHtml(item.account_number || 'No account')} · ${escapeHtml(item.cell_number || 'No phone')} · ${escapeHtml(item.email || item.city_town || '')}</span></div>`).join('')
      : '<div class="result"><b>No customers found</b><span>Try another name, number, email or account.</span></div>';
    showResults();
  }

  async function fetchCustomers(value, signal) {
    const response = await fetch(`/api/customers/search?q=${encodeURIComponent(value)}`, {
      headers: { Accept:'application/json' },
      signal
    });
    if (response.status === 401) {
      window.location.replace('/login');
      return null;
    }
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'SEARCH_FAILED');
    return Array.isArray(data.customers) ? data.customers : [];
  }

  async function runSearch(value, requestSequence) {
    if (controller) controller.abort();
    controller = new AbortController();
    try {
      let customers = await fetchCustomers(value, controller.signal);
      if (!customers) return;

      const normalisedValue = normalise(value);
      const atIndex = normalisedValue.indexOf('@');
      if (!customers.length && atIndex > 0 && normalisedValue.length > atIndex + 2) {
        const broadEmailPrefix = normalisedValue.slice(0, atIndex + 2);
        const broadCustomers = await fetchCustomers(broadEmailPrefix, controller.signal);
        if (!broadCustomers) return;
        customers = broadCustomers.filter(item => normalise(item.email).startsWith(normalisedValue));
      }

      if (requestSequence !== sequence || normalise(search.value) !== normalisedValue) return;
      renderCustomers(customers);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (requestSequence !== sequence) return;
      results.innerHTML = `<div class="result"><b>Search unavailable</b><span>${escapeHtml(error.message)}</span></div>`;
      showResults();
    }
  }

  search.addEventListener('input', event => {
    event.stopImmediatePropagation();
    clearTimeout(timer);
    dismissed = false;
    sequence += 1;
    const requestSequence = sequence;
    const value = search.value.trim();

    if (controller) controller.abort();
    if (value.length < 2) {
      results.innerHTML = '';
      hideResults();
      return;
    }

    results.innerHTML = '<div class="result"><b>Searching…</b><span>Reading the OS2 test database</span></div>';
    showResults();
    timer = setTimeout(() => runSearch(value, requestSequence), 250);
  }, true);

  search.addEventListener('focus', () => {
    dismissed = false;
    if (search.value.trim().length >= 2) showResults();
  });

  results.addEventListener('click', event => {
    const item = event.target.closest('[data-id]');
    if (!item) return;
    dismissed = true;
    hideResults();
    search.value = item.dataset.name || '';
    if (typeof window.openCustomer === 'function') window.openCustomer(item.dataset.id);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    dismissed = true;
    hideResults();
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest('.search')) return;
    if (!dismissed && search.value.trim().length >= 2) showResults();
  }, true);
})();
