(() => {
  function addStyles() {
    if (document.getElementById('opportunitiesLayoutStyles')) return;
    const style = document.createElement('style');
    style.id = 'opportunitiesLayoutStyles';
    style.textContent = `
      .opp-filter-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;padding:16px 18px;margin:0 0 14px;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 24px rgba(46,93,119,.05)}
      .opp-filter-group{display:grid;gap:8px;min-width:0}
      .opp-filter-group.period{justify-items:start}
      .opp-filter-label{font-size:11px;font-weight:900;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
      .opp-filter-panel .opp-controls{margin:0!important}
      .opp-filter-panel .opp-controls button{white-space:nowrap}
      .opp-toolbar{margin:0 0 14px!important}
      @media(max-width:900px){.opp-filter-panel{grid-template-columns:1fr;gap:14px}.opp-filter-group.period{justify-items:stretch}}
      @media(max-width:560px){.opp-filter-panel{padding:14px}.opp-filter-panel .opp-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.opp-filter-panel .opp-controls button{width:100%;padding:10px 8px}}
    `;
    document.head.appendChild(style);
  }

  function applyLayout() {
    const view = document.getElementById('opportunityView');
    const types = document.getElementById('oppTypes');
    const days = document.getElementById('oppDays');
    const toolbar = view?.querySelector('.opp-toolbar');
    if (!view || !types || !days || !toolbar) return false;
    if (view.querySelector('.opp-filter-panel')) return true;

    addStyles();
    const panel = document.createElement('section');
    panel.className = 'opp-filter-panel';
    panel.innerHTML = `
      <div class="opp-filter-group">
        <div class="opp-filter-label">Opportunity type</div>
      </div>
      <div class="opp-filter-group period">
        <div class="opp-filter-label">Period</div>
      </div>`;

    const groups = panel.querySelectorAll('.opp-filter-group');
    groups[0].appendChild(types);
    groups[1].appendChild(days);
    toolbar.parentNode.insertBefore(panel, toolbar);
    return true;
  }

  if (!applyLayout()) {
    const observer = new MutationObserver(() => {
      if (applyLayout()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
  }
})();
