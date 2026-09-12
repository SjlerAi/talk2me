(() => {
  'use strict';

  const shell = document.getElementById('talk2me-os');
  if (!shell) return;

  const media = window.matchMedia('(min-width: 761px) and (max-width: 1180px)');

  function applyResponsiveState() {
    const narrowDesktop = media.matches;
    shell.classList.toggle('is-uat-auto-collapsed', narrowDesktop);
  }

  applyResponsiveState();
  if (typeof media.addEventListener === 'function') media.addEventListener('change', applyResponsiveState);
  else if (typeof media.addListener === 'function') media.addListener(applyResponsiveState);
  window.addEventListener('resize', applyResponsiveState, { passive: true });
})();
