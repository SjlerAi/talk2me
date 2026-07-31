(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const drawer = byId('drawer');
  let canBroadcast = false;

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
    style.textContent = `.notification-toolbar{display:flex;justify-content:space-between;align-items:center;margin:14px 0}.notification-toolbar button,.notification-card button,.broadcast-form button{border:1px solid var(--line);border-radius:10px;background:#fff;padding:9px 12px;font-weight:800;cursor:pointer}.notification-list{display:grid;gap:10px}.notification-card{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff}.notification-card.unread{border-left:4px solid var(--red);background:#fffafa}.notification-card h3{margin:0 0 5px;font-size:15px}.notification-card p{margin:0 0 8px;color:var(--muted);font-size:13px;white-space:pre-wrap}.notification-meta{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:11px;color:var(--muted)}.notification-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.broadcast-form{margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--blue-pale);display:grid;gap:9px}.broadcast-form input,.broadcast-form textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff}.broadcast-form button{background:var(--red);color:#fff;border-color:var(--red)}.notification-empty{text-align:center;color:var(--muted);padding:30px 10px}`;
    document.head.appendChild(style);
  }

  function prepareDrawer() {
    if (!drawer) return;
    ensureStyles();
    drawer.innerHTML = `<div class="drawer-head"><div><h2>Notifications</h2><span id="notificationSummary">Loading...</span></div><button id="closeDrawer">×</button></div>
      <div id="broadcastArea"></div>
      <div class="notification-toolbar"><strong>Latest messages</strong><button id="refreshNotifications">Refresh</button></div>
      <div class="notification-list" id="notificationList"><div class="notification-empty">Loading notifications...</div></div>`;
    byId('closeDrawer').addEventListener('click', () => drawer.classList.remove('open'));
    byId('refreshNotifications').addEventListener('click', loadNotifications);
  }

  function renderBroadcast() {
    const area = byId('broadcastArea');
    if (!area) return;
    area.innerHTML = canBroadcast ? `<form class="broadcast-form" id="broadcastForm"><strong>Send team broadcast</strong><input id="broadcastTitle" maxlength="160" placeholder="Message title" required><textarea id="broadcastMessage" rows="3" maxlength="3000" placeholder="Message to all active staff" required></textarea><button type="submit" id="sendBroadcast">Send to team</button></form>` : '';
    byId('broadcastForm')?.addEventListener('submit', sendBroadcast);
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
      return `<article class="notification-card ${unread ? 'unread' : ''}" data-notification-id="${item.id}"><h3>${esc(item.title || 'Notification')}</h3><p>${esc(item.message || '')}</p><div class="notification-meta"><span>${esc(date)}</span><span>${esc(item.status || 'unread')}</span></div><div class="notification-actions">${item.client_id ? `<button data-open-client="${item.client_id}">Open customer</button>` : ''}${unread ? `<button data-mark-read="${item.id}">Mark as read</button>` : ''}</div></article>`;
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
      renderBroadcast();
      renderItems(data.items || []);
      byId('notificationSummary').textContent = `${data.unread} unread`;
      byId('alertBadge').textContent = data.unread;
    } catch (error) {
      byId('notificationSummary').textContent = 'Unavailable';
      byId('notificationList').innerHTML = `<div class="notification-empty">Could not load notifications: ${esc(error.message)}</div>`;
    }
  }

  async function markRead(button) {
    button.disabled = true;
    try {
      const response = await api(`/api/notifications/${button.dataset.markRead}/read`, {method:'POST'});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'NOTIFICATION_READ_FAILED');
      await loadNotifications();
    } catch (error) {
      notify(`Could not mark notification as read: ${error.message}`);
      button.disabled = false;
    }
  }

  async function sendBroadcast(event) {
    event.preventDefault();
    const button = byId('sendBroadcast');
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      const response = await api('/api/notifications/broadcast', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:byId('broadcastTitle').value,message:byId('broadcastMessage').value})});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'NOTIFICATION_BROADCAST_FAILED');
      notify(`Broadcast sent to ${data.recipients} staff members`);
      byId('broadcastForm').reset();
      await loadNotifications();
    } catch (error) {
      notify(`Could not send broadcast: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Send to team';
    }
  }

  prepareDrawer();
  byId('alerts')?.addEventListener('click', () => { drawer.classList.add('open'); loadNotifications(); });
  window.loadNotifications = loadNotifications;
  loadNotifications();
  setInterval(loadNotifications, 60000);
})();
