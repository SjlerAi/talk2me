(() => {
  'use strict';
  if (window.__talk2meUatWidgetPolishLoaded) return;
  window.__talk2meUatWidgetPolishLoaded = true;

  const configNode = document.getElementById('talk2me-os-config');
  const config = configNode ? JSON.parse(configNode.textContent || '{}') : {};
  const basePath = String(config.basePath || '');
  let staffColours = new Map();
  let pendingConversation = null;
  const chatDrafts = new Map();
  let composerFocused = false;
  let chatSending = false;

  function chatState(token) {
    const key = String(token || 'office');
    if (!chatDrafts.has(key)) chatDrafts.set(key, { text:'', caret:0, followUp:false, due:'', priority:'normal', pendingTaskId:null });
    return chatDrafts.get(key);
  }

  function currentConversation(widget) {
    const compact = widget?.querySelector('[data-compact-staff]');
    if (compact?.value) return compact.value;
    const active = widget?.querySelector('.t2m-chat-person.is-active[data-chat-person]');
    if (active?.dataset.chatPerson) return active.dataset.chatPerson;
    if (widget?.querySelector('[data-chat-tab="office"].is-active')) return 'office';
    return pendingConversation || 'office';
  }

  async function postJson(path, payload) {
    const response = await fetch(`${basePath}${path}`, {
      method:'POST',
      credentials:'same-origin',
      cache:'no-store',
      headers:{Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function taskTitleFromMessage(body) {
    const first = String(body || '').split(/\r?\n/).map(part => part.trim()).find(Boolean) || 'Message follow-up';
    return `Follow up: ${first.replace(/\s+/g,' ').slice(0,155)}`.slice(0,180);
  }

  function ensureFollowupStyles() {
    if (document.getElementById('t2m-chat-followup-style')) return;
    const style = document.createElement('style');
    style.id = 't2m-chat-followup-style';
    style.textContent = `
      #t2m-messenger-widget .t2m-chat-followup{display:flex;align-items:center;gap:7px;margin:0 0 6px;padding:6px 7px;border:1px solid #dde4ea;border-radius:9px;background:#f7f9fb;color:#344054;font-size:9px}
      #t2m-messenger-widget .t2m-chat-followup[hidden]{display:none!important}
      #t2m-messenger-widget .t2m-chat-followup-toggle{display:flex;align-items:center;gap:5px;white-space:nowrap;font-weight:900;cursor:pointer}
      #t2m-messenger-widget .t2m-chat-followup-toggle input{margin:0}
      #t2m-messenger-widget .t2m-chat-followup-fields{display:grid;grid-template-columns:minmax(125px,1fr) 76px;gap:5px;min-width:0;flex:1}
      #t2m-messenger-widget .t2m-chat-followup-fields[hidden]{display:none!important}
      #t2m-messenger-widget .t2m-chat-followup-fields input,#t2m-messenger-widget .t2m-chat-followup-fields select{width:100%;min-width:0;box-sizing:border-box;height:30px;border:1px solid #cdd6df;border-radius:7px;background:#fff;padding:4px 6px;color:#202832;font:inherit;font-size:9px}
      #t2m-messenger-widget .t2m-chat-send-busy{opacity:.65;cursor:wait}
    `;
    document.head.appendChild(style);
  }

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

  function restoreChatComposer(widget) {
    const textarea = widget.querySelector('[data-chat-text]');
    if (!textarea) return;
    const token = currentConversation(widget);
    const state = chatState(token);
    if (textarea.value !== state.text) textarea.value = state.text;
    textarea.oninput = () => {
      const active = chatState(currentConversation(widget));
      active.text = textarea.value;
      active.caret = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
      composerFocused = true;
    };
    textarea.onkeyup = textarea.onmouseup = () => {
      const active = chatState(currentConversation(widget));
      active.caret = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
    };
    textarea.onfocus = () => { composerFocused = true; };
    if (composerFocused && state.text) {
      window.requestAnimationFrame(() => {
        if (!document.body.contains(textarea)) return;
        textarea.focus({ preventScroll:true });
        const caret = Math.max(0, Math.min(Number(state.caret || state.text.length), textarea.value.length));
        try { textarea.setSelectionRange(caret, caret); } catch (_) {}
      });
    }
  }

  function ensureFollowupControls(widget) {
    ensureFollowupStyles();
    const composer = widget.querySelector('.t2m-chat-composer');
    const textarea = widget.querySelector('[data-chat-text]');
    if (!composer || !textarea) return;
    const token = currentConversation(widget);
    const direct = /^direct:\d+$/.test(token);
    let row = composer.querySelector('[data-chat-followup-row]');
    if (!row) {
      row = document.createElement('div');
      row.className = 't2m-chat-followup';
      row.dataset.chatFollowupRow = '1';
      row.innerHTML = `<label class="t2m-chat-followup-toggle"><input type="checkbox" data-chat-followup> Follow up</label><div class="t2m-chat-followup-fields" data-chat-followup-fields hidden><input type="datetime-local" data-chat-followup-due aria-label="Follow-up due date and time" title="Follow-up due date and time"><select data-chat-followup-priority aria-label="Follow-up priority" title="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>`;
      composer.insertBefore(row, composer.querySelector('.t2m-chat-compose-row'));
    }
    row.hidden = !direct;
    const checkbox = row.querySelector('[data-chat-followup]');
    const fields = row.querySelector('[data-chat-followup-fields]');
    const due = row.querySelector('[data-chat-followup-due]');
    const priority = row.querySelector('[data-chat-followup-priority]');
    const state = chatState(token);
    checkbox.checked = direct && Boolean(state.followUp);
    due.value = state.due || '';
    priority.value = state.priority || 'normal';
    fields.hidden = !checkbox.checked;
    checkbox.onchange = () => {
      const active = chatState(currentConversation(widget));
      active.followUp = checkbox.checked;
      if (!checkbox.checked) active.pendingTaskId = null;
      fields.hidden = !checkbox.checked;
      if (checkbox.checked && !due.value) due.focus();
    };
    due.onchange = due.oninput = () => { chatState(currentConversation(widget)).due = due.value; };
    priority.onchange = () => { chatState(currentConversation(widget)).priority = priority.value; };
    restoreChatComposer(widget);
  }

  async function sendChat(widget) {
    if (chatSending) return;
    const textarea = widget.querySelector('[data-chat-text]');
    const sendButton = widget.querySelector('[data-chat-send]');
    if (!textarea || !sendButton) return;
    const token = currentConversation(widget);
    const body = String(textarea.value || '').trim();
    if (!body) return;
    const state = chatState(token);
    const followUp = /^direct:\d+$/.test(token) && Boolean(state.followUp);
    const assignedTo = followUp ? Number(token.split(':')[1]) : null;
    if (followUp && !state.due) {
      window.alert('Choose a follow-up date and time.');
      widget.querySelector('[data-chat-followup-due]')?.focus();
      return;
    }

    chatSending = true;
    textarea.disabled = true;
    sendButton.disabled = true;
    sendButton.classList.add('t2m-chat-send-busy');
    let taskId = state.pendingTaskId || null;
    try {
      if (followUp && !taskId) {
        const task = await postJson('/api/uat/tasks', {
          assigned_to: assignedTo,
          title: taskTitleFromMessage(body),
          message: body,
          priority: state.priority || 'normal',
          due_at: state.due
        });
        taskId = Number(task.id || 0) || null;
        state.pendingTaskId = taskId;
      }
      await postJson('/api/uat/chat/messages', {
        conversation: token,
        body,
        related_task_id: taskId
      });
      chatDrafts.delete(token);
      composerFocused = false;
      window.dispatchEvent(new Event('workspace:refresh'));
      const conversationButton = widget.querySelector(`.t2m-chat-person[data-chat-person="${CSS.escape(token)}"]`);
      if (conversationButton) conversationButton.click();
      else {
        textarea.value = '';
        const row = widget.querySelector('[data-chat-followup-row]');
        if (row) row.querySelector('[data-chat-followup]')?.click();
      }
    } catch (error) {
      if (taskId) state.pendingTaskId = taskId;
      window.alert(taskId ? `The follow-up task was created, but the chat message could not be sent. Press Send again to retry the message.\n\n${error.message}` : error.message);
    } finally {
      chatSending = false;
      const currentText = widget.querySelector('[data-chat-text]');
      const currentSend = widget.querySelector('[data-chat-send]');
      if (currentText) currentText.disabled = false;
      if (currentSend) {
        currentSend.disabled = false;
        currentSend.classList.remove('t2m-chat-send-busy');
      }
      if (currentText && !currentText.value) currentText.focus();
    }
  }

  function bindChatComposerOnce(widget) {
    if (widget.dataset.chatFollowupBound === '1') return;
    widget.dataset.chatFollowupBound = '1';
    widget.addEventListener('click', event => {
      const send = event.target.closest('[data-chat-send]');
      if (!send) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      sendChat(widget);
    }, true);
    widget.addEventListener('keydown', event => {
      if (!event.target.matches('[data-chat-text]') || event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      sendChat(widget);
    }, true);
    widget.addEventListener('pointerdown', event => {
      composerFocused = Boolean(event.target.matches('[data-chat-text]'));
    }, true);
  }

  function polishChat() {
    const widget = document.getElementById('t2m-messenger-widget');
    if (!widget) return;
    compactSize(widget, 340, 430);
    bindChatComposerOnce(widget);
    const subtitle = widget.querySelector('.t2m-float-widget-head-copy small');
    if (subtitle) subtitle.textContent = 'People & Office';

    const tabs = widget.querySelector('.t2m-chat-tabs');
    if (tabs && !tabs.querySelector('[data-compact-staff]')) {
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
        composerFocused = false;
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
    }
    if (pendingConversation) finishPendingConversation(widget);
    ensureFollowupControls(widget);
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
  window.addEventListener('blur', () => { composerFocused = false; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStaffColours(); });
  document.addEventListener('focusin', event => {
    if (event.target.matches?.('#t2m-messenger-widget [data-chat-text]')) composerFocused = true;
    else if (event.target.closest?.('#t2m-messenger-widget .t2m-chat-composer')) composerFocused = false;
  });
  polishAll();
  loadStaffColours();
})();