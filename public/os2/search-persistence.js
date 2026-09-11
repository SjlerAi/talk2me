(() => {
  const search = document.getElementById('search');
  const results = document.getElementById('results');
  if (!search || !results || search.dataset.persistenceInstalled === '1') return;
  search.dataset.persistenceInstalled = '1';

  let selectedResult = false;
  let escapePressed = false;

  function hasSearchText() {
    return String(search.value || '').trim().length >= 2;
  }

  function reopenResults() {
    if (!hasSearchText() || selectedResult || escapePressed || !results.innerHTML.trim()) return;
    results.classList.add('show');
  }

  search.addEventListener('input', () => {
    selectedResult = false;
    escapePressed = false;
  });

  search.addEventListener('focus', () => {
    selectedResult = false;
    escapePressed = false;
    setTimeout(reopenResults, 0);
  });

  results.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-id]')) selectedResult = true;
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest('[data-id]')) return;
    if (!hasSearchText()) return;
    setTimeout(reopenResults, 0);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      escapePressed = true;
      results.classList.remove('show');
    }
  }, true);
})();
