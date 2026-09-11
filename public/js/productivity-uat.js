(() => {
  'use strict';

  if (window.__talk2meUatProductivityLoaded) return;
  window.__talk2meUatProductivityLoaded = true;

  const osConfigNode = document.getElementById('talk2me-os-config');
  const calendarConfigNode = document.getElementById('calendar-config');
  const osConfig = osConfigNode ? JSON.parse(osConfigNode.textContent || '{}') : null;
  const calendarConfig = calendarConfigNode ? JSON.parse(calendarConfigNode.textContent || '{}') : null;
  const basePath = String((osConfig || calendarConfig || {}).basePath || '');
  const osWindows = window.Talk2MeOS?.windows || null;

  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const typeMeta = {
    task: { label: 'Task', icon: '✓' },
    'follow-up': { label: 'Follow-up', icon: '↻' },
    callback: { label: 'Callback', icon: '☎' },
    birthday: { label: 'Birthday', icon: '★' },
    upgrade: { label: 'Upgrade', icon: '↗' },
    reminder: { label: 'Reminder', icon: '●' },
    appointment: { label: 'Appointment', icon: '◷' },
    other: { label: 'Other', icon: '•' }
  };

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

  function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function monthStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0);
  }

  function monthLabel(date) {
    return new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(date);
  }

  function longDate(value) {
    return new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(`${value}T12:00:00`));
  }

  function gridRange(month) {
    const first = monthStart(month);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 41);
    return { start: isoDate(start), end: isoDate(end), startDate: start, endDate: end };
  }

  function clampScratchpad(pad) {
    if (!pad || pad.hidden) return;
    const rect = pad.getBoundingClientRect();
    const width = Math.min(rect.width, Math.max(180, window.innerWidth - 12));
    const height = Math.min(rect.height, Math.max(38, window.innerHeight - 72));
    const left = Math.max(6, Math.min(window.innerWidth - width - 6, rect.left));
    const top = Math.max(74, Math.min(window.innerHeight - height - 8, rect.top));
    Object.assign(pad.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
  }

  function ensureScratchpad() {
    let pad = document.getElementById('t2m-scratchpad');
    if (pad) return pad;

    pad = document.createElement('section');
    pad.id = 't2m-scratchpad';
    pad.className = 't2m-scratchpad';
    pad.hidden = true;
    pad.innerHTML = `<div class="t2m-scratchpad-head" data-scratch-drag>
      <strong>My note</strong>
      <span class="t2m-scratchpad-save" data-scratch-status>Loading…</span>
      <div class="t2m-scratchpad-actions">
        <button type="button" data-scratch-min aria-label="Make note small" title="Make note small">—</button>
        <button type="button" data-scratch-close aria-label="Hide note" title="Hide note">×</button>
      </div>
    </div>
    <div class="t2m-scratchpad-body">
      <textarea maxlength="20000" spellcheck="true" aria-label="My scratch note" placeholder="Type here…"></textarea>
      <button type="button" class="t2m-scratchpad-clear" data-scratch-clear title="Clear note">Clear</button>
    </div>`;
    document.body.appendChild(pad);

    const area = pad.querySelector('textarea');
    const status = pad.querySelector('[data-scratch-status]');
    const prefKey = `t2m-sticky-note-${osConfig?.user?.id || 'user'}`;
    let saveTimer = 0;
    let resizeTimer = 0;
    let hasLoaded = false;

    const readPrefs = () => {
      try { return JSON.parse(localStorage.getItem(prefKey) || '{}') || {}; } catch (_) { return {}; }
    };

    const savePrefs = () => {
      if (pad.hidden) return;
      const rect = pad.getBoundingClientRect();
      localStorage.setItem(prefKey, JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        collapsed: pad.classList.contains('is-collapsed')
      }));
    };

    const prefs = readPrefs();
    if (Number.isFinite(prefs.width)) pad.style.width = `${Math.max(180, Math.min(520, prefs.width))}px`;
    if (Number.isFinite(prefs.height)) pad.style.height = `${Math.max(120, Math.min(520, prefs.height))}px`;
    if (Number.isFinite(prefs.left) && Number.isFinite(prefs.top)) {
      pad.style.left = `${prefs.left}px`;
      pad.style.top = `${prefs.top}px`;
      pad.style.right = 'auto';
      pad.style.bottom = 'auto';
    }
    if (prefs.collapsed) pad.classList.add('is-collapsed');

    const setStatus = (text, state = '') => {
      status.textContent = text;
      status.dataset.state = state;
    };

    const saveNote = async () => {
      if (!hasLoaded) return;
      setStatus('Saving…', 'saving');
      try {
        await jsonFetch('/api/scratchpad', { method: 'PUT', body: JSON.stringify({ note: area.value }) });
        setStatus('Saved', 'saved');
      } catch (_) {
        setStatus('Save failed', 'error');
      }
    };

    const loadNote = async () => {
      try {
        const scratch = await jsonFetch('/api/scratchpad');
        let note = String(scratch.note || '');

        // Preserve the user's existing Notes content on first use of the sticky pad.
        if (!note) {
          try {
            const existing = await jsonFetch('/api/os/notes');
            const candidate = Array.isArray(existing.notes) ? existing.notes.find(item => String(item.note_text || '').trim()) : null;
            if (candidate) {
              note = String(candidate.note_text || '');
              await jsonFetch('/api/scratchpad', { method: 'PUT', body: JSON.stringify({ note }) });
            }
          } catch (_) {}
        }

        area.value = note;
        hasLoaded = true;
        setStatus(note || scratch.updatedAt ? 'Saved' : 'Ready', 'saved');
      } catch (_) {
        hasLoaded = true;
        setStatus('Could not load', 'error');
      }
    };

    area.addEventListener('input', () => {
      clearTimeout(saveTimer);
      setStatus('Typing…');
      saveTimer = setTimeout(saveNote, 500);
    });

    pad.querySelector('[data-scratch-min]').addEventListener('click', () => {
      pad.classList.toggle('is-collapsed');
      savePrefs();
    });

    pad.querySelector('[data-scratch-close]').addEventListener('click', () => {
      clearTimeout(saveTimer);
      saveNote();
      savePrefs();
      pad.hidden = true;
    });

    pad.querySelector('[data-scratch-clear]').addEventListener('click', () => {
      if (area.value && !window.confirm('Clear this sticky note?')) return;
      area.value = '';
      saveNote();
      area.focus();
    });

    const drag = pad.querySelector('[data-scratch-drag]');
    drag.addEventListener('dblclick', event => {
      if (event.target.closest('button')) return;
      pad.classList.toggle('is-collapsed');
      savePrefs();
    });
    drag.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      const startRect = pad.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      drag.setPointerCapture(event.pointerId);

      const move = pointer => {
        const width = pad.offsetWidth;
        const height = pad.offsetHeight;
        const left = Math.max(6, Math.min(window.innerWidth - width - 6, startRect.left + pointer.clientX - startX));
        const top = Math.max(74, Math.min(window.innerHeight - height - 8, startRect.top + pointer.clientY - startY));
        Object.assign(pad.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
      };
      const done = () => {
        drag.removeEventListener('pointermove', move);
        drag.removeEventListener('pointerup', done);
        drag.removeEventListener('pointercancel', done);
        savePrefs();
      };
      drag.addEventListener('pointermove', move);
      drag.addEventListener('pointerup', done);
      drag.addEventListener('pointercancel', done);
    });

    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (pad.hidden || pad.classList.contains('is-collapsed')) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { clampScratchpad(pad); savePrefs(); }, 180);
      }).observe(pad);
    }
    window.addEventListener('resize', () => clampScratchpad(pad));
    loadNote();
    return pad;
  }

  function showScratchpad() {
    const pad = ensureScratchpad();
    const wasHidden = pad.hidden;
    pad.hidden = false;
    clampScratchpad(pad);
    if (!wasHidden && pad.classList.contains('is-collapsed')) pad.classList.remove('is-collapsed');
    if (!pad.classList.contains('is-collapsed')) pad.querySelector('textarea')?.focus();
  }

  function openTaskForDate(selected) {
    if (!osWindows) return;
    osWindows.open({
      id: 'quick:task',
      appKey: 'quick-action',
      title: 'Add Task',
      icon: '✓',
      subtitle: `Task for ${selected}`,
      url: `${basePath}/os/quick-add/task?date=${encodeURIComponent(selected)}`,
      width: 860,
      height: 650
    });
  }

  function openCalendarEvent(item) {
    if (!osWindows || !item.url) return;
    const meta = typeMeta[item.type] || typeMeta.other;
    osWindows.open({
      id: `calendar-item:${String(item.id).replace(/[^a-zA-Z0-9:_-]/g, '-')}`,
      appKey: 'calendar-detail',
      title: item.title || meta.label,
      icon: meta.icon,
      subtitle: `${meta.label}${item.assignedName ? ` · ${item.assignedName}` : ''}`,
      url: item.url,
      width: 940,
      height: 650
    });
  }

  function openCalendarWindow() {
    if (!osWindows) return;
    const today = new Date();
    osWindows.open({
      id: 'calendar-uat-live',
      appKey: 'calendar',
      title: 'Calendar',
      icon: '□',
      subtitle: 'Tasks, follow-ups, callbacks, birthdays and upgrades',
      width: 1100,
      height: 700,
      render(body) {
        const state = {
          month: monthStart(today),
          selected: isoDate(today),
          scope: osConfig?.isManagement ? 'team' : 'mine',
          events: [],
          loading: true,
          error: ''
        };

        const selectedEvents = () => state.events.filter(item => item.date === state.selected);
        const monthEvents = () => state.events.filter(item => {
          const date = new Date(`${item.date}T12:00:00`);
          return date.getFullYear() === state.month.getFullYear() && date.getMonth() === state.month.getMonth();
        });

        const load = async () => {
          state.loading = true;
          state.error = '';
          draw();
          const range = gridRange(state.month);
          try {
            const data = await jsonFetch(`/api/calendar/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}&scope=${encodeURIComponent(state.scope)}`);
            state.events = Array.isArray(data.events) ? data.events : [];
          } catch (error) {
            state.events = [];
            state.error = error.message || 'Calendar could not load.';
          }
          state.loading = false;
          draw();
        };

        const drawAgenda = () => {
          const list = body.querySelector('[data-calendar-agenda-list]');
          if (!list) return;
          if (state.loading) {
            list.innerHTML = '<div class="t2m-calendar-state"><strong>Loading work…</strong><span>Reading dated CRM activity.</span></div>';
            return;
          }
          if (state.error) {
            list.innerHTML = `<div class="t2m-calendar-state is-error"><strong>Calendar unavailable</strong><span>${esc(state.error)}</span></div>`;
            return;
          }
          const items = selectedEvents();
          if (!items.length) {
            list.innerHTML = '<div class="t2m-calendar-state"><strong>Nothing scheduled on this date</strong><span>Days with CRM work show a number and coloured dots in the month view.</span></div>';
            return;
          }
          list.innerHTML = items.map(item => {
            const meta = typeMeta[item.type] || typeMeta.other;
            const assigned = state.scope === 'team' && item.assignedName ? `<span class="t2m-calendar-assignee">${esc(item.assignedName)}</span>` : '';
            const completed = String(item.status || '').toLowerCase() === 'completed';
            return `<article class="t2m-calendar-agenda-item${completed ? ' is-completed' : ''}" data-event-type="${esc(item.type || 'other')}">
              <div class="t2m-calendar-agenda-top">
                <span class="t2m-calendar-type"><b>${esc(meta.icon)}</b>${esc(meta.label)}</span>
                <time>${esc(item.time || 'All day')}</time>
              </div>
              <strong>${esc(item.title || meta.label)}</strong>
              ${assigned}
              ${item.details ? `<p>${esc(item.details)}</p>` : ''}
              <div class="t2m-calendar-agenda-actions">
                ${item.url ? `<button type="button" data-calendar-open="${esc(item.id)}">Open</button>` : ''}
                ${item.editable ? `<button type="button" data-calendar-complete="${item.sourceId}" data-current-status="${esc(item.status || 'open')}">${completed ? 'Reopen' : 'Complete'}</button><button type="button" data-calendar-delete="${item.sourceId}">Delete</button>` : ''}
              </div>
            </article>`;
          }).join('');
        };

        const draw = () => {
          const range = gridRange(state.month);
          const todayKey = isoDate(new Date());
          const byDate = new Map();
          for (const item of state.events) {
            if (!byDate.has(item.date)) byDate.set(item.date, []);
            byDate.get(item.date).push(item);
          }

          const cells = [];
          for (let index = 0; index < 42; index += 1) {
            const day = new Date(range.startDate);
            day.setDate(range.startDate.getDate() + index);
            const key = isoDate(day);
            const items = byDate.get(key) || [];
            const types = [...new Set(items.map(item => item.type || 'other'))].slice(0, 5);
            const outside = day.getMonth() !== state.month.getMonth();
            cells.push(`<button type="button" class="t2m-calendar-day-live${outside ? ' is-outside' : ''}${key === state.selected ? ' is-selected' : ''}${key === todayKey ? ' is-today' : ''}" data-calendar-date="${key}">
              <span class="t2m-calendar-day-top"><b>${day.getDate()}</b>${items.length ? `<em>${items.length}</em>` : ''}</span>
              <span class="t2m-calendar-day-dots">${types.map(type => `<i data-event-type="${esc(type)}" title="${esc((typeMeta[type] || typeMeta.other).label)}"></i>`).join('')}</span>
              ${items.length ? `<small>${items.length === 1 ? esc((typeMeta[items[0].type] || typeMeta.other).label) : `${items.length} items`}</small>` : '<small>&nbsp;</small>'}
            </button>`);
          }

          const selectedCount = selectedEvents().length;
          const currentMonthCount = monthEvents().length;
          body.innerHTML = `<div class="t2m-calendar-live">
            <header class="t2m-calendar-live-toolbar">
              <button type="button" data-calendar-prev aria-label="Previous month">‹</button>
              <div class="t2m-calendar-live-heading">
                <strong>${esc(monthLabel(state.month))}</strong>
                <span>${state.loading ? 'Loading CRM work…' : state.error ? 'Could not read CRM work' : `${currentMonthCount} dated item${currentMonthCount === 1 ? '' : 's'} this month`}</span>
              </div>
              <button type="button" data-calendar-next aria-label="Next month">›</button>
              <button type="button" class="t2m-calendar-today" data-calendar-today>Today</button>
              ${osConfig?.isManagement ? `<div class="t2m-calendar-scope" role="group" aria-label="Calendar scope"><button type="button" data-calendar-scope="mine" class="${state.scope === 'mine' ? 'is-active' : ''}">Mine</button><button type="button" data-calendar-scope="team" class="${state.scope === 'team' ? 'is-active' : ''}">Team</button></div>` : '<span></span>'}
            </header>
            <div class="t2m-calendar-live-main">
              <section class="t2m-calendar-month-live">
                <div class="t2m-calendar-weekdays-live"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
                <div class="t2m-calendar-grid-live">${cells.join('')}</div>
              </section>
              <aside class="t2m-calendar-agenda-live">
                <header><div><span>Selected date</span><strong>${esc(longDate(state.selected))}</strong></div><b>${selectedCount}</b></header>
                <div class="t2m-calendar-agenda-list" data-calendar-agenda-list></div>
                <footer>
                  <button type="button" data-calendar-add-task>+ Task</button>
                  <button type="button" data-calendar-add-reminder>+ Reminder</button>
                </footer>
              </aside>
            </div>
            <dialog class="t2m-calendar-reminder-dialog" data-calendar-reminder-dialog>
              <form method="dialog" data-calendar-reminder-form>
                <header><div><span>Personal calendar item</span><strong>Add reminder</strong></div><button value="cancel" aria-label="Close">×</button></header>
                <label>Title<input name="title" maxlength="255" required placeholder="What must you remember?"></label>
                <div class="t2m-calendar-reminder-row"><label>Date<input name="date" type="date" required value="${state.selected}"></label><label>Time<input name="time" type="time" value="09:00"></label></div>
                <label>Details<textarea name="details" rows="4" maxlength="5000" placeholder="Optional detail or telephone number"></textarea></label>
                <p data-calendar-reminder-status></p>
                <footer><button value="cancel" class="secondary">Cancel</button><button type="button" data-calendar-reminder-save>Save reminder</button></footer>
              </form>
            </dialog>
          </div>`;

          drawAgenda();

          body.querySelector('[data-calendar-prev]').onclick = () => {
            state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1, 12, 0, 0);
            state.selected = isoDate(new Date(state.month.getFullYear(), state.month.getMonth(), 1, 12, 0, 0));
            load();
          };
          body.querySelector('[data-calendar-next]').onclick = () => {
            state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1, 12, 0, 0);
            state.selected = isoDate(new Date(state.month.getFullYear(), state.month.getMonth(), 1, 12, 0, 0));
            load();
          };
          body.querySelector('[data-calendar-today]').onclick = () => {
            const now = new Date();
            state.month = monthStart(now);
            state.selected = isoDate(now);
            load();
          };
          body.querySelectorAll('[data-calendar-scope]').forEach(button => {
            button.onclick = () => {
              const next = button.dataset.calendarScope;
              if (next === state.scope) return;
              state.scope = next;
              load();
            };
          });
          body.querySelectorAll('[data-calendar-date]').forEach(button => {
            button.onclick = () => {
              const chosen = button.dataset.calendarDate;
              const chosenDate = new Date(`${chosen}T12:00:00`);
              state.selected = chosen;
              if (chosenDate.getMonth() !== state.month.getMonth() || chosenDate.getFullYear() !== state.month.getFullYear()) {
                state.month = monthStart(chosenDate);
                load();
              } else {
                draw();
              }
            };
          });
          body.querySelector('[data-calendar-add-task]').onclick = () => openTaskForDate(state.selected);
          body.querySelector('[data-calendar-add-reminder]').onclick = () => {
            const dialog = body.querySelector('[data-calendar-reminder-dialog]');
            const dateInput = dialog.querySelector('input[name="date"]');
            dateInput.value = state.selected;
            dialog.showModal();
            setTimeout(() => dialog.querySelector('input[name="title"]')?.focus(), 0);
          };
          body.querySelectorAll('[data-calendar-open]').forEach(button => {
            button.onclick = () => {
              const item = state.events.find(event => String(event.id) === String(button.dataset.calendarOpen));
              if (item) openCalendarEvent(item);
            };
          });
          body.querySelectorAll('[data-calendar-complete]').forEach(button => {
            button.onclick = async () => {
              const next = button.dataset.currentStatus === 'completed' ? 'open' : 'completed';
              try {
                await jsonFetch(`/api/calendar/items/${button.dataset.calendarComplete}/status`, { method: 'POST', body: JSON.stringify({ status: next }) });
                await load();
              } catch (error) { window.alert(error.message); }
            };
          });
          body.querySelectorAll('[data-calendar-delete]').forEach(button => {
            button.onclick = async () => {
              if (!window.confirm('Delete this reminder?')) return;
              try {
                await jsonFetch(`/api/calendar/items/${button.dataset.calendarDelete}`, { method: 'DELETE' });
                await load();
              } catch (error) { window.alert(error.message); }
            };
          });
          body.querySelector('[data-calendar-reminder-save]').onclick = async () => {
            const dialog = body.querySelector('[data-calendar-reminder-dialog]');
            const form = dialog.querySelector('[data-calendar-reminder-form]');
            const formStatus = dialog.querySelector('[data-calendar-reminder-status]');
            const values = Object.fromEntries(new FormData(form).entries());
            const title = String(values.title || '').trim();
            if (!title) { formStatus.textContent = 'Enter a reminder title.'; return; }
            const date = String(values.date || state.selected);
            const time = String(values.time || '09:00');
            formStatus.textContent = 'Saving…';
            try {
              await jsonFetch('/api/calendar/items', {
                method: 'POST',
                body: JSON.stringify({ item_type: 'reminder', title, details: values.details || '', date, starts_at: `${date}T${time}` })
              });
              state.selected = date;
              const dateValue = new Date(`${date}T12:00:00`);
              state.month = monthStart(dateValue);
              dialog.close();
              await load();
            } catch (error) { formStatus.textContent = error.message; }
          };
        };

        load();
      }
    });
  }

  // Capture at window level so the UAT replacement wins before the legacy document handlers.
  if (osConfigNode) {
    window.addEventListener('click', event => {
      const noteButton = event.target.closest?.('[data-os-app="notes"]');
      if (noteButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showScratchpad();
        return;
      }

      const calendarButton = event.target.closest?.('[data-os-app="calendar"]');
      if (calendarButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openCalendarWindow();
      }
    }, true);
  }

  // Keep the full-page /calendar route useful when opened directly.
  if (!calendarConfigNode) return;

  const hub = document.getElementById('calendar-hub');
  const grid = document.getElementById('calendar-grid');
  const label = document.getElementById('calendar-month-label');
  const agendaDate = document.getElementById('agenda-date');
  const agendaList = document.getElementById('calendar-agenda-list');
  const dialog = document.getElementById('calendar-dialog');
  const form = document.getElementById('calendar-item-form');
  const formDate = document.getElementById('calendar-form-date');
  const status = document.getElementById('calendar-form-status');
  const scopeButton = document.getElementById('calendar-scope');
  let selectedDate = calendarConfig.selectedDate;
  let scope = calendarConfig.isManagement ? 'team' : 'mine';
  let cursor = monthStart(new Date(`${selectedDate}T12:00:00`));
  let events = [];

  function rangeForPageMonth() {
    const range = gridRange(cursor);
    return { start: range.start, end: range.end, startDate: range.startDate, endDate: range.endDate };
  }

  async function loadPage() {
    const range = rangeForPageMonth();
    const response = await jsonFetch(`/api/calendar/events?start=${range.start}&end=${range.end}&scope=${scope}`);
    events = response.events || [];
    renderPage();
  }

  function renderPage() {
    const range = rangeForPageMonth();
    label.textContent = monthLabel(cursor);
    agendaDate.textContent = longDate(selectedDate);
    if (scopeButton) scopeButton.textContent = scope === 'team' ? 'Show mine' : 'Show team';
    const today = isoDate(new Date());
    grid.innerHTML = '';

    for (let date = new Date(range.startDate); date <= range.endDate; date.setDate(date.getDate() + 1)) {
      const day = isoDate(date);
      const dayEvents = events.filter(item => item.date === day);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `calendar-day${date.getMonth() !== cursor.getMonth() ? ' is-outside' : ''}${day === selectedDate ? ' is-selected' : ''}${day === today ? ' is-today' : ''}`;
      button.dataset.date = day;
      button.innerHTML = `<span class="calendar-day-number">${date.getDate()}</span>${dayEvents.length ? `<b class="calendar-day-count">${dayEvents.length}</b>` : ''}<div class="calendar-day-events">${dayEvents.slice(0, 3).map(item => `<span class="calendar-chip" data-type="${esc(item.type)}">${esc((typeMeta[item.type] || typeMeta.other).icon)} ${esc(item.title)}</span>`).join('')}${dayEvents.length > 3 ? `<span class="calendar-chip">+${dayEvents.length - 3} more</span>` : ''}</div>`;
      grid.appendChild(button);
    }
    renderPageAgenda();
  }

  function renderPageAgenda() {
    const items = events.filter(item => item.date === selectedDate);
    if (!items.length) {
      agendaList.innerHTML = '<p class="calendar-empty">Nothing scheduled for this day.</p>';
      return;
    }
    agendaList.innerHTML = items.map(item => `<article class="agenda-item" data-type="${esc(item.type)}">
      <div class="agenda-item-head"><strong>${esc(item.title)}</strong><small>${esc(item.time || 'All day')}</small></div>
      ${scope === 'team' && item.assignedName ? `<small>${esc(item.assignedName)}</small>` : ''}
      ${item.details ? `<p>${esc(item.details)}</p>` : ''}
      <div class="agenda-item-actions">${item.url ? `<a href="${esc(item.url)}">Open</a>` : ''}${item.editable ? `<button type="button" data-complete="${item.sourceId}" data-status="${esc(item.status)}">${item.status === 'completed' ? 'Reopen' : 'Complete'}</button><button type="button" data-delete="${item.sourceId}">Delete</button>` : ''}</div>
    </article>`).join('');
  }

  function openPageAdd(date = selectedDate) {
    form.reset();
    formDate.value = date;
    status.textContent = '';
    form.elements.starts_at.value = `${date}T09:00`;
    dialog.showModal();
    setTimeout(() => form.elements.title.focus(), 0);
  }

  grid.addEventListener('click', event => {
    const day = event.target.closest('[data-date]');
    if (!day) return;
    selectedDate = day.dataset.date;
    renderPage();
  });
  document.getElementById('calendar-prev').onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1, 12, 0, 0); loadPage().catch(showPageError); };
  document.getElementById('calendar-next').onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12, 0, 0); loadPage().catch(showPageError); };
  document.getElementById('calendar-today').onclick = () => { selectedDate = isoDate(new Date()); cursor = monthStart(new Date()); loadPage().catch(showPageError); };
  document.getElementById('calendar-add').onclick = () => openPageAdd();
  document.getElementById('agenda-add').onclick = () => openPageAdd();
  if (scopeButton) scopeButton.onclick = () => { scope = scope === 'mine' ? 'team' : 'mine'; loadPage().catch(showPageError); };

  document.getElementById('calendar-save').onclick = async () => {
    status.textContent = 'Saving…';
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.date = formDate.value;
    try {
      await jsonFetch('/api/calendar/items', { method: 'POST', body: JSON.stringify(payload) });
      dialog.close();
      await loadPage();
    } catch (error) { status.textContent = error.message; }
  };

  agendaList.addEventListener('click', async event => {
    const complete = event.target.closest('[data-complete]');
    if (complete) {
      const next = complete.dataset.status === 'completed' ? 'open' : 'completed';
      await jsonFetch(`/api/calendar/items/${complete.dataset.complete}/status`, { method: 'POST', body: JSON.stringify({ status: next }) });
      return loadPage();
    }
    const del = event.target.closest('[data-delete]');
    if (del && window.confirm('Delete this calendar item?')) {
      await jsonFetch(`/api/calendar/items/${del.dataset.delete}`, { method: 'DELETE' });
      return loadPage();
    }
  });

  function showPageError(error) {
    agendaList.innerHTML = `<p class="calendar-empty">${esc(error.message || 'Calendar unavailable')}</p>`;
  }

  loadPage().catch(showPageError);
})();