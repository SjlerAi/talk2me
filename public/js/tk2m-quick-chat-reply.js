(() => {
  'use strict';
  // Red popup "Open message" should open a fast chat, not the old Work screen.
  if(location.hostname!=='crm.tk2m.co.za'||window.top!==window||window.Talk2MeQuickChat)return;
  const cfg=document.getElementById('talk2me-os-config');
  if(!cfg)return;
  const c=JSON.parse(cfg.textContent||'{}'),base=String(c.basePath||''),me=Number(c.user?.id||0);
  const overlay=document.createElement('div');
  overlay.id='tk2m-quick-chat-reply';
  overlay.className='tk2m-thread-overlay';
  overlay.hidden=true;
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','tk2m-chat-heading');
  overlay.innerHTML=
    '<section class="tk2m-thread-window">'+
    '<header class="tk2m-thread-red"><div><small>STAFF MESSAGES</small><h2 id="tk2m-chat-heading">Message</h2></div>'+
    '<button type="button" class="tk2m-thread-x" data-tk2m-chat-close aria-label="Close conversation">×</button></header>'+
    '<div class="tk2m-thread-body"><div class="tk2m-thread-history" id="tk2m-chat-history" aria-label="Conversation"></div></div>'+
    '<form class="tk2m-thread-form" data-tk2m-chat-form>'+
    '<label for="tk2m-chat-text">Reply</label>'+
    '<textarea id="tk2m-chat-text" name="message" rows="2" maxlength="4000" placeholder="Type your reply…"></textarea>'+
    '<p class="tk2m-thread-error" data-tk2m-chat-error role="alert" hidden></p>'+
    '<div class="tk2m-thread-actions"><button type="submit" class="tk2m-thread-complete" data-tk2m-chat-send>Send reply</button></div>'+
    '</form></section>';
  document.body.appendChild(overlay);
  const heading=overlay.querySelector('#tk2m-chat-heading');
  const history=overlay.querySelector('#tk2m-chat-history');
  const text=overlay.querySelector('#tk2m-chat-text');
  const error=overlay.querySelector('[data-tk2m-chat-error]');
  const send=overlay.querySelector('[data-tk2m-chat-send]');
  let token=null,busy=false;
  async function api(path,options={}){
    const r=await fetch(base+path,{credentials:'same-origin',cache:'no-store',headers:{
      Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})
    },...options});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.ok===false)throw Error(d.error||'Request failed ('+r.status+')');
    return d;
  }
  function showError(e){error.textContent=e?.message||String(e||'Please try again.');error.hidden=false;}
  function close(){
    if(busy)return;
    overlay.hidden=true;document.body.classList.remove('tk2m-thread-active');
    token=null;text.value='';error.hidden=true;
  }
  function showMessages(data){
    heading.textContent=String(data.conversation?.name||'Messages');
    history.replaceChildren();
    const messages=Array.isArray(data.messages)?data.messages:[];
    for(const item of messages.slice(-25)){
      const div=document.createElement('div');div.className='tk2m-thread-entry';
      if(Number(item.senderId)===me)div.classList.add('tk2m-thread-mine');
      const p=document.createElement('p');
      p.textContent=String(item.type==='voice'?'Voice message':item.body||'');
      const from=document.createElement('small');
      const date=item.createdAt?new Date(item.createdAt):null;
      from.textContent=String(item.senderName||'Staff')+' · '+(date&&!Number.isNaN(date.getTime())?date.toLocaleString('en-ZA'):'');
      div.append(p,from);
      history.appendChild(div);
    }
    if(!messages.length){
      const div=document.createElement('div');div.className='tk2m-thread-entry';
      div.textContent='No messages in this conversation yet.';
      history.appendChild(div);
    }
    history.scrollTop=history.scrollHeight;
  }
  function trackChatOpen(){
    fetch(base+'/api/usage/events',{
      method:'POST',credentials:'same-origin',keepalive:true,
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({event_type:'ui_action',screen_key:'communications-chat-reply',
        module_name:'communications',route_path:'/workspace',action:'open_chat_reply'})
    }).catch(()=>{});
  }
  async function open(value){
    if(value!=='office'&&!/^direct:\d+$/.test(String(value||'')))return false;
    if(busy)return false;
    trackChatOpen();
    token=String(value);overlay.hidden=false;
    document.body.classList.add('tk2m-thread-active');
    error.hidden=true;history.textContent='Loading conversation…';
    try{
      const data=await api('/api/uat/chat/messages?conversation='+encodeURIComponent(token));
      showMessages(data);
      text.focus();window.dispatchEvent(new Event('workspace:refresh'));
      return true;
    }catch(e){showError(e);return false;}
  }
  overlay.querySelector('[data-tk2m-chat-close]').addEventListener('click',close);
  overlay.querySelector('[data-tk2m-chat-form]').addEventListener('submit',async e=>{
    e.preventDefault();
    const body=text.value.trim();
    if(!body||!token||busy){if(!body)showError('Type a message before sending.');return;}
    busy=true;send.disabled=true;error.hidden=true;
    try{
      await api('/api/uat/chat/messages',{method:'POST',body:JSON.stringify({conversation:token,body})});
      text.value='';
      const data=await api('/api/uat/chat/messages?conversation='+encodeURIComponent(token));
      showMessages(data);
      window.dispatchEvent(new Event('workspace:refresh'));
      text.focus();
    }catch(x){showError(x)}
    finally{busy=false;send.disabled=false;}
  });
  overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}});
  window.Talk2MeQuickChat={open,close};
})();
