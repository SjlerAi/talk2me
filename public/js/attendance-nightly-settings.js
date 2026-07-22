(() => {
  'use strict';

  const form = document.querySelector('.attendance-settings-form');
  if (!form) return;

  const basePath = new URL(form.action, window.location.href).pathname.replace(/\/backoffice\/attendance\/settings$/, '');

  async function load() {
    try {
      const response = await fetch(`${basePath}/api/attendance/nightly-settings`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const settings = await response.json();
      const panel = new URLSearchParams(window.location.search).get('panel') === '1';
      const section = document.createElement('section');
      section.className = 'attendance-nightly-logout-card';
      section.innerHTML = `
        <div>
          <div class="eyebrow">Security and session control</div>
          <h3>Automatic Daily Logout</h3>
          <p>At the configured time, Talk2Me closes all active attendance and login sessions. Staff must log in again before continuing.</p>
        </div>
        <form method="post" action="${basePath}/backoffice/attendance/nightly-logout" class="attendance-nightly-logout-form">
          ${panel ? '<input type="hidden" name="panel" value="1">' : ''}
          <label class="attendance-switch">
            <input type="checkbox" name="auto_logout_enabled" value="1" ${settings.enabled ? 'checked' : ''}>
            <span></span><strong>Enable automatic daily logout</strong>
          </label>
          <label>Default logout time
            <small>Current timezone: ${settings.timezone}</small>
            <input type="time" name="auto_logout_time" value="${settings.time || '22:00'}" required>
          </label>
          <button class="btn primary" type="submit">Save Automatic Logout</button>
          <small>${settings.lastRunDate ? `Last automatic logout: ${String(settings.lastRunDate).slice(0, 10)}` : 'No automatic logout has run yet.'}</small>
        </form>`;
      form.before(section);
    } catch (_) {
      // Working-hours settings remain usable if this optional panel cannot load.
    }
  }

  load();
})();
