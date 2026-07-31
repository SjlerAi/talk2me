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

  function installCustomerGuard() {
    const original = window.openCustomer;
    if (typeof original !== 'function' || original.__talk2meGuarded) return false;

    const guarded = function customerGuardedOpen(...args) {
      hideDynamicViews('customerView');
      const customerView = document.getElementById('customerView');
      if (customerView) customerView.hidden = false;
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
