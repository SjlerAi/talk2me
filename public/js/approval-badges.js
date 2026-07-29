(() => {
  'use strict';

  const script = document.currentScript;
  const configNode = document.getElementById('talk2me-os-config');
  let config = {};
  try { config = configNode ? JSON.parse(configNode.textContent || '{}') : {}; } catch (_) {}
  const basePath = String(script?.dataset.basePath || config.basePath || '');
  let running = false;

  function paint(count) {
    const value = Number(count || 0);
    document.querySelectorAll('[data-approval-count]').forEach(node => {
      node.textContent = String(value);
      node.hidden = value < 1;
      node.classList.toggle('has-count', value > 0);
    });
    document.querySelectorAll('[data-approval-label]').forEach(node => {
      node.textContent = value > 0 ? 'Approvals Needed' : 'Approvals';
    });
    document.querySelectorAll('[data-status="approvalCount"]').forEach(node => {
      node.textContent = String(value);
      node.dataset.positive = String(value > 0);
    });
  }

  async function refresh() {
    if (running) return;
    running = true;
    try {
      const response = await fetch(`${basePath}/api/approvals/status`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const data = await response.json();
      paint(data.count);
    } catch (_) {
      // Keep the last visible count during a temporary network failure.
    } finally {
      running = false;
    }
  }

  refresh();
  setInterval(refresh, 15000);
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'talk2me:approval-updated') refresh();
  });
})();
