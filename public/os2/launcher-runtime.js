(() => {
  async function loadLaunchers() {
    try {
      const response = await fetch('/api/launchers', { headers:{Accept:'application/json'} });
      if (!response.ok) return;
      const data = await response.json();
      const box = document.querySelector('.tools');
      if (!box || !data.ok) return;
      box.innerHTML = '<p>WORK TOOLS</p>' + data.items.map(item => `<button type="button" title="${String(item.link_name).replace(/"/g,'&quot;')}" data-launcher-url="${String(item.link_url).replace(/"/g,'&quot;')}">${String(item.icon_text || '↗').replace(/[<>]/g,'')}</button>`).join('');
      box.querySelectorAll('[data-launcher-url]').forEach(button => button.addEventListener('click', () => window.open(button.dataset.launcherUrl, '_blank', 'noopener,noreferrer')));
    } catch (error) { console.error('Launcher load failed', error); }
  }
  window.loadLaunchers = loadLaunchers;
  loadLaunchers();
})();
