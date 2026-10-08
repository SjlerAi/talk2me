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
  const dateTimeInput = value => { if(!value)return ''; const date=new Date(value); if(Number.isNaN(date.getTime()))return String(value).replace(' ','T').slice(0,16); const local=new Date(date.getTime()-date.getTimezoneOffset()*60000); return local.toISOString().slice(0,16); };
  let floatingWidgetZ = 30000;
  const taskFileAccept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.rtf,.jpg,.jpeg,.png,.webp';

  async function jsonFetch(path, options={}) {
    const response = await fetch(`${basePath}${path}`, {
      credentials:'same-origin', cache:'no-store',
      headers:{Accept:'application/json', ...(options.body && !(options.body instanceof FormData) ? {'Content-Type':'application/json'} : {}), ...(options.headers||{})},
      ...options
    });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function restore(widget,key,size={}){
    try{
      const saved=JSON.parse(localStorage.getItem(key)||'{}');
      const mobile=window.matchMedia('(max-width:620px)').matches;
      if(!mobile){
        const maxWidth=Math.max(320,window.innerWidth-24);
        const maxHeight=Math.max(360,window.innerHeight-96);
        const minWidth=Math.min(Number(size.minWidth)||380,maxWidth);
        const minHeight=Math.min(Number(size.minHeight)||460,maxHeight);
        const wantedWidth=Number.isFinite(saved.width)?saved.width:(Number(size.width)||460);
        const wantedHeight=Number.isFinite(saved.height)?saved.height:(Number(size.height)||620);
        const width=Math.min(maxWidth,Math.max(minWidth,wantedWidth));
        const height=Math.min(maxHeight,Math.max(minHeight,wantedHeight));
        widget.style.width=`${Math.round(width)}px`;
        widget.style.height=`${Math.round(height)}px`;
        if(Number.isFinite(saved.left)){
          widget.style.left=`${Math.round(Math.max(4,Math.min(saved.left,window.innerWidth-width-4)))}px`;
          widget.style.right='auto';
        }
        if(Number.isFinite(saved.top)){
          widget.style.top=`${Math.round(Math.max(82,Math.min(saved.top,window.innerHeight-height-4)))}px`;
          widget.style.bottom='auto';
        }
      }
      if(Number.isFinite(saved.width)||Number.isFinite(saved.height))widget.dataset.userSized='1';
      if(saved.collapsed)widget.classList.add('is-collapsed');
    }catch(_){}
  }
  function widgetBoundsForSave(widget){
    if(widget.classList.contains('is-maximized')&&widget.dataset.restoreBounds){
      try{return JSON.parse(widget.dataset.restoreBounds);}catch(_){}
    }
    const r=widget.getBoundingClientRect();
    return {left:r.left,top:r.top,width:r.width,height:r.height};
  }
  function remember(widget,key){
    if(widget.hidden)return;
    const r=widgetBoundsForSave(widget);
    localStorage.setItem(key,JSON.stringify({
      left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height),
      collapsed:widget.classList.contains('is-collapsed')
    }));
  }
  function bringWidgetToFront(widget){
    if(!widget)return;
    widget.style.zIndex=String(++floatingWidgetZ);
    document.querySelectorAll('.t2m-float-widget').forEach(item=>item.classList.toggle('is-widget-focused',item===widget));
  }
  function showWidget(widget){
    widget.hidden=false;
    widget.classList.remove('is-collapsed');
    bringWidgetToFront(widget);
  }
  function fitWidgetMode(widget,key,size={}){
    if(!widget||widget.dataset.userSized==='1'||widget.classList.contains('is-maximized')||widget.classList.contains('is-collapsed'))return;
    if(window.matchMedia('(max-width:620px)').matches)return;
    const maxWidth=Math.max(360,window.innerWidth-24);
    const maxHeight=Math.max(360,window.innerHeight-92);
    const width=Math.min(maxWidth,Math.max(Number(size.minWidth)||520,Number(size.width)||720));
    const height=Math.min(maxHeight,Math.max(Number(size.minHeight)||360,Number(size.height)||600));
    widget.style.width=`${Math.round(width)}px`;
    widget.style.height=`${Math.round(height)}px`;
    const rect=widget.getBoundingClientRect();
    if(rect.right>window.innerWidth-4)widget.style.left=`${Math.max(4,window.innerWidth-width-4)}px`;
    if(rect.bottom>window.innerHeight-4)widget.style.top=`${Math.max(76,window.innerHeight-height-4)}px`;
    widget.style.right='auto';widget.style.bottom='auto';
  }
  function toggleMaximize(widget,key){
    bringWidgetToFront(widget);
    const button=widget.querySelector('[data-widget-max]');
    if(widget.classList.contains('is-maximized')){
      widget.classList.remove('is-maximized');
      try{
        const r=JSON.parse(widget.dataset.restoreBounds||'{}');
        if(Number.isFinite(r.left))widget.style.left=`${r.left}px`;
        if(Number.isFinite(r.top))widget.style.top=`${r.top}px`;
        if(Number.isFinite(r.width))widget.style.width=`${r.width}px`;
        if(Number.isFinite(r.height))widget.style.height=`${r.height}px`;
        widget.style.right='auto';widget.style.bottom='auto';
      }catch(_){}
      delete widget.dataset.restoreBounds;
      if(button){button.textContent='□';button.title='Maximise';}
      remember(widget,key);
      return;
    }
    if(widget.classList.contains('is-collapsed'))widget.classList.remove('is-collapsed');
    const r=widget.getBoundingClientRect();
    widget.dataset.restoreBounds=JSON.stringify({left:r.left,top:r.top,width:r.width,height:r.height});
    widget.classList.add('is-maximized');
    if(button){button.textContent='❐';button.title='Restore';}
  }
  function enableDrag(widget,handle,key){
    let resizeTimer;
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('button')||widget.classList.contains('is-maximized'))return;
      const r=widget.getBoundingClientRect(),sx=event.clientX,sy=event.clientY;
      handle.setPointerCapture(event.pointerId);
      const move=e=>{
        const l=Math.max(4,Math.min(window.innerWidth-widget.offsetWidth-4,r.left+e.clientX-sx));
        const t=Math.max(76,Math.min(window.innerHeight-widget.offsetHeight-4,r.top+e.clientY-sy));
        Object.assign(widget.style,{left:`${l}px`,top:`${t}px`,right:'auto',bottom:'auto'});
      };
      const done=()=>{
        handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',done);handle.removeEventListener('pointercancel',done);
        remember(widget,key);
      };
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',done);handle.addEventListener('pointercancel',done);
    });
    handle.addEventListener('dblclick',event=>{if(event.target.closest('button'))return;toggleMaximize(widget,key);});
    if(window.ResizeObserver)new ResizeObserver(()=>{
      if(widget.classList.contains('is-maximized'))return;
      clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>remember(widget,key),150);
    }).observe(widget);
  }
  function enableResize(widget,grip,key,size={}){
    if(!grip)return;
    grip.addEventListener('pointerdown',event=>{
      if(event.button!==0||widget.classList.contains('is-collapsed')||widget.classList.contains('is-maximized'))return;
      if(window.matchMedia('(max-width:620px)').matches)return;
      event.preventDefault();event.stopPropagation();
      const start=widget.getBoundingClientRect();
      const sx=event.clientX,sy=event.clientY;
      const minWidth=Math.min(Number(size.minWidth)||380,window.innerWidth-24);
      const minHeight=Math.min(Number(size.minHeight)||460,window.innerHeight-96);
      grip.setPointerCapture(event.pointerId);
      const move=e=>{
        const maxWidth=Math.max(minWidth,window.innerWidth-start.left-4);
        const maxHeight=Math.max(minHeight,window.innerHeight-start.top-4);
        const width=Math.max(minWidth,Math.min(maxWidth,start.width+(e.clientX-sx)));
        const height=Math.max(minHeight,Math.min(maxHeight,start.height+(e.clientY-sy)));
        widget.style.width=`${Math.round(width)}px`;
        widget.style.height=`${Math.round(height)}px`;
        widget.style.right='auto';widget.style.bottom='auto';
      };
      const done=()=>{
        grip.removeEventListener('pointermove',move);
        grip.removeEventListener('pointerup',done);
        grip.removeEventListener('pointercancel',done);
        widget.dataset.userSized='1';
        remember(widget,key);
      };
      grip.addEventListener('pointermove',move);
      grip.addEventListener('pointerup',done);
      grip.addEventListener('pointercancel',done);
    });
  }

  function makeWidget({id,title,subtitle,icon,key,size={}}){
    let widget=document.getElementById(id);if(widget)return widget;
    widget=document.createElement('section');widget.id=id;widget.className='t2m-float-widget';widget.hidden=true;
    widget.innerHTML=`<header class="t2m-float-widget-head" data-widget-drag><span class="avatar">${esc(icon)}</span><span class="t2m-float-widget-head-copy"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></span><span class="t2m-float-widget-head-actions"><button type="button" data-widget-min title="Minimise">—</button><button type="button" data-widget-max title="Maximise">□</button><button type="button" data-widget-close title="Hide">×</button></span></header><div class="t2m-float-widget-body" data-widget-body></div><span class="t2m-widget-resize-grip" data-widget-resize title="Drag to resize" aria-hidden="true"></span>`;
    document.body.appendChild(widget);restore(widget,key,size);enableDrag(widget,widget.querySelector('[data-widget-drag]'),key);enableResize(widget,widget.querySelector('[data-widget-resize]'),key,size);widget.addEventListener('pointerdown',()=>bringWidgetToFront(widget),true);
    widget.querySelector('[data-widget-min]').onclick=()=>{
      if(widget.classList.contains('is-maximized'))toggleMaximize(widget,key);
      widget.classList.toggle('is-collapsed');remember(widget,key);
    };
    widget.querySelector('[data-widget-max]').onclick=()=>toggleMaximize(widget,key);
    widget.querySelector('[data-widget-close]').onclick=()=>{remember(widget,key);widget.hidden=true;};
    return widget;
  }

  const workWidgetKey=`t2m-work-widget-v2-${user.id}`;
  const workWidget=makeWidget({id:'t2m-task-widget',title:'Work',subtitle:'Tasks, messages, files & follow-ups',icon:'✓',key:workWidgetKey,size:{width:840,height:700,minWidth:560,minHeight:420}});
  const workBody=workWidget.querySelector('[data-widget-body]');
  const chatWidget=workWidget;
  const chatBody=workBody;
  const workHead=workWidget.querySelector('.t2m-float-widget-head');
  const workHeadActions=workWidget.querySelector('.t2m-float-widget-head-actions');
  const workHeadNav=document.createElement('nav');
  workHeadNav.className='t2m-work-head-nav';
  workHeadNav.setAttribute('aria-label','Work sections');
  workHeadNav.innerHTML=`
    <button type="button" data-work-head="inbox"><span>✓</span><strong>Inbox</strong></button>
    <button type="button" data-work-head="messages"><span>●</span><strong>Messages</strong><b data-work-message-count hidden>0</b></button>
    <button type="button" class="new-task" data-work-head="new"><span>＋</span><strong>Task</strong></button>`;
  workHead.insertBefore(workHeadNav,workHeadActions);
  workHeadNav.addEventListener('pointerdown',event=>event.stopPropagation());
  workHeadNav.addEventListener('click',event=>{
    const button=event.target.closest('[data-work-head]');
    if(!button)return;
    event.preventDefault();event.stopPropagation();
    const next=button.dataset.workHead;
    if(next==='messages')openChat();
    else if(next==='new')openTaskWidget({new:true});
    else openTaskWidget();
  });

  let workMode='inbox';
  let chatBootstrap=null,chatConversation='office',chatTab='people',chatMessages=[],chatPoll=null,recorder=null,voiceChunks=[],voiceStarted=0,cancelRecording=false;

  function renderWorkHeader(active){
    workMode=active;
    workHeadNav.querySelectorAll('[data-work-head]').forEach(button=>button.classList.toggle('is-active',button.dataset.workHead===active));
    const messageCount=Number(chatBootstrap?.unreadTotal||0);
    const badge=workHeadNav.querySelector('[data-work-message-count]');
    if(badge){badge.textContent=String(messageCount);badge.hidden=!messageCount;}
  }
  const conversationByToken=token=>chatBootstrap?.conversations?.find(item=>item.token===token);

  function paintWorkCount(){
    const taskAttention=Number(taskState?.counts?.attention||config.status?.taskCount||0);
    const messageUnread=Number(chatBootstrap?.unreadTotal||0);
    const total=taskAttention+messageUnread;
    document.querySelectorAll('[data-badge="work"]').forEach(node=>{
      node.textContent=String(total);
      node.hidden=!total;
    });
  }
  async function refreshBootstrap(){chatBootstrap=await jsonFetch('/api/uat/chat/bootstrap');paintWorkCount();return chatBootstrap;}

  function renderMessageHtml(){if(!chatMessages.length)return '<div class="t2m-chat-empty"><strong>Start the conversation</strong><span>Quick, informal office communication stays here.</span></div>';return chatMessages.map(message=>{const mine=Number(message.senderId)===Number(user.id);return `<div class="t2m-chat-bubble-row ${mine?'is-me':''}"><article class="t2m-chat-bubble"><div class="t2m-chat-bubble-head"><strong>${esc(mine?'You':message.senderName)}</strong><span>${esc(prettyTime(message.createdAt))}</span></div>${message.type==='voice'?`<audio controls preload="metadata" src="${esc(message.voiceUrl)}"></audio>`:`<p>${esc(message.body)}</p>`}${message.relatedTaskId?`<button type="button" class="t2m-chat-task-link" data-chat-related-task="${Number(message.relatedTaskId)}">Open follow-up task</button>`:''}</article></div>`;}).join('');}

  function renderChatShell(){
    renderWorkHeader('messages');
    if(!chatBootstrap){chatBody.innerHTML='<div class="t2m-chat-empty"><strong>Loading chat…</strong></div>';return;}
    const conv=conversationByToken(chatConversation)||chatBootstrap.conversations[0];
    const direct=chatBootstrap.conversations.filter(c=>c.staffId);
    const office=chatBootstrap.conversations.find(c=>c.token==='office');
    chatBody.innerHTML=`<div class="t2m-chat-shell"><div class="t2m-chat-tabs"><button data-chat-tab="people" class="${chatTab==='people'?'is-active':''}">People <span class="t2m-chat-tab-badge" ${chatBootstrap.unreadTotal?'':'hidden'}>${chatBootstrap.unreadTotal||0}</span></button><button data-chat-tab="office" class="${chatTab==='office'?'is-active':''}">Office</button><button data-chat-tab="system" class="${chatTab==='system'?'is-active':''}">System <span class="t2m-chat-tab-badge" ${chatBootstrap.systemUnread?'':'hidden'}>${chatBootstrap.systemUnread||0}</span></button></div>${chatTab==='system'?'<div class="t2m-chat-system" data-chat-system></div>':`<div class="t2m-chat-main"><aside class="t2m-chat-people">${chatTab==='office'?`<button class="t2m-chat-person is-active" data-chat-person="office"><span class="t2m-chat-person-avatar" style="--person-color:#202832">O</span><span class="t2m-chat-person-copy"><strong>Office</strong><small>${esc(office?.latest?.preview||'Everyone')}</small></span>${office?.unread?`<em>${office.unread}</em>`:''}</button>`:direct.map(c=>`<button class="t2m-chat-person ${c.token===chatConversation?'is-active':''}" data-chat-person="${esc(c.token)}"><span class="t2m-chat-person-avatar" style="--person-color:${personColor(c.staffId)}">${esc(initials(c.name))}</span><span class="t2m-chat-person-copy"><strong>${esc(c.name)}</strong><small>${esc(c.latest?.preview||'No messages yet')}</small></span>${c.unread?`<em>${c.unread}</em>`:''}</button>`).join('')}</aside><section class="t2m-chat-conversation"><header class="t2m-chat-conversation-head"><div><strong>${esc(conv?.name||'Office')}</strong><small>${chatTab==='office'?'Everyone in the office':'Direct conversation'}</small></div></header>${chatTab==='office'?'<div class="t2m-chat-office-note">Office chat is visible to all active staff.</div>':''}<div class="t2m-chat-messages" data-chat-messages>${renderMessageHtml()}</div><footer class="t2m-chat-composer"><div class="t2m-chat-recording" data-recording hidden><span data-recording-time>Recording 0:00</span><button type="button" data-recording-cancel>Cancel</button></div><div class="t2m-chat-compose-row"><button type="button" class="voice" data-chat-voice title="Voice note">🎙</button><textarea rows="1" data-chat-text placeholder="Type a message…"></textarea><button type="button" data-chat-send>Send</button></div></footer></section></div>`}</div>`;
    bindChatControls();
  }

  function bindChatControls(){
    chatBody.querySelectorAll('[data-chat-tab]').forEach(button=>button.onclick=async()=>{chatTab=button.dataset.chatTab;if(chatTab==='office')chatConversation='office';chatMessages=[];renderChatShell();if(chatTab==='system')await loadSystem();else await loadConversation(chatConversation);});
    chatBody.querySelectorAll('[data-chat-person]').forEach(button=>button.onclick=()=>loadConversation(button.dataset.chatPerson));
    chatBody.querySelector('[data-chat-send]')?.addEventListener('click',sendText);
    chatBody.querySelector('[data-chat-text]')?.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendText();}});
    chatBody.querySelector('[data-chat-voice]')?.addEventListener('click',toggleVoice);
    chatBody.querySelector('[data-recording-cancel]')?.addEventListener('click',cancelVoice);
    chatBody.querySelectorAll('[data-system-task]').forEach(button=>button.onclick=()=>openTask(Number(button.dataset.systemTask)));
    chatBody.querySelectorAll('[data-chat-related-task]').forEach(button=>button.onclick=()=>openTask(Number(button.dataset.chatRelatedTask)));
    chatBody.querySelectorAll('[data-system-read]').forEach(button=>button.onclick=async()=>{await jsonFetch(`/api/uat/chat/system/${button.dataset.systemRead}/read`,{method:'POST',body:'{}'});await refreshBootstrap();renderChatShell();await loadSystem();});
  }

  async function loadConversation(token){
    chatConversation=token;
    const data=await jsonFetch(`/api/uat/chat/messages?conversation=${encodeURIComponent(token)}`);
    chatMessages=data.messages||[];
    await refreshBootstrap();
    renderChatShell();
    const holder=chatBody.querySelector('[data-chat-messages]');if(holder)holder.scrollTop=holder.scrollHeight;
  }

  async function loadSystem(){
    const data=await jsonFetch('/api/uat/chat/system');
    const holder=chatBody.querySelector('[data-chat-system]');if(!holder)return;
    holder.innerHTML=data.alerts.length?data.alerts.map(a=>`<article class="t2m-chat-system-card ${a.actionRequired?'is-action':''}"><strong>${a.actionRequired?'Action required':'System update'}</strong><p>${esc(a.text)}</p><small>${esc(prettyDateTime(a.createdAt))}</small><div><button type="button" data-system-task="${a.taskId}">Open task</button>${!a.actionRequired?` · <button type="button" data-system-read="${a.id}">Mark read</button>`:''}</div></article>`).join(''):'<div class="t2m-chat-empty"><strong>All clear</strong><span>No unread system alerts.</span></div>';
    bindChatControls();
  }

  async function sendText(){const textarea=chatBody.querySelector('[data-chat-text]');const body=String(textarea?.value||'').trim();if(!body)return;textarea.disabled=true;try{await jsonFetch('/api/uat/chat/messages',{method:'POST',body:JSON.stringify({conversation:chatConversation,body})});textarea.value='';await loadConversation(chatConversation);}catch(error){window.alert(error.message);}finally{textarea.disabled=false;textarea.focus();}}

  async function toggleVoice(){
    if(recorder&&recorder.state==='recording'){cancelRecording=false;recorder.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return window.alert('Voice recording is not supported in this browser.');
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const preferred=['audio/webm;codecs=opus','audio/webm','audio/ogg'].find(type=>MediaRecorder.isTypeSupported(type));recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);voiceChunks=[];voiceStarted=Date.now();cancelRecording=false;recorder.ondataavailable=e=>{if(e.data?.size)voiceChunks.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(track=>track.stop());const wasCancelled=cancelRecording;const chunks=voiceChunks.slice();const mime=recorder?.mimeType||'audio/webm';const seconds=Math.max(1,Math.round((Date.now()-voiceStarted)/1000));recorder=null;voiceChunks=[];updateRecordingUI();if(wasCancelled||!chunks.length)return;const blob=new Blob(chunks,{type:mime});const form=new FormData();form.append('conversation',chatConversation);form.append('duration_seconds',String(Math.min(seconds,180)));form.append('voice',blob,'voice-note.webm');try{await jsonFetch('/api/uat/chat/voice',{method:'POST',body:form});await loadConversation(chatConversation);}catch(error){window.alert(error.message);}};recorder.start();updateRecordingUI();}catch(error){window.alert(`Microphone unavailable: ${error.message}`);}
  }
  function cancelVoice(){if(recorder&&recorder.state==='recording'){cancelRecording=true;recorder.stop();}}
  function updateRecordingUI(){const bar=chatBody.querySelector('[data-recording]'),button=chatBody.querySelector('[data-chat-voice]');if(!recorder||recorder.state!=='recording'){if(bar)bar.hidden=true;if(button)button.classList.remove('is-recording');return;}if(bar)bar.hidden=false;if(button)button.classList.add('is-recording');const elapsed=Math.floor((Date.now()-voiceStarted)/1000),label=chatBody.querySelector('[data-recording-time]');if(label)label.textContent=`Recording ${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')} · tap mic to send`;if(elapsed>=180){cancelRecording=false;recorder.stop();}else setTimeout(updateRecordingUI,500);}

  async function openChat(){renderWorkHeader('messages');showWidget(workWidget);try{await refreshBootstrap();chatMessages=[];renderChatShell();if(chatTab==='system')await loadSystem();else await loadConversation(chatConversation);}catch(error){chatBody.innerHTML=`<div class="t2m-chat-empty"><strong>Could not open chat</strong><span>${esc(error.message)}</span></div>`;}clearInterval(chatPoll);chatPoll=setInterval(async()=>{if(chatWidget.hidden||workMode!=='messages')return;try{await refreshBootstrap();if(chatTab!=='system')await loadConversation(chatConversation);else{renderChatShell();await loadSystem();}}catch(_){}},12000);}


  function formatTaskBytes(bytes){
    const value=Number(bytes||0);
    if(value<1024)return `${value} B`;
    if(value<1024*1024)return `${(value/1024).toFixed(value<10*1024?1:0)} KB`;
    return `${(value/(1024*1024)).toFixed(1)} MB`;
  }
  function taskAttachmentsHtml(items=[]){
    if(!items.length)return '';
    return `<div class="t2m-task-attachment-list">${items.map(file=>`<a class="t2m-task-attachment" href="${esc(file.url)}" target="_blank" rel="noopener"><span>📎</span><strong>${esc(file.name)}</strong><small>${esc(formatTaskBytes(file.bytes))}</small></a>`).join('')}</div>`;
  }
  function bindTaskFilePicker(root){
    if(!root)return;
    const input=root.querySelector('[data-task-files]');
    const choose=root.querySelector('[data-task-files-choose]');
    const list=root.querySelector('[data-task-files-list]');
    if(!input||!choose||!list)return;
    const render=()=>{
      const files=[...input.files];
      list.innerHTML=files.map((file,index)=>`<span class="t2m-task-file-chip"><b>${esc(file.name)}</b><small>${esc(formatTaskBytes(file.size))}</small><button type="button" data-task-file-remove="${index}" aria-label="Remove ${esc(file.name)}">×</button></span>`).join('');
      list.hidden=!files.length;
      list.querySelectorAll('[data-task-file-remove]').forEach(button=>button.onclick=()=>{
        const removeIndex=Number(button.dataset.taskFileRemove);
        const transfer=new DataTransfer();
        files.forEach((file,index)=>{if(index!==removeIndex)transfer.items.add(file);});
        input.files=transfer.files;
        render();
      });
    };
    choose.onclick=()=>input.click();
    input.onchange=render;
    render();
  }

  const taskWidgetKey=workWidgetKey;
  const taskWidget=workWidget;
  const taskBody=workBody;
  let taskState={scope:'mine',view:'latest',filter:'all',counts:{latest:0,urgent:0,attention:0},tasks:[],staff:[],management:false,mode:'list',selected:null};

  async function loadTasks(options={}){
    const next=typeof options==='string'?{scope:options}:options;
    const scope=next.scope||taskState.scope||'mine';
    const view=next.view||taskState.view||'latest';
    const filter=next.filter||taskState.filter||'all';
    const query=new URLSearchParams({scope,view,filter});
    const data=await jsonFetch(`/api/uat/tasks?${query.toString()}`);
    taskState={...taskState,...data,scope:data.scope||scope,view:data.view||view,filter:data.filter||filter,mode:'list'};
    renderTaskList();
  }

  function taskInboxBadge(task){
    if(Number(task.action_count||0)>0)return {label:'NEEDS ACTION',kind:'attention'};
    if(Number(task.unread_count||0)>0||task.status==='unread')return {label:'NEW',kind:'new'};
    if(Number(task.is_overdue||0)>0)return {label:'OVERDUE',kind:'overdue'};
    if(Number(task.due_today||0)>0)return {label:'DUE TODAY',kind:'today'};
    if(task.status==='completed'&&task.workflow_state==='awaiting_sender_ack')return {label:'COMPLETED · APPROVAL',kind:'attention'};
    if(task.workflow_state==='returned')return {label:'RETURNED',kind:'attention'};
    return {label:String(task.priority||'normal').toUpperCase(),kind:String(task.priority||'normal')};
  }

  function taskInboxPreview(task){
    const update=String(task.latest_update||'').trim();
    if(update&&update!=='Task created')return update;
    return String(task.message||'').trim();
  }

  function taskInboxTime(task){
    const value=task.last_activity_at||task.latest_update_at||task.created_at;
    return value?prettyDateTime(value):'';
  }

  function renderTaskList(){
    renderWorkHeader('inbox');
    paintWorkCount();
    fitWidgetMode(taskWidget,taskWidgetKey,{width:840,height:700,minWidth:560,minHeight:420});
    const counts=taskState.counts||{};
    const emptyTitle=taskState.filter==='completed'
      ? 'No completed tasks'
      : taskState.view==='urgent'
        ? 'Nothing urgent'
        : taskState.view==='attention'
          ? 'Nothing needs your attention'
          : 'No active tasks';
    const emptyCopy=taskState.filter==='completed'
      ? 'Completed work will appear here with its completion date.'
      : taskState.view==='urgent'
        ? 'Overdue, due-today, urgent and returned work will appear here.'
        : taskState.view==='attention'
          ? 'New assignments, replies, returns and approvals will appear here.'
          : 'New and recently active work will appear here.';

    const historyValues=new Set(['new','old','7days','14days','month','history_all']);
    const statusValues=new Set(['all','today','week','overdue','upcoming','completed']);
    const historyValue=historyValues.has(taskState.filter)?taskState.filter:'';
    const statusValue=taskState.scope==='sent'?'sent':statusValues.has(taskState.filter)?taskState.filter:'all';

    const compactFilters=`
      <div class="t2m-work-filterbar" aria-label="Work inbox filters">
        <div class="t2m-task-context-switch" aria-label="Whose work">
          <button class="${taskState.scope==='mine'?'is-active':''}" data-task-context="mine">Mine</button>
          ${taskState.management
            ? `<button class="${taskState.scope==='team'?'is-active':''}" data-task-context="team">Team</button>`
            : `<button class="${taskState.scope==='all'?'is-active':''}" data-task-context="all">All</button>`}
        </div>
        <div class="t2m-work-view-switch" role="tablist" aria-label="Priority view">
          <button class="${taskState.view==='latest'&&taskState.filter!=='completed'?'is-active':''}" data-task-view="latest"><span>Latest</span><b>${Number(counts.latest||0)}</b></button>
          <button class="${taskState.view==='urgent'?'is-active':''}" data-task-view="urgent"><span>Urgent</span><b>${Number(counts.urgent||0)}</b></button>
          <button class="${taskState.view==='attention'?'is-active':''}" data-task-view="attention"><span>Needs attention</span><b>${Number(counts.attention||0)}</b></button>
        </div>
        <select data-task-history aria-label="History period">
          <option value="" ${historyValue===''?'selected':''}>History</option>
          <option value="new" ${historyValue==='new'?'selected':''}>New</option>
          <option value="old" ${historyValue==='old'?'selected':''}>Old</option>
          <option value="7days" ${historyValue==='7days'?'selected':''}>7 days</option>
          <option value="14days" ${historyValue==='14days'?'selected':''}>14 days</option>
          <option value="month" ${historyValue==='month'?'selected':''}>Month</option>
          <option value="history_all" ${historyValue==='history_all'?'selected':''}>All history</option>
        </select>
        <select data-task-status-filter aria-label="Status filter">
          <option value="all" ${statusValue==='all'?'selected':''}>Active</option>
          <option value="today" ${statusValue==='today'?'selected':''}>Today</option>
          <option value="week" ${statusValue==='week'?'selected':''}>This week</option>
          <option value="overdue" ${statusValue==='overdue'?'selected':''}>Overdue</option>
          <option value="upcoming" ${statusValue==='upcoming'?'selected':''}>Upcoming</option>
          <option value="completed" ${statusValue==='completed'?'selected':''}>Completed</option>
          <option value="sent" ${statusValue==='sent'?'selected':''}>Sent by me</option>
        </select>
      </div>`;

    const cards=taskState.tasks.length?taskState.tasks.map(task=>{
      const badge=taskInboxBadge(task);
      const preview=taskInboxPreview(task);
      const due=task.status==='completed'&&task.completed_at
        ? `Completed ${prettyDateTime(task.completed_at)}`
        : task.due_at
          ? `${Number(task.is_overdue||0)>0?'Due ':Number(task.due_today||0)>0?'Due today · ':'Due '}${prettyDateTime(task.due_at)}`
          : 'No due date';
      const latestBy=task.latest_update_by?`${esc(task.latest_update_by)} · `:'';
      const attachments=Number(task.attachment_count||0);
      const unread=Number(task.unread_count||0)>0||task.status==='unread';
      return `<article class="t2m-task-card t2m-task-inbox-card ${unread?'is-unread':''} ${Number(task.is_overdue||0)>0?'is-overdue':''}" style="--task-color:${personColor(task.assigned_to)}" data-task-open="${task.id}">
        <span class="t2m-task-card-mark"></span>
        <div class="t2m-task-card-body">
          <div class="t2m-task-inbox-card-head">
            <span class="t2m-task-inbox-badge is-${esc(badge.kind)}">${esc(badge.label)}</span>
            <time>${esc(taskInboxTime(task))}</time>
          </div>
          <div class="t2m-task-card-top"><strong>${esc(task.title)}</strong></div>
          <div class="t2m-task-inbox-people"><span>${esc(task.created_by_name||'')}</span><b>→</b><span>${esc(task.assigned_name||'Unassigned')}</span></div>
          <p class="t2m-task-inbox-preview">${esc(preview.slice(0,220))}</p>
          <div class="t2m-task-card-meta">
            <span class="${Number(task.is_overdue||0)>0?'is-danger':''}">${esc(due)}</span>
            <span>Status: ${esc(String(task.workflow_state||task.status||'active').replaceAll('_',' '))}</span>
            ${attachments?`<span>📎 ${attachments} file${attachments===1?'':'s'}</span>`:''}
            ${task.related_client_name?`<span>${esc(task.related_client_name)}</span>`:''}
          </div>
          ${task.latest_update_by?`<small class="t2m-task-inbox-latest-by">${latestBy}latest update</small>`:''}
          <div class="t2m-task-card-actions"><button type="button" data-task-open-button="${task.id}">Open</button></div>
        </div>
      </article>`;
    }).join(''):`<div class="t2m-chat-empty"><strong>${emptyTitle}</strong><span>${emptyCopy}</span></div>`;

    taskBody.innerHTML=`<div class="t2m-task-shell t2m-task-inbox-shell"><div class="t2m-task-inbox-head">${compactFilters}</div><div class="t2m-task-content">${cards}</div></div>`;

    taskBody.querySelectorAll('[data-task-view]').forEach(button=>button.onclick=()=>loadTasks({scope:taskState.scope==='sent'?'mine':taskState.scope,view:button.dataset.taskView,filter:'all'}));
    taskBody.querySelectorAll('[data-task-context]').forEach(button=>button.onclick=()=>loadTasks({scope:button.dataset.taskContext,view:'latest',filter:'all'}));
    taskBody.querySelector('[data-task-history]')?.addEventListener('change',event=>{
      const filter=event.target.value;
      if(!filter)return;
      loadTasks({scope:taskState.scope==='sent'?'mine':taskState.scope,view:'latest',filter});
    });
    taskBody.querySelector('[data-task-status-filter]')?.addEventListener('change',event=>{
      const value=event.target.value;
      if(value==='sent')loadTasks({scope:'sent',view:'latest',filter:'all'});
      else loadTasks({scope:taskState.scope==='sent'?'mine':taskState.scope,view:'latest',filter:value||'all'});
    });
    taskBody.querySelectorAll('[data-task-open]').forEach(card=>card.onclick=event=>{
      if(event.target.closest('button'))return;
      openTask(Number(card.dataset.taskOpen));
    });
    taskBody.querySelectorAll('[data-task-open-button]').forEach(button=>button.onclick=()=>openTask(Number(button.dataset.taskOpenButton)));
  }

  function renderTaskNew(prefill={}){
    renderWorkHeader('new');
    clearInterval(chatPoll);
    fitWidgetMode(taskWidget,taskWidgetKey,{width:840,height:700,minWidth:560,minHeight:420});
    const defaultDue=prefill.date?`${prefill.date}T09:00`:'';
    taskBody.innerHTML=`<form class="t2m-task-form t2m-task-form-new" data-task-form enctype="multipart/form-data"><div class="t2m-task-form-scroll" data-task-form-scroll><h3>New task</h3><label>Assign to<select name="assigned_to" required><option value="">Choose person</option>${taskState.management?'<option value="all">Everybody</option>':''}${(taskState.staff||[]).map(s=>`<option value="${s.id}">${esc(s.display_name||String(s.full_name||'').split(/\\s+/)[0]||'Staff')}</option>`).join('')}</select></label><label>Title<input name="title" maxlength="180" required placeholder="What needs doing?"></label><label>Task<textarea name="message" required placeholder="Short clear instruction"></textarea></label><div class="t2m-task-form-grid"><label>Due<input type="datetime-local" name="due_at" value="${esc(defaultDue)}"></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div><div class="t2m-task-file-picker"><div class="t2m-task-file-picker-row"><button type="button" data-task-files-choose>📎 Attach files</button><small>PDF, Word, Excel, PowerPoint, images and common office files · max 5 files, 15 MB each</small></div><input type="file" name="attachments" multiple accept="${taskFileAccept}" data-task-files hidden><div class="t2m-task-file-selection" data-task-files-list hidden></div></div></div><div class="t2m-task-form-actions" data-task-form-actions><button type="button" data-task-cancel>Cancel</button><button type="submit" class="primary">Create task</button></div></form>`;
    const form=taskBody.querySelector('[data-task-form]');
    const formScroll=form.querySelector('[data-task-form-scroll]');
    bindTaskFilePicker(form);
    form.addEventListener('focusin',event=>{
      if(!formScroll||event.target.closest('[data-task-form-actions]'))return;
      window.requestAnimationFrame(()=>{
        const target=event.target;
        if(!target?.getBoundingClientRect)return;
        const targetRect=target.getBoundingClientRect();
        const scrollRect=formScroll.getBoundingClientRect();
        if(targetRect.bottom>scrollRect.bottom-12)formScroll.scrollTop+=targetRect.bottom-scrollRect.bottom+20;
        else if(targetRect.top<scrollRect.top+12)formScroll.scrollTop-=scrollRect.top-targetRect.top+20;
      });
    });
    form.onsubmit=async event=>{
      event.preventDefault();
      const submit=form.querySelector('button[type="submit"]');
      submit.disabled=true;
      const old=submit.textContent;
      submit.textContent='Creating…';
      try{
        const values=new FormData(form);
        const created=await jsonFetch('/api/uat/tasks',{method:'POST',body:values});
        if(created.everybody&&created.count){
          window.setTimeout(()=>window.alert(`Task sent to ${created.count} staff members.`),0);
        }
        await loadTasks({scope:'mine',view:'latest',filter:'all'});
        window.dispatchEvent(new Event('workspace:refresh'));
      }catch(error){window.alert(error.message);}
      finally{if(submit.isConnected){submit.disabled=false;submit.textContent=old;}}
    };
    taskBody.querySelector('[data-task-cancel]').onclick=()=>openTaskWidget();
  }

  async function openTask(id){renderWorkHeader('inbox');clearInterval(chatPoll);showWidget(workWidget);try{const data=await jsonFetch(`/api/uat/tasks/${id}`);taskState.mode='detail';taskState.selected=data;renderTaskDetail(data);}catch(error){taskBody.innerHTML=`<div class="t2m-chat-empty"><strong>Could not open task</strong><span>${esc(error.message)}</span></div>`;}}
  function renderTaskDetail(data){
    renderWorkHeader('inbox');
    fitWidgetMode(taskWidget,taskWidgetKey,{width:840,height:700,minWidth:560,minHeight:420});
    const t=data.task,p=data.permissions||{};
    const completed=t.status==='completed';
    const waiting=t.workflow_state==='awaiting_sender_ack';
    const attachments=Array.isArray(data.attachments)?data.attachments:[];
    const filesByComment=new Map();
    attachments.forEach(file=>{
      const key=String(file.commentId||0);
      if(!filesByComment.has(key))filesByComment.set(key,[]);
      filesByComment.get(key).push(file);
    });
    const followupComments=(data.comments||[]).filter(c=>String(c.comment||'').startsWith('Follow-up moved from '));
    const latestFollowup=followupComments.length?followupComments[followupComments.length-1]:null;
    const latestFollowupReason=latestFollowup?String(latestFollowup.comment||'').split(' — ').slice(1).join(' — ').trim():'';
    const completedPanel=completed?`<section class="t2m-task-completed-summary"><strong>✓ Completed ${t.completed_at?esc(prettyDateTime(t.completed_at)):''}</strong><p>${esc(t.completion_note||'Completed')}</p>${waiting?'<small>Waiting for the sender/manager to accept the completed task.</small>':t.acknowledged_at?`<small>Accepted ${esc(prettyDateTime(t.acknowledged_at))}</small>`:''}</section>`:'';
    const currentFollowup=latestFollowupReason?`<section class="t2m-task-current-followup"><span>Current follow-up${latestFollowup?.full_name?` · ${esc(latestFollowup.full_name)}`:''}</span><strong>${esc(latestFollowupReason)}</strong><small>${t.due_at?`Follow up: ${esc(prettyDateTime(t.due_at))}`:'No follow-up date set'}${latestFollowup?.created_at?` · Updated ${esc(prettyDateTime(latestFollowup.created_at))}`:''}</small></section>`:'';
    const reschedulePanel=p.canReschedule?`<section class="t2m-task-reschedule"><strong>Move follow-up / due date</strong><div class="t2m-task-reschedule-grid"><label>Reason<textarea data-task-reschedule-reason maxlength="2000" placeholder="No answer — call again"></textarea></label><label>New date & time<input type="datetime-local" data-task-reschedule-due value="${esc(dateTimeInput(t.due_at))}"></label></div><button type="button" data-task-reschedule>Update follow-up date</button><div class="t2m-task-save-confirmation" data-task-reschedule-notice hidden></div><small>The change is added to Updates and the deadline reminder moves to the new date.</small></section>`:'';
    const commentsHtml=(data.comments||[]).map(c=>`<div class="t2m-task-comment"><div><strong>${esc(c.full_name)}</strong><small>${esc(prettyDateTime(c.created_at))}</small></div><p>${esc(c.comment)}</p>${taskAttachmentsHtml(filesByComment.get(String(c.id))||[])}</div>`).join('');
    const orphanFiles=filesByComment.get('0')||[];
    const composer=p.canComment?`<form class="t2m-task-thread-composer" data-task-comment-form enctype="multipart/form-data"><div class="t2m-task-thread-files" data-task-files-list hidden></div><div class="t2m-task-thread-compose-row"><button type="button" class="t2m-task-attach-button" data-task-files-choose title="Attach files">📎</button><input type="file" name="attachments" multiple accept="${taskFileAccept}" data-task-files hidden><input name="comment" data-task-comment placeholder="Add update or send a file"><button type="submit" data-task-comment-send>Send</button></div></form>`:'';
    taskBody.innerHTML=`<div class="t2m-task-detail"><button class="t2m-task-detail-back" data-task-back>← Back to Work</button><div class="t2m-task-detail-scroll"><article class="t2m-task-detail-card"><h3>${esc(t.title)}</h3><p class="lead">${esc(t.message)}</p><div class="t2m-task-detail-meta"><span>From ${esc(t.created_by_name)}</span><span>To ${esc(t.assigned_name)}</span><span>${esc(t.priority)}</span><span>Status: ${esc(String(t.workflow_state||t.status||'active').replaceAll('_',' '))}</span>${!latestFollowupReason&&t.due_at?`<span>Due ${esc(prettyDateTime(t.due_at))}</span>`:''}</div>${completedPanel}${currentFollowup}${reschedulePanel}${p.canUpdate?`<div class="t2m-task-status-actions"><button data-task-status="in_progress">Start / In progress</button></div><div class="t2m-task-complete"><textarea data-task-completion placeholder="What was completed?"></textarea><button data-task-complete>Complete task</button></div>`:''}${p.canApprove?`<div class="t2m-task-status-actions"><button class="primary" data-task-decision="accept">Accept & archive</button><button data-task-decision="return">Return for more work</button></div>`:''}<section class="t2m-task-comments"><h4>Updates & files</h4>${commentsHtml}${orphanFiles.length?`<div class="t2m-task-comment"><strong>Files</strong>${taskAttachmentsHtml(orphanFiles)}</div>`:''}</section></article></div>${composer}</div>`;
    taskBody.querySelector('[data-task-back]').onclick=()=>loadTasks();
    taskBody.querySelectorAll('[data-task-status]').forEach(button=>button.onclick=async()=>{await jsonFetch(`/api/uat/tasks/${t.id}/status`,{method:'POST',body:JSON.stringify({status:button.dataset.taskStatus})});await openTask(t.id);window.dispatchEvent(new Event('workspace:refresh'));});
    taskBody.querySelector('[data-task-reschedule]')?.addEventListener('click',async event=>{const button=event.currentTarget;const due=taskBody.querySelector('[data-task-reschedule-due]')?.value||'';const reason=String(taskBody.querySelector('[data-task-reschedule-reason]')?.value||'').trim();button.disabled=true;const previous=button.textContent;button.textContent='Saving…';try{const saved=await jsonFetch(`/api/uat/tasks/${t.id}/reschedule`,{method:'POST',body:JSON.stringify({due_at:due,reason})});if(!saved.verified)throw new Error('The new follow-up date was not verified.');await openTask(t.id);const notice=taskBody.querySelector('[data-task-reschedule-notice]');if(notice){notice.hidden=false;notice.textContent=`✓ Saved — follow-up is now ${saved.dueLabel||prettyDateTime(saved.dueAt)}`;}window.dispatchEvent(new Event('workspace:refresh'));}catch(error){window.alert(error.message);}finally{if(button.isConnected){button.disabled=false;button.textContent=previous;}}});
    taskBody.querySelector('[data-task-complete]')?.addEventListener('click',async()=>{const note=taskBody.querySelector('[data-task-completion]').value.trim();try{await jsonFetch(`/api/uat/tasks/${t.id}/status`,{method:'POST',body:JSON.stringify({status:'completed',completion_note:note})});await openTask(t.id);window.dispatchEvent(new Event('workspace:refresh'));}catch(error){window.alert(error.message);}});
    taskBody.querySelectorAll('[data-task-decision]').forEach(button=>button.onclick=async()=>{const action=button.dataset.taskDecision;let reason='';if(action==='return'){reason=window.prompt('What still needs to be done?')||'';if(!reason)return;}try{await jsonFetch(`/api/uat/tasks/${t.id}/decision`,{method:'POST',body:JSON.stringify({action,reason})});if(action==='accept')await loadTasks({scope:taskState.scope,view:'latest',filter:'completed'});else await openTask(t.id);window.dispatchEvent(new Event('workspace:refresh'));}catch(error){window.alert(error.message);}});
    const commentForm=taskBody.querySelector('[data-task-comment-form]');
    if(commentForm){
      bindTaskFilePicker(commentForm);
      commentForm.onsubmit=async event=>{
        event.preventDefault();
        const comment=String(commentForm.querySelector('[data-task-comment]')?.value||'').trim();
        const fileInput=commentForm.querySelector('[data-task-files]');
        if(!comment&&!fileInput?.files?.length)return;
        const send=commentForm.querySelector('[data-task-comment-send]');
        send.disabled=true;
        const old=send.textContent;
        send.textContent='Sending…';
        try{
          await jsonFetch(`/api/uat/tasks/${t.id}/comments`,{method:'POST',body:new FormData(commentForm)});
          await openTask(t.id);
        }catch(error){window.alert(error.message);}
        finally{if(send.isConnected){send.disabled=false;send.textContent=old;}}
      };
    }
  }
  async function openTaskWidget(prefill={}){renderWorkHeader(prefill.new?'new':'inbox');clearInterval(chatPoll);showWidget(workWidget);try{const requestedView=prefill.view||'latest';const requestedFilter=prefill.filter||'all';const requestedScope=prefill.scope||'mine';const query=new URLSearchParams({scope:requestedScope,view:requestedView,filter:requestedFilter});const data=await jsonFetch(`/api/uat/tasks?${query.toString()}`);taskState={...taskState,...data,scope:data.scope||requestedScope,view:data.view||requestedView,filter:data.filter||requestedFilter};if(prefill.new)renderTaskNew(prefill);else renderTaskList();}catch(error){taskBody.innerHTML=`<div class="t2m-chat-empty"><strong>Could not open Work</strong><span>${esc(error.message)}</span></div>`;}}

  window.Talk2MeWidgets={openWork:openTaskWidget,openChat,openTasks:openTaskWidget,openTask};
  window.addEventListener('click',event=>{
    const taskAdd=event.target.closest?.('[data-home-add-task]');if(taskAdd){event.preventDefault();event.stopImmediatePropagation();openTaskWidget({new:true});return;}
    const openCalendarTask=event.target.closest?.('[data-open-calendar-item]');if(openCalendarTask&&String(openCalendarTask.dataset.openCalendarItem||'').startsWith('task:')){event.preventDefault();event.stopImmediatePropagation();openTask(Number(String(openCalendarTask.dataset.openCalendarItem).split(':')[1]));return;}
    const taskApp=event.target.closest?.('[data-os-app="work"],[data-os-app="tasks"],[data-os-app="messages"]');if(taskApp){event.preventDefault();event.stopImmediatePropagation();taskApp.dataset.osApp==='messages'?openChat():openTaskWidget();}
  },true);

  refreshBootstrap().catch(()=>{});
})();