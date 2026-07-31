(() => {
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let view=null,type='upgrades',days=30,items=[],page=1,query='';
  const pageSize=20;
  async function api(url,options={}){const r=await fetch(url,{...options,headers:{Accept:'application/json',...(options.headers||{})}});if(r.status===401){location.replace('/login');throw new Error('AUTHENTICATION_REQUIRED');}return r;}
  function notify(m){if(typeof window.toast==='function')return window.toast(m);}
  function ensure(){
    if(view)return view;
    const s=document.createElement('style');
    s.textContent='.opp-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}.opp-controls{display:flex;gap:8px;flex-wrap:wrap}.opp-controls button{border:1px solid var(--line);background:#fff;border-radius:10px;padding:10px 13px;font-weight:800;cursor:pointer}.opp-controls button.active{background:var(--blue);color:#fff}.opp-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:14px 0}.opp-search{flex:1;max-width:520px;height:42px;padding:0 14px;border:1px solid var(--line);border-radius:11px;background:#fff}.opp-search:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(23,143,201,.12)}.opp-page-info{color:var(--muted);font-size:13px;font-weight:700}.opp-list{display:grid;gap:12px}.opp-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;display:grid;grid-template-columns:1fr auto;gap:14px}.opp-meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:7px 0}.opp-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.opp-actions button,.opp-actions a{border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 10px;font-weight:800;text-decoration:none;color:inherit;cursor:pointer}.opp-actions .primary{background:var(--red);color:#fff;border-color:var(--red)}.opp-pagination{display:flex;justify-content:center;align-items:center;gap:10px;margin:18px 0 4px}.opp-pagination button{min-width:100px;height:40px;border:1px solid var(--line);border-radius:10px;background:#fff;font-weight:800;cursor:pointer}.opp-pagination button:disabled{opacity:.45;cursor:not-allowed}.opp-pagination span{min-width:110px;text-align:center;font-weight:800;color:var(--muted)}@media(max-width:760px){.opp-card{grid-template-columns:1fr}.opp-toolbar{align-items:stretch;flex-direction:column}.opp-search{max-width:none;width:100%}}';
    document.head.appendChild(s);
    view=document.createElement('section');view.className='content';view.id='opportunityView';view.hidden=true;
    view.innerHTML='<div class="opp-head"><div><span>SALES & CLIENT CARE</span><h1>Opportunities</h1><p id="oppStatus">Loading opportunities...</p></div><button class="secondary" id="oppRefresh">Refresh</button></div><div class="opp-controls" id="oppTypes"><button data-type="upgrades" class="active">Upgrades</button><button data-type="birthdays">Birthdays</button><button data-type="prospects">Prospects</button><button data-type="renewals">Renewals / cancellations</button></div><div class="opp-controls" id="oppDays" style="margin:10px 0 0"><button data-days="0">Today</button><button data-days="7">7 days</button><button data-days="30" class="active">30 days</button><button data-days="60">60 days</button></div><div class="opp-toolbar"><input class="opp-search" id="oppSearch" type="search" placeholder="Search customer, account, phone, package or handset"><div class="opp-page-info" id="oppPageInfo"></div></div><div class="opp-list" id="oppList"></div><div class="opp-pagination" id="oppPagination"><button id="oppPrev">Previous</button><span id="oppPageLabel">Page 1 of 1</span><button id="oppNext">Next</button></div>';
    document.querySelector('main').appendChild(view);
    byId('oppRefresh').onclick=load;
    byId('oppTypes').onclick=e=>{const b=e.target.closest('[data-type]');if(!b)return;type=b.dataset.type;page=1;byId('oppTypes').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));load();};
    byId('oppDays').onclick=e=>{const b=e.target.closest('[data-days]');if(!b)return;days=Number(b.dataset.days);page=1;byId('oppDays').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));load();};
    let searchTimer;
    byId('oppSearch').oninput=e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{query=e.target.value.trim().toLowerCase();page=1;render();},180);};
    byId('oppPrev').onclick=()=>{if(page>1){page-=1;render();window.scrollTo({top:view.offsetTop-20,behavior:'smooth'});}};
    byId('oppNext').onclick=()=>{const pages=Math.max(1,Math.ceil(filteredItems().length/pageSize));if(page<pages){page+=1;render();window.scrollTo({top:view.offsetTop-20,behavior:'smooth'});}};
    return view;
  }
  function hide(){['dashboardView','customerView','workView','approvalView','attendanceView','reportView','administrationView'].forEach(id=>{const e=byId(id);if(e)e.hidden=true;});}
  function fmt(v){return v?new Intl.DateTimeFormat('en-ZA',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(v)):'—';}
  function filteredItems(){
    if(!query)return items;
    return items.filter(i=>[i.client_name,i.account_number,i.cell_number,i.email,i.city_town,i.package_name,i.handset,i.assigned_staff].some(v=>String(v||'').toLowerCase().includes(query)));
  }
  function render(){
    const list=byId('oppList');
    const filtered=filteredItems();
    const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
    if(page>pages)page=pages;
    const start=(page-1)*pageSize;
    const visible=filtered.slice(start,start+pageSize);
    byId('oppPageInfo').textContent=filtered.length?`Showing ${start+1}-${Math.min(start+pageSize,filtered.length)} of ${filtered.length}`:'0 results';
    byId('oppPageLabel').textContent=`Page ${page} of ${pages}`;
    byId('oppPrev').disabled=page<=1;
    byId('oppNext').disabled=page>=pages;
    byId('oppPagination').hidden=filtered.length<=pageSize;
    if(!visible.length){list.innerHTML='<div class="panel" style="padding:30px;text-align:center">No matching opportunities.</div>';return;}
    list.innerHTML=visible.map(i=>{const date=type==='birthdays'?i.birthday:type==='renewals'?i.cancellation_date:i.next_upgrade_date;const wa=String(i.cell_number||'').replace(/\D/g,'');return `<article class="opp-card"><div><strong>${esc(i.client_name)}</strong><div class="opp-meta"><span>${esc(i.account_number||'No account')}</span><span>${esc(i.assigned_staff)}</span><span>${esc(type)}: ${esc(fmt(date))}</span></div><p>${esc(i.package_name||'')} ${esc(i.handset||'')}</p></div><div class="opp-actions"><button data-client="${i.id}">Customer</button>${i.cell_number?`<a href="tel:${esc(i.cell_number)}">Call</a>`:''}${wa?`<a href="https://wa.me/${esc(wa)}" target="_blank">WhatsApp</a>`:''}<button data-contacted="${i.id}">Mark contacted</button><button class="primary" data-followup="${i.id}">Follow-up</button></div></article>`}).join('');
    list.querySelectorAll('[data-client]').forEach(b=>b.onclick=()=>window.openCustomer?.(Number(b.dataset.client)));
    list.querySelectorAll('[data-contacted]').forEach(b=>b.onclick=()=>contacted(b));
    list.querySelectorAll('[data-followup]').forEach(b=>b.onclick=()=>followup(b));
  }
  async function load(){ensure();byId('oppStatus').textContent='Loading opportunities...';try{const r=await api(`/api/opportunities?type=${encodeURIComponent(type)}&days=${days}`);const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'OPPORTUNITY_QUERY_FAILED');items=d.items||[];byId('oppStatus').textContent=`${d.count} opportunity${d.count===1?'':'ies'} · ${d.teamView?'Team view':'Your assigned clients'}`;render();}catch(e){byId('oppStatus').textContent=`Could not load opportunities: ${e.message}`;}}
  async function contacted(b){b.disabled=true;try{const r=await api(`/api/opportunities/${b.dataset.contacted}/contacted`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'manual'})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error);notify('Opportunity marked as contacted');}catch(e){notify(`Could not update: ${e.message}`);}finally{b.disabled=false;}}
  async function followup(b){
    const dialog=typeof window.talk2meDialog==='function'?window.talk2meDialog:null;
    if(!dialog){notify('Follow-up form is not ready. Refresh the page and try again.');return;}
    const result=await dialog({title:'Schedule follow-up',message:'Choose when this follow-up is due and add the action required.',confirmText:'Add follow-up',fields:[{label:'Follow-up date and time',type:'datetime-local'},{label:'Follow-up note',type:'textarea',rows:4,value:'Contact customer about available upgrade options.'}]});
    if(!result.confirmed)return;
    const [when,note]=result.values;if(!when){notify('Choose a follow-up date and time.');return;}
    b.disabled=true;
    try{const r=await api(`/api/opportunities/${b.dataset.followup}/follow-up`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({followUpAt:when,note:note||'Opportunity follow-up'})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error);notify('Follow-up added to My Work');window.loadDashboard?.();}catch(e){notify(`Could not schedule follow-up: ${e.message}`);}finally{b.disabled=false;}
  }
  async function show(){ensure();hide();view.hidden=false;document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view==='opportunities'));await load();}
  document.querySelectorAll('[data-view="opportunities"]').forEach(n=>n.addEventListener('click',e=>{e.preventDefault();show();}));window.showOpportunities=show;
  if(!document.querySelector('script[src$="reports.js"]')){const script=document.createElement('script');script.src='./reports.js';document.body.appendChild(script);}
})();
