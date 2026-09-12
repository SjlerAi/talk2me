(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode || !window.Talk2MeOS?.windows) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');
  const isManagement = Boolean(config.isManagement);
  const windows = window.Talk2MeOS.windows;
  const shell = document.getElementById('talk2me-os');
  const workspace = document.getElementById('os-workspace');
  const sidebar = document.querySelector('.t2m-os-sidebar');
  const launcher = document.querySelector('.t2m-os-launcher');
  const topActions = document.querySelector('.t2m-os-top-actions');
  if (!shell || !workspace || !sidebar) return;

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

  function simplifyShell() {
    shell.classList.add('t2m-calendar-home-shell');
    launcher?.setAttribute('hidden', '');

    sidebar.querySelectorAll(':scope > .t2m-os-sidebar-section').forEach(section => section.remove());
    const section = document.createElement('div');
    section.className = 't2m-os-sidebar-section t2m-simple-nav';
    section.innerHTML = `<span class="t2m-os-sidebar-label">Work</span>
      <button type="button" class="is-current" data-home-today aria-label="My Day" title="My Day"><span>□</span><strong>My Day</strong></button>
      <button type="button" data-os-launch="customers" aria-label="Customers" title="Customers"><span>C</span><strong>Customers</strong></button>
      ${isManagement ? `<button type="button" data-os-route="${basePath}/command-centre" data-route-title="Team" data-route-icon="◆" aria-label="Team" title="Team"><span>◆</span><strong>Team</strong></button>
      <button type="button" data-os-app="reports" aria-label="Reports" title="Reports"><span>▦</span><strong>Reports</strong></button>
      <button type="button" data-os-route="${basePath}/backoffice" data-route-title="Administration" data-route-icon="⚙" aria-label="Administration" title="Administration"><span>⚙</span><strong>Administration</strong></button>` : ''}
      <button type="button" data-os-app="help" aria-label="Help" title="Help"><span>?</span><strong>Help</strong></button>`;
    sidebar.appendChild(section);

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
  }

  function mountCalendar() {
    const today = iso(new Date());
    workspace.innerHTML = `<section class="t2m-home-calendar" aria-label="My Day calendar">
      <header class="t2m-home-calendar-head">
        <div>
          <span>Talk2Me work planner</span>
          <h1>My Day</h1>
          <p>${isManagement ? 'Team view shows the whole office. Staff colours show responsibility.' : 'Your tasks, customers and dated work in one place.'}</p>
        </div>
        <div class="t2m-home-actions">
          <button type="button" data-home-add-task>+ Task</button>
          <button type="button" data-home-add-reminder>+ Reminder</button>
        </div>
      </header>
      <div class="t2m-home-calendar-controls">
        <button type="button" data-home-prev aria-label="Previous month">‹</button>
        <button type="button" data-home-today-button>Today</button>
        <strong data-home-month></strong>
        <button type="button" data-home-next aria-label="Next month">›</button>
        ${isManagement ? '<div class="t2m-home-scope"><button type="button" data-home-scope="mine">Mine</button><button type="button" data-home-scope="team">Team</button></div>' : '<span></span>'}
      </div>
      <div class="t2m-home-team-filter" data-home-team-filter hidden></div>
      <div class="t2m-home-calendar-layout">
        <section class="t2m-home-month">
          <div class="t2m-home-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
          <div class="t2m-home-grid" data-home-grid></div>
        </section>
        <aside class="t2m-home-agenda">
          <header><div><span>Selected date</span><strong data-home-agenda-date></strong></div><b data-home-agenda-count>0</b></header>
          <div class="t2m-home-agenda-list" data-home-agenda></div>
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
      scope: isManagement ? 'team' : 'mine',
      staffFilter: null,
      events: [],
      loading: false,
      error: ''
    };

    const grid = workspace.querySelector('[data-home-grid]');
    const monthLabel = workspace.querySelector('[data-home-month]');
    const agendaDate = workspace.querySelector('[data-home-agenda-date]');
    const agendaCount = workspace.querySelector('[data-home-agenda-count]');
    const agenda = workspace.querySelector('[data-home-agenda]');
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
          name: item.assignedName || 'Unassigned',
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
          render();
        };
      });
    }

    function renderAgenda() {
      const items = visibleEvents().filter(item => item.date === state.selected);
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

      agenda.innerHTML = items.map(item => {
        const meta = eventMeta[item.type] || eventMeta.other;
        const color = staffColor(item);
        return `<article class="t2m-home-agenda-item" style="--staff-color:${color}">
          <div class="t2m-home-agenda-top"><span>${esc(meta.icon)} ${esc(meta.label)}</span><time>${esc(item.time || 'All day')}</time></div>
          <strong>${esc(item.title || meta.label)}</strong>
          <span class="t2m-home-owner"><i></i>${esc(item.assignedName || 'Unassigned')}</span>
          ${item.details ? `<p>${esc(item.details)}</p>` : ''}
          <div class="t2m-home-agenda-actions">
            ${item.url ? `<button type="button" data-open-calendar-item="${esc(item.id)}">Open</button>` : ''}
            ${item.editable ? `<button type="button" data-complete-calendar-item="${item.sourceId}" data-status="${esc(item.status || 'open')}">${item.status === 'completed' ? 'Reopen' : 'Complete'}</button><button type="button" data-delete-calendar-item="${item.sourceId}">Delete</button>` : ''}
          </div>
        </article>`;
      }).join('');

      agenda.querySelectorAll('[data-open-calendar-item]').forEach(button => {
        button.onclick = () => {
          const item = state.events.find(event => String(event.id) === String(button.dataset.openCalendarItem));
          if (!item?.url) return;
          const meta = eventMeta[item.type] || eventMeta.other;
          windows.open({
            id: `dated:${String(item.id).replace(/[^a-zA-Z0-9:_-]/g, '-')}`,
            appKey: 'dated-work',
            title: item.title || meta.label,
            icon: meta.icon,
            subtitle: `${meta.label} · ${item.assignedName || 'Unassigned'}`,
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
          return `<span class="t2m-home-event-mark" style="--staff-color:${staffColor(item)}" title="${esc(item.assignedName || 'Unassigned')} · ${esc(meta.label)}"><i></i><b>${esc(meta.icon)}</b></span>`;
        }).join('');
        button.innerHTML = `<span class="t2m-home-day-top"><b>${date.getDate()}</b>${items.length ? `<em>${items.length}</em>` : ''}</span><span class="t2m-home-event-marks">${markers}</span>${items.length ? `<small>${items.length === 1 ? esc((eventMeta[items[0].type] || eventMeta.other).label) : `${items.length} items`}</small>` : '<small>&nbsp;</small>'}`;
        button.onclick = () => {
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

    function openTask() {
      windows.open({
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

    workspace.querySelector('[data-home-prev]').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1, 12); state.selected = iso(state.month); load(); };
    workspace.querySelector('[data-home-next]').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1, 12); state.selected = iso(state.month); load(); };
    workspace.querySelector('[data-home-today-button]').onclick = () => { const now = new Date(); state.month = monthStart(now); state.selected = iso(now); state.staffFilter = null; load(); };
    workspace.querySelector('[data-home-add-task]').onclick = openTask;
    workspace.querySelector('[data-home-add-reminder]').onclick = openReminder;
    workspace.querySelectorAll('[data-home-scope]').forEach(button => {
      button.onclick = () => {
        const next = button.dataset.homeScope;
        if (next === state.scope) return;
        state.scope = next;
        state.staffFilter = null;
        load();
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
      if (event.origin !== location.origin || event.data?.type !== 'talk2me:quick-action-saved') return;
      setTimeout(load, 250);
    });

    load();
  }

  simplifyShell();
  mountCalendar();
})();