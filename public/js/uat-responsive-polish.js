(() => {
  'use strict';

  const shell = document.getElementById('talk2me-os');
  if (!shell) return;

  const media = window.matchMedia('(min-width: 761px) and (max-width: 1180px)');

  function compactSessionControl() {
    const attendance = document.querySelector('.t2m-os-top-actions .attendance-user-control');
    const logoutForm = document.querySelector('.t2m-os-top-actions > form');
    const logoutButton = logoutForm?.querySelector('button');
    if (!attendance || !logoutForm || !logoutButton || logoutButton.classList.contains('t2m-compact-session')) return;

    const name = attendance.querySelector('.attendance-user-copy strong')?.textContent?.trim() || 'Staff';
    const status = attendance.querySelector('.attendance-user-copy small')?.textContent?.trim() || 'Signed in';
    const isClockedIn = attendance.classList.contains('is-active');

    logoutButton.className = 't2m-compact-session';
    logoutButton.innerHTML = `<span class="t2m-compact-user"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(status.replace('Clocked in · ', 'In · '))}</small></span><span class="t2m-compact-clockout">${isClockedIn ? 'Clock out' : 'Log out'}</span>`;
    logoutButton.setAttribute('aria-label', isClockedIn ? `Clock out ${name}` : `Log out ${name}`);
    attendance.remove();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
  }

  function applyResponsiveState() {
    shell.classList.toggle('is-uat-auto-collapsed', media.matches);
  }

  compactSessionControl();
  applyResponsiveState();

  if (typeof media.addEventListener === 'function') media.addEventListener('change', applyResponsiveState);
  else if (typeof media.addListener === 'function') media.addListener(applyResponsiveState);
  window.addEventListener('resize', applyResponsiveState, { passive: true });
})();
