const searchInput = document.getElementById('clientSearch');
const resultsBox = document.getElementById('searchResults');
const snapshot = document.getElementById('snapshot');
let timer = null;
let lastRows = [];
let lastAutoLoadedClientId = null;
let currentSnapshotClientId = null;

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function fmtDate(v){
  if(!v) return 'Not available';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'Not available';
  return d.toLocaleDateString('en-ZA', { year:'numeric', month:'short', day:'2-digit' });
}
function fmtDateTime(v){
  if(!v) return 'No previous shop contact yet';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'No previous shop contact yet';
  return d.toLocaleString('en-ZA', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function money(v){
  if(v === null || v === undefined || v === '') return 'Not available';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `R${n.toFixed(2)}`;
}
function nextUpgradeLabel(v){
  if(!v) return 'No upgrade date';
  const upgrade = new Date(v);
  if (Number.isNaN(upgrade.getTime())) return 'No upgrade date';
  const now = new Date();
  const days = Math.ceil((upgrade - now) / 86400000);
  if (days < 0) return `Upgrade due since ${fmtDate(v)}`;
  if (days === 0) return 'Upgrade due today';
  if (days <= 30) return `Upgrade in ${days} day${days === 1 ? '' : 's'}`;
  return fmtDate(v);
}
function normalise(value){
  return String(value || '').toLowerCase().replace(/[^a-z0-9@.]/g, '');
}

function fillClientFields(c){
  document.getElementById('client_id').value = c.id || '';
  document.getElementById('client_name').value = c.client_name || '';
  document.getElementById('cell_number').value = c.cell_number || '';
  document.getElementById('email').value = c.email || '';
  searchInput.value = c.cell_number || c.client_name || c.account_number || '';
}

function statusLabel(status){
  const labels = {
    open: 'Open',
    resolved: 'Resolved',
    follow_up: 'Follow-up Required',
    waiting_customer: 'Waiting for Customer',
    waiting_network: 'Waiting for Network',
    waiting_supplier: 'Waiting for Supplier',
    cancelled: 'Cancelled'
  };
  return labels[status] || status || 'Unknown';
}
function statusClass(status){
  if (status === 'resolved') return 'ok';
  if (status === 'cancelled') return 'muted';
  if (['follow_up','waiting_customer','waiting_network','waiting_supplier'].includes(status)) return 'warn';
  return 'danger';
}
function valueOrDash(value){
  const text = String(value ?? '').trim();
  return text || 'Not captured';
}
function compactDate(value){
  if (!value) return 'Not set';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Not set';
  return d.toLocaleString('en-ZA', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function renderSnapshot(data){
  const c = data.client || {};
  const last = data.last_contact;
  const history = data.history || [];
  const followups = data.open_followups || [];
  const lines = data.related_lines || [];
  const lineItems = lines.slice(0, 8).map(line => `
    <div class="line-item ${line.id === c.id ? 'current' : ''}">
      <div><strong>${escapeHtml(line.cell_number || 'No cell')}</strong><span>${escapeHtml(line.package_name || 'No package')}</span></div>
      <div><span>Upgrade</span><strong>${escapeHtml(nextUpgradeLabel(line.upgrade_date))}</strong></div>
    </div>`).join('');

  const followupHtml = followups.length ? `
    <div class="snapshot-alert">
      <strong>Open inquiries / follow-ups</strong>
      ${followups.map(f => `
        <div class="followup-item">
          <span class="badge ${statusClass(f.status)}">${escapeHtml(statusLabel(f.status))}</span>
          <div><b>Inquiry</b> — ${escapeHtml(valueOrDash(f.query_text))}<br><small class="category-line">Category: ${escapeHtml(f.category_name || 'Uncategorised')}</small></div>
          <small>Action: ${escapeHtml(valueOrDash(f.action_taken))} • Due: ${escapeHtml(compactDate(f.follow_up_at))} • ${escapeHtml(f.staff_member || 'Unassigned')}</small>
          <button type="button" class="close-inquiry-btn" data-inquiry-id="${Number(f.id)}">Close Inquiry</button>
        </div>`).join('')}
    </div>` : '';

  const lastHtml = last ? `
    <div class="last-interaction-card">
      <div class="last-interaction-head">
        <div>
          <span class="eyebrow">Last Customer Interaction</span>
          <h4>Inquiry</h4><small class="category-line">Category: ${escapeHtml(last.category_name || 'Uncategorised')}</small>
        </div>
        <div class="last-interaction-actions">
          <span class="badge ${statusClass(last.status)}">${escapeHtml(statusLabel(last.status))}</span>
          ${['open','follow_up','waiting_customer','waiting_network','waiting_supplier'].includes(last.status) ? `<button type="button" class="close-inquiry-btn compact" data-inquiry-id="${Number(last.id)}">Close Inquiry</button>` : ''}
        </div>
      </div>
      <div class="interaction-grid">
        <div><span>Date Logged</span><strong>${escapeHtml(fmtDateTime(last.created_at))}</strong></div>
        <div><span>Handled By</span><strong>${escapeHtml(last.staff_member || 'Unassigned')}</strong></div>
        <div><span>Follow-up Due</span><strong>${escapeHtml(compactDate(last.follow_up_at))}</strong></div>
        <div><span>Completed</span><strong>${last.completed_at ? escapeHtml(fmtDateTime(last.completed_at)) : 'Still open / not completed'}</strong></div>
      </div>
      <div class="interaction-text"><span>Customer Asked</span><p>${escapeHtml(valueOrDash(last.query_text))}</p></div>
      <div class="interaction-text"><span>Result Found</span><p>${escapeHtml(valueOrDash(last.result_found))}</p></div>
      <div class="interaction-text"><span>Action Taken</span><p>${escapeHtml(valueOrDash(last.action_taken))}</p></div>
    </div>` : `
    <div class="last-interaction-card">
      <span class="eyebrow">Last Customer Interaction</span>
      <h4>No history yet</h4>
      <p>This will update automatically after the first saved query.</p>
    </div>`;

  const historyHtml = history.length ? history.map(h => `
    <div class="history-row">
      <div><strong>Inquiry</strong><small>Category: ${escapeHtml(h.category_name || 'Uncategorised')}</small><small>${escapeHtml(fmtDateTime(h.created_at))}</small></div>
      <div>${escapeHtml(valueOrDash(h.query_text))}</div>
      <div><span class="badge ${statusClass(h.status)}">${escapeHtml(statusLabel(h.status))}</span></div>
    </div>`).join('') : '<p>No previous interactions.</p>';

  snapshot.hidden = false;
  snapshot.innerHTML = `
    <div class="snapshot-header">
      <div>
        <span class="eyebrow">Customer Snapshot</span>
        <h3>${escapeHtml(c.client_name || 'Client')}</h3>
        <p>${escapeHtml(c.cell_number || 'No cell number')} ${c.account_number ? ' • Acc: ' + escapeHtml(c.account_number) : ''}</p>
      </div>
      <div class="snapshot-lines"><span>Lines</span><strong>${Number(data.line_count || 1)}</strong></div>
    </div>

    <div class="snapshot-grid highlight-grid">
      <div><span>Next Upgrade</span><strong>${escapeHtml(nextUpgradeLabel(c.upgrade_date))}</strong></div>
      <div><span>Last Shop Contact</span><strong>${escapeHtml(last ? fmtDateTime(last.created_at) : 'No previous shop contact yet')}</strong></div>
      <div><span>Total Contacts</span><strong>${Number(data.total_contacts || 0)}</strong></div>
      <div><span>Package</span><strong>${escapeHtml(c.package_name || 'Not available')}</strong></div>
      <div><span>Handset</span><strong>${escapeHtml(c.handset || 'Not available')}</strong></div>
      <div><span>Monthly</span><strong>${escapeHtml(money(c.monthly_invoice_amount))}</strong></div>
    </div>

    ${followupHtml}
    ${lastHtml}

    <div class="history-card">
      <div class="lines-title"><strong>Last 5 interactions</strong><span>${history.length}</span></div>
      ${historyHtml}
    </div>

    <div class="lines-card">
      <div class="lines-title"><strong>Lines / contracts found</strong><span>${Number(data.line_count || 1)}</span></div>
      ${lineItems || '<p>No linked lines found.</p>'}
    </div>`;
  attachCloseInquiryButtons();
}

function attachCloseInquiryButtons(){
  [...document.querySelectorAll('.close-inquiry-btn')].forEach(btn => {
    btn.addEventListener('click', async function(event){
      event.preventDefault();
      event.stopPropagation();
      const inquiryId = this.dataset.inquiryId;
      if (!inquiryId) return;
      const oldText = this.textContent;
      this.disabled = true;
      this.textContent = 'Closing...';
      try {
        const res = await fetch(`${window.BASE_PATH}/inquiries/${encodeURIComponent(inquiryId)}/close`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.message || 'Close failed');
        if (currentSnapshotClientId) {
          await loadSnapshot(currentSnapshotClientId, {
            id: currentSnapshotClientId,
            client_name: document.getElementById('client_name')?.value,
            cell_number: document.getElementById('cell_number')?.value,
            email: document.getElementById('email')?.value
          });
        }
      } catch (err) {
        this.disabled = false;
        this.textContent = oldText;
        alert('Could not close this inquiry. Please try again.');
      }
    });
  });
}

async function loadSnapshot(clientId, fallbackClient){
  currentSnapshotClientId = clientId;
  snapshot.hidden = false;
  snapshot.innerHTML = '<div class="snapshot-loading">Loading customer snapshot...</div>';
  try {
    const res = await fetch(`${window.BASE_PATH}/clients/${encodeURIComponent(clientId)}/snapshot`);
    if (!res.ok) throw new Error('Snapshot failed');
    const data = await res.json();
    renderSnapshot(data);
  } catch (err) {
    renderSnapshot({ client: fallbackClient, line_count: 1, related_lines: [fallbackClient], last_contact: null, total_contacts: 0 });
  }
}

function selectClient(c, keepResultsOpen = false){
  fillClientFields(c);
  if (!keepResultsOpen) resultsBox.style.display = 'none';
  if (c.id) loadSnapshot(c.id, c);
}

function renderResults(rows){
  lastRows = rows;
  if (!rows.length) {
    resultsBox.innerHTML = '<div class="result-item muted">No results found. Type client details manually below.</div>';
    resultsBox.style.display = 'block';
    return;
  }

  resultsBox.innerHTML = rows.map((c, i) => `
    <div class="result-item" data-i="${i}">
      <div class="result-main">
        <strong>${escapeHtml(c.client_name || 'No name')}</strong>
        <small>${escapeHtml(c.cell_number || '')} ${c.email ? ' | '+escapeHtml(c.email) : ''} ${c.account_number ? ' | Acc: '+escapeHtml(c.account_number) : ''}</small>
      </div>
      <div class="result-meta">
        <span>${escapeHtml(c.package_name || 'No package')}</span>
        <span>Upgrade: ${escapeHtml(nextUpgradeLabel(c.upgrade_date))}</span>
        <span>${escapeHtml(c.handset || 'No handset')}</span>
      </div>
      <button type="button" class="result-load">Load</button>
    </div>`).join('');

  resultsBox.style.display = 'block';
  [...resultsBox.querySelectorAll('[data-i]')].forEach(el => {
    el.onclick = () => selectClient(rows[Number(el.dataset.i)]);
  });
}

function findExactMatch(q, rows){
  const nq = normalise(q);
  return rows.find(c => [c.cell_number, c.account_number, c.id_number, c.email].some(v => normalise(v) === nq));
}

searchInput.addEventListener('input', () => {
  clearTimeout(timer);
  const q = searchInput.value.trim();
  lastAutoLoadedClientId = null;
  if(q.length < 2){ resultsBox.style.display='none'; snapshot.hidden = true; return; }
  timer = setTimeout(async () => {
    const res = await fetch(`${window.BASE_PATH}/clients/search?q=${encodeURIComponent(q)}`);
    const rows = await res.json();
    renderResults(rows);

    // For retail speed: if there is one clear match, or an exact cell/account/email/ID match,
    // load the snapshot immediately without making the consultant click again.
    const exact = findExactMatch(q, rows);
    const autoClient = exact || (rows.length === 1 ? rows[0] : null);
    if (autoClient && autoClient.id && autoClient.id !== lastAutoLoadedClientId) {
      lastAutoLoadedClientId = autoClient.id;
      selectClient(autoClient, true);
    }
  }, 250);
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (lastRows.length) selectClient(lastRows[0]);
  }
});

(function(){
  const minimizeBtn = document.getElementById('minimizeQuery');
  const dock = document.getElementById('queryDock');
  const card = document.querySelector('.query-card');
  if (!minimizeBtn || !dock || !card) return;
  minimizeBtn.addEventListener('click', function(){
    card.classList.add('minimized');
    dock.hidden = false;
    document.body.classList.add('body-query-minimized');
  });
  dock.addEventListener('click', function(){
    card.classList.remove('minimized');
    dock.hidden = true;
    document.body.classList.remove('body-query-minimized');
  });
})();

// Save flow patch: keep staff on the query screen after saving.
// After a successful save, the screen remains available for corrections or additional action.
// If nobody touches the form for 60 seconds, it resets to a fresh query.
(function(){
  const form = document.getElementById('queryForm');
  const notice = document.getElementById('saveNotice');
  const saveStayBtn = document.getElementById('saveStayBtn');
  const saveNewBtn = document.getElementById('saveNewBtn');
  if (!form || !notice) return;

  let resetTimer = null;
  let resetDeadline = null;
  let countdownTimer = null;
  let shouldResetImmediately = false;

  function clearResetTimers(){
    if (resetTimer) clearTimeout(resetTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    resetTimer = null;
    countdownTimer = null;
    resetDeadline = null;
  }

  function setNotice(message, tone = 'success'){
    notice.hidden = false;
    notice.className = `save-notice ${tone}`;
    notice.textContent = message;
  }

  function resetQueryForm(){
    clearResetTimers();
    document.getElementById('client_id').value = '';
    document.getElementById('clientSearch').value = '';
    document.getElementById('client_name').value = '';
    document.getElementById('cell_number').value = '';
    document.getElementById('email').value = '';
    const other = form.querySelector('[name="category_other"]');
    const queryText = form.querySelector('[name="query_text"]');
    const resultFound = form.querySelector('[name="result_found"]');
    const actionTaken = form.querySelector('[name="action_taken"]');
    const followUp = form.querySelector('[name="follow_up_at"]');
    const status = form.querySelector('[name="status"]');
    if (other) other.value = '';
    if (queryText) queryText.value = '';
    if (resultFound) resultFound.value = '';
    if (actionTaken) actionTaken.value = '';
    if (followUp) followUp.value = '';
    if (status) status.value = 'resolved';
    if (resultsBox) { resultsBox.innerHTML = ''; resultsBox.style.display = 'none'; }
    if (snapshot) { snapshot.innerHTML = ''; snapshot.hidden = true; }
    lastRows = [];
    lastAutoLoadedClientId = null;
    currentSnapshotClientId = null;
    setNotice('Ready for the next customer.', 'neutral');
    document.getElementById('clientSearch').focus();
  }

  function scheduleAutoReset(seconds){
    clearResetTimers();
    resetDeadline = Date.now() + seconds * 1000;
    const updateCountdown = () => {
      if (!resetDeadline) return;
      const remaining = Math.max(0, Math.ceil((resetDeadline - Date.now()) / 1000));
      setNotice(`Saved. This query will clear in ${remaining}s if there is no more activity.`, 'success');
    };
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 1000);
    resetTimer = setTimeout(resetQueryForm, seconds * 1000);
  }

  form.addEventListener('input', function(){
    if (resetTimer) {
      clearResetTimers();
      setNotice('Saved. Auto-clear cancelled because you are still working on this query.', 'neutral');
    }
  });

  form.addEventListener('change', function(){
    if (resetTimer) {
      clearResetTimers();
      setNotice('Saved. Auto-clear cancelled because you are still working on this query.', 'neutral');
    }
  });

  form.addEventListener('submit', async function(event){
    event.preventDefault();
    clearResetTimers();
    setNotice('Saving query...', 'neutral');
    if (saveStayBtn) saveStayBtn.disabled = true;
    if (saveNewBtn) saveNewBtn.disabled = true;

    try {
      const formData = new FormData(form);
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(formData)
      });

      if (res.redirected && res.url.includes('/login')) {
        window.location.href = res.url;
        return;
      }
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || 'Save failed');

      const currentClientId = document.getElementById('client_id')?.value;
      if (currentClientId && !shouldResetImmediately) {
        await loadSnapshot(currentClientId, {
          id: currentClientId,
          client_name: document.getElementById('client_name')?.value,
          cell_number: document.getElementById('cell_number')?.value,
          email: document.getElementById('email')?.value
        });
      }

      if (shouldResetImmediately) {
        shouldResetImmediately = false;
        resetQueryForm();
      } else {
        scheduleAutoReset(Number(data.reset_after_seconds || 60));
      }
    } catch (err) {
      setNotice('Could not save the query. Please check the connection and try again.', 'error');
    } finally {
      if (saveStayBtn) saveStayBtn.disabled = false;
      if (saveNewBtn) saveNewBtn.disabled = false;
    }
  });

  if (saveNewBtn) {
    saveNewBtn.addEventListener('click', function(){
      shouldResetImmediately = true;
      form.requestSubmit();
    });
  }
})();
