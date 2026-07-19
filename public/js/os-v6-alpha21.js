(() => {
  'use strict';

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode || !window.Talk2MeOS?.windows) return;
  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');
  const windows = window.Talk2MeOS.windows;
  const notesKey = `talk2me-os-v6-notes-${config.user?.id || 'user'}`;
  const notesImportKey = `${notesKey}-imported`;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));

  function toast(title, message) {
    const region = document.getElementById('os-toast-region');
    if (!region) return;
    const node = document.createElement('div');
    node.className = 't2m-os-toast';
    node.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    region.appendChild(node);
    setTimeout(() => node.remove(), 4000);
  }

  async function api(path, options = {}) {
    const response = await fetch(`${basePath}${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || 'The request could not be completed.');
    return payload;
  }

  function simplifyTodayWork() {
    const widget = document.querySelector('.t2m-os-desk-widget[data-widget="work"] .t2m-os-widget-body');
    if (!widget) return;

    const overdueRow = widget.querySelector('[data-status="overdueTaskCount"]')?.closest('.t2m-os-widget-row');
    const todayRow = widget.querySelector('[data-status="dueTodayTaskCount"]')?.closest('.t2m-os-widget-row');
    const followUpRow = widget.querySelector('[data-status="followUpTodayCount"]')?.closest('.t2m-os-widget-row');
    const messageRow = widget.querySelector('[data-status="unreadMessageCount"]')?.closest('.t2m-os-widget-row');

    if (overdueRow) overdueRow.remove();
    if (todayRow) {
      const view = todayRow.querySelector('.t2m-os-widget-view');
      const label = view?.querySelector('span');
      const count = view?.querySelector('strong');
      if (label) label.textContent = 'Tasks';
      if (view) {
        view.dataset.osRoute = `${basePath}/tasks`;
        view.dataset.routeTitle = 'Tasks';
        view.dataset.routeIcon = '✓';
        view.setAttribute('aria-label', 'Open tasks');
      }
      if (count) count.dataset.status = 'actionableTaskCount';
    }
    if (followUpRow) {
      const view = followUpRow.querySelector('.t2m-os-widget-view');
      const label = view?.querySelector('span');
      if (label) label.textContent = 'Follow-ups';
      if (view) {
        view.dataset.routeTitle = 'Follow-ups';
        view.setAttribute('aria-label', 'Open follow-ups');
      }
    }
    if (messageRow) {
      const view = messageRow.querySelector('.t2m-os-widget-view');
      const label = view?.querySelector('span');
      if (label) label.textContent = 'Messages';
      if (view) {
        view.dataset.routeTitle = 'Messages';
        view.setAttribute('aria-label', 'Open messages');
      }
    }
  }

  async function refreshActionableTasks() {
    try {
      const response = await fetch(`${basePath}/api/os/status`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const status = (await response.json()).status || {};
      const overdue = Number(status.overdueTaskCount || 0);
      const dueToday = Number(status.dueTodayTaskCount || 0);
      const count = overdue + dueToday;
      document.querySelectorAll('[data-status="actionableTaskCount"]').forEach(node => {
        node.textContent = String(count);
        node.dataset.positive = String(overdue > 0);
      });
    } catch (_) {}
  }

  function openQuickAction(type, title, icon = '+') {
    windows.open({
      id: `quick:${type}`,
      appKey: 'quick-action',
      title,
      icon,
      subtitle: 'Create or update',
      url: `${basePath}/os/quick-add/${type}`,
      width: 860,
      height: 650
    });
  }

  function openNotes() {
    windows.open({
      id: 'notes-db',
      appKey: 'notes',
      title: 'Notes',
      icon: '✎',
      width: 900,
      height: 620,
      render(body) {
        body.innerHTML = '<div class="t2m-os-window-loader">Loading your notes…</div>';
        let notes = [];
        let activeId = null;

        const load = async () => {
          try {
            notes = (await api('/api/os/notes')).notes || [];
            if (activeId && !notes.some(note => Number(note.id) === Number(activeId))) activeId = null;
            draw();
          } catch (error) {
            body.innerHTML = `<div class="t2m-os-native t2m-os-placeholder"><h2>Notes unavailable</h2><p>${esc(error.message)}</p></div>`;
          }
        };

        const draw = () => {
          const current = notes.find(note => Number(note.id) === Number(activeId)) || null;
          const localNote = String(localStorage.getItem(notesKey) || '').trim();
          const canImport = localNote && localStorage.getItem(notesImportKey) !== '1';
          body.innerHTML = `<div class="t2m-notes-db">
            <aside class="t2m-notes-sidebar">
              <header><h2>My Notes</h2><button type="button" class="t2m-os-primary-button" data-note-new>New</button></header>
              <input class="t2m-notes-search" type="search" placeholder="Search notes…" data-note-search>
              <div class="t2m-notes-list">${notes.map(note => `<button type="button" class="t2m-note-item ${Number(note.id) === Number(activeId) ? 'is-active' : ''}" data-note-id="${note.id}"><strong>${note.is_pinned ? '★ ' : ''}${esc(note.title || 'Untitled note')}</strong><span>${esc(String(note.note_text || '').slice(0, 80))}</span></button>`).join('') || '<p>No notes yet.</p>'}</div>
            </aside>
            <section class="t2m-notes-editor">
              ${canImport ? '<div class="t2m-notes-import">A browser-only note was found. <button type="button" data-note-import>Import into Talk2Me</button></div>' : '<div></div>'}
              <input type="text" maxlength="200" placeholder="Note title" data-note-title value="${esc(current?.title || '')}">
              <textarea placeholder="Write your note…" data-note-text>${esc(current?.note_text || '')}</textarea>
              <div class="t2m-notes-actions"><button type="button" class="t2m-os-primary-button" data-note-save>${current ? 'Save note' : 'Create note'}</button>${current ? `<button type="button" class="t2m-os-secondary-button" data-note-pin>${current.is_pinned ? 'Unpin' : 'Pin'}</button><button type="button" class="danger" data-note-archive>Archive</button>` : ''}</div>
            </section>
          </div>`;

          body.querySelectorAll('[data-note-id]').forEach(button => {
            button.onclick = () => { activeId = Number(button.dataset.noteId); draw(); };
          });
          body.querySelector('[data-note-new]').onclick = () => { activeId = null; draw(); };
          body.querySelector('[data-note-search]').oninput = event => {
            const query = event.target.value.toLowerCase();
            body.querySelectorAll('[data-note-id]').forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(query); });
          };
          body.querySelector('[data-note-save]').onclick = async () => {
            try {
              const payload = await api('/api/os/notes', {
                method: 'POST',
                body: JSON.stringify({ id: activeId, title: body.querySelector('[data-note-title]').value, note_text: body.querySelector('[data-note-text]').value })
              });
              activeId = Number(payload.note.id);
              await load();
              toast('Note saved', 'Your note is available on every Talk2Me workstation.');
            } catch (error) { toast('Note not saved', error.message); }
          };
          body.querySelector('[data-note-pin]')?.addEventListener('click', async () => {
            await api(`/api/os/notes/${activeId}/pin`, { method: 'POST', body: '{}' });
            await load();
          });
          body.querySelector('[data-note-archive]')?.addEventListener('click', async () => {
            if (!confirm('Archive this note?')) return;
            await api(`/api/os/notes/${activeId}/archive`, { method: 'POST', body: '{}' });
            activeId = null;
            await load();
          });
          body.querySelector('[data-note-import]')?.addEventListener('click', async () => {
            try {
              const payload = await api('/api/os/notes', { method: 'POST', body: JSON.stringify({ title: 'Imported browser note', note_text: localNote }) });
              localStorage.setItem(notesImportKey, '1');
              activeId = Number(payload.note.id);
              await load();
              toast('Note imported', 'The browser note is now stored in Talk2Me.');
            } catch (error) { toast('Import failed', error.message); }
          });
        };

        load();
      }
    });
  }

  document.addEventListener('click', event => {
    const add = event.target.closest('[data-widget-add]');
    if (add) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openQuickAction(add.dataset.widgetAdd, add.dataset.addTitle || 'Quick action', add.dataset.addIcon || '+');
      return;
    }

    const notesButton = event.target.closest('[data-os-app="notes"]');
    if (notesButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openNotes();
    }
  }, true);

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'talk2me:quick-action-saved') return;
    const type = String(event.data.action || '');
    setTimeout(() => windows.close(`quick:${type}`), 250);
    window.Talk2MeOS.refresh();
    refreshActionableTasks();
    toast('Saved', 'The dashboard and related work list were refreshed.');
  });

  simplifyTodayWork();
  refreshActionableTasks();
  setInterval(refreshActionableTasks, 15000);
})();