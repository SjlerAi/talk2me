(() => {
 'use strict';
 if (location.hostname!=='crm.tk2m.co.za'||window.top!==window||window.Talk2MeCommunications)return;
 const configEl=document.getElementById('talk2me-os-config');
 if(!configEl)return;
 const cfg=JSON.parse(configEl.textContent||'{}');
 const base=String(cfg.basePath||'');
 let recipients=null,sending=false,briefOpen=null,briefBusy=false,briefPolling=false;
 const userId=Number(cfg.user?.id||0);
 if(!userId)return;
 const el=(tag,cls,text)=>{
   const node=document.createElement(tag);
   if(cls)node.className=cls;
   if(text!==undefined)node.textContent=String(text);
   return node;
 };
 async function api(path,options={}){
   const r=await fetch(base+path,{credentials:'same-origin',cache:'no-store',headers:{
     Accept:'application/json',...(options.body&&!(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(options.headers||{})
   },...options});
   const body=await r.json().catch(()=>({}));
   if(!r.ok||body.ok===false)throw Error(body.error||'Request failed ('+r.status+')');
   return body;
 }
 const toast=el('div','tk2m-communications-toast');
 toast.setAttribute('role','status');toast.hidden=true;
 document.body.appendChild(toast);
 let toastDelay=0;
 function say(message){
   window.clearTimeout(toastDelay);
   toast.textContent=message;toast.hidden=false;
   toastDelay=window.setTimeout(()=>{toast.hidden=true;},3100);
 }
 const modal=el('div','tk2m-quick-overlay');
 modal.id='tk2m-quick-communication-modal';modal.hidden=true;
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 modal.setAttribute('aria-labelledby','tk2m-quick-title');
 modal.innerHTML=
  '<section class="tk2m-quick-box">'+
  '<header class="tk2m-quick-red"><h2 id="tk2m-quick-title">SEND MESSAGE / TASK</h2><button type="button" data-tk2m-quick-close aria-label="Close message">×</button></header>'+
  '<form data-tk2m-quick-form><label class="tk2m-quick-label">To'+
  '<select name="assigned_to" required data-tk2m-quick-recipient><option value="">Choose staff member</option></select></label>'+
  '<label class="tk2m-quick-label"><span>Message or instruction</span><textarea required maxlength="4000" rows="3" name="message" placeholder="e.g. Bel my asseblief" data-tk2m-quick-text></textarea></label>'+
  '<label class="tk2m-quick-check"><input type="checkbox" name="action_required" data-tk2m-quick-action><span>Action required (track until complete)</span></label>'+
  '<div class="tk2m-quick-bottom"><label class="tk2m-quick-attachment"><span>📎 Attach file (optional)</span><input type="file" data-tk2m-quick-files name="attachments" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp"></label>'+
  '<button type="submit" class="tk2m-quick-send" data-tk2m-quick-send>Send <span aria-hidden="true">➤</span></button></div>'+
  '<p class="tk2m-quick-hint">Sends immediately. No automatic deadline. Tasks remain open until completed.</p>'+
  '<p class="tk2m-quick-error" role="alert" data-tk2m-quick-error hidden></p></form></section>';
 document.body.appendChild(modal);
 const form=modal.querySelector('[data-tk2m-quick-form]');
 const select=form.querySelector('[data-tk2m-quick-recipient]');
 const message=form.querySelector('[data-tk2m-quick-text]');
 const action=form.querySelector('[data-tk2m-quick-action]');
 const files=form.querySelector('[data-tk2m-quick-files]');
 const error=form.querySelector('[data-tk2m-quick-error]');
 const send=form.querySelector('[data-tk2m-quick-send]');
 function toggleFiles(){
   const count=files.files?.length||0;
   if(count)action.checked=true;
   files.closest('.tk2m-quick-attachment')?.classList.toggle('has-files',count>0);
   const text=files.closest('.tk2m-quick-attachment')?.querySelector('span');
   if(text)text.textContent=count?(count+' file'+(count===1?'':'s')+' attached'):'📎 Attach file (optional)';
 }
 files.addEventListener('change',toggleFiles);
 function closeQuick(){if(sending)return;modal.hidden=true;form.reset();toggleFiles();error.hidden=true;}
 modal.querySelector('[data-tk2m-quick-close]').addEventListener('click',closeQuick);
 async function staff(){
   if(recipients)return recipients;
   const data=await api('/api/tk2m/communications/people');
   recipients=Array.isArray(data.staff)?data.staff:[];
   return recipients;
 }
 async function trackComposeOpen(){
   try{await fetch(base+'/api/usage/events',{method:'POST',credentials:'same-origin',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({event_type:'ui_action',screen_key:'communications-quick-send',
       module_name:'communications',action:'open_compose',route_path:'/workspace'})});}
   catch(_){}
 }
 async function openQuick(options={}){
   if(briefOpen||sending)return;
   void trackComposeOpen();
   modal.hidden=false;
   form.reset();error.hidden=true;action.checked=options.actionRequired!==false;
   toggleFiles();
   const previous=select.value;
   select.innerHTML='<option value="">Choose staff member</option>';
   try{
     const list=await staff();
     for(const p of list){
       const opt=el('option','',p.name+(p.fullName!==p.name?' — '+p.fullName:''));
       opt.value=String(p.id);select.appendChild(opt);
     }
     const wanted=Number(options.recipientId||0);
     if(wanted&&list.some(x=>x.id===wanted))select.value=String(wanted);
     else if(previous&&list.some(x=>String(x.id)===previous))select.value=previous;
   }catch(e){error.textContent='Could not load staff: '+e.message;error.hidden=false;}
   (select.value?message:select).focus();
 }
 form.addEventListener('submit',async event=>{
   event.preventDefault();
   if(sending)return;
   const person=Number(select.value),text=String(message.value||'').trim(),needsAction=action.checked||(files.files?.length||0)>0;
   if(!person||!text){error.textContent='Select a staff member and enter a message.';error.hidden=false;return;}
   if(text.length>4000){error.textContent='Message is too long.';error.hidden=false;return;}
   sending=true;send.disabled=true;send.textContent='Sending…';error.hidden=true;
   try{
     if(needsAction){
       const data=new FormData();
       data.set('assigned_to',String(person));
       data.set('message',text);
       const title=text.split(/\r?\n/)[0].trim().slice(0,180)||text.slice(0,180);
       data.set('title',title);
       data.set('priority','high');
       // Intentionally no due_at: an automatic "deadline missed" would be false.
       for(const file of files.files||[])data.append('attachments',file,file.name);
       await api('/api/uat/tasks',{method:'POST',body:data});
     }else{
       await api('/api/uat/chat/messages',{method:'POST',
         body:JSON.stringify({conversation:'direct:'+person,body:text})});
     }
     const name=recipients?.find(p=>p.id===person)?.name||'staff';
     modal.hidden=true;form.reset();toggleFiles();
     say((needsAction?'Task':'Message')+' sent to '+name);
     window.dispatchEvent(new Event('workspace:refresh'));
   }catch(e){error.textContent=e.message;error.hidden=false;}finally{
     sending=false;send.disabled=false;send.textContent='Send ➤';
   }
 });
 // Backend-computed, per-staff once-daily summaries. No task is marked read/done.
 const brief=el('div','tk2m-brief-overlay');
 brief.hidden=true;brief.id='tk2m-communications-brief';
 brief.setAttribute('role','alertdialog');brief.setAttribute('aria-modal','true');
 brief.setAttribute('aria-labelledby','tk2m-brief-heading');
 brief.innerHTML=
  '<section class="tk2m-brief-card">'+
  '<header class="tk2m-brief-red"><span data-tk2m-brief-time></span><h2 id="tk2m-brief-heading"></h2></header>'+
  '<p class="tk2m-brief-intro" data-tk2m-brief-intro></p>'+
  '<div class="tk2m-brief-numbers"><article><strong data-tk2m-brief-messages>0</strong><span>Unread messages</span></article><article><strong data-tk2m-brief-tasks>0</strong><span>Open tasks</span></article></div>'+
  '<p class="tk2m-brief-carry" data-tk2m-brief-carry></p>'+
  '<div class="tk2m-brief-list" data-tk2m-brief-list></div>'+
  '<p class="tk2m-brief-error" data-tk2m-brief-error role="alert" hidden></p>'+
  '<footer class="tk2m-brief-actions"><button type="button" data-tk2m-brief-open="messages">Open messages</button>'+
  '<button type="button" data-tk2m-brief-open="tasks">Open tasks</button>'+
  '<button type="button" class="primary" data-tk2m-brief-open="dismiss">Acknowledge & continue</button></footer>'+
  '</section>';
 document.body.appendChild(brief);
 const morningOrAfternoon=()=>briefOpen;
 function showBrief(kind,data){
   briefOpen=kind;
   const morning=kind==='morning';
   brief.querySelector('[data-tk2m-brief-time]').textContent=morning?'DAILY START-UP REVIEW':'16:30 DAILY FOLLOW-UP';
   brief.querySelector('#tk2m-brief-heading').textContent=morning?'OUTSTANDING FROM PREVIOUS DAYS':'STILL OUTSTANDING TODAY';
   brief.querySelector('[data-tk2m-brief-intro]').textContent=morning
    ?'Review yesterday’s unfinished messages and tasks before starting your day.'
    :'Your single end-of-day reminder. Review what is still unanswered or incomplete.';
   const counts=data.counts||{};
   brief.querySelector('[data-tk2m-brief-messages]').textContent=String(morning?counts.carriedMessages:counts.unreadMessages||0);
   brief.querySelector('[data-tk2m-brief-tasks]').textContent=String(morning?counts.carriedTasks:counts.tasks||0);
   brief.querySelector('[data-tk2m-brief-carry]').textContent=morning
    ?'Older items remain in your work lists until actioned.'
    :'Today: '+(counts.todayMessages||0)+' new unread messages · '+(counts.todayTasks||0)+' new open tasks. Older unfinished work is included above.';
   const list=brief.querySelector('[data-tk2m-brief-list]');
   list.replaceChildren();
   const cutoff=data.day||'';
   const tasks=(data.tasks||[]).filter(x=>!morning||String(x.createdAt||'').slice(0,10)<cutoff).slice(0,4);
   const messages=(data.messages||[]).filter(x=>!morning||String(x.createdAt||'').slice(0,10)<cutoff).slice(0,3);
   for(const item of tasks)list.appendChild(briefListItem('TASK',item.title,item.sender));
   for(const item of messages)list.appendChild(briefListItem('MESSAGE',item.preview,item.sender));
   brief.querySelector('[data-tk2m-brief-error]').hidden=true;
   brief.hidden=false;
   document.body.classList.add('tk2m-brief-active');
   brief.querySelector('[data-tk2m-brief-open="dismiss"]').focus();
 }
 function briefListItem(type,summary,sender){
   const row=el('div','tk2m-brief-row');
   row.append(el('span','tk2m-brief-type',type));
   const copy=el('div','tk2m-brief-copy');
   copy.append(el('strong','',String(summary||'Work item').slice(0,160)),el('small','',String(sender||'Staff')));
   row.appendChild(copy);return row;
 }
 async function acknowledgeBrief(where){
   if(briefBusy||!briefOpen)return;
   const kind=briefOpen;briefBusy=true;
   const errorEl=brief.querySelector('[data-tk2m-brief-error]');
   brief.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{
     await api('/api/tk2m/communications/brief/ack',{method:'POST',body:JSON.stringify({kind})});
     briefOpen=null;brief.hidden=true;document.body.classList.remove('tk2m-brief-active');
     if(where!=='dismiss'){
       if(where==='messages')window.Talk2MeWidgets?.openChat?.()||document.querySelector('[data-os-app="messages"]')?.click();
       else window.Talk2MeWidgets?.openTasks?.({scope:'mine',view:'latest'})||document.querySelector('[data-os-app="tasks"]')?.click();
     }
   }catch(e){errorEl.textContent='Could not record the review: '+e.message;errorEl.hidden=false;}
   finally{
     briefBusy=false;brief.querySelectorAll('button').forEach(b=>b.disabled=false);
   }
 }
 brief.querySelectorAll('[data-tk2m-brief-open]').forEach(btn=>
   btn.addEventListener('click',()=>acknowledgeBrief(btn.dataset.tk2mBriefOpen)));
 async function pollBrief(){
   if(briefPolling||briefBusy||briefOpen)return;
   briefPolling=true;
   try{
     const data=await api('/api/tk2m/communications/brief');
     if(data.prompts?.morning?.pending)showBrief('morning',data);
     else if(data.prompts?.afternoon?.pending)showBrief('afternoon',data);
   }catch(e){console.error('Talk2Me daily communications check:',e.message);}
   finally{briefPolling=false;}
 }
 // Entrypoints work on My Day even if optional Work widgets fail to load.
 document.addEventListener('click',event=>{
   const button=event.target.closest?.('[data-home-add-task],[data-home-quick-send]');
   if(!button||modal.contains(button)||brief.contains(button))return;
   event.preventDefault();event.stopImmediatePropagation();
   openQuick({actionRequired:true});
 },true);
 modal.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();closeQuick();}
 });
 document.addEventListener('keydown',event=>{
   if(brief.hidden)return;
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();}
   else if(event.key==='Tab'){
     const controls=[...brief.querySelectorAll('button:not([disabled])')];
     if(!controls.length)return;
     const i=controls.indexOf(document.activeElement);
     if(event.shiftKey&&i<=0){event.preventDefault();controls[controls.length-1].focus();}
     else if(!event.shiftKey&&i===controls.length-1){event.preventDefault();controls[0].focus();}
   }
 },true);
 window.Talk2MeCommunications={open:openQuick,refreshBrief:pollBrief};
 pollBrief();
 window.setInterval(pollBrief,30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollBrief();});
 window.addEventListener('pageshow',pollBrief);
})();
