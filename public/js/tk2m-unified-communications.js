(() => {
 'use strict';
 if(location.hostname!=='crm.tk2m.co.za'||window.top!==window||window.Talk2MeUnifiedInbox)return;
 const cfgEl=document.getElementById('talk2me-os-config');
 if(!cfgEl)return;
 const cfg=JSON.parse(cfgEl.textContent||'{}'),base=String(cfg.basePath||'');
 function labelLauncher(){
   document.querySelectorAll('[data-os-app="work"]').forEach(button=>{
     if(button.getAttribute('aria-label')!=='Communications')button.setAttribute('aria-label','Communications');
     if(button.getAttribute('title')!=='Communications')button.setAttribute('title','Communications');
     button.querySelectorAll('strong').forEach(child=>{
       if(child.textContent!=='Communications')child.textContent='Communications';
     });
   });
 }
 labelLauncher();
 const launcherBar=document.querySelector('.t2m-os-launcher');
 if(launcherBar && typeof MutationObserver!=='undefined'){
   new MutationObserver(labelLauncher).observe(launcherBar,{childList:true,subtree:true});
 }
 const overlay=document.createElement('div');
 overlay.className='tk2m-unified-overlay';
 overlay.id='tk2m-unified-communications';
 overlay.hidden=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
 overlay.setAttribute('aria-labelledby','tk2m-unified-title');
 overlay.innerHTML=
  '<section class="tk2m-unified-window">'+
  '<header class="tk2m-unified-head"><div><h2 id="tk2m-unified-title">Communications</h2>'+
  '<small>One place for everything sent and received</small></div>'+
  '<div class="tk2m-unified-head-actions"><button type="button" data-tk2m-unified-send>+ Send</button>'+
  '<button type="button" data-tk2m-unified-close aria-label="Close Communications">×</button></div></header>'+
  '<div class="tk2m-unified-status" data-tk2m-unified-status aria-live="polite"></div>'+
  '<div class="tk2m-unified-list" data-tk2m-unified-list></div>'+
  '<footer class="tk2m-unified-foot">Showing the last 48 hours. Older records remain in the CRM audit.</footer>'+
  '</section>';
 document.body.appendChild(overlay);
 const list=overlay.querySelector('[data-tk2m-unified-list]');
 const status=overlay.querySelector('[data-tk2m-unified-status]');
 let busy=false,loading=false,lastItems=[],refreshTimer=null;
 const node=(tag,cls,text)=>{
   const n=document.createElement(tag);if(cls)n.className=cls;
   if(text!==undefined)n.textContent=String(text);return n;
 };
 async function api(path,opts={}){
   const res=await fetch(base+path,{credentials:'same-origin',cache:'no-store',
     headers:{Accept:'application/json',...(opts.body&&!(opts.body instanceof FormData)?{'Content-Type':'application/json'}:{})},...opts});
   const payload=await res.json().catch(()=>({}));
   if(!res.ok||payload.ok===false)throw Error(payload.error||'Could not update communication ('+res.status+')');
   return payload;
 }
 function close(){
   if(busy)return;
   overlay.hidden=true;
   if(refreshTimer)window.clearInterval(refreshTimer);
   refreshTimer=null;
 }
 const label=record=>{
   if(record.direction==='sent')return 'To '+record.recipient;
   return 'From '+record.sender;
 };
 function entry(item){
   const wrap=node('article','tk2m-unified-entry');
   wrap.dataset.communicationId=String(item.id);
   wrap.dataset.communicationKind=item.kind;
   const header=node('div','tk2m-unified-entry-head');
   const sender=node('strong','',label(item));
   const date=new Date(item.createdAt);
   const when=node('small','',!Number.isNaN(date.getTime())
     ?date.toLocaleString('en-ZA',{dateStyle:'short',timeStyle:'short'}):'');
   header.append(sender,when);
   const body=node('p','tk2m-unified-message',item.text||item.subject||'Communication');
   wrap.append(header,body);
   const strip=node('div','tk2m-unified-strip');
   const state=item.kind==='legacy_chat'
     ?(item.direction==='sent'?'Sent':'Received')
     :(item.direction==='sent'?(item.acknowledged?'Received by '+item.recipient:'Waiting for '+item.recipient)
        :(item.acknowledged?'Received — outstanding':'Not yet acknowledged'));
   strip.append(node('small','',state));
   const actions=node('div','tk2m-unified-entry-actions');
   if(item.kind==='task'){
     if(item.direction==='received'){
       if(!item.acknowledged)actions.append(actionButton('Received','receipt',item));
       actions.append(actionButton('Done','complete',item));
       actions.append(actionButton('Reply','reply',item));
     }else{
       actions.append(actionButton('Reply','reply',item));
     }
   }else{
     actions.append(actionButton('Reply','legacy',item));
   }
   strip.append(actions);wrap.append(strip);
   const form=node('form','tk2m-unified-inline-reply');
   form.hidden=true;form.dataset.replyId=String(item.id);
   const message=node('textarea');message.rows=2;message.maxLength=4000;
   message.placeholder='Type your reply…';
   const controls=node('div','tk2m-unified-reply-actions');
   const send=node('button','tk2m-unified-submit','Send reply');send.type='submit';
   const cancel=node('button','tk2m-unified-cancel','Cancel');cancel.type='button';
   cancel.addEventListener('click',()=>{form.hidden=true;message.value='';});
   controls.append(cancel,send);form.append(message,controls);
   form.addEventListener('submit',event=>{event.preventDefault();void replyTask(item,message.value,form);});
   wrap.append(form);
   return wrap;
 }
 function actionButton(text,type,item){
   const button=node('button','tk2m-unified-action tk2m-unified-'+type,text);
   button.type='button';button.addEventListener('click',()=>{void act(type,item,button);});
   return button;
 }
 async function replyTask(item,message,form){
   if(busy)return;
   const body=String(message||'').trim();
   if(!body){status.textContent='Type a reply first.';return;}
   busy=true;
   try{
     const payload=new FormData();payload.set('comment',body);
     await api('/api/uat/tasks/'+item.id+'/comments',{method:'POST',body:payload});
     status.textContent='Reply sent';form.hidden=true;
     await load();
   }catch(error){status.textContent=error.message;}
   finally{busy=false;}
 }
 async function act(type,item,button){
   if(busy)return;
   if(type==='legacy'){
     if(typeof window.Talk2MeQuickChat?.open==='function'){
       close();window.Talk2MeQuickChat.open(item.conversation);
     }else status.textContent='Conversation temporarily unavailable. Refresh your CRM.';
     return;
   }
   if(type==='reply'){
     const el=button.closest('.tk2m-unified-entry');
     const form=el?.querySelector('.tk2m-unified-inline-reply');
     if(form){form.hidden=!form.hidden;if(!form.hidden)form.querySelector('textarea')?.focus();}
     return;
   }
   busy=true;button.disabled=true;
   try{
     if(type==='receipt'){
       await api('/api/staff-attention/ack',{method:'POST',
         body:JSON.stringify({kind:'task',id:item.id,method:'dismiss'})});
       status.textContent='Received and recorded';
     }else if(type==='complete'){
       await api('/api/uat/tasks/'+item.id+'/status',{method:'POST',
         body:JSON.stringify({status:'completed',completion_note:'Completed via Communications'})});
       status.textContent='Completed and recorded';
     }
     await load();
     window.dispatchEvent(new Event('workspace:refresh'));
   }catch(error){status.textContent=error.message;}
   finally{busy=false;button.disabled=false;}
 }
 async function load(focusTaskId){
   if(loading)return;
   loading=true;
   const focus=Number(focusTaskId||0);
   try{
     const data=await api('/api/tk2m/communications/inbox');
     lastItems=Array.isArray(data.items)?data.items:[];
     list.replaceChildren();
     for(const item of lastItems)list.appendChild(entry(item));
     if(!lastItems.length)list.append(node('div','tk2m-unified-empty','Nothing outstanding. You are up to date.'));
     status.textContent=lastItems.length+' recent communications';
     if(focus)list.querySelector('[data-communication-kind="task"][data-communication-id="'+focus+'"]')?.scrollIntoView({block:'nearest'});
   }catch(error){status.textContent='Could not load Communications: '+error.message;}
   finally{loading=false;}
 }
 function trackInboxOpen(){
   fetch(base+'/api/usage/events',{
     method:'POST',credentials:'same-origin',keepalive:true,
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({event_type:'ui_action',screen_key:'communications-inbox',
       module_name:'communications',route_path:'/workspace',action:'open_inbox'})
   }).catch(()=>{});
 }
 function open(options={}){
   labelLauncher();
   trackInboxOpen();
   // The old floating Work window must never sit on top of this one.
   const old=document.getElementById('t2m-task-widget');
   if(old)old.hidden=true;
   overlay.hidden=false;status.textContent='Loading communications…';
   void load(options.focusTaskId);
   if(refreshTimer)window.clearInterval(refreshTimer);
   refreshTimer=window.setInterval(()=>{if(!document.hidden&&!overlay.hidden&&!busy)void load();},20000);
   overlay.querySelector('[data-tk2m-unified-close]').focus();
 }
 overlay.querySelector('[data-tk2m-unified-close]').addEventListener('click',close);
 overlay.querySelector('[data-tk2m-unified-send]').addEventListener('click',()=>{
   close();window.Talk2MeCommunications?.open?.();
 });
 overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!overlay.hidden)void load();});
 window.addEventListener('workspace:refresh',()=>{if(!overlay.hidden)void load();});
 window.Talk2MeUnifiedInbox={open,close,refresh:()=>load()};
})();
