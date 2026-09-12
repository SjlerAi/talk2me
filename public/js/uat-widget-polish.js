(() => {
  'use strict';
  if (window.__talk2meUatWidgetPolishLoaded) return;
  window.__talk2meUatWidgetPolishLoaded = true;

  const configNode = document.getElementById('talk2me-os-config');
  const config = configNode ? JSON.parse(configNode.textContent || '{}') : {};
  const basePath = String(config.basePath || '');
  let staffColours = new Map();
  let pendingConversation = null;

  async function loadStaffColours() {
    try {
      const response = await fetch(`${basePath}/api/uat/staff-colors`, { credentials:'same-origin', cache:'no-store', headers:{Accept:'application/json'} });
      const data = await response.json();
      if (!response.ok || data.ok === false) return;
      staffColours = new Map((data.staff || []).map(person => [String(person.name || '').trim(), person.color]));
      applyStaffColours();
    } catch (_) {}
  }

  function applyStaffColours() {
    document.querySelectorAll('.t2m-home-team-filter button').forEach(button => {
      const name = button.textContent.trim();
      const color = staffColours.get(name);
      const dot = button.querySelector('i');
      if (color && dot) dot.style.setProperty('--staff-color', color);
    });

    document.querySelectorAll('.t2m-home-agenda-item').forEach(card => {
      const owner = card.querySelector('.t2m-home-owner');
      const color = owner ? staffColours.get(owner.textContent.trim()) : null;
      if (color) card.style.setProperty('--staff-color', color);
    });

    document.querySelectorAll('.t2m-home-event-mark[title]').forEach(mark => {
      const name = String(mark.getAttribute('title') || '').split(' · ')[0].trim();
      const color = staffColours.get(name);
      if (color) mark.style.setProperty('--staff-color', color);
    });

    const select = document.querySelector('#t2m-messenger-widget [data-compact-staff]');
    if (select) {
      const selected = select.options[select.selectedIndex];
      const color = selected ? staffColours.get(selected.dataset.name || '') : null;
      select.style.borderLeft = color ? `6px solid ${color}` : '';
    }
  }

  function compactSize(widget, width, height) {
    if (!widget || widget.dataset.compactSized === '1') return;
    const rect = widget.getBoundingClientRect();
    if (rect.width > width) widget.style.width = `${width}px`;
    if (rect.height > height) widget.style.height = `${height}px`;
    widget.dataset.compactSized = '1';
  }

  function polishChat() {
    const widget = document.getElementById('t2m-messenger-widget');
    if (!widget) return;
    compactSize(widget, 340, 430);
    const subtitle = widget.querySelector('.t2m-float-widget-head-copy small');
    if (subtitle) subtitle.textContent = 'People & Office';

    const tabs = widget.querySelector('.t2m-chat-tabs');
    if (!tabs || tabs.querySelector('[data-compact-staff]')) {
      if (pendingConversation) finishPendingConversation(widget);
      applyStaffColours();
      return;
    }

    const peopleTab = tabs.querySelector('[data-chat-tab="people"]');
    const directButtons = [...widget.querySelectorAll('.t2m-chat-person[data-chat-person^="direct:"]')];
    const activeDirect = widget.querySelector('.t2m-chat-person.is-active[data-chat-person^="direct:"]');
    const select = document.createElement('select');
    select.className = 't2m-chat-staff-select';
    select.dataset.compactStaff = '1';
    select.setAttribute('aria-label', 'Choose staff member');
    select.innerHTML = `<option value="">People</option>${directButtons.map(button => {
      const token = button.dataset.chatPerson;
      const name = button.querySelector('strong')?.textContent?.trim() || 'Staff';
      const unread = button.querySelector('em')?.textContent?.trim();
      return `<option value="${token}" data-name="${name.replace(/"/g,'&quot;')}">${name}${unread ? ` (${unread})` : ''}</option>`;
    }).join('')}`;
    if (activeDirect) select.value = activeDirect.dataset.chatPerson;

    select.addEventListener('change', () => {
      const token = select.value;
      if (!token) return;
      const button = widget.querySelector(`.t2m-chat-person[data-chat-person="${CSS.escape(token)}"]`);
      if (button) {
        button.click();
      } else if (peopleTab) {
        pendingConversation = token;
        peopleTab.click();
      }
      setTimeout(applyStaffColours, 0);
    });

    tabs.insertBefore(select, tabs.firstChild);
    if (pendingConversation) finishPendingConversation(widget);
    applyStaffColours();
  }

  function finishPendingConversation(widget) {
    if (!pendingConversation) return;
    const button = widget.querySelector(`.t2m-chat-person[data-chat-person="${CSS.escape(pendingConversation)}"]`);
    if (!button) return;
    const token = pendingConversation;
    pendingConversation = null;
    button.click();
    setTimeout(() => {
      const select = widget.querySelector('[data-compact-staff]');
      if (select) select.value = token;
      applyStaffColours();
    }, 0);
  }

  function polishTasks() {
    const widget = document.getElementById('t2m-task-widget');
    if (!widget) return;
    compactSize(widget, 340, 440);
  }

  function polishAll() {
    polishChat();
    polishTasks();
    applyStaffColours();
  }

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(polishAll);
  });
  observer.observe(document.body, { childList:true, subtree:true });

  window.addEventListener('focus', loadStaffColours);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStaffColours(); });
  polishAll();
  loadStaffColours();
})();
