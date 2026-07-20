(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode || !window.Talk2MeOS?.windows) return;

  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');
  const windows = window.Talk2MeOS.windows;

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function monthTitle(date) {
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function drawCalendar(body, state) {
    const first = startOfMonth(state.month);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    const todayKey = dateKey(new Date());
    const cells = [];

    for (let index = 0; index < 42; index += 1) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      const key = dateKey(day);
      const outside = day.getMonth() !== state.month.getMonth();
      const selected = key === state.selected;
      cells.push(`<button type="button" class="t2m-calendar-day${outside ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}${selected ? ' is-selected' : ''}" data-calendar-date="${key}"><span>${day.getDate()}</span></button>`);
    }

    body.innerHTML = `<div class="t2m-calendar-app">
      <header class="t2m-calendar-toolbar">
        <button type="button" data-calendar-prev aria-label="Previous month">‹</button>
        <div><strong>${monthTitle(state.month)}</strong><small>${state.selected ? `Selected: ${state.selected}` : 'Select a date'}</small></div>
        <button type="button" data-calendar-next aria-label="Next month">›</button>
      </header>
      <div class="t2m-calendar-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
      <div class="t2m-calendar-grid">${cells.join('')}</div>
      <footer class="t2m-calendar-footer">
        <button type="button" class="t2m-os-secondary-button" data-calendar-today>Today</button>
        <button type="button" class="t2m-os-primary-button" data-calendar-add>Add task for selected date</button>
      </footer>
    </div>`;

    body.querySelector('[data-calendar-prev]').onclick = () => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
      drawCalendar(body, state);
    };
    body.querySelector('[data-calendar-next]').onclick = () => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
      drawCalendar(body, state);
    };
    body.querySelector('[data-calendar-today]').onclick = () => {
      const today = new Date();
      state.month = startOfMonth(today);
      state.selected = dateKey(today);
      drawCalendar(body, state);
    };
    body.querySelectorAll('[data-calendar-date]').forEach(button => {
      button.onclick = () => {
        state.selected = button.dataset.calendarDate;
        const chosen = new Date(`${state.selected}T12:00:00`);
        state.month = startOfMonth(chosen);
        drawCalendar(body, state);
      };
    });
    body.querySelector('[data-calendar-add]').onclick = () => {
      const selected = state.selected || dateKey(new Date());
      windows.open({
        id: 'quick:task',
        appKey: 'quick-action',
        title: 'Add Task',
        icon: '✓',
        subtitle: `Task for ${selected}`,
        url: `${basePath}/os/quick-add/task?date=${encodeURIComponent(selected)}`,
        width: 860,
        height: 650
      });
    };
  }

  function openCalendar() {
    const today = new Date();
    windows.open({
      id: 'calendar-live',
      appKey: 'calendar',
      title: 'Calendar',
      icon: '□',
      width: 900,
      height: 650,
      render(body) {
        drawCalendar(body, { month: startOfMonth(today), selected: dateKey(today) });
      }
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-os-app="calendar"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCalendar();
  }, true);
})();