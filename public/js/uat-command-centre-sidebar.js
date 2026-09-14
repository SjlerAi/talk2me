(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode) return;
  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');

  function ensureCommandCentreButton() {
    const nav = document.querySelector('.t2m-os-sidebar .t2m-simple-nav');
    if (!nav || nav.querySelector('[data-uat-command-centre]')) return false;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.uatCommandCentre = '1';
    button.dataset.osRoute = `${basePath}/command-centre`;
    button.dataset.routeTitle = 'Command Centre';
    button.dataset.routeIcon = '◆';
    button.setAttribute('aria-label', 'Command Centre');
    button.title = 'Command Centre';
    button.innerHTML = '<span>◆</span><strong>Command Centre</strong>';

    const reports = nav.querySelector('[data-os-app="reports"]');
    const administration = nav.querySelector('[data-os-route$="/backoffice"]');
    const help = nav.querySelector('[data-os-app="help"]');

    if (reports) reports.insertAdjacentElement('afterend', button);
    else if (administration) nav.insertBefore(button, administration);
    else if (help) nav.insertBefore(button, help);
    else nav.appendChild(button);
    return true;
  }

  if (ensureCommandCentreButton()) return;

  const observer = new MutationObserver(() => {
    if (ensureCommandCentreButton()) observer.disconnect();
  });
  observer.observe(document.querySelector('.t2m-os-sidebar') || document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
})();
