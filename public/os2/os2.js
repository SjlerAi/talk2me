const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const formatDate = value => value ? new Intl.DateTimeFormat('en-ZA', { day:'2-digit', month:'short', year:'numeric' }).format(new Date(value)) : '—';
const toast = message => { const el=byId('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>el.classList.remove('show'),2200); };
const modal=byId('modal'), drawer=byId('drawer'), sidebar=byId('sidebar');
let selectedCustomer=null;
let currentUser=null;

async function apiFetch(url, options={}){
  const response=await fetch(url,{...options,headers:{Accept:'application/json',...(options.headers||{})}});
  if(response.status===401){window.location.replace('/login');throw new Error('AUTHENTICATION_REQUIRED');}
  return response;
}

function initials(name){return String(name||'').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'--';}
function greeting(){const hour=new Date().getHours();return hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';}

async function loadCurrentUser(){
  const response=await apiFetch('/api/auth/me');
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||'USER_SESSION_FAILED');
  currentUser=data.user;
  byId('profileAvatar').textContent=initials(currentUser.full_name);
  byId('profileName').textContent=currentUser.full_name;
  byId('profileRole').textContent=`${currentUser.role.charAt(0).toUpperCase()+currentUser.role.slice(1)} · Secure session`;
  byId('welcomeHeading').textContent=`${greeting()}, ${String(currentUser.full_name||'').split(' ')[0]}`;
  byId('adminNav').hidden=!data.permissions.canManage;
}

byId('logoutButton').addEventListener('click',async()=>{
  byId('logoutButton').disabled=true;
  try{await apiFetch('/api/auth/logout',{method:'POST'});}catch(error){console.error(error);}
  window.location.replace('/login');
});

document.querySelectorAll('[data-toast]').forEach(el=>el.addEventListener('click',()=>toast(el.dataset.toast)));
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>{
  if(el.hidden)return;
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));
  const match=document.querySelector(`.nav-item[data-view="${el.dataset.view}"]`); if(match) match.classList.add('active');
  if(el.dataset.view==='home'){ showDashboard(); } else { toast(`${el.dataset.view.charAt(0).toUpperCase()+el.dataset.view.slice(1)} workspace selected`); }
  sidebar.classList.remove('open');
}));
byId('alerts').addEventListener('click',()=>drawer.classList.add('open'));
byId('closeDrawer').addEventListener('click',()=>drawer.classList.remove('open'));
const openInquiry=()=>{ if(selectedCustomer) byId('inquiryCustomer').value=selectedCustomer.client_name||''; modal.classList.add('open'); };
byId('newInquiry').addEventListener('click',openInquiry);
byId('customerNewInquiry').addEventListener('click',openInquiry);
byId('closeModal').addEventListener('click',()=>modal.classList.remove('open'));
byId('cancelModal').addEventListener('click',()=>modal.classList.remove('open'));
byId('menu').addEventListener('click',()=>sidebar.classList.toggle('open'));
byId('backDashboard').addEventListener('click',showDashboard);
modal.addEventListener('click',event=>{if(event.target===modal) modal.classList.remove('open')});
modal.querySelector('form').addEventListener('submit',event=>{event.preventDefault();modal.classList.remove('open');toast('Inquiry saving is not enabled yet')});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();byId('search').focus()}
  if(event.key==='Escape'){modal.classList.remove('open');drawer.classList.remove('open');sidebar.classList.remove('open');byId('results').classList.remove('show')}
});
function statusClass(status){ if(['resolved','completed','active'].includes(status)) return 'done'; if(['open','follow_up','in_progress'].includes(status)) return 'progress'; return 'pending'; }
function showDashboard(){ byId('customerView').hidden=true; byId('dashboardView').hidden=false; document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view==='home')); }
async function loadDashboard(){
  byId('systemMessage').textContent='Loading live information from the OS2 test database…';
  try{
    const response=await apiFetch('/api/dashboard'); const data=await response.json(); if(!response.ok||!data.ok) throw new Error(data.error||'Dashboard could not load');
    const m=data.metrics;
    ['Approvals','Overdue','Unassigned','Upgrades','Birthdays','Callbacks','Prospects'].forEach(k=>byId(`metric${k}`).textContent=m[k.charAt(0).toLowerCase()+k.slice(1)]);
    byId('metricClockedIn').textContent=`${m.clockedIn}/${m.activeStaff}`; byId('activeStaffText').textContent=`${m.activeStaff} active staff accounts`; byId('workBadge').textContent=m.overdue; byId('alertBadge').textContent=m.approvals; byId('systemMessage').textContent='Secure live test data loaded from kloka_talk2me.';
    byId('activityRows').innerHTML=data.activity.length?data.activity.map(row=>`<tr><td>${escapeHtml(row.staff_member)}</td><td>${escapeHtml(row.latest_action)}</td><td>${escapeHtml(row.customer)}</td><td><span class="status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td><td>${escapeHtml(row.activity_time)}</td></tr>`).join(''):'<tr><td colspan="5">No activity found.</td></tr>';
  }catch(error){if(error.message==='AUTHENTICATION_REQUIRED')return;byId('systemMessage').textContent=`Database connection not ready: ${error.message}`;byId('activityRows').innerHTML='<tr><td colspan="5">Live data is not available yet.</td></tr>';toast('Database connection needs configuration');}
}
byId('refreshDashboard').addEventListener('click',()=>{loadDashboard();toast('Refreshing live dashboard')});
byId('databaseStatus').addEventListener('click',async()=>{try{const r=await fetch('/health');const d=await r.json();toast(d.database?.connected?`Connected to ${d.database.name}`:'Database is not connected')}catch{toast('Health check failed')}});

async function openCustomer(id){
  byId('results').classList.remove('show'); byId('dashboardView').hidden=true; byId('customerView').hidden=false;
  byId('customerName').textContent='Loading customer…'; byId('customerSummary').textContent='Reading Customer 360 from the test database.';
  try{
    const response=await apiFetch(`/api/customers/${encodeURIComponent(id)}`); const data=await response.json(); if(!response.ok||!data.ok) throw new Error(data.error||'Customer could not load');
    selectedCustomer=data.customer; const c=data.customer;
    byId('customerName').textContent=c.client_name||'Unnamed customer';
    byId('customerSummary').textContent=`${c.account_number||'No account number'} · ${data.lines.length} mobile line${data.lines.length===1?'':'s'} · Assigned to ${c.assigned_staff||'Unassigned'}`;
    byId('customerDetails').innerHTML=[['Account',c.account_number],['Cellphone',c.cell_number],['Alternative',c.alt_number],['Email',c.email],['Town',c.city_town],['ID number',c.id_number],['Main contact',c.main_contact_name],['Contact number',c.main_contact_number]].map(([label,value])=>`<div class="detail"><span>${label}</span><strong>${escapeHtml(value||'—')}</strong></div>`).join('');
    byId('customerStatus').innerHTML=`<div><span>Assigned staff</span><strong>${escapeHtml(c.assigned_staff||'Unassigned')}</strong></div><div><span>Customer type</span><strong>${escapeHtml(c.customer_type||'Unknown')}</strong></div><div><span>Lifecycle</span><strong>${escapeHtml(c.lifecycle_status||'Unknown')}</strong></div><div><span>Authority</span><strong>${escapeHtml(c.account_authority_status||'Unknown')}</strong></div>`;
    byId('lineCount').textContent=data.lines.length;
    byId('customerLines').innerHTML=data.lines.length?data.lines.map(line=>`<tr><td>${escapeHtml(line.cell_number||'—')}</td><td>${escapeHtml(line.package_name||'—')}</td><td>${escapeHtml(line.handset||'—')}</td><td>${formatDate(line.next_upgrade_date)}</td><td><span class="status ${statusClass(line.line_status)}">${escapeHtml(line.line_status||'unknown')}</span></td></tr>`).join(''):'<tr><td colspan="5">No mobile lines found.</td></tr>';
    byId('inquiryCount').textContent=data.inquiries.length;
    byId('customerInquiries').innerHTML=data.inquiries.length?data.inquiries.map(item=>`<article class="timeline-item"><div class="timeline-dot"></div><div><div class="timeline-top"><strong>${escapeHtml(item.category||'Inquiry')}</strong><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></div><p>${escapeHtml(item.action_taken||item.query_text||item.result_found||'No notes recorded')}</p><small>${formatDate(item.created_at)} · ${escapeHtml(item.staff_member||'Unassigned')}</small></div></article>`).join(''):'<div class="empty-state">No inquiry history linked to this customer.</div>';
    document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view==='customers'));
  }catch(error){if(error.message==='AUTHENTICATION_REQUIRED')return;byId('customerName').textContent='Customer unavailable';byId('customerSummary').textContent=error.message;toast('Customer 360 could not load');}
}
byId('copyPhone').addEventListener('click',async()=>{const phone=selectedCustomer?.cell_number;if(!phone)return toast('No phone number available');try{await navigator.clipboard.writeText(phone);toast('Phone number copied')}catch{toast(phone)}});

const search=byId('search'), results=byId('results'); let searchTimer;
search.addEventListener('input',()=>{
  clearTimeout(searchTimer); const value=search.value.trim(); if(value.length<2){results.classList.remove('show');results.innerHTML='';return}
  results.innerHTML='<div class="result"><b>Searching…</b><span>Reading the OS2 test database</span></div>'; results.classList.add('show');
  searchTimer=setTimeout(async()=>{try{
    const response=await apiFetch(`/api/customers/search?q=${encodeURIComponent(value)}`); const data=await response.json(); if(!response.ok||!data.ok) throw new Error(data.error||'Search failed');
    results.innerHTML=data.customers.length?data.customers.map(item=>`<div class="result" data-id="${item.id}" data-name="${escapeHtml(item.client_name)}"><b>${escapeHtml(item.client_name)}</b><span>${escapeHtml(item.account_number||'No account')} · ${escapeHtml(item.cell_number||'No phone')} · ${escapeHtml(item.city_town||item.email||'')}</span></div>`).join(''):'<div class="result"><b>No customers found</b><span>Try another name, number or account.</span></div>';
    results.querySelectorAll('[data-id]').forEach(item=>item.addEventListener('click',()=>{search.value=item.dataset.name;openCustomer(item.dataset.id)}));
  }catch(error){if(error.message!=='AUTHENTICATION_REQUIRED')results.innerHTML=`<div class="result"><b>Search unavailable</b><span>${escapeHtml(error.message)}</span></div>`}},300);
});
document.addEventListener('click',event=>{if(!event.target.closest('.search'))results.classList.remove('show')});
byId('todayLabel').textContent=new Intl.DateTimeFormat('en-ZA',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date()).toUpperCase();
(async()=>{try{await loadCurrentUser();await loadDashboard();}catch(error){console.error(error);window.location.replace('/login');}})();
