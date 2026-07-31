(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  let view = null;
  let canManage = false;
  let activeCorrection = null;

  async function api(url, options={}) {
    const response = await fetch(url, {...options, headers:{Accept:'application/json', ...(options.headers || {})}});
    if (response.status === 401) { location.replace('/login'); throw new Error('AUTHENTICATION_REQUIRED'); }
    return response;
  }

  function notify(message) {
    if (typeof window.toast === 'function') return window.toast(message);
    alert(message);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-ZA', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  }

  function formatMinutes(value) {
    const minutes = Number(value || 0);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h ${String(remainder).padStart(2,'0')}m`;
  }

  function toLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  }

  function ensureStyles() {
    if (byId('attendanceStyles')) return;
    const style = document.createElement('style');
    style.id = 'attendanceStyles';
    style.textContent = `
      .attendance-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:22px}
      .attendance-head h1{margin:4px 0}.attendance-head p{margin:0;color:var(--muted)}
      .attendance-actions{display:flex;gap:10px;flex-wrap:wrap}
      .attendance-actions button{height:44px;padding:0 18px;border-radius:12px;border:1px solid var(--line);font-weight:800;cursor:pointer}
      .attendance-actions .clock-in{background:var(--green);border-color:var(--green);color:#fff}.attendance-actions .clock-out{background:var(--red);border-color:var(--red);color:#fff}
      .attendance-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}
      .attendance-stat{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 10px 28px rgba(46,93,119,.06)}
      .attendance-stat span{display:block;color:var(--muted);font-size:12px;font-weight:800;text-transform:uppercase}.attendance-stat strong{display:block;margin-top:8px;font-size:25px}
      .attendance-table-wrap{overflow:auto}.attendance-table{width:100%;border-collapse:collapse}.attendance-table th,.attendance-table td{padding:13px 12px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}.attendance-table th{font-size:11px;text-transform:uppercase;color:var(--muted)}
      .attendance-status{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800}.attendance-status.active{background:#e7f8ef;color:#148154}.attendance-status.completed{background:#eef4f8;color:#31566b}.attendance-status.late{background:#fff2e3;color:#b66a00;margin-left:6px}
      .attendance-table button{border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 11px;font-weight:800;cursor:pointer}
      .attendance-empty{padding:28px;text-align:center;color:var(--muted)}
      .attendance-modal{position:fixed;inset:0;background:rgba(17,39,52,.38);display:none;align-items:center;justify-content:center;z-index:1100;padding:18px}.attendance-modal.open{display:flex}.attendance-modal form{width:min(520px,100%);background:#fff;border-radius:18px;padding:20px;display:grid;gap:14px}.attendance-modal label{display:grid;gap:6px;font-weight:800;font-size:12px}.attendance-modal input,.attendance-modal textarea{width:100%;padding:11px;border:1px solid var(--line);border-radius:10px}.attendance-modal .modal-actions{display:flex;justify-content:flex-end;gap:8px}
      @media(max-width:850px){.attendance-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.attendance-head{flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function ensureNav() {
    if (document.querySelector('[data-view="attendance"]')) return;
    const nav = document.querySelector('.sidebar nav');
    if (!nav) return;
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'attendance';
    button.innerHTML = '<span>◷</span>Attendance';
    const reports = nav.querySelector('[data-view="reports"]');
    nav.insertBefore(button, reports || null);
    button.addEventListener('click', show);
  }

  function ensureView() {
    if (view) return view;
    ensureStyles();
    ensureNav();
    view = document.createElement('section');
    view.className = 'content';
    view.id = 'attendanceView';
    view.hidden = true;
    view.innerHTML = `
      <div class="attendance-head">
        <div><span>TIME & ATTENDANCE</span><h1>Attendance</h1><p id="attendanceStatus">Loading today's attendance...</p></div>
        <div class="attendance-actions"><button class="clock-in" id="clockInButton">Clock in</button><button class="clock-out" id="clockOutButton">Clock out</button><button class="secondary" id="refreshAttendance">Refresh</button></div>
      </div>
      <div class="attendance-summary">
        <div class="attendance-stat"><span>Your status</span><strong id="attendanceMyStatus">—</strong></div>
        <div class="attendance-stat"><span>Started today</span><strong id="attendanceStart">—</strong></div>
        <div class="attendance-stat"><span>Hours today</span><strong id="attendanceHours">0h 00m</strong></div>
        <div class="attendance-stat"><span>Team clocked in</span><strong id="attendanceTeamCount">0</strong></div>
      </div>
      <section class="panel" id="attendanceTeamPanel"><div class="panel-head"><div><span>TEAM TODAY</span><h2>Attendance register</h2></div></div><div class="attendance-table-wrap"><table class="attendance-table"><thead><tr><th>Staff member</th><th>Clock in</th><th>Clock out</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody id="attendanceRows"></tbody></table></div></section>`;
    document.querySelector('main').appendChild(view);

    const modal = document.createElement('div');
    modal.className = 'attendance-modal';
    modal.id = 'attendanceCorrectionModal';
    modal.innerHTML = `<form id="attendanceCorrectionForm"><div class="modal-head"><div><span>MANAGEMENT CORRECTION</span><h2>Correct attendance</h2></div><button type="button" id="closeAttendanceCorrection">×</button></div><p id="attendanceCorrectionName"></p><label>Clock-in time<input type="datetime-local" id="attendanceCorrectionIn" required></label><label>Clock-out time<input type="datetime-local" id="attendanceCorrectionOut"></label><label>Reason for correction<textarea id="attendanceCorrectionNote" rows="3" placeholder="Explain the correction"></textarea></label><div class="modal-actions"><button type="button" class="secondary" id="cancelAttendanceCorrection">Cancel</button><button type="submit" class="quick" id="saveAttendanceCorrection">Save correction</button></div></form>`;
    document.body.appendChild(modal);

    byId('clockInButton').addEventListener('click', () => action('clock-in'));
    byId('clockOutButton').addEventListener('click', () => action('clock-out'));
    byId('refreshAttendance').addEventListener('click', load);
    byId('closeAttendanceCorrection').addEventListener('click', closeCorrection);
    byId('cancelAttendanceCorrection').addEventListener('click', closeCorrection);
    byId('attendanceCorrectionModal').addEventListener('click', event => { if (event.target === byId('attendanceCorrectionModal')) closeCorrection(); });
    byId('attendanceCorrectionForm').addEventListener('submit', saveCorrection);
    return view;
  }

  function hideOtherViews() {
    ['dashboardView','customerView','workView','approvalView'].forEach(id => { const el = byId(id); if (el) el.hidden = true; });
  }

  function render(data) {
    canManage = Boolean(data.canManage);
    const mine = data.mine;
    byId('attendanceMyStatus').textContent = data.clockedIn ? 'Clocked in' : mine ? 'Clocked out' : 'Not started';
    byId('attendanceStart').textContent = mine?.clock_in_at ? new Intl.DateTimeFormat('en-ZA',{hour:'2-digit',minute:'2-digit'}).format(new Date(mine.clock_in_at)) : '—';
    byId('attendanceHours').textContent = formatMinutes(mine?.minutes_today);
    byId('clockInButton').disabled = data.clockedIn || Boolean(mine);
    byId('clockOutButton').disabled = !data.clockedIn;

    const activeCount = (data.team || []).filter(row => row.status === 'active' && !row.clock_out_at).length;
    byId('attendanceTeamCount').textContent = canManage ? activeCount : (data.clockedIn ? 1 : 0);
    byId('attendanceTeamPanel').hidden = !canManage;
    byId('attendanceStatus').textContent = data.clockedIn ? 'You are currently clocked in.' : mine ? 'Your attendance for today is complete.' : 'You have not clocked in today.';

    if (!canManage) return;
    const rows = byId('attendanceRows');
    if (!data.team.length) {
      rows.innerHTML = '<tr><td colspan="6" class="attendance-empty">No attendance has been recorded today.</td></tr>';
      return;
    }
    rows.innerHTML = data.team.map(row => `<tr><td><strong>${esc(row.full_name)}</strong><br><small>${esc(row.role)}</small></td><td>${esc(formatDateTime(row.clock_in_at))}</td><td>${esc(formatDateTime(row.clock_out_at))}</td><td>${esc(formatMinutes(row.minutes_today))}</td><td><span class="attendance-status ${row.status === 'active' ? 'active' : 'completed'}">${esc(row.status === 'active' ? 'Clocked in' : 'Completed')}</span>${row.late ? '<span class="attendance-status late">Late</span>' : ''}</td><td><button data-correct-attendance="${row.id}">Correct</button></td></tr>`).join('');
    rows.querySelectorAll('[data-correct-attendance]').forEach(button => button.addEventListener('click', () => {
      const row = data.team.find(item => Number(item.id) === Number(button.dataset.correctAttendance));
      if (row) openCorrection(row);
    }));
  }

  async function load() {
    ensureView();
    try {
      const response = await api('/api/attendance');
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'ATTENDANCE_QUERY_FAILED');
      render(data);
      if (typeof window.loadDashboard === 'function') window.loadDashboard();
    } catch (error) {
      byId('attendanceStatus').textContent = `Could not load attendance: ${error.message}`;
    }
  }

  async function action(type) {
    const button = type === 'clock-in' ? byId('clockInButton') : byId('clockOutButton');
    button.disabled = true;
    try {
      const response = await api(`/api/attendance/${type}`, {method:'POST'});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'ATTENDANCE_ACTION_FAILED');
      notify(type === 'clock-in' ? 'You are clocked in' : 'You are clocked out');
      await load();
    } catch (error) {
      const messages = {ALREADY_CLOCKED_IN:'You are already clocked in.',NOT_CLOCKED_IN:'You are not clocked in.',ATTENDANCE_ALREADY_COMPLETED_TODAY:'Today’s attendance has already been completed.'};
      notify(messages[error.message] || `Attendance action failed: ${error.message}`);
      await load();
    }
  }

  function openCorrection(row) {
    activeCorrection = row;
    byId('attendanceCorrectionName').textContent = row.full_name;
    byId('attendanceCorrectionIn').value = toLocalInput(row.clock_in_at);
    byId('attendanceCorrectionOut').value = toLocalInput(row.clock_out_at);
    byId('attendanceCorrectionNote').value = '';
    byId('attendanceCorrectionModal').classList.add('open');
  }

  function closeCorrection() {
    activeCorrection = null;
    byId('attendanceCorrectionModal')?.classList.remove('open');
  }

  async function saveCorrection(event) {
    event.preventDefault();
    if (!activeCorrection) return;
    const button = byId('saveAttendanceCorrection');
    button.disabled = true;
    try {
      const response = await api(`/api/attendance/${activeCorrection.id}/correct`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clockIn:byId('attendanceCorrectionIn').value,clockOut:byId('attendanceCorrectionOut').value,note:byId('attendanceCorrectionNote').value})});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'ATTENDANCE_CORRECTION_FAILED');
      closeCorrection();
      notify('Attendance corrected');
      await load();
    } catch (error) {
      notify(`Could not correct attendance: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  async function show() {
    ensureView();
    hideOtherViews();
    view.hidden = false;
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'attendance'));
    await load();
  }

  ensureNav();
  window.showAttendance = show;
})();
