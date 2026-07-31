(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const drawer = byId('drawer');
  let canBroadcast = false;
  let recipients = [];

  async function api(url, options={}) {
    const response = await fetch(url, {...options, headers:{Accept:'application/json', ...(options.headers || {})}});
    if (response.status === 401) { location.replace('/login'); throw new Error('AUTHENTICATION_REQUIRED'); }
    return response;
  }

  function notify(message) {
    if (typeof window.toast === 'function') return window.toast(message);
    const toast = byId('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function ensureStyles() {
    if (byId('notificationStyles')) return;
    const style = document.createElement('style');
    style.id = 'notificationStyles';
    style.textContent = `
      #drawer{display:flex;flex-direction:column;max-height:100vh;overflow:hidden}
      #drawer .drawer-head{flex:0 0 auto;background:#fff;position:sticky;top:0;z-index:3}
      .notification-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 18px 24px}
      .notification-toolbar{display:flex;justify-content:space-between;align-items:center;margin:14px 0;position:sticky;top:0;background:#fff;padding:8px 0;z-index:2}
      .notification-toolbar button,.notification-card button,.broadcast-form button{border:1px solid var(--line);border-radius:10px;background:#fff;padding:9px 12px;font-weight:800;cursor:pointer}
      .notification-list{display:grid;gap:10px;padding-bottom:28px}
      .notification-card{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff}
      .notification-card.unread{border-left:4px solid var(--red);background:#fffafa}
      .notification-card h3{margin:0 0 5px;font-size:15px}
      .notification-card p{margin:0 0 8px;color:var(--muted);font-size:13px;white-space:pre-wrap}
      .notification-meta{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:11px;color:var(--muted)}
      .notification-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
      .broadcast-form{margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--blue-pale);display:grid;gap:9px}
      .broadcast-form input,.broadcast-form textarea,.broadcast-form select{width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff}
      .broadcast-form button{background:var(--red);color:#fff;border-color:var(--red)}
      .broadcast-target-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .notification-empty{text-align:center;color:var(--muted);padding:30px 10px}
      @media(max-width:640px){.broadcast-target-row{grid-template-columns:1fr}.notification-scroll{padding:0 12px 20px}}
    `;
    document.head.appendChild(style);
  }

  function prepareDrawer() {
    if (!drawer) return;
    ensureStyles();
    drawer.innerHTML = `<div class="drawer-head"><div><h2>Notifications</h2><span id="notificationSummary">Loading...</span></div><button id="closeDrawer">×</button></div>
      <div class="notification-scroll" id="notificationScroll">
        <div id="broadcastArea"></div>
        <div class="notification-toolbar"><strong>Latest messages</strong><button id="refreshNotifications">Refresh</button></div>
        <div class="notification-list" id="notificationList"><div class="notification-empty">Loading notifications...</div></div>
      </div>`;
    byId('closeDrawer').addEventListener('click', () => drawer.classList.remove('open'));
    byId('refreshNotifications').addEventListener('click', loadNotifications);
  }

  function renderBroadcast() {
    const area = byId('broadcastArea');
    if (!area) return;
    if (!canBroadcast) { area.innerHTML = ''; return; }
    const staffOptions = recipients.map(person => `<option value="${person.id}">${esc(person.full_name)} · ${esc(person.role)}</option>`).join('');
    area.innerHTML = `<form class="broadcast-form" id="broadcastForm">
      <strong>Send message</strong>
      <div class="broadcast-target-row">
        <label>Send to<select id="broadcastTarget"><option value="team">Whole team</option><option value="staff">One staff member</option></select></label>
        <label id="broadcastStaffWrap" hidden>Staff member<select id="broadcastStaff"><option value="">Select staff member</option>${staffOptions}</select></label>
      </div>
      <input id="broadcastTitle" maxlength="160" placeholder="Message title" required>
      <textarea id="broadcastMessage" rows="3" maxlength="3000" placeholder="Write the message" required></textarea>
      <button type="submit" id="sendBroadcast">Send to team</button>
    </form>`;
    byId('broadcastTarget').addEventListener('change', updateTargetControls);
    byId('broadcastForm').addEventListener('submit', sendBroadcast);
    updateTargetControls();
  }

  function updateTargetControls() {
    const direct = byId('broadcastTarget')?.value === 'staff';
    if (byId('broadcastStaffWrap')) byId('broadcastStaffWrap').hidden = !direct;
    if (byId('broadcastStaff')) byId('broadcastStaff').required = direct;
    if (byId('sendBroadcast')) byId('sendBroadcast').textContent = direct ? 'Send to staff member' : 'Send to team';
  }

  function isUnread(status) {
    return !['seen','read','completed','done','archived'].includes(String(status || '').toLowerCase());
  }

  function renderItems(items) {
    const list = byId('notificationList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="notification-empty">No notifications yet.</div>';
      return;
    }
    list.innerHTML = items.map(item => {
      const unread = isUnread(item.status);
      const date = item.created_at ? new Intl.DateTimeFormat('en-ZA',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(item.created_at)) : '';
      return `<article class="notification-card ${unread ? 'unread' : ''}" data-notification-id="${item.id}"><h3>${esc(item.title || 'Notification')}</h3><p>${esc(item.message || '')}</p><div class="notification-meta"><span>${esc(date)}</span><span>${unread ? 'unread' : 'seen'}</span></div><div class="notification-actions">${item.client_id ? `<button data-open-client="${item.client_id}">Open customer</button>` : ''}${unread ? `<button data-mark-read="${item.id}">Mark as read</button>` : ''}</div></article>`;
    }).join('');
    list.querySelectorAll('[data-mark-read]').forEach(button => button.addEventListener('click', () => markRead(button)));
    list.querySelectorAll('[data-open-client]').forEach(button => button.addEventListener('click', async () => {
      const id = Number(button.dataset.openClient);
      drawer.classList.remove('open');
      if (id && typeof window.openCustomer === 'function') await window.openCustomer(id);
    }));
  }

  async function loadNotifications() {
    if (!drawer) return;
    if (!byId('notificationList')) prepareDrawer();
    try {
      const response = await api('/api/notifications');
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'NOTIFICATION_QUERY_FAILED');
      canBroadcast = Boolean(data.canBroadcast);
      recipients = Array.isArray(data.recipients) ? data.recipients : [];
      renderBroadcast();
      renderItems(data.items || []);
      byId('notificationSummary').textContent = `${data.unread} unread · ${(data.items || []).length} shown`;
      byId('alertBadge').textContent = data.unread;
      byId('alertBadge').hidden = Number(data.unread) === 0;
    } catch (error) {
      byId('notificationSummary').textContent = 'Unavailable';
      byId('notificationList').innerHTML = `<div class="notification-empty">Could not load notifications: ${esc(error.message)}</div>`;
    }
  }

  async function markRead(button) {
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const response = await api(`/api/notifications/${button.dataset.markRead}/read`, {method:'POST'});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'NOTIFICATION_READ_FAILED');
      await loadNotifications();
    } catch (error) {
      notify(`Could not mark notification as read: ${error.message}`);
      button.disabled = false;
      button.textContent = 'Mark as read';
    }
  }

  async function sendBroadcast(event) {
    event.preventDefault();
    const button = byId('sendBroadcast');
    const target = byId('broadcastTarget').value;
    const staffId = Number(byId('broadcastStaff').value || 0);
    if (target === 'staff' && !staffId) return notify('Select a staff member first');
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      const response = await api('/api/notifications/broadcast', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:byId('broadcastTitle').value,message:byId('broadcastMessage').value,target,staffId})});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'NOTIFICATION_SEND_FAILED');
      notify(target === 'staff' ? `Message sent to ${data.recipientName}` : `Broadcast sent to ${data.recipients} staff members`);
      byId('broadcastForm').reset();
      updateTargetControls();
      await loadNotifications();
    } catch (error) {
      notify(`Could not send message: ${error.message}`);
    } finally {
      button.disabled = false;
      updateTargetControls();
    }
  }

  prepareDrawer();
  byId('alerts')?.addEventListener('click', () => { drawer.classList.add('open'); loadNotifications(); });
  window.loadNotifications = loadNotifications;
  loadNotifications();
  setInterval(loadNotifications, 60000);
})();
