(() => {
  'use strict';
  if (window.__talk2meWorkOperatingModelLoaded) return;
  window.__talk2meWorkOperatingModelLoaded = true;

  const configNode=document.getElementById('talk2me-os-config');
  if(!configNode)return;
  const config=JSON.parse(configNode.textContent||'{}');
  const basePath=String(config.basePath||'');
  const user=config.user||{};
  const isOwner=String(user.role||'').toLowerCase()==='owner';
  const isManagement=['owner','admin','manager'].includes(String(user.role||'').toLowerCase());
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const shortStaff=value=>{
    const raw=String(value||'').trim();
    if(!raw)return '';
    const source=raw.includes('@')?raw.split('@')[0]:raw;
    const parts=source.split(/[\s._-]+/).filter(Boolean);
    if(String(parts[0]||'').toLowerCase()==='van'&&String(parts[1]||'').toLowerCase()==='zyl')return 'Van Zyl';
    return parts[0]||raw;
  };
  const pretty=value=>value?new Date(value).toLocaleString('en-ZA',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const num=value=>Number(value||0);

  async function jsonFetch(path,options={}){
    const response=await fetch(basePath+path,{
      credentials:'same-origin',
      cache:'no-store',
      headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})},
      ...options
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.ok===false)throw new Error(payload.error||('Request failed ('+response.status+')'));
    return payload;
  }

  function widget(){return document.getElementById('t2m-task-widget');}
  function body(){return widget()?.querySelector('[data-widget-body]');}
  function showWidget(){
    const panel=widget();
    if(!panel)return false;
    panel.hidden=false;
    panel.classList.remove('is-collapsed');
    panel.style.zIndex='39990';
    return true;
  }
  function setActive(key){
    const panel=widget();
    panel?.querySelectorAll('[data-work-head]').forEach(button=>button.classList.toggle('is-active',button.dataset.workHead===key));
  }

  function ensureHeader(){
    const panel=widget();
    const nav=panel?.querySelector('.t2m-work-head-nav');
    if(!nav)return;
    const inbox=nav.querySelector('[data-work-head="inbox"] strong');
    if(inbox)inbox.textContent='Tasks';
    if(!nav.querySelector('[data-work-head="overview"]')){
      const button=document.createElement('button');
      button.type='button';
      button.dataset.workHead='overview';
      button.innerHTML='<span>⌂</span><strong>My Work</strong>';
      nav.insertBefore(button,nav.firstChild);
      button.addEventListener('click',event=>{
        event.preventDefault();
        event.stopImmediatePropagation();
        openWork();
      });
    }
  }

  function targetSummary(targets){
    const goals=Array.isArray(targets?.goals)?targets.goals:[];
    const measured=goals.filter(goal=>num(goal.target)>0);
    if(!measured.length)return {value:goals.length,label:goals.length?'targets ready':'not set'};
    const average=Math.round(measured.reduce((sum,goal)=>sum+num(goal.progress),0)/measured.length);
    return {value:average+'%',label:'average progress'};
  }

  function priority(item){
    if(item.overdue)return {label:'OVERDUE',kind:'urgent'};
    const value=String(item.priority||'normal').toLowerCase();
    if(value==='high')return {label:'IMPORTANT',kind:'high'};
    if(value==='urgent')return {label:'URGENT',kind:'urgent'};
    return {label:'NORMAL',kind:'normal'};
  }

  function renderWork(data){
    const holder=body();
    if(!holder)return;
    const o=data.overview||data||{};
    const targets=o.targets||{goals:[]};
    const target=targetSummary(targets);
    const delegated=Array.isArray(o.delegated)?o.delegated:[];
    const customers=Array.isArray(o.customers?.items)?o.customers.items:[];

    const delegatedHtml=delegated.length?delegated.slice(0,15).map(item=>{
      const p=priority(item);
      return '<button type="button" class="t2m-om-delegated is-'+esc(p.kind)+'" data-om-task="'+num(item.id)+'">'+
        '<span class="t2m-om-priority">'+esc(p.label)+'</span>'+
        '<span><strong>'+esc(item.title||'Delegated work')+'</strong><small>'+
        (item.clientName?esc(item.clientName)+' · ':'')+'From '+esc(item.delegatedBy||'Management')+
        (item.dueAt?' · Due '+esc(pretty(item.dueAt)):'')+'</small></span><b>›</b></button>';
    }).join(''):'<div class="t2m-om-empty">No delegated work is outstanding.</div>';

    const customerHtml=customers.length?customers.slice(0,12).map(item=>
      '<button type="button" class="t2m-om-customer" data-om-client="'+num(item.id)+'"><strong>'+esc(item.name||'Customer')+
      '</strong><span>'+esc((item.reasons||[]).join(' · '))+'</span><small>'+esc(item.cell||item.account||'')+'</small></button>'
    ).join(''):'<div class="t2m-om-empty">No assigned customers need attention right now.</div>';

    const targetHtml=(targets.goals||[]).length?(targets.goals||[]).slice(0,10).map(goal=>{
      const width=Math.max(0,Math.min(100,num(goal.progress)));
      return '<div class="t2m-om-target"><span><strong>'+esc(goal.label)+'</strong><small>'+
        (goal.source==='automatic'?'Automatic from CRM':'Entered progress')+'</small></span><b>'+esc(String(goal.actual||0))+
        (goal.target!=null?' / '+esc(String(goal.target)):'')+'</b><i><em style="width:'+width+'%"></em></i></div>';
    }).join(''):'<div class="t2m-om-empty">Targets have not been set for you yet.</div>';

    const ownerTools=isOwner?'<div class="t2m-om-owner-tools">'+
      '<button data-om-owner="scorecard"><strong>Office Scorecard</strong><span>Who did what</span></button>'+
      '<button data-om-owner="targets"><strong>Target Centre</strong><span>Set & track targets</span></button>'+
      '<button data-om-owner="imports"><strong>Import Summary</strong><span>What came in this month</span></button>'+
      '</div>':'';

    holder.innerHTML='<div class="t2m-om-shell">'+
      '<header class="t2m-om-hero"><div><small>MY WORK</small><h3>What must I do now?</h3><p>Delegated work, tasks, customers and targets in one place.</p></div><button data-om-refresh>Refresh</button></header>'+
      '<div class="t2m-om-kpis">'+
        '<button data-om-kpi="delegated"><span>Delegated to me</span><strong>'+num(o.tasks?.delegated)+'</strong><small>From Gerda / management</small></button>'+
        '<button data-om-kpi="tasks"><span>My Tasks</span><strong>'+num(o.tasks?.active)+'</strong><small>'+num(o.tasks?.urgent)+' urgent · '+num(o.tasks?.overdue)+' overdue</small></button>'+
        '<button data-om-kpi="customers"><span>My Customers</span><strong>'+num(o.customers?.total)+'</strong><small>Need attention</small></button>'+
        '<button data-om-kpi="targets"><span>My Targets</span><strong>'+esc(String(target.value))+'</strong><small>'+esc(target.label)+'</small></button>'+
      '</div>'+ownerTools+
      '<section class="t2m-om-section" data-om-section="delegated"><div class="t2m-om-section-head"><div><small>DELEGATED WORK</small><h4>From Gerda / management</h4></div><button data-om-open-tasks>Open Tasks</button></div><div class="t2m-om-delegated-list">'+delegatedHtml+'</div></section>'+
      '<div class="t2m-om-columns">'+
        '<section class="t2m-om-section" data-om-section="customers"><div class="t2m-om-section-head"><div><small>MY CUSTOMERS</small><h4>Need attention</h4></div></div><div class="t2m-om-customer-list">'+customerHtml+'</div></section>'+
        '<section class="t2m-om-section" data-om-section="targets"><div class="t2m-om-section-head"><div><small>MY TARGETS</small><h4>'+esc(String(o.monthKey||'').slice(0,7))+'</h4></div></div><div class="t2m-om-target-list">'+targetHtml+'</div></section>'+
      '</div></div>';

    holder.querySelector('[data-om-refresh]')?.addEventListener('click',openWork);
    holder.querySelector('[data-om-open-tasks]')?.addEventListener('click',()=>window.Talk2MeWidgets?.openTasks?.({scope:'mine',view:'latest'}));
    holder.querySelector('[data-om-kpi="tasks"]')?.addEventListener('click',()=>window.Talk2MeWidgets?.openTasks?.({scope:'mine',view:'latest'}));
    holder.querySelector('[data-om-kpi="delegated"]')?.addEventListener('click',()=>holder.querySelector('[data-om-section="delegated"]')?.scrollIntoView({behavior:'smooth',block:'start'}));
    holder.querySelector('[data-om-kpi="customers"]')?.addEventListener('click',()=>holder.querySelector('[data-om-section="customers"]')?.scrollIntoView({behavior:'smooth',block:'start'}));
    holder.querySelector('[data-om-kpi="targets"]')?.addEventListener('click',()=>holder.querySelector('[data-om-section="targets"]')?.scrollIntoView({behavior:'smooth',block:'start'}));
    holder.querySelectorAll('[data-om-task]').forEach(button=>button.onclick=()=>window.Talk2MeWidgets?.openTask?.(num(button.dataset.omTask)));
    holder.querySelectorAll('[data-om-client]').forEach(button=>button.onclick=()=>{window.location.href=basePath+'/customers/'+num(button.dataset.omClient)+'/details';});
    holder.querySelector('[data-om-owner="scorecard"]')?.addEventListener('click',()=>openScorecard('month'));
    holder.querySelector('[data-om-owner="targets"]')?.addEventListener('click',openTargets);
    holder.querySelector('[data-om-owner="imports"]')?.addEventListener('click',openImports);
  }

  async function openWork(){
    ensureHeader();
    if(!showWidget())return;
    setActive('overview');
    const holder=body();
    holder.innerHTML='<div class="t2m-chat-empty"><strong>Loading My Work…</strong><span>Checking delegated work, customers and targets.</span></div>';
    try{renderWork(await jsonFetch('/api/uat/work/overview'));}catch(error){holder.innerHTML='<div class="t2m-chat-empty"><strong>Could not load My Work</strong><span>'+esc(error.message)+'</span></div>';}
  }

  async function openScorecard(range='month'){
    if(!isOwner)return;
    ensureHeader();showWidget();setActive('overview');
    const holder=body();holder.innerHTML='<div class="t2m-chat-empty"><strong>Loading Office Scorecard…</strong></div>';
    try{
      const data=await jsonFetch('/api/uat/work/scorecard?range='+encodeURIComponent(range));
      const rows=data.scorecard?.rows||[];
      const periods=[['today','Today'],['week','This Week'],['month','This Month'],['last_month','Last Month']];
      holder.innerHTML='<div class="t2m-om-admin"><header><button data-om-back>← My Work</button><div><small>OWNER VIEW</small><h3>Office Scorecard</h3><p>Live CRM activity · '+esc(data.scorecard?.range?.label||'')+'</p></div></header>'+
        '<div class="t2m-om-periods">'+periods.map(p=>'<button data-om-range="'+p[0]+'" class="'+(p[0]===range?'is-active':'')+'">'+p[1]+'</button>').join('')+'</div>'+
        '<div class="t2m-om-table-wrap"><table class="t2m-om-scorecard"><thead><tr><th>Staff</th><th>Queries handeled</th><th>Upgrade Updated</th><th>New Clients added</th><th>Tasks Send</th><th>Task Updated</th><th>Task Completed</th><th>Client Claimed</th><th>U/S Task</th><th>Over Due Upgrades</th></tr></thead><tbody>'+
        rows.map(row=>'<tr><th>'+esc(row.staffName)+'</th><td>'+num(row.queriesHandled)+'</td><td>'+num(row.upgradesUpdated)+'</td><td>'+num(row.newClientsAdded)+'</td><td>'+num(row.tasksSent)+'</td><td>'+num(row.tasksUpdated)+'</td><td>'+num(row.tasksCompleted)+'</td><td>'+num(row.clientsClaimed)+'</td><td class="'+(num(row.outstandingTasks)?'is-warn':'')+'">'+num(row.outstandingTasks)+'</td><td class="'+(num(row.overdueUpgrades)?'is-danger':'')+'">'+num(row.overdueUpgrades)+'</td></tr>').join('')+
        '</tbody></table></div></div>';
      holder.querySelector('[data-om-back]').onclick=openWork;
      holder.querySelectorAll('[data-om-range]').forEach(button=>button.onclick=()=>openScorecard(button.dataset.omRange));
    }catch(error){holder.innerHTML='<div class="t2m-chat-empty"><strong>Could not load scorecard</strong><span>'+esc(error.message)+'</span></div>';}
  }

  async function openTargets(){
    if(!isOwner)return;
    ensureHeader();showWidget();setActive('overview');
    const holder=body();holder.innerHTML='<div class="t2m-chat-empty"><strong>Loading Target Centre…</strong></div>';
    try{
      const data=await jsonFetch('/api/uat/work/targets');
      const staff=data.targets?.staff||[];
      const month=data.targets?.monthKey||'';
      holder.innerHTML='<div class="t2m-om-admin"><header><button data-om-back>← My Work</button><div><small>OWNER VIEW</small><h3>Target Centre</h3><p>Different measures per role. Blank targets stay editable; supported CRM actuals update automatically.</p></div></header>'+
        '<div class="t2m-om-target-staff">'+(staff.map(person=>'<section class="t2m-om-target-person"><div class="t2m-om-target-person-head"><h4>'+esc(person.staffName)+'</h4><span>'+esc(String(month).slice(0,7))+'</span></div><div class="t2m-om-table-wrap"><table class="t2m-om-target-table"><thead><tr><th>Measure</th><th>Target</th><th>W1</th><th>W2</th><th>W3</th><th>W4</th><th>W5</th><th>Actual</th><th>%</th><th></th></tr></thead><tbody>'+
        person.goals.map(goal=>'<tr data-om-target-row="'+num(goal.id)+'"><th>'+esc(goal.label)+'<small>'+esc(goal.source==='automatic'?'Automatic':'Manual')+'</small></th><td><input type="number" step="0.01" data-om-target value="'+(goal.target==null?'':esc(String(goal.target)))+'"></td>'+
          [1,2,3,4,5].map(week=>'<td><input type="number" step="0.01" data-om-week="'+week+'" '+(goal.source==='automatic'?'disabled':'')+' value="'+(goal.weeks?.[week]==null?'':esc(String(goal.weeks[week])))+'"></td>').join('')+
          '<td><strong>'+esc(String(goal.actual||0))+'</strong></td><td>'+(goal.progress==null?'—':esc(String(goal.progress))+'%')+'</td><td><button data-om-save="'+num(goal.id)+'">Save</button></td></tr>').join('')+
        '</tbody></table></div></section>').join('')||'<div class="t2m-om-empty">No target templates matched active staff.</div>')+'</div></div>';
      holder.querySelector('[data-om-back]').onclick=openWork;
      holder.querySelectorAll('[data-om-save]').forEach(button=>button.onclick=async()=>{
        const row=button.closest('[data-om-target-row]');
        const target=row.querySelector('[data-om-target]')?.value??'';
        const weeks=[1,2,3,4,5].map(week=>row.querySelector('[data-om-week="'+week+'"]')?.value??'');
        button.disabled=true;button.textContent='Saving…';
        try{await jsonFetch('/api/uat/work/targets/'+button.dataset.omSave,{method:'POST',body:JSON.stringify({target,weeks,month})});await openTargets();}catch(error){window.alert(error.message);button.disabled=false;button.textContent='Save';}
      });
    }catch(error){holder.innerHTML='<div class="t2m-chat-empty"><strong>Could not load Target Centre</strong><span>'+esc(error.message)+'</span></div>';}
  }

  async function openImports(){
    if(!isOwner)return;
    ensureHeader();showWidget();setActive('overview');
    const holder=body();holder.innerHTML='<div class="t2m-chat-empty"><strong>Loading Monthly Import Summary…</strong></div>';
    try{
      const data=await jsonFetch('/api/uat/work/import-summary');
      const summary=data.summary||{},t=summary.totals||{};
      const card=(label,value,link,kind='')=>'<button class="'+kind+'" data-om-import-link="'+esc(link||summary.links?.management||'')+'"><span>'+esc(label)+'</span><strong>'+num(value)+'</strong></button>';
      holder.innerHTML='<div class="t2m-om-admin"><header><button data-om-back>← My Work</button><div><small>OWNER VIEW</small><h3>Monthly Import Summary</h3><p>'+esc(String(summary.monthKey||'').slice(0,7))+' · click a figure to review the import.</p></div></header>'+
        '<div class="t2m-om-import-kpis">'+card('Imported',t.imported,summary.links?.import)+card('Upgrades',t.upgrades,summary.links?.management)+card('New lines',t.newLines,summary.links?.management)+card('Exact matches',t.exactMatches,summary.links?.management)+card('Needs review',t.needsReview,summary.links?.exceptions,'is-danger')+card('Incomplete clients',t.incompleteClients,summary.links?.management,'is-warn')+card('New clients applied',t.newClientsApplied,summary.links?.management)+card('Exceptions',t.exceptions,summary.links?.exceptions,'is-danger')+'</div>'+
        '<section class="t2m-om-files"><h4>Files processed</h4>'+((summary.files||[]).map(file=>'<div><strong>'+esc(file.name)+'</strong><span>'+esc(file.type||'')+' · '+num(file.validRows)+' valid · '+num(file.exceptions)+' exceptions</span><small>'+esc(file.processedBy||'')+' · '+esc(pretty(file.createdAt))+'</small></div>').join('')||'<div class="t2m-om-empty">No monthly import files found for this month.</div>')+'</section></div>';
      holder.querySelector('[data-om-back]').onclick=openWork;
      holder.querySelectorAll('[data-om-import-link]').forEach(button=>button.onclick=()=>{if(button.dataset.omImportLink)window.location.href=basePath+button.dataset.omImportLink;});
    }catch(error){holder.innerHTML='<div class="t2m-chat-empty"><strong>Could not load import summary</strong><span>'+esc(error.message)+'</span></div>';}
  }

  function simplifyNames(root=document){
    root.querySelectorAll?.('.t2m-task-inbox-people span').forEach(node=>{node.textContent=shortStaff(node.textContent);});
    root.querySelectorAll?.('.t2m-task-inbox-latest-by').forEach(node=>{const parts=node.textContent.split(' · ');if(parts.length>1)node.textContent=shortStaff(parts[0])+' · '+parts.slice(1).join(' · ');});
    root.querySelectorAll?.('.t2m-task-detail-meta span').forEach(node=>{
      const text=String(node.textContent||'');
      if(text.startsWith('From '))node.textContent='From '+shortStaff(text.slice(5));
      if(text.startsWith('To '))node.textContent='To '+shortStaff(text.slice(3));
    });
    root.querySelectorAll?.('.t2m-chat-person-copy strong,.t2m-chat-bubble-head strong').forEach(node=>{if(node.textContent!=='Office'&&node.textContent!=='You')node.textContent=shortStaff(node.textContent);});
    root.querySelectorAll?.('.t2m-task-comment').forEach(comment=>{
      comment.classList.add('t2m-om-thread-bubble');
      const name=comment.querySelector('strong');
      if(name){
        const mine=shortStaff(name.textContent).toLowerCase()===shortStaff(user.full_name||user.name||'').toLowerCase();
        comment.classList.toggle('is-me',mine);
        name.textContent=mine?'You':shortStaff(name.textContent);
      }
    });
    root.querySelector('[data-task-complete]')?.replaceChildren(document.createTextNode('Complete / Close'));
    const composer=root.querySelector('[data-task-comment]');
    if(composer)composer.placeholder='Reply with what you did, or attach a file';
    if(!isManagement)root.querySelectorAll?.('[data-task-context="all"],[data-task-context="team"]').forEach(button=>button.remove());
  }

  function install(){
    ensureHeader();
    if(window.Talk2MeWidgets)window.Talk2MeWidgets.openWork=openWork;
    simplifyNames(document);
    const observer=new MutationObserver(records=>{
      for(const record of records){
        for(const node of record.addedNodes){
          if(node.nodeType===1)simplifyNames(node);
        }
      }
      ensureHeader();
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  window.Talk2MeOperatingModel={openWork,openScorecard,openTargets,openImports};

  // Existing Work launcher registers on window capture. This module is loaded after it,
  // so calendar-home is patched to call this function for Work while Tasks/Messages stay unchanged.
  install();
})();
