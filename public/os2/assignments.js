(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt',"'":'&#39;','"':'&quot;'}[char]));
  let activeCustomerId = null;
  let options = null;

  async function api(url, optionsArg={}) {
    const response = await fetch(url, {...optionsArg, headers:{Accept:'application/json', ...(optionsArg.headers||{})}});
    if (response.status === 401) { window.location.replace('/login'); throw new Error('AUTHENTICATION_REQUIRED'); }
    return response;
  }

  function notify(message) {
    if (typeof window.toast === 'function') return window.toast(message);
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600);
  }

  function ensureStyles() {
    if (document.getElementById('assignmentStyles')) return;
    const style = document.createElement('style');
    style.id = 'assignmentStyles';
    style.textContent = `.assignment-box{margin:14px 20px 20px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--blue-pale)}.assignment-box h3{margin:0 0 8px;font-size:15px}.assignment-box p{margin:0 0 12px;color:var(--muted);font-size:13px}.assignment-actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.assignment-actions label{display:grid;gap:6px;flex:1;min-width:180px;font-size:12px;font-weight:800}.assignment-actions select,.assignment-actions textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff}.assignment-actions button{height:40px;padding:0 14px;border:0;border-radius:10px;background:var(--red);color:#fff;font-weight:800;cursor:pointer}.assignment-actions button.secondary-action{background:#fff;color:var(--blue-dark);border:1px solid var(--line)}.claim-note{width:100%;margin-top:8px}.assignment-pending{display:inline-flex;padding:5px 9px;border-radius:99px;background:#fff7e8;color:var(--amber);font-size:11px;font-weight:800}`;
    document.head.appendChild(style);
  }

  async function loadOptions() {
    if (options) return options;
    const response = await api('/api/assignments/options');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'ASSIGNMENT_OPTIONS_FAILED');
    options = data;
    return data;
  }

  async function loadAssignment(clientId) {
    activeCustomerId = Number(clientId);
    if (!activeCustomerId) return;
    ensureStyles();
    try {
      const [opts, response] = await Promise.all([loadOptions(), api(`/api/customers/${activeCustomerId}/assignment`)]);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'ASSIGNMENT_LOOKUP_FAILED');
      render(data, opts);
    } catch (error) {
      console.error(error);
      notify(`Assignment information unavailable: ${error.message}`);
    }
  }

  function render(data, opts) {
    const status = document.getElementById('customerStatus');
    if (!status) return;
    document.getElementById('assignmentBox')?.remove();
    const box = document.createElement('div');
    box.id = 'assignmentBox';
    box.className = 'assignment-box';
    const current = data.assignment?.assigned_staff || 'Unassigned';
    let controls = '';
    if (data.canManage) {
      controls = `<div class="assignment-actions"><label>Assign account to<select id="assignmentStaff">${opts.staff.map(person => `<option value="${person.id}" ${Number(person.id)===Number(data.assignment?.assigned_staff_id)?'selected':''}>${escapeHtml(person.full_name)} · ${escapeHtml(person.role)}</option>`).join('')}</select></label><button id="saveAssignment">Save assignment</button></div>`;
    } else if (data.canClaim) {
      controls = data.pendingClaim
        ? `<span class="assignment-pending">Claim awaiting approval</span>`
        : `<div class="assignment-actions"><label class="claim-note">Reason for claim<textarea id="claimReason" rows="2" placeholder="Why should this customer be assigned to you?"></textarea></label><button id="requestClaim">Request claim</button></div>`;
    }
    box.innerHTML = `<h3>Account ownership</h3><p>Currently assigned to <strong>${escapeHtml(current)}</strong>. Assignment applies to active work for this customer.</p>${controls}`;
    status.parentElement.appendChild(box);

    document.getElementById('saveAssignment')?.addEventListener('click', async () => {
      const button = document.getElementById('saveAssignment');
      button.disabled = true; button.textContent = 'Saving...';
      try {
        const staffId = Number(document.getElementById('assignmentStaff').value);
        const response = await api(`/api/customers/${activeCustomerId}/assign`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffId})});
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'CLIENT_ASSIGNMENT_FAILED');
        notify(`Assigned to ${result.staffName}`);
        await loadAssignment(activeCustomerId);
        if (typeof window.openCustomer === 'function') await window.openCustomer(activeCustomerId);
        if (typeof window.loadDashboard === 'function') window.loadDashboard();
      } catch (error) { notify(`Could not assign customer: ${error.message}`); }
      finally { if (button.isConnected) { button.disabled=false; button.textContent='Save assignment'; } }
    });

    document.getElementById('requestClaim')?.addEventListener('click', async () => {
      const button = document.getElementById('requestClaim');
      button.disabled = true; button.textContent = 'Sending...';
      try {
        const reason = document.getElementById('claimReason').value;
        const response = await api(`/api/customers/${activeCustomerId}/claim`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})});
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'CLIENT_CLAIM_FAILED');
        notify('Claim request sent for approval');
        await loadAssignment(activeCustomerId);
        if (typeof window.loadDashboard === 'function') window.loadDashboard();
      } catch (error) { notify(`Could not request claim: ${error.message}`); }
      finally { if (button.isConnected) { button.disabled=false; button.textContent='Request claim'; } }
    });
  }

  const originalOpenCustomer = window.openCustomer;
  if (typeof originalOpenCustomer === 'function') {
    window.openCustomer = async function wrappedOpenCustomer(id) {
      const result = await originalOpenCustomer(id);
      await loadAssignment(id);
      return result;
    };
  }

  for (const source of ['./approvals.js','./attendance.js','./opportunities.js','./reports.js']) {
    if (!document.querySelector(`script[src$="${source.slice(2)}"]`)) {
      const script = document.createElement('script');
      script.src = source;
      document.body.appendChild(script);
    }
  }
})();
