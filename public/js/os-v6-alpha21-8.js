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

  function enhanceEmptyState() {
    const message = searchResults.querySelector('.t2m-os-search-message');
    if (!message || !/No customer found/i.test(message.textContent || '')) return;

    const query = searchInput.value.trim();
    if (!query) return;

    searchResults.innerHTML = `<div class="t2m-search-empty-action">
      <div>
        <strong>No customer found</strong>
        <span>No existing record matches “${esc(query)}”.</span>
      </div>
      <button type="button" class="t2m-os-primary-button" data-search-add-prospect>Add new customer / enquiry</button>
    </div>`;
  }

  new MutationObserver(enhanceEmptyState).observe(searchResults, { childList: true, subtree: true });

  searchResults.addEventListener('click', event => {
    const button = event.target.closest('[data-search-add-prospect]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const query = searchInput.value.trim();
    const url = `${basePath}/os/quick-add/prospect?prospect_name=${encodeURIComponent(query)}&lead_source=${encodeURIComponent('Customer search')}`;

    window.Talk2MeOS.windows.open({
      id: 'quick:prospect',
      appKey: 'quick-action',
      title: 'Add New Customer / Enquiry',
      icon: '+',
      subtitle: 'New prospect',
      url,
      width: 860,
      height: 650
    });

    searchResults.hidden = true;
    searchResults.innerHTML = '';
    searchInput.setAttribute('aria-expanded', 'false');
  });
})();
