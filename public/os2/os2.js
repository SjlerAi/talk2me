const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const toast = message => {
  const el = byId('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
};

const modal = byId('modal');
const drawer = byId('drawer');
const sidebar = byId('sidebar');

document.querySelectorAll('[data-toast]').forEach(el => el.addEventListener('click', () => toast(el.dataset.toast)));
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  const match = document.querySelector(`.nav-item[data-view="${el.dataset.view}"]`);
  if (match) match.classList.add('active');
  toast(`${el.dataset.view.charAt(0).toUpperCase() + el.dataset.view.slice(1)} workspace selected`);
  sidebar.classList.remove('open');
}));

byId('alerts').addEventListener('click', () => drawer.classList.add('open'));
byId('closeDrawer').addEventListener('click', () => drawer.classList.remove('open'));
byId('newInquiry').addEventListener('click', () => modal.classList.add('open'));
byId('closeModal').addEventListener('click', () => modal.classList.remove('open'));
byId('cancelModal').addEventListener('click', () => modal.classList.remove('open'));
byId('menu').addEventListener('click', () => sidebar.classList.toggle('open'));
modal.addEventListener('click', event => { if (event.target === modal) modal.classList.remove('open'); });
modal.querySelector('form').addEventListener('submit', event => {
  event.preventDefault();
  modal.classList.remove('open');
  toast('Inquiry saving is not enabled yet');
});

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    byId('search').focus();
  }
  if (event.key === 'Escape') {
    modal.classList.remove('open');
    drawer.classList.remove('open');
    sidebar.classList.remove('open');
    byId('results').classList.remove('show');
  }
});

function statusClass(status) {
  if (['resolved', 'completed'].includes(status)) return 'done';
  if (['open', 'follow_up', 'in_progress'].includes(status)) return 'progress';
  return 'pending';
}

async function loadDashboard() {
  byId('systemMessage').textContent = 'Loading live information from the OS2 test database…';
  try {
    const response = await fetch('/api/dashboard', { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Dashboard could not load');

    const m = data.metrics;
    byId('metricApprovals').textContent = m.approvals;
    byId('metricOverdue').textContent = m.overdue;
    byId('metricUnassigned').textContent = m.unassigned;
    byId('metricClockedIn').textContent = `${m.clockedIn}/${m.activeStaff}`;
    byId('activeStaffText').textContent = `${m.activeStaff} active staff accounts`;
    byId('metricUpgrades').textContent = m.upgrades;
    byId('metricBirthdays').textContent = m.birthdays;
    byId('metricCallbacks').textContent = m.callbacks;
    byId('metricProspects').textContent = m.prospects;
    byId('workBadge').textContent = m.overdue;
    byId('alertBadge').textContent = m.approvals;
    byId('systemMessage').textContent = 'Live test data loaded from kloka_talk2me.';

    byId('activityRows').innerHTML = data.activity.length
      ? data.activity.map(row => `<tr>
          <td>${escapeHtml(row.staff_member)}</td>
          <td>${escapeHtml(row.latest_action)}</td>
          <td>${escapeHtml(row.customer)}</td>
          <td><span class="status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
          <td>${escapeHtml(row.activity_time)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5">No activity found.</td></tr>';
  } catch (error) {
    console.error(error);
    byId('systemMessage').textContent = `Database connection not ready: ${error.message}`;
    byId('activityRows').innerHTML = '<tr><td colspan="5">Live data is not available yet. Check the cPanel database environment variables.</td></tr>';
    toast('Database connection needs configuration');
  }
}

byId('refreshDashboard').addEventListener('click', () => {
  loadDashboard();
  toast('Refreshing live dashboard');
});
byId('databaseStatus').addEventListener('click', async () => {
  try {
    const response = await fetch('/health');
    const data = await response.json();
    toast(data.database?.connected ? `Connected to ${data.database.name}` : 'Database is not connected');
  } catch {
    toast('Health check failed');
  }
});

const search = byId('search');
const results = byId('results');
let searchTimer;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const value = search.value.trim();
  if (value.length < 2) {
    results.classList.remove('show');
    results.innerHTML = '';
    return;
  }
  results.innerHTML = '<div class="result"><b>Searching…</b><span>Reading the OS2 test database</span></div>';
  results.classList.add('show');
  searchTimer = setTimeout(async () => {
    try {
      const response = await fetch(`/api/customers/search?q=${encodeURIComponent(value)}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Search failed');
      results.innerHTML = data.customers.length
        ? data.customers.map(item => `<div class="result" data-id="${item.id}" data-name="${escapeHtml(item.client_name)}">
            <b>${escapeHtml(item.client_name)}</b>
            <span>${escapeHtml(item.account_number || 'No account')} · ${escapeHtml(item.cell_number || 'No phone')} · ${escapeHtml(item.city_town || item.email || '')}</span>
          </div>`).join('')
        : '<div class="result"><b>No customers found</b><span>Try another name, number or account.</span></div>';
      results.querySelectorAll('[data-id]').forEach(item => item.addEventListener('click', () => {
        search.value = item.dataset.name;
        results.classList.remove('show');
        toast(`${item.dataset.name} selected; Customer 360 integration is next`);
      }));
    } catch (error) {
      results.innerHTML = `<div class="result"><b>Search unavailable</b><span>${escapeHtml(error.message)}</span></div>`;
    }
  }, 300);
});

document.addEventListener('click', event => {
  if (!event.target.closest('.search')) results.classList.remove('show');
});

byId('todayLabel').textContent = new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase();
loadDashboard();
