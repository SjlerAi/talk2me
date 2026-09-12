(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const panelMode = params.get('panel') === '1' && window.parent !== window;

  if (panelMode) {
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if (!link || link.hasAttribute('download') || link.hasAttribute('data-panel-self')) return;

      let url;
      try { url = new URL(link.href, location.href); } catch (_) { return; }
      if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      url.searchParams.delete('panel');
      const title = String(link.dataset.routeTitle || link.textContent || document.title || 'Talk2Me').trim().replace(/\s+/g, ' ').slice(0, 90) || 'Talk2Me';
      const icon = String(link.dataset.routeIcon || 'C').trim().slice(0, 4) || 'C';
      window.parent.postMessage({
        type: 'talk2me:open-route',
        url: url.href,
        title,
        icon
      }, location.origin);
    }, true);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const match = location.pathname.match(/\/customers\/(\d+)\/360\/?$/);
    if (!match) return;
    const actions = document.querySelector('.customer-head .hero-actions');
    if (!actions) return;

    const labels = [...actions.querySelectorAll('a,button')].map(x => x.textContent.trim().toLowerCase());
    const primary = actions.querySelector('a');
    let mobile = null;
    const panelSuffix = params.get('panel') === '1' ? '?panel=1' : '';

    document.querySelectorAll(`a[href*="/customers/${match[1]}/notes/new"]`).forEach(link => {
      if (!panelMode) {
        link.target = '_blank';
        link.rel = 'noopener';
      } else {
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }
    });

    if (!labels.includes('add mobile line')) {
      mobile = document.createElement('a');
      mobile.className = 'btn opportunity';
      mobile.href = `${location.pathname.replace(/\/360\/?$/, '')}/add-mobile${panelSuffix}`;
      mobile.textContent = 'Add Mobile Line';
      actions.insertBefore(mobile, primary?.nextSibling || actions.firstChild);
    }

    if (!labels.includes('add fixed service')) {
      const fixed = document.createElement('a');
      fixed.className = 'btn opportunity';
      fixed.href = `${location.pathname.replace(/\/360\/?$/, '')}/add-fixed${panelSuffix}`;
      fixed.textContent = 'Add Fixed Service';
      actions.insertBefore(fixed, mobile?.nextSibling || primary?.nextSibling || actions.firstChild);
    }
  });
})();
