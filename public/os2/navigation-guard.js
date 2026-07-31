(() => {
  function hideDynamicViews(exceptId = '') {
    document.querySelectorAll('main > .content').forEach(view => {
      if (view.id && view.id !== exceptId) view.hidden = true;
    });
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-view]');
    if (!trigger || trigger.hidden) return;

    const target = String(trigger.dataset.view || '');
    if (!target) return;

    if (target === 'home') {
      hideDynamicViews('dashboardView');
      const dashboard = document.getElementById('dashboardView');
      if (dashboard) dashboard.hidden = false;
      return;
    }

    if (target !== 'admin') {
      const administration = document.getElementById('administrationView');
      if (administration) administration.hidden = true;
      const legacyApprovals = document.getElementById('approvalView');
      if (legacyApprovals) legacyApprovals.hidden = true;
    }
  }, true);
})();