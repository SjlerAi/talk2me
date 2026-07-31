(() => {
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let view=null;

  async function api(url,options={}){
    const r=await fetch(url,{...options,headers:{Accept:'application/json',...(options.headers||{})}});
    if(r.status===401){location.replace('/login');throw new Error('AUTHENTICATION_REQUIRED');}
    return r;
  }

  function notify(message){if(typeof window.toast==='function')return window.toast(message);}
  function ensureView(){
    if(view)return view;
    const style=document.createElement('style');
    style.textContent='.approval-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px}.approval-head h1{margin:4px 0}.approval-list{display:grid;gap:14px}.approval-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;display:grid;grid-template-columns:1fr auto;gap:16px;box-shadow:0 10px 28px rgba(46,93,119,.07)}.approval-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:8px 0}.approval-actions{display:flex;gap:8px;align-items:center}.approval-actions button{height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:#fff;font-weight:800;cursor:pointer}.approval-actions .approve{background:var(--green);color:#fff;border-color:var(--green)}.approval-actions .reject{background:var(--red);color:#fff;border-color:var(--red)}.approval-empty{padding:32px;text-align:center;color:var(--muted)}@media(max-width:760px){.approval-card{grid-template-columns:1fr}.approval-actions{justify-content:flex-start}}';
    document.head.appendChild(style);
    view=document.createElement('section');
    view.className='content';view.id='approvalView';view.hidden=true;
    view.innerHTML='<div class="approval-head"><div><span>MANAGEMENT CONTROL</span><h1>Approvals</h1><p id="approvalStatus">Loading pending claims...</p></div><button class="secondary" id="refreshApprovals">Refresh</button></div><div class="approval-list" id="approvalList"></div>';
    document.querySelector('main').appendChild(view);
    byId('refreshApprovals').addEventListener('click',load);
    return view;
  }

  function hideOtherViews(){['dashboardView','customerView','workView'].forEach(id=>{const el=byId(id);if(el)el.hidden=true;});}
  async function load(){
    ensureView();hideOtherViews();view.hidden=false;
    document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view==='admin'));
    byId('approvalStatus').textContent='Loading pending claims...';
    try{
      const r=await api('/api/approvals');const data=await r.json();
      if(!r.ok||!data.ok)throw new Error(data.error||'APPROVAL_QUEUE_FAILED');
      byId('approvalStatus').textContent=`${data.count} pending claim${data.count===1?'':'s'}`;
      byId('approvalList').innerHTML=data.items.length?data.items.map(item=>`<article class="approval-card"><div><strong>${esc(item.client_name||'Unknown customer')}</strong><div class="approval-meta"><span>Requested by ${esc(item.requester_name||'Unknown')}</span><span>Current owner: ${esc(item.current_assignee||'Unassigned')}</span><span>Account: ${esc(item.account_number||'—')}</span></div><p>${esc(item.reason||item.description||'No reason supplied.')}</p></div><div class="approval-actions"><button data-customer="${item.entity_id||item.client_id||''}">Customer</button><button class="reject" data-decision="reject" data-id="${item.id}">Reject</button><button class="approve" data-decision="approve" data-id="${item.id}">Approve</button></div></article>`).join(''):'<div class="approval-empty">No claim approvals are waiting.</div>';
      byId('approvalList').querySelectorAll('[data-customer]').forEach(btn=>btn.addEventListener('click',()=>{const id=Number(btn.dataset.customer);if(id&&typeof window.openCustomer==='function'){view.hidden=true;window.openCustomer(id);}}));
      byId('approvalList').querySelectorAll('[data-decision]').forEach(btn=>btn.addEventListener('click',()=>decide(btn)));
    }catch(error){byId('approvalStatus').textContent=`Could not load approvals: ${error.message}`;}
  }

  async function decide(button){
    const decision=button.dataset.decision;
    if(typeof window.talk2meDialog!=='function'){notify('Approval form is not ready. Refresh and try again.');return;}
    const result=await window.talk2meDialog({
      title:decision==='reject'?'Reject client claim':'Approve client claim',
      message:decision==='reject'?'Enter the reason for rejecting this request.':'Add an optional approval note.',
      confirmText:decision==='reject'?'Reject claim':'Approve claim',
      fields:[{label:decision==='reject'?'Rejection reason':'Approval note',type:'textarea',rows:4,required:decision==='reject'}]
    });
    if(!result.confirmed)return;
    const note=result.values[0]||'';
    if(decision==='reject'&&!note.trim()){notify('Enter a reason for rejection.');return;}
    button.disabled=true;
    try{
      const r=await api(`/api/approvals/${button.dataset.id}/decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,note})});
      const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'APPROVAL_DECISION_FAILED');
      notify(decision==='approve'?'Client claim approved':'Client claim rejected');
      if(typeof window.loadDashboard==='function')window.loadDashboard();
      if(typeof window.loadNotifications==='function')window.loadNotifications();
      await load();
    }catch(error){const messages={SELF_APPROVAL_NOT_ALLOWED:'You cannot approve your own claim.',REQUEST_ALREADY_DECIDED:'This request has already been decided.'};notify(messages[error.message]||`Decision failed: ${error.message}`);}finally{button.disabled=false;}
  }

  document.querySelectorAll('[data-view="admin"]').forEach(el=>el.addEventListener('click',event=>{event.preventDefault();load();}));
  document.querySelectorAll('[data-view="home"],[data-view="work"],[data-view="customers"]').forEach(el=>el.addEventListener('click',()=>{if(view)view.hidden=true;}));
  window.showApprovals=load;

  if (!document.querySelector('script[src$="notifications.js"]')) {
    const script=document.createElement('script');
    script.src='./notifications.js';
    document.body.appendChild(script);
  }
})();
