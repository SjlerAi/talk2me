(() => {
  'use strict';
  if (window.__talk2meWorkWidgetsLoaded) return;
  window.__talk2meWorkWidgetsLoaded = true;

  const configNode = document.getElementById('talk2me-os-config');
  if (!configNode) return;
  const config = JSON.parse(configNode.textContent || '{}');
  const basePath = String(config.basePath || '');
  const user = config.user || {};

  const palette = ['#7c3aed','#2563eb','#059669','#ea580c','#db2777','#0891b2','#9333ea','#16a34a','#c2410c','#0284c7'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const initials = value => String(value || '?').trim().split(/\s+/).slice(0,2).map(part => part[0] || '').join('').toUpperCase();
  const personColor = id => palette[Math.abs(Number(id) || 0) % palette.length];
  const prettyTime = value => value ? new Date(value).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}) : '';
  const prettyDateTime = value => value ? new Date(value).toLocaleString('en-ZA',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';

  async function jsonFetch(path, options = {}) {
    const response = await fetch(`${basePath}${path}`, {
      credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body && !(options.body instanceof FormData) ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function placeWidget(widget, key) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (Number.isFinite(saved.left)) widget.style.left = `${saved.left}px`;
      if (Number.isFinite(saved.top)) widget.style.top = `${saved.top}px`;
      if (Number.isFinite(saved.width)) widget.style.width = `${saved.width}px`;
      if (Number.isFinite(saved.height)) widget.style.height = `${saved.height}px`;
      if (saved.collapsed) widget.classList.add('is-collapsed');
      if (saved.left || saved.top) { widget.style.right='auto'; widget.style.bottom='auto'; }
    } catch (_) {}
  }

  function saveWidget(widget, key) {
    if (widget.hidden) return;
    const rect = widget.getBoundingClientRect();
    localStorage.setItem(key, JSON.stringify({ left:Math.round(rect.left), top:Math.round(rect.top), width:Math.round(rect.width), height:Math.round(rect.height), collapsed:widget.classList.contains('is-collapsed') }));
  }

  function draggable(widget, handle, key) {
    let resizeTimer;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = widget.getBoundingClientRect();
      const sx = event.clientX, sy = event.clientY;
      handle.setPointerCapture(event.pointerId);
      const move = e => {
        const left = Math.max(4, Math.min(window.innerWidth - widget.offsetWidth - 4, rect.left + e.clientX - sx));
        const top = Math.max(76, Math.min(window.innerHeight - widget.offsetHeight - 4, rect.top + e.clientY - sy));
        Object.assign(widget.style,{left:`${left}px`,top:`${top}px`,right:'auto',bottom:'auto'});
      };
      const done = () => { handle.removeEventListener('pointermove',move); handle.removeEventListener('pointerup',done); handle.removeEventListener('pointercancel',done); saveWidget(widget,key); };
      handle.addEventListener('pointermove',move); handle.addEventListener('pointerup',done); handle.addEventListener('pointercancel',done);
    });
    if (window.ResizeObserver) new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer=setTimeout(()=>saveWidget(widget,key),180); }).observe(widget);
  }

  function makeWidget({id,title,subtitle,icon,key}) {
    let widget = document.getElementById(id);
    if (widget) return widget;
    widget = document.createElement('section');
    widget.id = id;
    widget.className = 't2m-float-widget';
    widget.hidden = true;
    widget.innerHTML = `<header class="t2m-float-widget-head" data-widget-drag><span class="avatar">${esc(icon)}</span><span class="t2m-float-widget-head-copy"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></span><span class="t2m-float-widget-head-actions"><button type="button" data-widget-min title="Minimise">—</button><button type="button" data-widget-close title="Hide">×</button></span></header><div class="t2m-float-widget-body" data-widget-body></div>`;
    document.body.appendChild(widget);
    placeWidget(widget,key);
    draggable(widget,widget.querySelector('[data-widget-drag]'),key);
    widget.querySelector('[data-widget-min]').onclick = () => { widget.classList.toggle('is-collapsed'); saveWidget(widget,key); };
    widget.querySelector('[data-widget-close]').onclick = () => { saveWidget(widget,key); widget.hidden=true; };
    return widget;
  }

  let chatBootstrap = null;
  let chatConversation = 'office';
  let chatTab = 'people';
  let chatPoll = 0;
  let recorder = null;
  let voiceChunks = [];
  let voiceStarted = 0;

  const chatWidget = makeWidget({id:'t2m-messenger-widget',title:'Talk2Me Chat',subtitle:'People, office and system',icon:'●',key:`t2m-chat-widget-${user.id}`});
  const chatBody = chatWidget.querySelector('[data-widget-body]');

  async function loadBootstrap() {
    chatBootstrap = await jsonFetch('/api/uat/chat/bootstrap');
    document.querySelectorAll('[data-badge="notifications"]').forEach(node => {
      node.textContent = String(chatBootstrap.unreadTotal || 0);
      node.hidden = !chatBootstrap.unreadTotal;
    });
    renderChat();
  }

  function conversationByToken(token){ return chatBootstrap?.conversations?.find(item => item.token === token); }

  async function loadMessages(token) {
    chatConversation = token;
    renderChat();
    try {
      const data = await jsonFetch(`/api/uat/chat/messages?conversation=${encodeURIComponent(token)}`);
      const holder = chatBody.querySelector('[data-chat-messages]');
      if (!holder) return;
      holder.innerHTML = data.messages.length ? data.messages.map(message => {
        const mine = Number(message.senderId) === Number(user.id);
        return `<div class="t2m-chat-bubble-row ${mine?'is-me':''}"><article class="t2m-chat-bubble"><div class="t2m-chat-bubble-head"><strong>${esc(mine?'You':message.senderName)}</strong><span>${esc(prettyTime(message.createdAt))}</span></div>${message.type==='voice'?`<audio controls preload="metadata" src="${esc(message.voiceUrl)}"></audio>`:`<p>${esc(message.body)}</p>`}</article></div>`;
      }).join('') : '<div class="t2m-chat-empty"><strong>Start the conversation</strong><span>Keep quick office communication here instead of switching apps.</span></div>';
      holder.scrollTop = holder.scrollHeight;
      await loadBootstrap();
    } catch (error) {
      const holder = chatBody.querySelector('[data-chat-messages]'); if (holder) holder.innerHTML=`<div class="t2m-chat-empty"><strong>Could not load chat</strong><span>${esc(error.message)}</span></div>`;
    }
  }

  async function loadSystem() {
    try {
      const data = await jsonFetch('/api/uat/chat/system');
      const holder = chatBody.querySelector('[data-chat-system]');
      if (!holder) return;
      holder.innerHTML = data.alerts.length ? data.alerts.map(a => `<article class="t2m-chat-system-card ${a.actionRequired?'is-action':''}"><strong>${a.actionRequired?'Action required':'System update'}</strong><p>${esc(a.text)}</p><small>${esc(prettyDateTime(a.createdAt))}</small><div><button type="button" data-system-task="${a.taskId}">Open task</button>${!a.actionRequired?` · <button type="button" data-system-read="${a.id}">Mark read</button>`:''}</div></article>`).join('') : '<div class="t2m-chat-empty"><strong>All clear</strong><span>No unread system alerts.</span></div>';
    } catch (error) {
      const holder = chatBody.querySelector('[data-chat-system]'); if (holder) holder.innerHTML=`<div class="t2m-chat-empty"><strong>Could not load alerts</strong><span>${esc(error.message)}</span></div>`;
    }
  }

  function renderChat() {
    if (!chatBootstrap) { chatBody.innerHTML='<div class="t2m-chat-empty"><strong>Loading chat…</strong></div>'; return; }
    const conv = conversationByToken(chatConversation) || chatBootstrap.conversations[0];
    const direct = chatBootstrap.conversations.filter(c=>c.staffId);
    const office = chatBootstrap.conversations.find(c=>c.token==='office');
    chatBody.innerHTML = `<div class="t2m-chat-shell"><div class="t2m-chat-tabs"><button data-chat-tab="people" class="${chatTab==='people'?'is-active':''}">People <span class="t2m-chat-tab-badge" ${chatBootstrap.unreadTotal?'':'hidden'}>${chatBootstrap.unreadTotal||0}</span></button><button data-chat-tab="office" class="${chatTab==='office'?'is-active':''}">Office</button><button data-chat-tab="system" class="${chatTab==='system'?'is-active':''}">System <span class="t2m-chat-tab-badge" ${chatBootstrap.systemUnread?'':'hidden'}>${chatBootstrap.systemUnread||0}</span></button></div>${chatTab==='system'?'<div class="t2m-chat-system" data-chat-system></div>':`<div class="t2m-chat-main"><aside class="t2m-chat-people">${chatTab==='office'?`<button class="t2m-chat-person is-active" data-chat-person="office"><span class="t2m-chat-person-avatar" style="--person-color:#202832">O</span><span class="t2m-chat-person-copy"><strong>Office</strong><small>${esc(office?.latest?.preview||'Everyone')}</small></span>${office?.unread?`<em>${office.unread}</em>`:''}</button>`:direct.map(c=>`<button class="t2m-chat-person ${c.token===chatConversation?'is-active':''}" data-chat-person="${esc(c.token)}"><span class="t2m-chat-person-avatar" style="--person-color:${personColor(c.staffId)}">${esc(initials(c.name))}</span><span class="t2m-chat-person-copy"><strong>${esc(c.name)}</strong><small>${esc(c.latest?.preview||'No messages yet')}</small></span>${c.unread?`<em>${c.unread}</em>`:''}</button>`).join('')}</aside><section class="t2m-chat-conversation"><header class="t2m-chat-conversation-head"><div><strong>${esc(conv?.name||'Office')}</strong><small>${chatTab==='office'?'Everyone in the office':'Direct conversation'}</small></div></header>${chatTab==='office'?'<div class="t2m-chat-office-note">Office chat is visible to all active staff.</div>':''}<div class="t2m-chat-messages" data-chat-messages><div class="t2m-chat-empty"><strong>Loading…</strong></div></div><footer class="t2m-chat-composer"><div class="t2m-chat-recording" data-recording hidden><span data-recording-time>Recording 0:00</span><button type="button" data-recording-cancel>Cancel</button></div><div class="t2m-chat-compose-row"><button type="button" class="voice" data-chat-voice title="Voice note">🎙</button><textarea rows="1" data-chat-text placeholder="Type a message…"></textarea><button type="button" data-chat-send>Send</button></div></footer></section></div>`}</div>`;

    chatBody.querySelectorAll('[data-chat-tab]').forEach(button=>button.onclick=()=>{chatTab=button.dataset.chatTab;if(chatTab==='office')chatConversation='office';renderChat();if(chatTab==='system')loadSystem();else loadMessages(chatConversation);});
    chatBody.querySelectorAll('[data-chat-person]').forEach(button=>button.onclick=()=>loadMessages(button.dataset.chatPerson));
    chatBody.querySelector('[data-chat-send]')?.addEventListener('click', sendText);
    chatBody.querySelector('[data-chat-text]')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendText();}});
    chatBody.querySelector('[data-chat-voice]')?.addEventListener('click', toggleVoice);
    chatBody.querySelector('[data-recording-cancel]')?.addEventListener('click', cancelVoice);
    chatBody.querySelectorAll('[data-system-task]').forEach(button=>button.onclick=()=>openTask(Number(button.dataset.systemTask)));
    chatBody.querySelectorAll('[data-system-read]').forEach(button=>button.onclick=async()=>{await jsonFetch(`/api/uat/chat/system/${button.dataset.systemRead}/read`,{method:'POST',body:'{}'});await loadBootstrap();chatTab='system';renderChat();loadSystem();});
    if (chatTab !== 'system') setTimeout(()=>loadMessages(chatConversation),0);
  }

  async function sendText() {
    const textarea = chatBody.querySelector('[data-chat-text]');
    const body = String(textarea?.value||'').trim(); if(!body)return;
    textarea.disabled=true;
    try { await jsonFetch('/api/uat/chat/messages',{method:'POST',body:JSON.stringify({conversation:chatConversation,body})}); textarea.value=''; await loadMessages(chatConversation); }
    catch(error){ window.alert(error.message); }
    finally { textarea.disabled=false; textarea.focus(); }
  }

  async function toggleVoice() {
    if (recorder && recorder.state==='recording') { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return window.alert('Voice recording is not supported in this browser.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const preferred = ['audio/webm;codecs=opus','audio/webm','audio/ogg'].find(type=>MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, preferred?{mimeType:preferred}:undefined); voiceChunks=[]; voiceStarted=Date.now();
      recorder.ondataavailable = e=>{if(e.data?.size)voiceChunks.push(e.data);};
      recorder.onstop = async()=>{ stream.getTracks().forEach(track=>track.stop()); const seconds=Math.max(1,Math.round((Date.now()-voiceStarted)/1000)); if(!voiceChunks.length)return; const blob=new Blob(voiceChunks,{type:recorder.mimeType||'audio/webm'}); const form=new FormData(); form.append('conversation',chatConversation); form.append('duration_seconds',String(Math.min(seconds,180))); form.append('voice',blob,'voice-note.webm'); try{await jsonFetch('/api/uat/chat/voice',{method:'POST',body:form});await loadMessages(chatConversation);}catch(error){window.alert(error.message);} recorder=null; };
      recorder.start(); updateRecordingUI();
    } catch(error){ window.alert(`Microphone unavailable: ${error.message}`); }
  }
  function cancelVoice(){ if(recorder&&recorder.state==='recording'){voiceChunks=[];recorder.stop();} }
  function updateRecordingUI(){ const bar=chatBody.querySelector('[data-recording]'); const button=chatBody.querySelector('[data-chat-voice]'); if(!recorder||recorder.state!=='recording'){if(bar)bar.hidden=true;if(button)button.classList.remove('is-recording');return;} if(bar)bar.hidden=false;if(button)button.classList.add('is-recording'); const elapsed=Math.floor((Date.now()-voiceStarted)/1000); const label=chatBody.querySelector('[data-recording-time]'); if(label)label.textContent=`Recording ${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')} · tap mic to send`; if(elapsed>=180)recorder.stop(); else setTimeout(updateRecordingUI,500); }

  async function openChat() {
    chatWidget.hidden=false; chatWidget.classList.remove('is-collapsed');
    try { await loadBootstrap(); if(chatTab==='system')loadSystem(); else loadMessages(chatConversation); } catch(error){ chatBody.innerHTML=`<div class="t2m-chat-empty"><strong>Could not open chat</strong><span>${esc(error.message)}</span></div>`; }
    clearInterval(chatPoll); chatPoll=setInterval(()=>{if(!chatWidget.hidden)loadBootstrap().catch(()=>{});},12000);
  }

  let taskState = {scope:'mine',tasks:[],staff:[],management:false,mode:'list',selected:null};
  const taskWidget = makeWidget({id:'t2m-task-widget',title:'Tasks',subtitle:'Quick work cards',icon:'✓',key:`t2m-task-widget-${user.id}`});
  const taskBody = taskWidget.querySelector('[data-widget-body]');

  async function loadTasks(scope=taskState.scope) {
    taskState.scope=scope;
    const data=await jsonFetch(`/api/uat/tasks?scope=${encodeURIComponent(scope)}`);
    taskState={...taskState,...data,mode:'list'}; renderTasks();
  }

  function renderTasks(){
    if(taskState.mode==='new') return renderTaskNew();
    if(taskState.mode==='detail') return renderTaskDetail(taskState.selected);
    taskBody.innerHTML=`<div class="t2m-task-shell"><div class="t2m-task-toolbar"><button class="${taskState.scope==='mine'?'is-active':''}" data-task-scope="mine">Mine</button><button class="${taskState.scope==='sent'?'is-active':''}" data-task-scope="sent">Sent</button>${taskState.management?`<button class="${taskState.scope==='team'?'is-active':''}" data-task-scope="team">Team</button>`:''}<button class="new-task" data-task-new>+ Task</button></div><div class="t2m-task-content">${taskState.tasks.length?taskState.tasks.map(task=>`<article class="t2m-task-card" style="--task-color:${personColor(task.assigned_to)}"><span class="t2m-task-card-mark"></span><div class="t2m-task-card-body"><div class="t2m-task-card-top"><strong>${esc(task.title)}</strong><em>${esc(task.priority)}</em></div><p>${esc(String(task.message||'').slice(0,150))}</p><div class="t2m-task-card-meta"><span>To: ${esc(task.assigned_name)}</span><span>${task.due_at?`Due ${esc(prettyDateTime(task.due_at))}`:'No due date'}</span>${task.related_client_name?`<span>${esc(task.related_client_name)}</span>`:''}</div><div class="t2m-task-card-actions"><button data-task-open="${task.id}">Open</button></div></div></article>`).join(''):'<div class="t2m-chat-empty"><strong>No active tasks</strong><span>Use + Task to add one without leaving the calendar.</span></div>'}</div></div>`;
    taskBody.querySelectorAll('[data-task-scope]').forEach(button=>button.onclick=()=>loadTasks(button.dataset.taskScope));
    taskBody.querySelector('[data-task-new]').onclick=()=>{taskState.mode='new';renderTasks();};
    taskBody.querySelectorAll('[data-task-open]').forEach(button=>button.onclick=()=>openTask(Number(button.dataset.taskOpen)));
  }

  function renderTaskNew(prefill={}){
    const defaultDue=prefill.date?`${prefill.date}T09:00`:'';
    taskBody.innerHTML=`<form class="t2m-task-form" data-task-form><h3>New task</h3><label>Assign to<select name="assigned_to" required><option value="">Choose person</option>${(taskState.staff||[]).filter(s=>Number(s.id)!==0).map(s=>`<option value="${s.id}">${esc(s.full_name)}</option>`).join('')}</select></label><label>Title<input name="title" maxlength="180" required placeholder="What needs doing?"></label><label>Task<textarea name="message" required placeholder="Short clear instruction"></textarea></label><div class="t2m-task-form-grid"><label>Due<input type="datetime-local" name="due_at" value="${esc(defaultDue)}"></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div><div class="t2m-task-form-actions"><button type="button" data-task-cancel>Cancel</button><button type="submit" class="primary">Create task</button></div></form>`;
    const form=taskBody.querySelector('[data-task-form]');
    form.onsubmit=async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(form).entries());try{await jsonFetch('/api/uat/tasks',{method:'POST',body:JSON.stringify(values)});await loadTasks('mine');window.dispatchEvent(new Event('workspace:refresh'));}catch(error){window.alert(error.message);}};
    taskBody.querySelector('[data-task-cancel]').onclick=()=>{taskState.mode='list';renderTasks();};
  }

  async function openTask(id){
    taskWidget.hidden=false;taskWidget.classList.remove('is-collapsed');
    try{const data=await jsonFetch(`/api/uat/tasks/${id}`);taskState.mode='detail';taskState.selected=data;renderTasks();}catch(error){taskBody.innerHTML=`<div class="t2m-chat-empty"><strong>Could not open task</strong><span>${esc(error.message)}</span></div>`;}
  }

  function renderTaskDetail(data){
    if(!data?.task)return;
    const t=data.task,p=data.permissions||{};
    taskBody.innerHTML=`<div class="t2m-task-detail"><button class="t2m-task-detail-back" data-task-back>← Back to tasks</button><article class="t2m-task-detail-card"><h3>${esc(t.title)}</h3><p class="lead">${esc(t.message)}</p><div class="t2m-task-detail-meta"><span>From ${esc(t.created_by_name)}</span><span>To ${esc(t.assigned_name)}</span><span>${esc(t.priority)}</span><span>${t.due_at?`Due ${esc(prettyDateTime(t.due_at))}`:'No due date'}</span></div>${p.canUpdate?`<div class="t2m-task-status-actions"><button data-task-status="in_progress">Start / In progress</button></div><div class="t2m-task-complete"><textarea data-task-completion placeholder="What was completed?"></textarea><button data-task-complete>Complete task</button></div>`:''}${p.canApprove?`<div class="t2m-task-status-actions"><button class="primary" data-task-decision="accept">Accept & archive</button><button data-task-decision="return">Return for more work</button></div>`:''}<section class="t2m-task-comments"><h4>Updates</h4>${(data.comments||[]).map(c=>`<div class="t2m-task-comment"><strong>${esc(c.full_name)}</strong><small>${esc(prettyDateTime(c.created_at))}</small><p>${esc(c.comment)}</p></div>`).join('')}${p.canComment?'<div class="t2m-task-comment-compose"><input data-task-comment placeholder="Add quick update"><button data-task-comment-send>Send</button></div>':''}</section></article></div>`;
    taskBody.querySelector('[data-task-back]').onclick=()=>loadTasks(taskState.scope);
    taskBody.querySelectorAll('[data-task-status]').forEach(button=>button.onclick=async()=>{await jsonFetch(`/api/uat/tasks/${t.id}/status`,{method:'POST',body:JSON.stringify({status:button.dataset.taskStatus})});await openTask(t.id);window.dispatchEvent(new Event('workspace:refresh'));});
    taskBody.querySelector('[data-task-complete]')?.addEventListener('click',async()=>{const note=taskBody.querySelector('[data-task-completion]').value.trim();try{await jsonFetch(`/api/uat/tasks/${t.id}/status`,{method:'POST',body:JSON.stringify({status:'completed',completion_note:note})});await loadTasks(taskState.scope);window.dispatchEvent(new Event('workspace:refresh'));}catch(error){window.alert(error.message);}});
    taskBody.querySelectorAll('[data-task-decision]').forEach(button=>button.onclick=async()=>{const action=button.dataset.taskDecision;let reason='';if(action==='return'){reason=window.prompt('What still needs to be done?')||'';if(!reason)return;}try{await jsonFetch(`/api/uat/tasks/${t.id}/decision`,{method:'POST',body:JSON.stringify({action,reason})});await loadTasks(taskState.scope);window.dispatchEvent(new Event('workspace:refresh'));}catch(error){window.alert(error.message);}});
    taskBody.querySelector('[data-task-comment-send]')?.addEventListener('click',async()=>{const input=taskBody.querySelector('[data-task-comment]');const comment=input.value.trim();if(!comment)return;await jsonFetch(`/api/uat/tasks/${t.id}/comments`,{method:'POST',body:JSON.stringify({comment})});await openTask(t.id);});
  }

  async function openTaskWidget(prefill={}){
    taskWidget.hidden=false;taskWidget.classList.remove('is-collapsed');
    try{const data=await jsonFetch('/api/uat/tasks?scope=mine');taskState={...taskState,...data,scope:'mine'};if(prefill.new){taskState.mode='new';renderTaskNew(prefill);}else{taskState.mode='list';renderTasks();}}catch(error){taskBody.innerHTML=`<div class="t2m-chat-empty"><strong>Could not open tasks</strong><span>${esc(error.message)}</span></div>`;}
  }

  window.Talk2MeWidgets={openChat,openTasks:openTaskWidget,openTask};

  window.addEventListener('click',event=>{
    const bell=event.target.closest?.('[data-os-app="notifications"]');
    if(bell){event.preventDefault();event.stopImmediatePropagation();openChat();return;}
    const taskAdd=event.target.closest?.('[data-home-add-task]');
    if(taskAdd){event.preventDefault();event.stopImmediatePropagation();openTaskWidget({new:true,date:new URLSearchParams(location.search).get('date')||undefined});return;}
    const openCalendarTask=event.target.closest?.('[data-open-calendar-item]');
    if(openCalendarTask&&String(openCalendarTask.dataset.openCalendarItem||'').startsWith('task:')){event.preventDefault();event.stopImmediatePropagation();openTask(Number(String(openCalendarTask.dataset.openCalendarItem).split(':')[1]));return;}
    const taskApp=event.target.closest?.('[data-os-app="tasks"],[data-os-app="messages"]');
    if(taskApp){event.preventDefault();event.stopImmediatePropagation();taskApp.dataset.osApp==='messages'?openChat():openTaskWidget();}
  },true);

  loadBootstrap().catch(()=>{});
})();