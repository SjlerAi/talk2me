(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');
  const isManagement = Boolean(config.isManagement);
  const tk2mPreview = Boolean(config.isStaging) || window.location.hostname === 'crm.tk2m.co.za';

  function openWorkWindow(options = {}) {
    const manager = window.Talk2MeOS?.windows;
    if (manager?.open) return manager.open(options);
    // Never replace My Day when the OS window manager has not finished loading.
    // A separate same-origin window is a safe fallback: closing it returns to
    // the unchanged workspace. A blocked popup must fail closed.
    if (options.url) {
      let destination;
      try { destination = new URL(options.url, window.location.href); } catch (_) { return null; }
      if (destination.origin !== window.location.origin) return null;
      const name = 'tk2m-work-' + String(options.id || 'details').replace(/[^a-zA-Z0-9_-]/g, '-');
      const popup = window.open(destination.href, name,
        'popup=yes,width=1120,height=720,resizable=yes,scrollbars=yes');
      if (popup) {
        try { popup.opener = null; popup.focus(); } catch (_) {}
        return popup;
      }
      window.alert('Work window blocked. Allow CRM pop-ups and try again. Your My Day screen is unchanged.');
    }
    return null;
  }
  const shell = document.getElementById('talk2me-os');
  const workspace = document.getElementById('os-workspace');
  const sidebar = document.querySelector('.t2m-os-sidebar');
  const launcher = document.querySelector('.t2m-os-launcher');
  const topActions = document.querySelector('.t2m-os-top-actions');
  if (!shell || !workspace || !sidebar) return;
  if (shell.dataset.calendarHomeReady === '1') return; // Idempotent if another loader retries.

  const palette = [
    '#7c3aed', '#2563eb', '#059669', '#ea580c', '#db2777', '#0891b2', '#9333ea', '#16a34a',
    '#c2410c', '#0284c7', '#be123c', '#4f46e5', '#0f766e', '#a16207', '#6d28d9', '#b91c1c',
    '#0369a1', '#15803d', '#9f1239', '#4338ca'
  ];
  const eventMeta = {
    task: { icon: '✓', label: 'Task' },
    'follow-up': { icon: '↻', label: 'Follow-up' },
    callback: { icon: '☎', label: 'Callback' },
    birthday: { icon: '★', label: 'Birthday' },
    upgrade: { icon: '↗', label: 'Upgrade' },
    reminder: { icon: '●', label: 'Reminder' },
    appointment: { icon: '◷', label: 'Appointment' },
    other: { icon: '•', label: 'Other' }
  };

  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const staffAliases = new Map([
    ['gertrudia johanna le roux', 'Gerda'],
    ['gertruida johanna le roux', 'Gerda'],
    ['elias booyens', 'Sias'],
    ['jonathan olivier', 'Johnny']
  ]);

  const shortStaffName = value => {
    const raw = String(value ?? '').trim();
    if (!raw || raw.toLowerCase() === 'unassigned') return 'Unassigned';
    const alias = staffAliases.get(raw.toLowerCase());
    if (alias) return alias;
    const parts = raw.split(/\s+/).filter(Boolean);
    const first = String(parts[0] || '').toLowerCase();
    if (first === 'gertruida' || first === 'gertrudia') return 'Gerda';
    if (first === 'van' && String(parts[1] || '').toLowerCase() === 'zyl') return 'Van Zyl';
    return parts[0] || raw;
  };

  const staffKey = item => {
    const id = Number(item?.assignedTo || 0);
    if (Number.isInteger(id) && id > 0) return `id:${id}`;
    return `name:${String(item?.assignedName || 'Unassigned').trim().toLowerCase()}`;
  };

  const staffColor = item => {
    const key = staffKey(item);
    if (key === 'name:unassigned') return '#64748b';
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
    return palette[Math.abs(hash) % palette.length];
  };

  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const monthStart = date => new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0);
  const monthName = date => new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(date);
  const humanDate = value => new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));

  function rangeFor(month) {
    const first = monthStart(month);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 41);
    return { start: iso(start), end: iso(end), startDate: start };
  }

  async function jsonFetch(path, options = {}) {
    const response = await fetch(`${basePath}${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function mountMobileMenu() {
    if (!topActions || topActions.querySelector('[data-mobile-menu-toggle]')) return;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 't2m-os-icon-button t2m-mobile-menu-toggle';
    toggle.dataset.mobileMenuToggle = '1';
    toggle.setAttribute('aria-label', 'Open Talk2Me menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span aria-hidden="true">☰</span>';
    topActions.insertBefore(toggle, topActions.firstChild);

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 't2m-mobile-menu-backdrop';
    backdrop.dataset.mobileMenuBackdrop = '1';
    backdrop.setAttribute('aria-label', 'Close Talk2Me menu');
    backdrop.hidden = true;

    const menu = document.createElement('nav');
    menu.className = 't2m-mobile-menu';
    menu.dataset.mobileMenu = '1';
    menu.setAttribute('aria-label', 'Talk2Me mobile navigation');
    menu.hidden = true;

    shell.appendChild(backdrop);
    shell.appendChild(menu);

    const renderMenu = () => {
      const source = sidebar.querySelector('.t2m-simple-nav');
      const status = config.status || {};
      const quick = tk2mPreview ? [{app:'work',icon:'✓',label:'Work',badge:Number(status.taskCount||0)}] : [];

      menu.innerHTML = '<header><div><span>Talk2Me</span><strong>Menu</strong></div><button type="button" data-mobile-menu-close aria-label="Close menu">×</button></header><div class="t2m-mobile-menu-grid" data-mobile-menu-grid></div>';
      const grid = menu.querySelector('[data-mobile-menu-grid]');

      quick.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.osApp = item.app;
        button.innerHTML = `<span>${item.icon}</span><strong>${item.label}</strong>${item.badge ? `<b>${item.badge}</b>` : ''}`;
        grid.appendChild(button);
      });

      source?.querySelectorAll('button').forEach(sourceButton => {
        const button = sourceButton.cloneNode(true);
        button.removeAttribute('id');
        button.classList.remove('is-open');
        grid.appendChild(button);
      });
    };

    const setOpen = open => {
      if (open) renderMenu();
      menu.hidden = !open;
      backdrop.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      shell.classList.toggle('is-mobile-menu-open', open);
      if (open) menu.querySelector('button:not([data-mobile-menu-close])')?.focus();
    };

    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setOpen(menu.hidden);
    });
    backdrop.addEventListener('click', () => setOpen(false));
    menu.addEventListener('click', event => {
      if (event.target.closest('[data-mobile-menu-close]')) {
        setOpen(false);
        return;
      }
      if (event.target.closest('button')) setTimeout(() => setOpen(false), 0);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) setOpen(false);
    });
    const phone = window.matchMedia('(max-width:760px)');
    const closeOnDesktop = event => { if (!event.matches) setOpen(false); };
    if (typeof phone.addEventListener === 'function') phone.addEventListener('change', closeOnDesktop);
    else if (typeof phone.addListener === 'function') phone.addListener(closeOnDesktop);
  }

  function simplifyShell() {
    shell.classList.add('t2m-calendar-home-shell');
    if (tk2mPreview) {
      shell.classList.add('t2m-tk2m-test-shell');
      launcher?.removeAttribute('hidden');
    } else {
      launcher?.setAttribute('hidden', '');
    }

    sidebar.querySelectorAll(':scope > .t2m-os-sidebar-section').forEach(section => section.remove());
    const section = document.createElement('div');
    section.className = 't2m-os-sidebar-section t2m-simple-nav';
    section.innerHTML = tk2mPreview ? `<span class="t2m-os-sidebar-label">Navigate</span>
      <button type="button" class="is-current" data-home-today aria-label="My Day" title="My Day"><span>□</span><strong>My Day</strong></button>
      <button type="button" data-os-launch="customers" aria-label="Customers" title="Customers"><span>C</span><strong>Customers</strong></button>
      <button type="button" data-os-route="${basePath}/library" data-route-title="Library" data-route-icon="L" aria-label="Library" title="Library"><span>L</span><strong>Library</strong></button>
      <button type="button" data-os-route="${basePath}/data-review" data-route-title="Data Review" data-route-icon="✓" aria-label="Data Review" title="Data Review"><span>✓</span><strong>Data Review</strong></button>
      ${isManagement ? `<button type="button" data-os-app="reports" aria-label="Reports" title="Reports"><span>▦</span><strong>Reports</strong></button>
      <button type="button" data-os-route="${basePath}/backoffice" data-route-title="Administration" data-route-icon="⚙" aria-label="Administration" title="Administration"><span>⚙</span><strong>Administration</strong></button>` : ''}
      <button type="button" data-os-app="help" aria-label="Help" title="Help"><span>?</span><strong>Help</strong></button>` : `<span class="t2m-os-sidebar-label">Work</span>
      <button type="button" class="is-current" data-home-today aria-label="My Day" title="My Day"><span>□</span><strong>My Day</strong></button>
      <button type="button" data-os-app="work" aria-label="Work" title="Work"><span>✓</span><strong>Work</strong></button>
      <button type="button" data-os-launch="customers" aria-label="Customers" title="Customers"><span>C</span><strong>Customers</strong></button>
      <button type="button" data-os-route="${basePath}/library" data-route-title="Library" data-route-icon="L" aria-label="Library" title="Library"><span>L</span><strong>Library</strong></button>
      ${isManagement ? `<button type="button" data-os-route="${basePath}/command-centre" data-route-title="Team" data-route-icon="◆" aria-label="Team" title="Team"><span>◆</span><strong>Team</strong></button>
      <button type="button" data-os-app="reports" aria-label="Reports" title="Reports"><span>▦</span><strong>Reports</strong></button>
      <button type="button" data-os-route="${basePath}/backoffice" data-route-title="Administration" data-route-icon="⚙" aria-label="Administration" title="Administration"><span>⚙</span><strong>Administration</strong></button>` : ''}
      <button type="button" data-os-app="help" aria-label="Help" title="Help"><span>?</span><strong>Help</strong></button>`;
    sidebar.appendChild(section);

    const launcherScroll = launcher?.querySelector('.t2m-os-launcher-scroll');
    if (shell.dataset.tk2mEnvironment !== 'TK2M LIVE' && launcherScroll && !launcherScroll.querySelector('[data-uat-work-launcher]')) {
      const workLauncher = document.createElement('button');
      workLauncher.type = 'button';
      workLauncher.dataset.uatWorkLauncher = '1';
      workLauncher.dataset.osApp = 'work';
      workLauncher.setAttribute('aria-label', 'Work');
      workLauncher.title = 'Work';
      workLauncher.innerHTML = '<span class="t2m-brand-mark customer">W</span><strong>Work</strong><b data-badge="work" hidden></b>';
      const customerLauncher = launcherScroll.querySelector('[data-os-launch="customers"]');
      if (customerLauncher) launcherScroll.insertBefore(workLauncher, customerLauncher);
      else launcherScroll.prepend(workLauncher);
    }

    mountMobileMenu();

    if (topActions && !topActions.querySelector('[data-os-app="notes"]')) {
      const notes = document.createElement('button');
      notes.type = 'button';
      notes.className = 't2m-os-icon-button t2m-top-sticky-button';
      notes.dataset.osApp = 'notes';
      notes.title = 'Sticky note';
      notes.setAttribute('aria-label', 'Open sticky note');
      notes.innerHTML = '<span aria-hidden="true">✎</span>';
      topActions.insertBefore(notes, topActions.firstChild);
    }

    if (topActions && !topActions.querySelector('[data-uat-deals-launcher]')) {
      const deals = document.createElement('button');
      deals.type = 'button';
      deals.className = 't2m-os-icon-button t2m-top-deals-button';
      deals.setAttribute('data-uat-deals-launcher', '1');
      deals.dataset.osRoute = `${basePath}/deals`;
      deals.dataset.routeTitle = 'Deals';
      deals.dataset.routeIcon = '🤝';
      deals.title = 'Deals';
      deals.setAttribute('aria-label', 'Open Deals');
      deals.setAttribute('aria-pressed', 'false');
      deals.innerHTML = '<span aria-hidden="true">🤝</span>';

      const notesButton = topActions.querySelector('[data-os-app="notes"]');
      if (notesButton?.nextSibling) topActions.insertBefore(deals, notesButton.nextSibling);
      else topActions.appendChild(deals);

      document.addEventListener('click', event => {
        const routeButton = event.target.closest('[data-os-route]');
        if (!routeButton) return;
        const active = routeButton === deals;
        deals.classList.toggle('is-active', active);
        deals.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
  }

  function mountCalendar() {
    const today = iso(new Date());
    workspace.innerHTML = `<section class="t2m-home-calendar" aria-label="My Day calendar">
      <header class="t2m-home-calendar-head">
        <div>
          <span>Talk2Me work planner</span>
          <h1>My Day</h1>
          <p>${tk2mPreview ? (isManagement ? 'Your calendar first. Switch between your day and the team, with staff colours showing responsibility.' : 'Your calendar, tasks, reminders and messages in one place.') : (isManagement ? 'Team view shows the whole office. Staff colours show responsibility.' : 'Your tasks, customers and dated work in one place.')}</p>
        </div>
        <div class="t2m-home-actions">
          <button type="button" data-home-add-task>${tk2mPreview?'+ Send':'+ Task'}</button>
          <button type="button" data-home-add-reminder>+ Reminder</button>
        </div>
      </header>
      ${tk2mPreview ? `<section class="t2m-home-focus" aria-label="Daily priorities">
        <section class="t2m-home-attention-strip" data-home-attention-strip aria-label="Communications">
          <div class="t2m-home-attention-copy">
            <strong>TODAY'S COMMUNICATIONS</strong>
            <span data-home-attention-summary>Checking today's communications...</span>
            <small data-home-alert-status>Checking red alerts...</small>
          </div>
          <div class="t2m-home-attention-actions">
            <button type="button" data-home-quick-send aria-label="Send communication">+ Send</button>
            <button type="button" data-os-app="messages" aria-label="Open all recent communications">Communications</button>
          </div>
          <div class="t2m-home-priority-carousel" data-home-priority-carousel aria-label="Browse today's communications">
            <button type="button" class="t2m-home-priority-arrow" data-home-priority-prev aria-label="Previous communications" title="Previous communications" hidden>‹</button>
            <div class="t2m-home-priority-list" data-home-priority-list role="list" aria-label="Today's communications" aria-live="polite">
              <span class="t2m-home-priority-loading">Loading current instructions...</span>
            </div>
            <button type="button" class="t2m-home-priority-arrow" data-home-priority-next aria-label="Next communications" title="Next communications" hidden>›</button>
          </div>
        </section>
        <button type="button" data-home-focus="tasks" aria-label="View selected-day calendar actions">
          <span>Calendar actions</span><strong data-home-focus-count="tasks">—</strong><small>Selected day · agenda</small>
        </button>
        <button type="button" data-home-focus="reminders" aria-label="Add a reminder for the selected date">
          <span>Reminders</span><strong data-home-focus-count="reminders">—</strong><small>Tap to add · selected date</small>
        </button>
        <button type="button" data-home-focus="messages" data-os-app="messages" aria-label="Open recent communications">
          <span>Today</span><strong data-home-focus-count="messages">—</strong><small>Today's communication history</small>
        </button>
        <button type="button" data-home-focus="overdue" aria-label="Open outstanding work from previous days">
          <span>Outstanding Work</span><strong data-home-focus-count="overdue">—</strong><small>Previous days · unfinished</small>
        </button>
      </section>` : ''}
      <div class="t2m-home-calendar-controls">
        <button type="button" data-home-prev aria-label="Previous month">‹</button>
        <button type="button" data-home-today-button>Today</button>
        <strong data-home-month></strong>
        <button type="button" data-home-next aria-label="Next month">›</button>
        ${isManagement ? '<div class="t2m-home-scope"><button type="button" data-home-scope="mine">Mine</button><button type="button" data-home-scope="team">Team</button></div>' : '<div class="t2m-home-scope"><button type="button" data-home-scope="all">All</button><button type="button" data-home-scope="mine">My Own</button></div>'}
      </div>
      <div class="t2m-home-team-filter" data-home-team-filter hidden></div>
      <div class="t2m-home-calendar-layout">
        <section class="t2m-home-month">
          <div class="t2m-home-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
          <div class="t2m-home-grid" data-home-grid></div>
        </section>
        <aside class="t2m-home-agenda${tk2mPreview?' t2m-home-carry-panel':''}">
          ${tk2mPreview ? `
            <header class="t2m-home-carry-header">
              <div><span>Unfinished instructions from previous days</span><strong>Outstanding Work</strong></div>
              <b data-home-carry-count>0</b>
            </header>
            <div data-home-carry-feedback class="t2m-home-carry-feedback" role="status" aria-live="polite" hidden></div>
            <div class="t2m-home-carry-list" data-home-carry-list aria-label="Outstanding work that requires a reply or completion"></div>
            <details class="t2m-home-calendar-fold" data-home-calendar-fold>
              <summary>Selected date · <strong data-home-agenda-date></strong> (<b data-home-agenda-count>0</b>)</summary>
              <div class="t2m-home-agenda-list" data-home-agenda></div>
            </details>
          ` : `
            <header><div><span>Selected date</span><strong data-home-agenda-date></strong></div><b data-home-agenda-count>0</b></header>
            <div class="t2m-home-agenda-list" data-home-agenda></div>
          `}
        </aside>
      </div>
      <dialog class="t2m-home-reminder-dialog" data-home-reminder-dialog>
        <form method="dialog" data-home-reminder-form>
          <header><div><span>Quick reminder</span><strong>Add to calendar</strong></div><button value="cancel" aria-label="Close">×</button></header>
          <label>Title<input name="title" maxlength="255" required placeholder="What must you remember?"></label>
          <div class="t2m-home-reminder-row"><label>Date<input name="date" type="date" required></label><label>Time<input name="time" type="time" value="09:00"></label></div>
          <label>Details<textarea name="details" maxlength="5000" rows="4" placeholder="Optional note or telephone number"></textarea></label>
          <p data-home-reminder-status></p>
          <footer><button value="cancel" class="secondary">Cancel</button><button type="button" data-home-reminder-save>Save reminder</button></footer>
        </form>
      </dialog>
    </section>`;

    const state = {
      month: monthStart(new Date()),
      selected: today,
      scope: isManagement ? 'team' : 'all',
      staffFilter: null,
      events: [],
      loading: false,
      error: '',
      focus: { messages: null, overdue: null, openWork: null },
      communications: [],
      outstanding: [],
      outstandingTotal: 0,
      carryExpanded: false,
      carryBusy: false,
      attentionError: null,
      agendaExpanded: false,
      priorityPage: 0
    };

    const grid = workspace.querySelector('[data-home-grid]');
    const monthLabel = workspace.querySelector('[data-home-month]');
    const agendaDate = workspace.querySelector('[data-home-agenda-date]');
    const agendaCount = workspace.querySelector('[data-home-agenda-count]');
    const agenda = workspace.querySelector('[data-home-agenda]');
    const carryList = workspace.querySelector('[data-home-carry-list]');
    const carryCount = workspace.querySelector('[data-home-carry-count]');
    const carryFeedback = workspace.querySelector('[data-home-carry-feedback]');
    const teamFilter = workspace.querySelector('[data-home-team-filter]');
    const dialog = workspace.querySelector('[data-home-reminder-dialog]');
    const reminderForm = workspace.querySelector('[data-home-reminder-form]');
    const reminderStatus = workspace.querySelector('[data-home-reminder-status]');

    const visibleEvents = () => state.staffFilter
      ? state.events.filter(item => staffKey(item) === state.staffFilter)
      : state.events;

    const staffFromEvents = () => {
      const map = new Map();
      for (const item of state.events) {
        const key = staffKey(item);
        if (!map.has(key)) map.set(key, {
          key,
          name: shortStaffName(item.assignedName),
          color: staffColor(item)
        });
      }
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    };

    function renderStaffFilters() {
      if (!isManagement || state.scope !== 'team') {
        teamFilter.hidden = true;
        teamFilter.innerHTML = '';
        return;
      }
      const people = staffFromEvents();
      teamFilter.hidden = false;
      teamFilter.innerHTML = `<button type="button" class="${state.staffFilter ? '' : 'is-active'}" data-staff-filter="all"><i style="--staff-color:#202832"></i>All staff</button>${people.map(person => `<button type="button" class="${state.staffFilter === person.key ? 'is-active' : ''}" data-staff-filter="${esc(person.key)}"><i style="--staff-color:${person.color}"></i>${esc(person.name)}</button>`).join('')}`;
      teamFilter.querySelectorAll('[data-staff-filter]').forEach(button => {
        button.onclick = () => {
          const value = button.dataset.staffFilter;
          state.staffFilter = value === 'all' ? null : value;
          state.priorityPage = 0;
          render();
        };
      });
    }

    function openCommunications(item=null,view='today') {
      const options={scope:isManagement&&state.scope==='team'?'team':'mine',view};
      if(item?.kind==='task')options.focusTaskId=Number(item.id);
      if(window.Talk2MeUnifiedInbox?.open)return window.Talk2MeUnifiedInbox.open(options);
      document.querySelector('[data-os-app="work"]')?.click();
    }
    function renderPriority() {
      if(!tk2mPreview)return;
      const panel=workspace.querySelector('[data-home-priority-list]');
      if(!panel)return;
      if(state.attentionError){
        panel.innerHTML='<div class="t2m-home-priority-empty">Communications unavailable. Open the list to retry.</div>';
        return;
      }
      const scoped=state.staffFilter && isManagement && state.scope==='team'
        ?state.communications.filter(item=>item.kind==='task' &&
           staffKey({assignedTo:item.assignedTo,assignedName:item.recipient})===state.staffFilter)
        :state.communications;
      const pages=Math.ceil(scoped.length/3);
      state.priorityPage=pages ? Math.min(state.priorityPage,pages-1) : 0;
      const latest=scoped.slice(state.priorityPage*3,(state.priorityPage+1)*3);
      const frame=workspace.querySelector('[data-home-priority-carousel]');
      const prev=workspace.querySelector('[data-home-priority-prev]');
      const next=workspace.querySelector('[data-home-priority-next]');
      const hasPages=pages>1;
      frame?.classList.toggle('has-pages',hasPages);
      if(prev){
        prev.hidden=!hasPages;
        prev.onclick=()=>{state.priorityPage=(state.priorityPage-1+pages)%pages;renderPriority();};
      }
      if(next){
        next.hidden=!hasPages;
        next.onclick=()=>{state.priorityPage=(state.priorityPage+1)%pages;renderPriority();};
      }
      if(!latest.length){
        panel.innerHTML='<div class="t2m-home-priority-empty">No communications sent or received today.</div>';
        return;
      }
      panel.innerHTML=latest.map((item,index)=>{
        const sender=shortStaffName(item.sender),recipient=shortStaffName(item.recipient);
        const who=item.kind==='task'?sender+' → '+recipient
          :item.direction==='sent'?'To '+recipient:'From '+sender;
        const title=String(item.text||item.subject||'Communication')
          .replace(/\s+/g,' ').trim();
        const color=item.kind==='task'
          ?staffColor({assignedTo:item.assignedTo,assignedName:item.recipient})
          :'#ab2330';
        return `<article class="t2m-home-priority-item" role="listitem" style="--staff-color:${color}">
          <button type="button" class="t2m-home-priority-open" data-home-priority-open="${index}"
            aria-label="Open communication: ${esc(who)} – ${esc(title)}">
            <span class="t2m-home-priority-who">${esc(who)}</span>
            <strong title="${esc(title)}">${esc(title)}</strong>
          </button>
          <div class="t2m-home-priority-actions">
            <button type="button" data-priority-reply="${index}">Reply</button>
            ${item.kind==='task'&&item.canComplete?`<button type="button" class="is-done" data-priority-done="${index}">Done</button>`:''}
          </div>
          ${item.kind==='task'?`<form class="t2m-home-priority-reply" data-priority-form="${index}" hidden>
            <input id="priority-reply-${index}" type="text" maxlength="4000"
              aria-label="Reply to ${esc(who)}" placeholder="Type reply…" required>
            <button type="submit">Send</button>
          </form>`:''}
          <small class="t2m-home-priority-feedback" data-priority-feedback="${index}" role="status" hidden></small>
        </article>`;
      }).join('');
      const priorityForm=index=>panel.querySelector('[data-priority-form="'+index+'"]');
      const priorityFeedback=(index,message)=>{
        const node=panel.querySelector('[data-priority-feedback="'+index+'"]');
        if(node){node.textContent=String(message||'');node.hidden=false;}
      };
      panel.querySelectorAll('[data-home-priority-open]').forEach(button=>{
        button.onclick=()=>openCommunications(latest[Number(button.dataset.homePriorityOpen)]);
      });
      panel.querySelectorAll('[data-priority-reply]').forEach(button=>{
        button.onclick=()=>{
          if(state.carryBusy)return;
          const index=Number(button.dataset.priorityReply),item=latest[index];
          if(!item)return;
          if(item.kind!=='task'){openCommunications(item);return;}
          const form=priorityForm(index);
          if(form){form.hidden=false;form.querySelector('input')?.focus();}
        };
      });
      panel.querySelectorAll('[data-priority-form]').forEach(form=>{
        form.addEventListener('submit',async event=>{
          event.preventDefault();
          if(state.carryBusy)return;
          const index=Number(form.dataset.priorityForm),item=latest[index];
          if(!item||item.kind!=='task')return;
          const reply=String(form.querySelector('input')?.value||'').trim();
          if(!reply){priorityFeedback(index,'Enter a reply first.');return;}
          state.carryBusy=true;
          try{
            const body=new FormData();body.set('comment',reply);
            const response=await fetch(`${basePath}/api/uat/tasks/${Number(item.id)}/comments`,{
              method:'POST',credentials:'same-origin',headers:{Accept:'application/json'},body});
            const result=await response.json().catch(()=>({}));
            if(!response.ok||result.ok===false)throw Error(result.error||'Could not send reply');
            priorityFeedback(index,'Reply sent.');form.hidden=true;form.reset();
            window.dispatchEvent(new Event('workspace:refresh'));
          }catch(error){priorityFeedback(index,error.message);}
          finally{state.carryBusy=false;}
        });
      });
      panel.querySelectorAll('[data-priority-done]').forEach(button=>{
        button.onclick=async()=>{
          if(state.carryBusy)return;
          const index=Number(button.dataset.priorityDone),item=latest[index];
          if(!item||item.kind!=='task'||!item.canComplete)return;
          if(item.completeOnBehalf&&!window.confirm(
            'Mark "'+String(item.subject||'this instruction')+'" Done on behalf of '+
            String(item.recipient||'the employee')+'? This records you as completing it.'
          ))return;
          state.carryBusy=true;button.disabled=true;
          try{
            await jsonFetch(`/api/uat/tasks/${Number(item.id)}/status`,{
              method:'POST',body:JSON.stringify({
                status:'completed',completion_note:item.completeOnBehalf
                  ?'Manager confirmed completion on behalf via My Day ribbon'
                  :'Completed via My Day ribbon'
              })
            });
            window.dispatchEvent(new Event('workspace:refresh'));
          }catch(error){priorityFeedback(index,error.message);button.disabled=false;}
          finally{state.carryBusy=false;}
        };
      });
    }
    function showCarryFeedback(message,isError=false){
      if(!carryFeedback)return;
      carryFeedback.hidden=false;
      carryFeedback.textContent=String(message||'');
      carryFeedback.classList.toggle('is-error',!!isError);
    }
    function renderCarry(){
      if(!tk2mPreview||!carryList||!carryCount)return;
      const filtered=state.staffFilter&&isManagement&&state.scope==='team';
      const all=filtered?state.outstanding.filter(item=>
        staffKey({assignedTo:item.assignedTo,assignedName:item.recipient})===state.staffFilter)
        :state.outstanding;
      const total=filtered?all.length:state.outstandingTotal;
      carryCount.textContent=String(total);
      if(state.attentionError){
        carryList.innerHTML='<div class="t2m-home-carry-empty">Outstanding work could not load. Open Communications to retry.</div>';
        return;
      }
      if(!all.length){
        carryList.innerHTML='<div class="t2m-home-carry-empty">Nothing carried over from previous days.</div>';
        return;
      }
      const shown=state.carryExpanded?all:all.slice(0,5);
      carryList.innerHTML=shown.map(item=>{
        const id=Number(item.id);
        const sender=shortStaffName(item.sender);
        const recipient=shortStaffName(item.recipient);
        const title=String(item.subject||item.text||'Instruction').trim();
        const created=new Date(item.createdAt);
        const when=Number.isNaN(created.getTime())?'Earlier':created.toLocaleDateString('en-ZA',{day:'numeric',month:'short'});
        const received=item.acknowledged?'Received':'Awaiting receipt';
        const color=staffColor({assignedTo:item.assignedTo,assignedName:item.recipient});
        return `<article class="t2m-home-carry-item" style="--staff-color:${color}" data-home-carry-id="${id}">
          <strong class="t2m-home-carry-people">${esc(sender)} → ${esc(recipient)}</strong>
          <span class="t2m-home-carry-subject" title="${esc(title)}">${esc(title)}</span>
          <small>${esc(when)} · ${esc(received)} · Outstanding</small>
          <div class="t2m-home-carry-actions">
            <button type="button" data-carry-reply="${id}">Reply</button>
            ${item.canComplete?`<button type="button" class="is-done" data-carry-done="${id}">Done</button>`:''}
          </div>
          <form class="t2m-home-carry-reply" data-carry-form="${id}" hidden>
            <label for="carry-reply-${id}">Quick reply</label>
            <textarea id="carry-reply-${id}" rows="2" maxlength="4000" required placeholder="Type a short update…"></textarea>
            <div class="t2m-home-carry-reply-controls">
              <button type="button" data-carry-cancel="${id}">Cancel</button>
              <button type="submit" class="is-send">Send reply</button>
            </div>
          </form>
        </article>`;
      }).join('')+(all.length>5
        ?`<button type="button" class="t2m-home-carry-more" data-carry-expand>${state.carryExpanded?'Show fewer':'View all '+total+' outstanding'}</button>`
        :'');
      carryList.querySelector('[data-carry-expand]')?.addEventListener('click',()=>{
        state.carryExpanded=!state.carryExpanded;
        renderCarry();
      });
      carryList.querySelectorAll('[data-carry-reply]').forEach(button=>{
        button.onclick=()=>{
          const item=button.closest('.t2m-home-carry-item');
          const form=item?.querySelector('[data-carry-form]');
          if(!form||state.carryBusy)return;
          form.hidden=!form.hidden;
          if(!form.hidden)form.querySelector('textarea')?.focus();
        };
      });
      carryList.querySelectorAll('[data-carry-cancel]').forEach(button=>{
        button.onclick=()=>{
          const form=button.closest('[data-carry-form]');
          if(form){form.hidden=true;form.reset();}
        };
      });
      carryList.querySelectorAll('[data-carry-form]').forEach(form=>{
        form.addEventListener('submit',async event=>{
          event.preventDefault();
          if(state.carryBusy)return;
          const taskId=Number(form.dataset.carryForm);
          const reply=String(form.querySelector('textarea')?.value||'').trim();
          if(!reply){showCarryFeedback('Enter a short reply first.',true);return;}
          state.carryBusy=true;
          try{
            const body=new FormData();body.set('comment',reply);
            const response=await fetch(`${basePath}/api/uat/tasks/${taskId}/comments`,{
              method:'POST',credentials:'same-origin',headers:{Accept:'application/json'},body});
            const result=await response.json().catch(()=>({}));
            if(!response.ok||result.ok===false)throw Error(result.error||'Could not send reply');
            showCarryFeedback('Reply recorded and sent to the staff involved.');
            form.hidden=true;form.reset();
            window.dispatchEvent(new Event('workspace:refresh'));
          }catch(error){showCarryFeedback(error.message,true);}
          finally{state.carryBusy=false;}
        });
      });
      carryList.querySelectorAll('[data-carry-done]').forEach(button=>{
        button.onclick=async()=>{
          if(state.carryBusy)return;
          const taskId=Number(button.dataset.carryDone);
          const item=all.find(x=>Number(x.id)===taskId);
          if(!item||!item.canComplete)return;
          if(item.completeOnBehalf && !window.confirm(
            'Mark "'+String(item.subject||'this instruction')+'" Done on behalf of '+
            String(item.recipient||'the employee')+
            '? This records you as completing it and notifies the sender.'
          ))return;
          state.carryBusy=true;button.disabled=true;
          try{
            await jsonFetch(`/api/uat/tasks/${taskId}/status`,{
              method:'POST',body:JSON.stringify({
                status:'completed',completion_note:item.completeOnBehalf
                  ?'Manager confirmed completion on behalf via My Day Outstanding Work'
                  :'Completed via My Day Outstanding Work'
              })
            });
            showCarryFeedback('Work completed. The instruction is removed from Outstanding Work.');
            window.dispatchEvent(new Event('workspace:refresh'));
          }catch(error){
            showCarryFeedback(error.message,true);
            button.disabled=false;
          }finally{state.carryBusy=false;}
        };
      });
    }
    function renderFocus() {
      if (!tk2mPreview) return;
      const inactive = new Set(['completed', 'cancelled', 'closed', 'done', 'accepted']);
      const selectedItems = visibleEvents().filter(item =>
        item.date === state.selected && !inactive.has(String(item.status || '').toLowerCase()));
      const taskCount = selectedItems.filter(item =>
        item.source === 'task' || item.type === 'follow-up' || item.type === 'callback').length;
      const reminderCount = selectedItems.filter(item =>
        item.type === 'reminder' || item.type === 'appointment').length;
      const counts = {
        tasks: state.loading ? null : taskCount,
        reminders: state.loading ? null : reminderCount,
        messages: state.focus.messages,
        overdue: state.focus.overdue
      };
      for (const [key, count] of Object.entries(counts)) {
        const node = workspace.querySelector(`[data-home-focus-count="${key}"]`);
        if (!node) continue;
        node.textContent = count === null ? '—' : String(count);
        node.closest('[data-home-focus]')?.classList.toggle('has-attention', Number(count) > 0);
      }
      renderPriority();
      renderCarry();
      const summary = workspace.querySelector('[data-home-attention-summary]');
      if(summary){
        const count=state.focus.messages,overdue=state.focus.overdue;
        summary.textContent = count===null || overdue===null
          ? 'Checking today\'s communications...'
          : count+' communications today · '+overdue+' outstanding from previous days';
      }
    }

    function renderAgenda() {
      const inactive=new Set(['completed','cancelled','closed','done','accepted']);
      const items = visibleEvents().filter(item => item.date === state.selected &&
        (!tk2mPreview || !inactive.has(String(item.status||'').toLowerCase())));
      const shown=tk2mPreview && !state.agendaExpanded?items.slice(0,4):items;
      agendaDate.textContent = humanDate(state.selected);
      agendaCount.textContent = String(items.length);

      if (state.loading) {
        agenda.innerHTML = '<div class="t2m-home-empty"><strong>Loading work…</strong><span>Reading the CRM calendar.</span></div>';
        return;
      }
      if (state.error) {
        agenda.innerHTML = `<div class="t2m-home-empty is-error"><strong>Calendar unavailable</strong><span>${esc(state.error)}</span></div>`;
        return;
      }
      if (!items.length) {
        agenda.innerHTML = '<div class="t2m-home-empty"><strong>Nothing scheduled for this day</strong><span>Select another date or add a task/reminder.</span></div>';
        return;
      }

      agenda.innerHTML = shown.map(item => {
        const meta = eventMeta[item.type] || eventMeta.other;
        const color = staffColor(item);
        return `<article class="t2m-home-agenda-item" style="--staff-color:${color}">
          <div class="t2m-home-agenda-top"><span>${esc(meta.icon)} ${esc(meta.label)}</span><time>${esc(item.time || 'All day')}</time></div>
          <strong>${esc(item.title || meta.label)}</strong>
          <span class="t2m-home-owner"><i></i>${esc(shortStaffName(item.assignedName))}</span>
          ${!tk2mPreview && item.details ? `<p>${esc(item.details)}</p>` : ''}
          <div class="t2m-home-agenda-actions">
            ${item.url ? `<button type="button" data-open-calendar-item="${esc(item.id)}">${item.source === 'personal' ? 'View' : 'Open'}</button>` : ''}
            ${item.editable ? `<button type="button" data-complete-calendar-item="${item.sourceId}" data-status="${esc(item.status || 'open')}">${item.status === 'completed' ? 'Reopen' : 'Complete'}</button><button type="button" data-delete-calendar-item="${item.sourceId}">Delete</button>` : ''}
          </div>
        </article>`;
      }).join('') + (tk2mPreview && items.length>4
        ?`<button type="button" class="t2m-home-agenda-more" data-home-agenda-more>${state.agendaExpanded?'Show four': 'View all '+items.length+' calendar actions'}</button>`
        :'');
      agenda.querySelector('[data-home-agenda-more]')?.addEventListener('click',()=>{
        state.agendaExpanded=!state.agendaExpanded;
        renderAgenda();
      });

      agenda.querySelectorAll('[data-open-calendar-item]').forEach(button => {
        button.onclick = () => {
          const item = state.events.find(event => String(event.id) === String(button.dataset.openCalendarItem));
          if (!item?.url) return;
          if(tk2mPreview && item.source==='task' && window.Talk2MeUnifiedInbox?.open){
            openCommunications({kind:'task',id:item.sourceId});return;
          }
          const meta = eventMeta[item.type] || eventMeta.other;
          openWorkWindow({
            id: `dated:${String(item.id).replace(/[^a-zA-Z0-9:_-]/g, '-')}`,
            appKey: 'dated-work',
            title: item.title || meta.label,
            icon: meta.icon,
            subtitle: `${meta.label} · ${shortStaffName(item.assignedName)}`,
            url: item.url,
            width: 980,
            height: 680
          });
        };
      });

      agenda.querySelectorAll('[data-complete-calendar-item]').forEach(button => {
        button.onclick = async () => {
          const next = button.dataset.status === 'completed' ? 'open' : 'completed';
          try {
            await jsonFetch(`/api/calendar/items/${button.dataset.completeCalendarItem}/status`, { method: 'POST', body: JSON.stringify({ status: next }) });
            await load();
          } catch (error) { window.alert(error.message); }
        };
      });

      agenda.querySelectorAll('[data-delete-calendar-item]').forEach(button => {
        button.onclick = async () => {
          if (!window.confirm('Delete this reminder?')) return;
          try {
            await jsonFetch(`/api/calendar/items/${button.dataset.deleteCalendarItem}`, { method: 'DELETE' });
            await load();
          } catch (error) { window.alert(error.message); }
        };
      });
    }

    function render() {
      const range = rangeFor(state.month);
      const todayKey = iso(new Date());
      const byDate = new Map();
      for (const item of visibleEvents()) {
        if (!byDate.has(item.date)) byDate.set(item.date, []);
        byDate.get(item.date).push(item);
      }

      monthLabel.textContent = monthName(state.month);
      grid.innerHTML = '';
      for (let index = 0; index < 42; index += 1) {
        const date = new Date(range.startDate);
        date.setDate(range.startDate.getDate() + index);
        const key = iso(date);
        const items = byDate.get(key) || [];
        const outside = date.getMonth() !== state.month.getMonth();
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.date = key;
        button.className = `t2m-home-day${outside ? ' is-outside' : ''}${key === state.selected ? ' is-selected' : ''}${key === todayKey ? ' is-today' : ''}`;
        const markers = items.slice(0, 4).map(item => {
          const meta = eventMeta[item.type] || eventMeta.other;
          return `<span class="t2m-home-event-mark" style="--staff-color:${staffColor(item)}" title="${esc(shortStaffName(item.assignedName))} · ${esc(meta.label)}"><i></i><b>${esc(meta.icon)}</b></span>`;
        }).join('');
        button.innerHTML = `<span class="t2m-home-day-top"><b>${date.getDate()}</b>${items.length ? `<em>${items.length}</em>` : ''}</span><span class="t2m-home-event-marks">${markers}</span>${items.length ? `<small>${items.length === 1 ? esc((eventMeta[items[0].type] || eventMeta.other).label) : `${items.length} items`}</small>` : '<small>&nbsp;</small>'}`;
        button.onclick = () => {
          state.agendaExpanded=false;
          state.selected = key;
          if (outside) {
            state.month = monthStart(date);
            load();
          } else {
            render();
          }
        };
        grid.appendChild(button);
      }

      workspace.querySelectorAll('[data-home-scope]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.homeScope === state.scope);
      });
      renderStaffFilters();
      renderFocus();
      renderAgenda();
    }

    async function load() {
      const range = rangeFor(state.month);
      state.loading = true;
      state.error = '';
      render();
      try {
        const data = await jsonFetch(`/api/calendar/events?start=${range.start}&end=${range.end}&scope=${state.scope}`);
        state.events = Array.isArray(data.events) ? data.events : [];
        if (state.staffFilter && !state.events.some(item => staffKey(item) === state.staffFilter)) state.staffFilter = null;
      } catch (error) {
        state.events = [];
        state.error = error.message || 'Could not load calendar.';
      }
      state.loading = false;
      render();
    }

    async function loadAttention() {
      if(!tk2mPreview)return;
      try{
        const data=await jsonFetch('/api/tk2m/communications/myday'+
          (isManagement&&state.scope==='team'?'?scope=team':''));
        state.communications=Array.isArray(data.today)?data.today:[];
        state.outstanding=Array.isArray(data.outstanding)?data.outstanding:[];
        state.outstandingTotal=Math.max(0,Number(data.counts?.outstanding||0));
        state.attentionError=null;
        state.focus.messages=state.communications.length;
        state.focus.overdue=state.outstandingTotal;
        state.focus.openWork=state.outstandingTotal;
      }catch(error){
        state.attentionError=String(error.message||'Communications unavailable');
        state.communications=[];state.outstanding=[];
        state.outstandingTotal=0;
        state.focus.messages=null;state.focus.overdue=null;
      }
      renderFocus();
    }

    function openTask() {
      if(tk2mPreview && window.Talk2MeCommunications?.open) {
        window.Talk2MeCommunications.open({actionRequired:true});
        return;
      }
      openWorkWindow({
        id: 'quick:task', appKey: 'quick-action', title: 'Add Task', icon: '✓',
        subtitle: `Task for ${state.selected}`,
        url: `${basePath}/os/quick-add/task?date=${encodeURIComponent(state.selected)}`,
        width: 860, height: 650
      });
    }

    function openReminder() {
      reminderForm.reset();
      reminderForm.elements.date.value = state.selected;
      reminderForm.elements.time.value = '09:00';
      reminderStatus.textContent = '';
      dialog.showModal();
      setTimeout(() => reminderForm.elements.title.focus(), 0);
    }

    workspace.querySelector('[data-home-prev]').onclick = () => { state.agendaExpanded=false; state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1, 12); state.selected = iso(state.month); load(); };
    workspace.querySelector('[data-home-next]').onclick = () => { state.agendaExpanded=false; state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1, 12); state.selected = iso(state.month); load(); };
    workspace.querySelector('[data-home-today-button]').onclick = () => { state.agendaExpanded=false; const now = new Date(); state.month = monthStart(now); state.selected = iso(now); state.staffFilter = null; load(); };
    workspace.querySelector('[data-home-add-task]').onclick = openTask;
    workspace.querySelector('[data-home-add-reminder]').onclick = openReminder;
    workspace.querySelector('[data-home-focus="tasks"]')?.addEventListener('click', () => {
      const details=workspace.querySelector('[data-home-calendar-fold]');
      if(details)details.open=true;
      const agenda=workspace.querySelector('.t2m-home-agenda');
      agenda?.scrollIntoView({block:'nearest',behavior:'smooth'});
      agenda?.classList.add('is-highlighted');
      window.setTimeout(()=>agenda?.classList.remove('is-highlighted'),900);
    });
    workspace.querySelector('[data-home-focus="reminders"]')?.addEventListener('click', () => {
      if(tk2mPreview){openReminder();return;}
      const panel=workspace.querySelector('.t2m-home-agenda');
      panel?.scrollIntoView({block:'nearest',behavior:'smooth'});
    });
    workspace.querySelector('[data-home-focus="overdue"]')?.addEventListener('click', () => {
      if(tk2mPreview){
        const panel=workspace.querySelector('.t2m-home-carry-panel');
        panel?.scrollIntoView({block:'nearest',behavior:'smooth'});
        panel?.classList.add('is-highlighted');
        window.setTimeout(()=>panel?.classList.remove('is-highlighted'),900);return;
      }
      openWorkWindow({
        id: 'myday:overdue', appKey: 'overdue-work', title: 'My overdue tasks',
        icon: '!', subtitle: 'Outstanding work requiring attention',
        url: `${basePath}/os/my-work/overdue-tasks`, width: 940, height: 650
      });
    });
    workspace.querySelectorAll('[data-home-scope]').forEach(button => {
      button.onclick = () => {
        const next = button.dataset.homeScope;
        if (next === state.scope) return;
        state.scope = next;
        state.staffFilter = null;
        state.priorityPage = 0;
        state.agendaExpanded=false;
        load();loadAttention();
      };
    });

    document.addEventListener('click', event => {
      const home = event.target.closest('[data-home-today]');
      if (!home) return;
      event.preventDefault();
      const now = new Date();
      state.month = monthStart(now);
      state.selected = iso(now);
      state.staffFilter = null;
      state.agendaExpanded=false;
      load();
    });

    workspace.querySelector('[data-home-reminder-save]').onclick = async () => {
      const values = Object.fromEntries(new FormData(reminderForm).entries());
      const title = String(values.title || '').trim();
      if (!title) { reminderStatus.textContent = 'Enter a title.'; return; }
      const date = String(values.date || state.selected);
      const time = String(values.time || '09:00');
      reminderStatus.textContent = 'Saving…';
      try {
        await jsonFetch('/api/calendar/items', {
          method: 'POST',
          body: JSON.stringify({ item_type: 'reminder', title, details: values.details || '', date, starts_at: `${date}T${time}` })
        });
        state.selected = date;
        state.month = monthStart(new Date(`${date}T12:00:00`));
        dialog.close();
        await load();
      } catch (error) { reminderStatus.textContent = error.message; }
    };

    window.addEventListener('message', event => {
      if (event.origin !== location.origin) return;
      if (event.data?.type === 'talk2me:quick-action-saved' || event.data?.type === 'talk2me:calendar-item-updated') {
        setTimeout(() => { load(); loadAttention(); }, 150);
      }
    });

    window.addEventListener('workspace:refresh', () => {
      setTimeout(() => { load(); loadAttention(); }, 100);
    });
    // Refresh remote staff instructions without closing an active quick-reply box.
    window.setInterval(()=>{
      if(!tk2mPreview||document.hidden||state.carryBusy||
         workspace.querySelector('[data-carry-form]:not([hidden])'))return;
      void loadAttention();
    },30000);
    document.addEventListener('visibilitychange',()=>{
      if(tk2mPreview&&!document.hidden&&!state.carryBusy)void loadAttention();
    });

    load();
    loadAttention();
  }

  // Mount My Day first. The calendar is the primary workspace and must not
  // depend on optional shell/window enhancements being available for a role.
  // This specifically protects owner/management sessions from falling back to
  // the legacy Today’s Work dashboard if another OS enhancement fails.
  try {
    mountCalendar();
    shell.dataset.calendarHomeReady = '1';
  } catch (error) {
    console.error('Talk2Me My Day mount failed:', error);
    if (tk2mPreview) window.Talk2MeBoot?.fail();
    return;
  }

  try {
    simplifyShell();
  } catch (error) {
    console.error('Talk2Me My Day shell enhancement failed:', error);
    // For TK2M, do not reveal a partially initialised older navigation layer.
    if (tk2mPreview) { window.Talk2MeBoot?.fail(); return; }
  }

  // The TK2M login-to-calendar transition is atomic: the old OS is not
  // exposed while the new calendar/sidebar are being constructed.
  if (tk2mPreview && window.Talk2MeBoot) {
    const calendarReady = Boolean(workspace.querySelector('.t2m-home-calendar'));
    const navigationReady = Boolean(sidebar.querySelector('.t2m-simple-nav'));
    if (calendarReady && navigationReady) window.Talk2MeBoot.ready();
    else window.Talk2MeBoot.fail();
  }
})();
