(() => {
  if (!document.querySelector('script[src$="opportunities-layout.js"]')) {
    const layoutScript = document.createElement('script');
    layoutScript.src = './opportunities-layout.js';
    document.body.appendChild(layoutScript);
  }

  function hideDynamicViews(exceptId = '') {
    document.querySelectorAll('main > .content').forEach(view => {
      if (view.id && view.id !== exceptId) view.hidden = true;
    });
  }

  function scrollWorkspaceTop() {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      const main = document.querySelector('main');
      if (main && typeof main.scrollTo === 'function') main.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
  }

  function prepareCustomerView() {
    hideDynamicViews('customerView');
    const customerView = document.getElementById('customerView');
    if (customerView) customerView.hidden = false;
    scrollWorkspaceTop();
  }

  function installCustomerGuard() {
    const original = window.openCustomer;
    if (typeof original !== 'function' || original.__talk2meGuarded) return false;

    const guarded = function customerGuardedOpen(...args) {
      prepareCustomerView();
      return original.apply(this, args);
    };
    guarded.__talk2meGuarded = true;
    window.openCustomer = guarded;
    return true;
  }

  if (!installCustomerGuard()) {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (installCustomerGuard() || attempts >= 40) window.clearInterval(timer);
    }, 250);
  }

  document.addEventListener('click', event => {
    const searchResult = event.target.closest('#results [data-id]');
    const customerButton = event.target.closest('[data-client]');
    if (searchResult || customerButton) {
      prepareCustomerView();
      return;
    }

    const dashboardButton = event.target.closest('#backDashboard');
    if (dashboardButton) {
      window.setTimeout(scrollWorkspaceTop, 0);
      return;
    }

    const trigger = event.target.closest('[data-view]');
    if (!trigger || trigger.hidden) return;

    const target = String(trigger.dataset.view || '');
    if (!target) return;

    if (target === 'home') {
      hideDynamicViews('dashboardView');
      const dashboard = document.getElementById('dashboardView');
      if (dashboard) dashboard.hidden = false;
      scrollWorkspaceTop();
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
