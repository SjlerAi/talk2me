'use strict';
(()=>{
  if (window.top !== window.self) return;
  const currentScript=document.currentScript;
  const BASE=(currentScript?.dataset?.basePath||'').replace(/\/$/,'');
  const MASCOT=BASE+'/public/images/cudo-mascot.webp';
  const FALLBACK='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="b" x1="0" x2="1"><stop stop-color="#1385ff"/><stop offset="1" stop-color="#005ee8"/></linearGradient></defs><circle cx="64" cy="64" r="62" fill="url(#b)"/><circle cx="64" cy="58" r="42" fill="#d8dbe2"/><path d="M30 28C8 18 12 58 32 58M98 28c22-10 18 30-2 30" fill="#7a7f8c"/><ellipse cx="48" cy="53" rx="8" ry="11" fill="#603d1e"/><ellipse cx="80" cy="53" rx="8" ry="11" fill="#603d1e"/><circle cx="50" cy="50" r="2.5" fill="white"/><circle cx="82" cy="50" r="2.5" fill="white"/><ellipse cx="64" cy="67" rx="10" ry="7" fill="#252a33"/><path d="M45 73c9 18 29 18 38 0" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/><path d="M54 80c4 10 16 10 20 0" fill="#f98191"/><path d="M37 98h54l-10 20H47z" fill="#075fd6"/><circle cx="64" cy="105" r="5" fill="#34d5ff"/></svg>');

  function mascot(img){
    img.src=MASCOT;
    img.onerror=()=>{img.onerror=null;img.src=FALLBACK;};
  }

  const root=document.createElement('div');
  root.className='cudo-root';
  root.innerHTML=`
    <section class="cudo-panel" hidden aria-label="Cudo AI Office Assistant">
      <header class="cudo-head">
        <img class="cudo-head-img" alt="Cudo">
        <div class="cudo-title"><strong>Cudo</strong><span>AI Office Assistant</span></div>
        <span class="cudo-live"><i></i>Live</span>
        <div class="cudo-tools">
          <button class="cudo-tool" type="button" data-cudo-size="-1" title="Make Cudo smaller">−</button>
          <button class="cudo-tool" type="button" data-cudo-size="1" title="Make Cudo bigger">+</button>
          <button class="cudo-tool" type="button" data-cudo-reset title="New conversation">↻</button>
          <button class="cudo-tool" type="button" data-cudo-close title="Minimise">×</button>
        </div>
      </header>
      <div class="cudo-body">
        <div class="cudo-welcome"><strong>Hi, I’m Cudo.</strong><br>I can investigate your CRM, find work that has slipped, and help turn results into monitored staff tasks.</div>
        <div class="cudo-stream"></div>
      </div>
      <div class="cudo-suggestions"></div>
      <form class="cudo-compose">
        <textarea name="message" rows="1" placeholder="Ask Cudo anything about your CRM or office…" autocomplete="off"></textarea>
        <button class="cudo-mic" type="button" aria-label="Speak to Cudo" title="Speak to Cudo">🎙</button>
        <button class="cudo-send" type="submit" aria-label="Send">➤</button>
      </form>
      <span class="cudo-resize-note"></span>
    </section>
    <button class="cudo-launcher" type="button" aria-label="Open Cudo AI Office Assistant">
      <img alt="Cudo">
      <span class="cudo-badge" hidden>0</span>
      <span class="cudo-name-tip">Ask Cudo</span>
    </button>`;
  document.body.appendChild(root);
  root.querySelectorAll('img').forEach(mascot);

  const launcher=root.querySelector('.cudo-launcher');
  const panel=root.querySelector('.cudo-panel');
  const head=root.querySelector('.cudo-head');
  const stream=root.querySelector('.cudo-stream');
  const suggestions=root.querySelector('.cudo-suggestions');
  const textarea=root.querySelector('textarea');
  const mic=root.querySelector('.cudo-mic');
  const send=root.querySelector('.cudo-send');
  const badge=root.querySelector('.cudo-badge');
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition||null;
  let bootstrap=null;
  let drag=null;
  let pending=false;
  let recognition=null;
  let listening=false;
  let voiceBase='';
  let voiceFinal='';

  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const scrollEnd=()=>requestAnimationFrame(()=>{const body=root.querySelector('.cudo-body');body.scrollTop=body.scrollHeight;});

  function activeContext(){
    let route=location.pathname+location.search;
    let title=document.title;
    let clientId=null;
    const frames=[...document.querySelectorAll('iframe[src]')].filter(f=>{
      const r=f.getBoundingClientRect();return r.width>100&&r.height>100;
    });
    const customerFrame=[...frames].reverse().find(f=>/\/customers\/\d+/.test(f.getAttribute('src')||''));
    if(customerFrame){
      try{const u=new URL(customerFrame.src,location.href);route=u.pathname+u.search;title=customerFrame.title||title;}catch(_){}
    }
    const match=route.match(/\/customers\/(\d+)/);
    if(match) clientId=Number(match[1]);
    return {route,title,clientId};
  }

  function setAvatarSize(delta=0){
    const stored=Number(localStorage.getItem('t2m-cudo-size')||78);
    const next=clamp(stored+delta*8,58,110);
    localStorage.setItem('t2m-cudo-size',String(next));
    launcher.style.width=next+'px';
    launcher.style.height=next+'px';
  }
  setAvatarSize(0);

  function restorePosition(){
    try{
      const p=JSON.parse(localStorage.getItem('t2m-cudo-position')||'null');
      if(!p)return;
      root.style.right='auto';root.style.bottom='auto';
      root.style.left=clamp(Number(p.x)||0,4,Math.max(4,innerWidth-launcher.offsetWidth-4))+'px';
      root.style.top=clamp(Number(p.y)||0,4,Math.max(4,innerHeight-launcher.offsetHeight-4))+'px';
      positionPanel();
    }catch(_){}
  }
  setTimeout(restorePosition,0);

  function positionPanel(){
    if(innerWidth<720)return;
    const r=root.getBoundingClientRect();
    panel.style.left='auto';panel.style.right='auto';panel.style.top='auto';panel.style.bottom='auto';
    if(r.left+r.width/2>innerWidth/2)panel.style.right='0';
    else panel.style.left='0';
    if(r.top+r.height/2>innerHeight/2)panel.style.bottom=(launcher.offsetHeight+16)+'px';
    else panel.style.top=(launcher.offsetHeight+16)+'px';
  }
  function openPanel(){
    panel.hidden=false;
    positionPanel();
    launcher.setAttribute('aria-expanded','true');
    textarea.focus();
    scrollEnd();
  }
  function closePanel(){
    panel.hidden=true;
    launcher.setAttribute('aria-expanded','false');
  }

  function setSuggestions(items){
    suggestions.innerHTML='';
    (items||[]).slice(0,5).forEach(text=>{
      const b=document.createElement('button');
      b.className='cudo-suggest';b.type='button';b.textContent=text;
      b.addEventListener('click',()=>{textarea.value=text;sendMessage(text);});
      suggestions.appendChild(b);
    });
  }

  function addUser(text){
    const el=document.createElement('div');
    el.className='cudo-msg user';
    el.innerHTML=`<div class="cudo-bubble">${esc(text)}</div>`;
    stream.appendChild(el);scrollEnd();
  }
  function addAssistant(data){
    const el=document.createElement('div');
    el.className='cudo-msg assistant';
    const rows=Array.isArray(data.rows)?data.rows:[];
    const grouped=data.grouped&&typeof data.grouped==='object'
      ? Object.entries(data.grouped).filter(([,n])=>Number(n)>0).map(([name,n])=>`<div class="cudo-result"><strong>${esc(name)}</strong><span>${Number(n)} outstanding</span></div>`).join('')
      : '';
    const list=rows.slice(0,20).map(row=>`<div class="cudo-result"><strong>${esc(row.title||'Item')}</strong><span>${esc(row.detail||'')}</span><small>${esc(row.meta||'')}</small></div>`).join('');
    const actions=(data.actions||[]).map(action=>{
      const labels={show_all:'Show all',create_tasks:'Create tasks',open_agent:'Open Gerda Agent',confirm_tasks:'Create monitored tasks',cancel_action:'Cancel'};
      const cls=action==='confirm_tasks'?' primary':action==='cancel_action'?' danger':'';
      return `<button type="button" class="cudo-action${cls}" data-cudo-action="${esc(action)}">${esc(labels[action]||action)}</button>`;
    }).join('');
    el.innerHTML=`<img class="cudo-msg-avatar" alt="Cudo"><div class="cudo-bubble"><div>${esc(data.text||'')}</div>${grouped||list?`<div class="cudo-result-list">${grouped}${list}</div>`:''}${actions?`<div class="cudo-actions">${actions}</div>`:''}</div>`;
    mascot(el.querySelector('img'));
    stream.appendChild(el);scrollEnd();
    if(data.suggestions?.length)setSuggestions(data.suggestions);
  }

  function setListening(value){
    listening=Boolean(value);
    mic.classList.toggle('is-listening',listening);
    mic.setAttribute('aria-pressed',listening?'true':'false');
    mic.title=listening?'Stop listening':'Speak to Cudo';
    mic.textContent=listening?'■':'🎙';
    launcher.classList.toggle('is-thinking',listening||pending);
  }

  function initVoice(){
    if(!SpeechRecognition){
      mic.disabled=true;
      mic.title='Voice input is not supported in this browser.';
      return;
    }
    recognition=new SpeechRecognition();
    recognition.lang=/^af\b/i.test(navigator.language||'')?'af-ZA':'en-ZA';
    recognition.continuous=false;
    recognition.interimResults=true;
    recognition.maxAlternatives=1;

    recognition.onstart=()=>setListening(true);
    recognition.onresult=event=>{
      let finalText='';
      let interimText='';
      for(let i=event.resultIndex;i<event.results.length;i++){
        const transcript=String(event.results[i][0]?.transcript||'').trim();
        if(!transcript)continue;
        if(event.results[i].isFinal)finalText+=(finalText?' ':'')+transcript;
        else interimText+=(interimText?' ':'')+transcript;
      }
      if(finalText)voiceFinal+=(voiceFinal?' ':'')+finalText;
      const spoken=[voiceFinal,interimText].filter(Boolean).join(' ').trim();
      textarea.value=[voiceBase,spoken].filter(Boolean).join(voiceBase&&spoken?' ':'').trim();
    };
    recognition.onerror=event=>{
      const code=String(event.error||'');
      if(code==='not-allowed'||code==='service-not-allowed'){
        addAssistant({text:'Microphone access is blocked. Allow microphone permission for Talk2Me in your browser, then try again.',rows:[],actions:[]});
      }else if(code!=='aborted'&&code!=='no-speech'){
        addAssistant({text:'I could not hear that clearly. Please try the microphone again.',rows:[],actions:[]});
      }
    };
    recognition.onend=()=>{
      const spoken=voiceFinal.trim();
      setListening(false);
      voiceFinal='';
      if(spoken&&!pending){
        const full=[voiceBase,spoken].filter(Boolean).join(voiceBase&&spoken?' ':'').trim();
        voiceBase='';
        textarea.value=full;
        sendMessage(full);
      }else{
        voiceBase='';
      }
    };
  }

  async function sendMessage(text){
    text=String(text||textarea.value||'').trim();
    if(!text||pending)return;
    addUser(text);textarea.value='';pending=true;send.disabled=true;launcher.classList.add('is-thinking');
    try{
      const response=await fetch(BASE+'/api/cudo/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:text,context:activeContext()})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Cudo could not complete that request.');
      addAssistant(data);
    }catch(error){addAssistant({text:error.message||'Cudo is temporarily unavailable.',rows:[],actions:[]});}
    finally{pending=false;send.disabled=false;launcher.classList.toggle('is-thinking',listening);textarea.focus();}
  }

  async function runAction(action,button){
    if(action==='open_agent'){location.href=(bootstrap?.openAgentUrl||BASE+'/agent');return;}
    if(action==='show_all'){button.closest('.cudo-bubble')?.querySelectorAll('.cudo-result').forEach(x=>x.hidden=false);return;}
    if(action==='create_tasks'){
      textarea.value='Assign these as tasks to ';
      textarea.focus();
      addAssistant({text:'Tell me who should receive these items and the deadline, for example: “Assign these to Johnny, due Friday 15:00”.',rows:[],actions:[]});
      return;
    }
    if(action==='cancel_action'||action==='confirm_tasks'){
      button.disabled=true;
      try{
        const response=await fetch(BASE+'/api/cudo/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action==='cancel_action'?'cancel':'confirm_tasks'})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||'Cudo could not complete that action.');
        addAssistant({text:data.text||'Done.',rows:[],actions:['open_agent']});
      }catch(error){addAssistant({text:error.message||'The action failed.',rows:[],actions:[]});}
      return;
    }
  }

  async function loadBootstrap(){
    try{
      const response=await fetch(BASE+'/api/cudo/bootstrap',{cache:'no-store'});
      if(!response.ok){root.remove();return;}
      bootstrap=await response.json();
      setSuggestions(bootstrap.suggestions||[]);
      paintAlerts(bootstrap.alerts);
    }catch(_){launcher.classList.add('is-alerting');}
  }

  function paintAlerts(alerts){
    const count=Number(alerts?.count||0);
    badge.hidden=count<=0;
    badge.textContent=count>99?'99+':String(count);
    launcher.classList.toggle('is-alerting',count>0);
    const old=stream.querySelector('.cudo-attention-wrap');if(old)old.remove();
    if(count>0&&Array.isArray(alerts.items)){
      const wrap=document.createElement('div');wrap.className='cudo-attention-wrap';
      wrap.innerHTML=`<div class="cudo-attention"><strong>${count} item${count===1?'':'s'} need attention</strong><span>${alerts.items.filter(x=>Number(x.count)>0).map(x=>esc(x.label)+': '+Number(x.count)).join(' · ')}</span></div>`;
      stream.prepend(wrap);
    }
  }
  async function pollAlerts(){
    try{const r=await fetch(BASE+'/api/cudo/alerts',{cache:'no-store'});if(r.ok)paintAlerts(await r.json());}catch(_){}
  }

  launcher.addEventListener('click',e=>{
    if(launcher.dataset.dragged==='1'){launcher.dataset.dragged='0';return;}
    panel.hidden?openPanel():closePanel();
  });
  root.querySelector('[data-cudo-close]').addEventListener('click',closePanel);
  root.querySelectorAll('[data-cudo-size]').forEach(b=>b.addEventListener('click',()=>setAvatarSize(Number(b.dataset.cudoSize))));
  root.querySelector('[data-cudo-reset]').addEventListener('click',async()=>{
    await fetch(BASE+'/api/cudo/reset',{method:'POST'}).catch(()=>{});
    stream.querySelectorAll('.cudo-msg').forEach(x=>x.remove());
    addAssistant({text:'Fresh conversation. What would you like me to check?',rows:[],actions:[]});
  });
  root.querySelector('.cudo-compose').addEventListener('submit',e=>{e.preventDefault();sendMessage();});
  textarea.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
  mic.addEventListener('click',()=>{
    if(!recognition||pending)return;
    if(panel.hidden)openPanel();
    if(listening){
      try{recognition.stop();}catch(_){}
      return;
    }
    voiceBase=String(textarea.value||'').trim();
    voiceFinal='';
    try{recognition.start();}
    catch(error){
      setListening(false);
      addAssistant({text:'The microphone is already busy. Wait a moment and try again.',rows:[],actions:[]});
    }
  });
  stream.addEventListener('click',e=>{const b=e.target.closest('[data-cudo-action]');if(b)runAction(b.dataset.cudoAction,b);});

  launcher.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const r=root.getBoundingClientRect();
    drag={pointer:e.pointerId,startX:e.clientX,startY:e.clientY,x:r.left,y:r.top,moved:false};
    launcher.setPointerCapture(e.pointerId);
  });
  launcher.addEventListener('pointermove',e=>{
    if(!drag||drag.pointer!==e.pointerId)return;
    const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
    if(Math.hypot(dx,dy)>5)drag.moved=true;
    if(!drag.moved)return;
    root.style.right='auto';root.style.bottom='auto';
    root.style.left=clamp(drag.x+dx,4,Math.max(4,innerWidth-launcher.offsetWidth-4))+'px';
    root.style.top=clamp(drag.y+dy,4,Math.max(4,innerHeight-launcher.offsetHeight-4))+'px';
    positionPanel();
  });
  launcher.addEventListener('pointerup',e=>{
    if(!drag)return;
    if(drag.moved){
      launcher.dataset.dragged='1';
      const r=root.getBoundingClientRect();
      localStorage.setItem('t2m-cudo-position',JSON.stringify({x:r.left,y:r.top}));
      positionPanel();
    }
    drag=null;
  });

  head.addEventListener('dblclick',()=>{panel.style.width='460px';panel.style.height='650px';});
  addEventListener('resize',()=>{if(innerWidth<720){root.style.left='';root.style.top='';root.style.right='12px';root.style.bottom='12px';}});
  initVoice();
  loadBootstrap();
  setInterval(pollAlerts,60000);
})();