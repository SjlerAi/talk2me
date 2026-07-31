(() => {
  const existingSearch = document.getElementById('search');
  const results = document.getElementById('results');
  if (!existingSearch || !results || existingSearch.dataset.controllerInstalled === '1') return;

  const search = existingSearch.cloneNode(true);
  search.dataset.controllerInstalled = '1';
  existingSearch.replaceWith(search);

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  const normaliseText = value => String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .trim();

  const canonicalEmail = value => normaliseText(value)
    .replace(/[^a-z0-9@._+\-]/g, '');

  let timer = null;
  let controller = null;
  let sequence = 0;
  let dismissed = false;

  function hideResults() {
    dismissed = true;
    results.classList.remove('show');
  }

  function showResults() {
    dismissed = false;
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
      cache: 'no-store',
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
      const canonicalValue = canonicalEmail(value);
      const isEmailSearch = canonicalValue.includes('@');
      let customers;

      if (isEmailSearch) {
        const atIndex = canonicalValue.indexOf('@');
        const domainTyped = canonicalValue.slice(atIndex + 1);
        const broadPrefix = domainTyped.length
          ? `${canonicalValue.slice(0, atIndex + 1)}${domainTyped.charAt(0)}`
          : canonicalValue;
        const broadCustomers = await fetchCustomers(broadPrefix, controller.signal);
        if (!broadCustomers) return;
        customers = broadCustomers.filter(item => canonicalEmail(item.email).startsWith(canonicalValue));
      } else {
        customers = await fetchCustomers(value, controller.signal);
        if (!customers) return;
      }

      if (requestSequence !== sequence || normaliseText(search.value) !== normaliseText(value)) return;
      renderCustomers(customers);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (requestSequence !== sequence) return;
      results.innerHTML = `<div class="result"><b>Search unavailable</b><span>${escapeHtml(error.message)}</span></div>`;
      showResults();
    }
  }

  search.addEventListener('input', () => {
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
  });

  search.addEventListener('focus', () => {
    if (search.value.trim().length >= 2) showResults();
  });

  results.addEventListener('click', event => {
    const item = event.target.closest('[data-id]');
    if (!item) return;
    hideResults();
    search.value = item.dataset.name || '';
    if (typeof window.openCustomer === 'function') window.openCustomer(item.dataset.id);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    hideResults();
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest('.search')) return;
    hideResults();
  }, true);

  const visibilityGuard = new MutationObserver(() => {
    const hasRenderedResults = Boolean(results.querySelector('[data-id], .result'));
    const searchIsActive = document.activeElement === search;
    const shouldRemainVisible = !dismissed && searchIsActive && search.value.trim().length >= 2 && hasRenderedResults;
    if (shouldRemainVisible && !results.classList.contains('show')) {
      results.classList.add('show');
    }
  });

  visibilityGuard.observe(results, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true
  });
})();
