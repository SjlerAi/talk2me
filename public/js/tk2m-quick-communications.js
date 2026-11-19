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
  '<header class="tk2m-quick-red"><h2 id="tk2m-quick-title">SEND COMMUNICATION</h2><button type="button" data-tk2m-quick-close aria-label="Close message">×</button></header>'+
  '<form data-tk2m-quick-form><label class="tk2m-quick-label">To'+
  '<select name="assigned_to" required data-tk2m-quick-recipient><option value="">Choose staff member</option></select></label>'+
  '<label class="tk2m-quick-label"><span>What needs to be done?</span><textarea required maxlength="4000" rows="3" name="message" placeholder="e.g. Bel my asseblief" data-tk2m-quick-text></textarea></label>'+

  '<div class="tk2m-quick-bottom"><label class="tk2m-quick-attachment"><span>📎 Attach file (optional)</span><input type="file" data-tk2m-quick-files name="attachments" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp"></label>'+
  '<div class="tk2m-quick-actions"><button type="button" class="tk2m-quick-schedule" data-tk2m-quick-schedule aria-expanded="false">Schedule</button>'+
  '<button type="submit" class="tk2m-quick-send" data-tk2m-quick-send>Send <span aria-hidden="true">➤</span></button></div></div>'+
  '<div class="tk2m-quick-schedule-options" data-tk2m-quick-schedule-options hidden>'+
  '<p>Deliver this communication later (South Africa time).</p>'+
  '<div class="tk2m-quick-schedule-datetime"><label>Date<input type="date" data-tk2m-schedule-date></label>'+
  '<label>Time<input type="time" data-tk2m-schedule-time step="60"></label></div>'+
  '<div class="tk2m-quick-schedule-footer"><button type="button" data-tk2m-schedule-back>Back</button>'+
  '<button type="button" class="tk2m-quick-schedule-confirm" data-tk2m-schedule-confirm>Confirm schedule</button></div></div>'+
  '<p class="tk2m-quick-hint">Send delivers immediately. Schedule delivers on the date and time you choose.</p>'+
  '<button type="button" class="tk2m-quick-scheduled-link" data-tk2m-view-scheduled aria-expanded="false">View scheduled messages</button>'+
  '<section class="tk2m-quick-scheduled-list" data-tk2m-scheduled-list hidden aria-label="Messages awaiting scheduled delivery"></section>'+
  '<p class="tk2m-quick-error" role="alert" data-tk2m-quick-error hidden></p></form></section>';
 document.body.appendChild(modal);
 const form=modal.querySelector('[data-tk2m-quick-form]');
 const select=form.querySelector('[data-tk2m-quick-recipient]');
 const message=form.querySelector('[data-tk2m-quick-text]');
 const files=form.querySelector('[data-tk2m-quick-files]');
 const error=form.querySelector('[data-tk2m-quick-error]');
 const send=form.querySelector('[data-tk2m-quick-send]');
 const scheduleBtn=form.querySelector('[data-tk2m-quick-schedule]');
 const options=form.querySelector('[data-tk2m-quick-schedule-options]');
 const dateInput=form.querySelector('[data-tk2m-schedule-date]');
 const timeInput=form.querySelector('[data-tk2m-schedule-time]');
 const confirmSchedule=form.querySelector('[data-tk2m-schedule-confirm]');
 const backSchedule=form.querySelector('[data-tk2m-schedule-back]');
 const viewScheduled=form.querySelector('[data-tk2m-view-scheduled]');
 const scheduledList=form.querySelector('[data-tk2m-scheduled-list]');
 function toggleFiles(){
   const count=files.files?.length||0;
   files.closest('.tk2m-quick-attachment')?.classList.toggle('has-files',count>0);
   const text=files.closest('.tk2m-quick-attachment')?.querySelector('span');
   if(text)text.textContent=count?(count+' file'+(count===1?'':'s')+' attached'):'📎 Attach file (optional)';
 }
 files.addEventListener('change',toggleFiles);
 function closeQuick(){if(sending)return;modal.hidden=true;form.reset();toggleFiles();error.hidden=true;closeSchedule();scheduledList.hidden=true;viewScheduled.setAttribute('aria-expanded','false');}
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
   form.reset();error.hidden=true;
   closeSchedule();scheduledList.hidden=true;viewScheduled.setAttribute('aria-expanded','false');
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
   if(!options.hidden){
     error.textContent='Use Confirm schedule to deliver this later, or Back for immediate Send.';
     error.hidden=false;return;
   }
   const person=Number(select.value),text=String(message.value||'').trim();
   if(!person||!text){error.textContent='Select a staff member and enter a message.';error.hidden=false;return;}
   if(text.length>4000){error.textContent='Message is too long.';error.hidden=false;return;}
   sending=true;send.disabled=true;send.textContent='Sending…';error.hidden=true;
   try{
     // Every new communication uses ONE actionable task record. No optional
     // message/task distinction and no automatic deadline.
     const data=new FormData();
     data.set('assigned_to',String(person));
     data.set('message',text);
     data.set('title',text.split(/\r?\n/)[0].trim().slice(0,180)||text.slice(0,180));
     data.set('priority','high');
     for(const file of files.files||[])data.append('attachments',file,file.name);
     await api('/api/uat/tasks',{method:'POST',body:data});
     const name=recipients?.find(p=>p.id===person)?.name||'staff';
     modal.hidden=true;form.reset();toggleFiles();
     say('Communication sent to '+name);
     window.dispatchEvent(new Event('workspace:refresh'));
   }catch(e){error.textContent=e.message;error.hidden=false;}finally{
     sending=false;send.disabled=false;send.textContent='Send ➤';
   }
 });
 function nextSast(){
   const d=new Date(Date.now()+15*60000);
   const parts=new Intl.DateTimeFormat('en-GB',{
     timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit',
     hour:'2-digit',minute:'2-digit',hourCycle:'h23'
   }).formatToParts(d);
   const p={};for(const a of parts)if(a.type!=='literal')p[a.type]=a.value;
   return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
 }
 function closeSchedule(){
   options.hidden=true;
   scheduleBtn.setAttribute('aria-expanded','false');
   send.disabled=false;
   scheduleBtn.disabled=false;
 }
 scheduleBtn.addEventListener('click',()=>{
   if(sending)return;
   if(!options.hidden){closeSchedule();return;}
   const next=nextSast();
   dateInput.value=next.date;timeInput.value=next.time;
   dateInput.min=nextSast().date;
   error.hidden=true;
   options.hidden=false;
   scheduleBtn.setAttribute('aria-expanded','true');
   send.disabled=true;
   dateInput.focus();
 });
 backSchedule.addEventListener('click',closeSchedule);
 confirmSchedule.addEventListener('click',async()=>{
   if(sending)return;
   const person=Number(select.value),text=String(message.value||'').trim();
   if(!person||!text||text.length>4000){
     error.textContent='Choose a colleague and enter your message first.';
     error.hidden=false;return;
   }
   const when=String(dateInput.value||'')+'T'+String(timeInput.value||'');
   if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)){
     error.textContent='Choose both a date and time for delivery.';
     error.hidden=false;dateInput.focus();return;
   }
   sending=true;confirmSchedule.disabled=true;confirmSchedule.textContent='Scheduling…';
   scheduleBtn.disabled=true;error.hidden=true;
   try{
     const data=new FormData();
     data.set('assigned_to',String(person));
     data.set('message',text);
     data.set('scheduled_for',when);
     for(const file of files.files||[])data.append('attachments',file,file.name);
     const result=await api('/api/tk2m/communications/scheduled',{method:'POST',body:data});
     sending=false;
     closeQuick();
     say('Scheduled for '+result.scheduledFor.replace('T',' ')+' (South Africa time)');
     window.dispatchEvent(new Event('workspace:refresh'));
   }catch(err){error.textContent=err.message;error.hidden=false}
   finally{
     sending=false;confirmSchedule.disabled=false;
     confirmSchedule.textContent='Confirm schedule';scheduleBtn.disabled=false;
   }
 });
 async function showScheduled(){
   scheduledList.hidden=false;
   viewScheduled.setAttribute('aria-expanded','true');
   scheduledList.replaceChildren(el('p','','Loading scheduled messages…'));
   try{
     const data=await api('/api/tk2m/communications/scheduled');
     const items=Array.isArray(data.pending)?data.pending:[];
     scheduledList.replaceChildren();
     if(!items.length){
       scheduledList.append(el('p','','No messages awaiting scheduled delivery.'));
       return;
     }
     scheduledList.append(el('strong','','Scheduled – not delivered yet'));
     for(const item of items){
       const row=el('div','tk2m-scheduled-item');
       const body=el('span','');
       body.append(el('strong','',item.recipientName+' · '+item.scheduledFor.replace('T',' ')+' SAST'));
       body.append(el('small','',String(item.title||'Communication').slice(0,90)));
       const cancel=el('button','','Cancel');
       cancel.type='button';cancel.setAttribute('aria-label','Cancel scheduled message to '+item.recipientName);
       cancel.onclick=async()=>{
         if(sending)return;
         if(!window.confirm('Cancel this scheduled communication? It will not be sent.'))return;
         sending=true;cancel.disabled=true;
         try{
           await api('/api/tk2m/communications/scheduled/'+item.id+'/cancel',{method:'POST',body:'{}'});
           say('Scheduled communication cancelled');
           await showScheduled();
         }catch(err){error.textContent=err.message;error.hidden=false;}
         finally{sending=false;cancel.disabled=false}
       };
       row.append(body,cancel);scheduledList.append(row);
     }
   }catch(err){scheduledList.replaceChildren(el('p','',err.message))}
 }
 viewScheduled.addEventListener('click',()=>{
   if(sending)return;
   if(!scheduledList.hidden){
     scheduledList.hidden=true;viewScheduled.setAttribute('aria-expanded','false');
     return;
   }
   void showScheduled();
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
  '<div class="tk2m-brief-numbers"><article><strong data-tk2m-brief-messages>0</strong><span>Received & unfinished</span></article><article><strong data-tk2m-brief-tasks>0</strong><span>Sent & unfinished</span></article></div>'+
  '<p class="tk2m-brief-carry" data-tk2m-brief-carry></p>'+
  '<div class="tk2m-brief-list" data-tk2m-brief-list></div>'+
  '<p class="tk2m-brief-error" data-tk2m-brief-error role="alert" hidden></p>'+
  '<footer class="tk2m-brief-actions"><button type="button" data-tk2m-brief-open="communications">Open Communications</button>'+

  '<button type="button" class="primary" data-tk2m-brief-open="dismiss">Received — continue</button></footer>'+
  '</section>';
 document.body.appendChild(brief);
 const morningOrAfternoon=()=>briefOpen;
 function showBrief(kind,data){
   briefOpen=kind;
   const morning=kind==='morning';
   brief.querySelector('[data-tk2m-brief-time]').textContent=morning?'DAILY START-UP REVIEW':'16:30 DAILY FOLLOW-UP';
   brief.querySelector('#tk2m-brief-heading').textContent=morning?'OUTSTANDING FROM PREVIOUS DAYS':'STILL OUTSTANDING TODAY';
   brief.querySelector('[data-tk2m-brief-intro]').textContent=morning
    ?'Yesterday’s communications remain unfinished. Both sender and recipient can review them.'
    :'Unfinished communications are shown for both sender and recipient.';
   const counts=data.counts||{};
   brief.querySelector('[data-tk2m-brief-messages]').textContent=String(morning?(counts.receivedCarried||0):(counts.received||0));
   brief.querySelector('[data-tk2m-brief-tasks]').textContent=String(morning?(counts.sentCarried||0):(counts.sent||0));
   brief.querySelector('[data-tk2m-brief-carry]').textContent=morning
    ?'Outstanding communications remain in your combined list until completed.'
    :'Received and sent items requiring attention appear in one Communications list.';
   const list=brief.querySelector('[data-tk2m-brief-list]');
   list.replaceChildren();
   const cutoff=data.day||'';
   const tasks=(data.tasks||[]).filter(x=>!morning||String(x.createdAt||'').slice(0,10)<cutoff).slice(0,4);
   const messages=(data.messages||[]).filter(x=>!morning||String(x.createdAt||'').slice(0,10)<cutoff).slice(0,3);
   for(const item of tasks)list.appendChild(briefListItem(item.direction==='sent'?'SENT':'RECEIVED',item.title,item.direction==='sent'?'To '+item.recipient:'From '+item.sender));
   for(const item of messages)list.appendChild(briefListItem('RECEIVED',item.preview,item.sender));
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
       window.Talk2MeUnifiedInbox?.open?.({view:kind==='morning'?'outstanding':'today'});
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
