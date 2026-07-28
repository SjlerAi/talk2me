(() => {
  'use strict';
  const strip = document.querySelector('.t2m-os-launcher-scroll');
  const previous = document.querySelector('[data-launcher-scroll="previous"]');
  const next = document.querySelector('[data-launcher-scroll="next"]');
  const configNode = document.getElementById('talk2me-os-config');
  const config = configNode ? JSON.parse(configNode.textContent || '{}') : {};
  const basePath = String(config.basePath || '');
  if (!strip || !previous || !next) return;

  function update() {
    const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
    previous.disabled = strip.scrollLeft <= 4;
    next.disabled = strip.scrollLeft >= max - 4;
  }

  function move(direction) {
    const amount = Math.max(260, Math.round(strip.clientWidth * 0.72));
    strip.scrollBy({ left: amount * direction, behavior: 'smooth' });
  }

  function paintCount(selector, value) {
    document.querySelectorAll(selector).forEach(node => {
      node.textContent = String(value || 0);
      node.hidden = !value;
    });
  }

  async function refreshAssignments() {
    try {
      const response = await fetch(`${basePath}/api/client-assignments/status`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      paintCount('[data-badge="unassignedClients"]', data.unassignedCount);
      document.querySelectorAll('[data-status="unassignedClientCount"]').forEach(node => {
        node.textContent = String(data.unassignedCount || 0);
        node.dataset.positive = String(Number(data.unassignedCount || 0) > 0);
      });
    } catch (_) {}
  }

  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  strip.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  window.addEventListener('workspace:refresh', refreshAssignments);
  new MutationObserver(update).observe(strip, { childList: true });
  update();
  refreshAssignments();
  setInterval(refreshAssignments, 15000);
})();
