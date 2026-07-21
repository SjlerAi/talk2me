(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  const searchInput = document.getElementById('os-global-search');
  const searchResults = document.getElementById('os-search-results');
  if (!configNode || !searchInput || !searchResults || !window.Talk2MeOS?.windows) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function closeResults() {
    searchResults.hidden = true;
    searchResults.innerHTML = '';
    searchInput.setAttribute('aria-expanded', 'false');
  }

  function enhanceEmptyState() {
    const message = searchResults.querySelector('.t2m-os-search-message');
    if (!message || !/No customer found/i.test(message.textContent || '')) return;

    const query = searchInput.value.trim();
    if (!query) return;

    searchResults.innerHTML = `<div class="t2m-search-empty-action">
      <div>
        <strong>No existing customer found</strong>
        <span>Choose whether “${esc(query)}” is only an enquiry prospect or a potential client who must be added to the customer database.</span>
      </div>
      <div class="t2m-search-empty-buttons">
        <button type="button" class="t2m-os-secondary-button" data-search-add-prospect>Add Prospect Inquiry</button>
        <button type="button" class="t2m-os-primary-button" data-search-add-potential-client>Add Potential Client</button>
      </div>
    </div>`;
  }

  new MutationObserver(enhanceEmptyState).observe(searchResults, { childList: true, subtree: true });

  searchResults.addEventListener('click', event => {
    const prospectButton = event.target.closest('[data-search-add-prospect]');
    const clientButton = event.target.closest('[data-search-add-potential-client]');
    if (!prospectButton && !clientButton) return;

    event.preventDefault();
    event.stopPropagation();

    const query = searchInput.value.trim();
    if (prospectButton) {
      const url = `${basePath}/os/quick-add/prospect?prospect_name=${encodeURIComponent(query)}&lead_source=${encodeURIComponent('Customer search')}`;
      window.Talk2MeOS.windows.open({
        id: 'quick:prospect',
        appKey: 'quick-action',
        title: 'Add Prospect Inquiry',
        icon: '+',
        subtitle: 'Enquiry only',
        url,
        width: 860,
        height: 650
      });
    } else {
      const url = `${basePath}/os/potential-client/new?client_name=${encodeURIComponent(query)}`;
      window.Talk2MeOS.windows.open({
        id: 'quick:potential-client',
        appKey: 'quick-action',
        title: 'Add Potential Client',
        icon: 'C',
        subtitle: 'Customer database',
        url,
        width: 900,
        height: 720
      });
    }

    closeResults();
  });
})();
