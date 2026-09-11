(() => {
  'use strict';

  const osConfigNode = document.getElementById('talk2me-os-config');
  const calendarConfigNode = document.getElementById('calendar-config');
  const osConfig = osConfigNode ? JSON.parse(osConfigNode.textContent || '{}') : null;
  const calendarConfig = calendarConfigNode ? JSON.parse(calendarConfigNode.textContent || '{}') : null;
  const basePath = String((osConfig || calendarConfig || {}).basePath || '');

  function ensureScratchpad() {
    let pad = document.getElementById('t2m-scratchpad');
    if (pad) return pad;
    pad = document.createElement('section');
    pad.id = 't2m-scratchpad';
    pad.className = 't2m-scratchpad';
    pad.innerHTML = `<div class="t2m-scratchpad-head" data-scratch-drag>
      <div><strong>My Scratch Pad</strong><span>Private · autosaved</span></div>
      <div class="t2m-scratchpad-actions"><button type="button" data-scratch-min aria-label="Minimise">—</button><button type="button" data-scratch-close aria-label="Close">×</button></div>
    </div><div class="t2m-scratchpad-body"><textarea maxlength="20000" placeholder="Jot down a phone number, name or quick thought…"></textarea><div class="t2m-scratchpad-foot"><span data-scratch-status>Loading…</span><button type="button" class="t2m-scratchpad-clear" data-scratch-clear>Clear</button></div></div>`;
    document.body.appendChild(pad);
    const area = pad.querySelector('textarea');
    const status = pad.querySelector('[data-scratch-status]');
    const prefKey = `t2m-scratchpad-position-${osConfig?.user?.id || 'user'}`;
    let saveTimer;

    fetch(`${basePath}/api/scratchpad`, { credentials: 'same-origin', cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('load failed')))
      .then(data => { area.value = data.note || ''; status.textContent = data.updatedAt ? 'Saved' : 'Ready'; })
      .catch(() => { status.textContent = 'Could not load'; });

    const save = () => {
      status.textContent = 'Saving…';
      fetch(`${basePath}/api/scratchpad`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: area.value })
      }).then(r => r.ok ? r.json() : Promise.reject(new Error('save failed')))
        .then(() => { status.textContent = 'Saved'; })
        .catch(() => { status.textContent = 'Save failed'; });
    };
    area.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 450); });
    pad.querySelector('[data-scratch-min]').onclick = () => pad.classList.toggle('is-minimized');
    pad.querySelector('[data-scratch-close]').onclick = () => { pad.hidden = true; };
    pad.querySelector('[data-scratch-clear]').onclick = () => {
      if (!area.value || confirm('Clear your scratch pad?')) { area.value = ''; save(); area.focus(); }
    };

    try {
      const saved = JSON.parse(localStorage.getItem(prefKey) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        pad.style.left = `${saved.left}px`; pad.style.top = `${saved.top}px`; pad.style.right = 'auto'; pad.style.bottom = 'auto';
      }
    } catch (_) {}

    const drag = pad.querySelector('[data-scratch-drag]');
    drag.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      const rect = pad.getBoundingClientRect();
      const startX = event.clientX, startY = event.clientY;
      drag.setPointerCapture(event.pointerId);
      const move = e => {
        const width = pad.offsetWidth, height = pad.offsetHeight;
        const left = Math.max(0, Math.min(window.innerWidth - width, rect.left + e.clientX - startX));
        const top = Math.max(28, Math.min(window.innerHeight - height, rect.top + e.clientY - startY));
        pad.style.left = `${left}px`; pad.style.top = `${top}px`; pad.style.right = 'auto'; pad.style.bottom = 'auto';
      };
      const done = () => {
        drag.removeEventListener('pointermove', move); drag.removeEventListener('pointerup', done); drag.removeEventListener('pointercancel', done);
        const current = pad.getBoundingClientRect();
        localStorage.setItem(prefKey, JSON.stringify({ left: current.left, top: current.top }));
      };
      drag.addEventListener('pointermove', move); drag.addEventListener('pointerup', done); drag.addEventListener('pointercancel', done);
    });
    return pad;
  }

  if (osConfigNode) {
    document.addEventListener('click', event => {
      const noteButton = event.target.closest('[data-os-app="notes"]');
      if (noteButton) {
        event.preventDefault(); event.stopImmediatePropagation();
        const pad = ensureScratchpad(); pad.hidden = false; pad.classList.remove('is-minimized'); pad.querySelector('textarea')?.focus();
        return;
      }
      const calendarButton = event.target.closest('[data-os-app="calendar"]');
      if (calendarButton) {
        event.preventDefault(); event.stopImmediatePropagation();
        window.location.href = `${basePath}/calendar`;
      }
    }, true);
  }

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
  let scope = 'mine';
  let cursor = new Date(`${selectedDate}T12:00:00`);
  cursor.setDate(1);
  let events = [];

  const iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const human = value => new Intl.DateTimeFormat('en-ZA',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(`${value}T12:00:00`));
  const monthName = date => new Intl.DateTimeFormat('en-ZA',{month:'long',year:'numeric'}).format(date);
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function rangeForMonth() {
    const start = new Date(cursor); start.setDate(1); start.setDate(start.getDate() - ((start.getDay()+6)%7));
    const end = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0); end.setDate(end.getDate() + (6-((end.getDay()+6)%7)));
    return { start: iso(start), end: iso(end) };
  }

  async function load() {
    const range = rangeForMonth();
    const response = await fetch(`${basePath}/api/calendar/events?start=${range.start}&end=${range.end}&scope=${scope}`, { credentials:'same-origin', cache:'no-store' });
    if (!response.ok) throw new Error('Could not load calendar');
    const data = await response.json(); events = data.events || []; render();
  }

  function render() {
    const { start, end } = rangeForMonth();
    label.textContent = monthName(cursor);
    agendaDate.textContent = human(selectedDate);
    const startDate = new Date(`${start}T12:00:00`), endDate = new Date(`${end}T12:00:00`), today = iso(new Date());
    grid.innerHTML = '';
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate()+1)) {
      const day = iso(date), dayEvents = events.filter(item => item.date === day);
      const button = document.createElement('button'); button.type = 'button';
      button.className = `calendar-day${date.getMonth()!==cursor.getMonth()?' is-outside':''}${day===selectedDate?' is-selected':''}${day===today?' is-today':''}`;
      button.dataset.date = day;
      button.innerHTML = `<span class="calendar-day-number">${date.getDate()}</span><div class="calendar-day-events">${dayEvents.slice(0,4).map(item=>`<span class="calendar-chip" data-type="${esc(item.type)}">${item.time?esc(item.time)+' ':''}${esc(item.title)}</span>`).join('')}${dayEvents.length>4?`<span class="calendar-chip">+${dayEvents.length-4} more</span>`:''}</div>`;
      grid.appendChild(button);
    }
    renderAgenda();
  }

  function renderAgenda() {
    const items = events.filter(item => item.date === selectedDate);
    if (!items.length) { agendaList.innerHTML = '<p class="calendar-empty">Nothing scheduled for this day.</p>'; return; }
    agendaList.innerHTML = items.map(item => `<article class="agenda-item" data-type="${esc(item.type)}">
      <div class="agenda-item-head"><strong>${esc(item.title)}</strong><small>${esc(item.time || 'All day')}</small></div>
      <small>${esc(item.assignedName || '')}</small>${item.details?`<p>${esc(item.details)}</p>`:''}
      <div class="agenda-item-actions">${item.url?`<a href="${esc(item.url)}">Open</a>`:''}${item.editable?`<button type="button" data-complete="${item.sourceId}" data-status="${esc(item.status)}">${item.status==='completed'?'Reopen':'Complete'}</button><button type="button" data-delete="${item.sourceId}">Delete</button>`:''}</div>
    </article>`).join('');
  }

  function openAdd(date = selectedDate) {
    form.reset(); formDate.value = date; status.textContent = '';
    const input = form.elements.starts_at; input.value = `${date}T09:00`;
    dialog.showModal(); setTimeout(()=>form.elements.title.focus(),0);
  }

  grid.addEventListener('click', event => {
    const day = event.target.closest('[data-date]'); if (!day) return;
    selectedDate = day.dataset.date; render();
  });
  document.getElementById('calendar-prev').onclick = () => { cursor.setMonth(cursor.getMonth()-1); load().catch(showError); };
  document.getElementById('calendar-next').onclick = () => { cursor.setMonth(cursor.getMonth()+1); load().catch(showError); };
  document.getElementById('calendar-today').onclick = () => { selectedDate=iso(new Date()); cursor=new Date(`${selectedDate}T12:00:00`); cursor.setDate(1); load().catch(showError); };
  document.getElementById('calendar-add').onclick = () => openAdd();
  document.getElementById('agenda-add').onclick = () => openAdd();
  if (scopeButton) scopeButton.onclick = () => { scope = scope==='mine'?'team':'mine'; scopeButton.textContent = scope==='mine'?'Show team':'Show mine'; load().catch(showError); };

  document.getElementById('calendar-save').onclick = async () => {
    status.textContent = 'Saving…';
    const payload = Object.fromEntries(new FormData(form).entries()); payload.date = formDate.value;
    const response = await fetch(`${basePath}/api/calendar/items`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) { status.textContent = data.error || 'Could not save'; return; }
    dialog.close(); await load();
  };

  agendaList.addEventListener('click', async event => {
    const complete = event.target.closest('[data-complete]');
    if (complete) {
      const next = complete.dataset.status === 'completed' ? 'open' : 'completed';
      await fetch(`${basePath}/api/calendar/items/${complete.dataset.complete}/status`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:next}) });
      return load();
    }
    const del = event.target.closest('[data-delete]');
    if (del && confirm('Delete this calendar item?')) {
      await fetch(`${basePath}/api/calendar/items/${del.dataset.delete}`, { method:'DELETE', credentials:'same-origin' });
      return load();
    }
  });

  function showError(error) { agendaList.innerHTML = `<p class="calendar-empty">${esc(error.message || 'Calendar unavailable')}</p>`; }
  load().catch(showError);
})();
