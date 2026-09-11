(() => {
  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const formatDateTime = value => value ? new Intl.DateTimeFormat('en-ZA', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : 'No follow-up date';
  const workView = byId('workView');
  const updateModal = byId('workUpdateModal');
  const updateForm = byId('workUpdateForm');
  let activeFilter = 'all';
  let selectedWorkItem = null;

  async function api(url, options={}) {
    const response = await fetch(url, {...options, headers:{Accept:'application/json', ...(options.headers||{})}});
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('AUTHENTICATION_REQUIRED');
    }
    return response;
  }

  function hideWork() {
    if (workView) workView.hidden = true;
  }

  function setActiveNav() {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'work'));
  }

  function statusLabel(status) {
    return ({open:'Open',follow_up:'Follow-up',waiting_customer:'Waiting for customer',waiting_network:'Waiting for network',waiting_supplier:'Waiting for supplier',resolved:'Resolved'})[status] || status;
  }

  function renderItems(items) {
    const list = byId('workItems');
    if (!items.length) {
      list.innerHTML = '<div class="work-empty"><strong>No work items in this view.</strong><br>Choose another filter or create a new inquiry.</div>';
      return;
    }
    list.innerHTML = items.map(item => {
      const copy = item.action_taken || item.query_text || item.result_found || 'No notes recorded.';
      return `<article class="work-item ${escapeHtml(item.urgency)}" data-work-id="${item.id}" data-customer-id="${item.client_id || ''}">
        <div class="work-flag"></div>
        <div class="work-main">
          <div class="work-top"><h3>${escapeHtml(item.client_name || 'Unknown customer')}</h3><span class="status ${item.status === 'open' || item.status === 'follow_up' ? 'progress' : 'pending'}">${escapeHtml(statusLabel(item.status))}</span>${item.priority === 'urgent' ? '<span class="status pending">Urgent</span>' : ''}</div>
          <div class="work-meta"><span>${escapeHtml(item.category || 'Inquiry')}</span><span>${escapeHtml(item.assigned_staff || 'Unassigned')}</span><span>${escapeHtml(formatDateTime(item.follow_up_at))}</span></div>
          <p class="work-copy">${escapeHtml(copy)}</p>
        </div>
        <div class="work-actions"><button type="button" data-open-customer="${item.client_id || ''}">Customer</button><button type="button" data-update-work="${item.id}">Update</button></div>
      </article>`;
    }).join('');

    list.querySelectorAll('[data-open-customer]').forEach(button => button.addEventListener('click', () => {
      const id = Number(button.dataset.openCustomer);
      if (!id) return;
      hideWork();
      if (typeof window.openCustomer === 'function') window.openCustomer(id);
    }));
    list.querySelectorAll('[data-update-work]').forEach(button => button.addEventListener('click', () => {
      const item = items.find(entry => Number(entry.id) === Number(button.dataset.updateWork));
      if (item) openUpdate(item);
    }));
  }

  async function loadMyWork(filter=activeFilter) {
    activeFilter = filter;
    byId('workLoading').textContent = 'Loading work items...';
    document.querySelectorAll('.work-filter').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
    try {
      const response = await api(`/api/my-work?filter=${encodeURIComponent(filter)}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'MY_WORK_QUERY_FAILED');
      byId('workScope').textContent = data.scope === 'team' ? 'Team work queue' : 'Your assigned work';
      byId('workCountTotal').textContent = data.counts.total;
      byId('workCountOverdue').textContent = data.counts.overdue;
      byId('workCountToday').textContent = data.counts.today;
      byId('workCountWaiting').textContent = data.counts.waiting;
      byId('workCountOpen').textContent = data.counts.open;
      byId('workBadge').textContent = data.counts.total;
      byId('workLoading').textContent = `${data.items.length} item${data.items.length === 1 ? '' : 's'} shown`;
      renderItems(data.items);
    } catch (error) {
      byId('workLoading').textContent = `Could not load My Work: ${error.message}`;
      byId('workItems').innerHTML = '<div class="work-empty">My Work is temporarily unavailable.</div>';
    }
  }

  window.showMyWork = async function showMyWork() {
    byId('dashboardView').hidden = true;
    byId('customerView').hidden = true;
    workView.hidden = false;
    setActiveNav();
    await loadMyWork(activeFilter);
  };

  function openUpdate(item) {
    selectedWorkItem = item;
    byId('workUpdateId').value = item.id;
    byId('workUpdateCustomer').textContent = `${item.client_name || 'Unknown customer'} · Inquiry #${item.id}`;
    byId('workUpdateStatus').value = item.status;
    byId('workUpdateNote').value = '';
    byId('workUpdateError').hidden = true;
    byId('workUpdateFollowUp').value = item.follow_up_at ? new Date(new Date(item.follow_up_at).getTime() - new Date(item.follow_up_at).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
    toggleFollowUp();
    updateModal.classList.add('open');
  }

  function toggleFollowUp() {
    const status = byId('workUpdateStatus').value;
    byId('workUpdateFollowUpWrap').hidden = !(status === 'follow_up' || status.startsWith('waiting_'));
  }

  byId('workUpdateStatus').addEventListener('change', toggleFollowUp);
  byId('closeWorkUpdate').addEventListener('click', () => updateModal.classList.remove('open'));
  byId('cancelWorkUpdate').addEventListener('click', () => updateModal.classList.remove('open'));
  updateModal.addEventListener('click', event => { if (event.target === updateModal) updateModal.classList.remove('open'); });

  updateForm.addEventListener('submit', async event => {
    event.preventDefault();
    const id = Number(byId('workUpdateId').value);
    const payload = {
      status: byId('workUpdateStatus').value,
      followUpAt: byId('workUpdateFollowUp').value,
      note: byId('workUpdateNote').value
    };
    const button = byId('saveWorkUpdate');
    const errorBox = byId('workUpdateError');
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const response = await api(`/api/inquiries/${id}/work-update`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'MY_WORK_UPDATE_FAILED');
      updateModal.classList.remove('open');
      if (typeof window.toast === 'function') window.toast(`Inquiry #${id} updated`);
      await loadMyWork(activeFilter);
      if (typeof window.loadDashboard === 'function') window.loadDashboard();
      if (selectedWorkItem?.client_id && typeof window.openCustomer === 'function' && !byId('customerView').hidden) window.openCustomer(selectedWorkItem.client_id);
    } catch (error) {
      const messages = {FOLLOW_UP_DATE_REQUIRED:'Choose a follow-up date and time.',NOT_ASSIGNED_TO_YOU:'This inquiry is not assigned to you.',INVALID_FOLLOW_UP_DATE:'The follow-up date is invalid.'};
      errorBox.textContent = messages[error.message] || `Could not update inquiry: ${error.message}`;
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Save update';
    }
  });

  document.querySelectorAll('.work-filter').forEach(button => button.addEventListener('click', () => loadMyWork(button.dataset.filter)));
  byId('refreshWork').addEventListener('click', () => loadMyWork(activeFilter));
  document.querySelectorAll('[data-view="work"]').forEach(button => button.addEventListener('click', () => window.showMyWork()));
  document.querySelectorAll('[data-view="home"]').forEach(button => button.addEventListener('click', hideWork));
  document.addEventListener('click', event => { if (event.target.closest('.result[data-id]')) hideWork(); });
})();
