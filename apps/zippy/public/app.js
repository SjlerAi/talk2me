'use strict';
const $=sel=>document.querySelector(sel);
const $$=sel=>[...document.querySelectorAll(sel)];
const state={user:null,view:'today',reminders:[],contacts:[],alerts:[],activity:[],system:null,activeDraft:null,popupId:null,pendingInput:null,busy:false,recognition:null,mediaRecorder:null,mediaStream:null,conversation:[],replyLanguage:'en-ZA',speakBack:false,recognitionSource:'text',lastReminderSignal:0};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const zone='Africa/Johannesburg';
const when=iso=>{if(!iso)return 'Time not set';try{return new Intl.DateTimeFormat('en-ZA',{timeZone:zone,weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}catch(_){return 'Invalid time'}};
const dateString=()=>new Intl.DateTimeFormat('en-ZA',{timeZone:zone,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
const todayKey=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const keyFor=iso=>new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
async function api(path,{method='GET',body}={}){
 const response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method==='GET'?{}:{'X-Zippy-Action':'1'})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>({ok:false,error:'Server did not return JSON'}));
 if(response.status===401){if(path!=='/api/login')showLogin();throw Error(data.error||'Please sign in.');}
 if(!response.ok||data.ok===false)throw Error(data.error||'Something went wrong.');return data;
}
function showLogin(){state.user=null;state.reminders=[];state.contacts=[];state.alerts=[];state.activity=[];state.activeDraft=null;state.pendingInput=null;state.conversation=[];renderConversation();$('#review-panel').hidden=true;const popup=$('#reminder-popup');if(popup.open)popup.close();$('#login-view').hidden=false;$('#app-view').hidden=true;render();}
function showApp(profile){if(state.user?.email!==profile.email){state.reminders=[];state.contacts=[];state.alerts=[];state.activity=[];state.activeDraft=null;$('#review-panel').hidden=true;state.pendingInput=null;state.conversation=[];renderConversation();render();}state.user=profile;$('#login-view').hidden=true;$('#app-view').hidden=false;$('#account-avatar').textContent=String(profile.name||'Z').slice(0,1).toUpperCase();$('#account-avatar').title=(profile.name||'Your')+' account';$('#change-password').hidden=profile.authSource==='crm';const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(new Date()));$('#greeting').innerHTML=esc((hour<12?'Good morning, ':hour<17?'Good afternoon, ':'Good evening, ')+(profile.name||'there'))+' <span aria-hidden="true">✳</span>';$('#today-date').textContent=dateString();$('#connection-state').textContent=profile.crmConnected?'CRM connected':'Private mode';$('#connection-state').style.background=profile.crmConnected?'#e8f8f2':'#fff4db';$('#crm-connection-detail').textContent=profile.crmConnected?'Talk2Me is connected. All office messages require your confirmation.':'The Talk2Me secure bridge has not been activated. Personal reminders are fully separate and available now.';
 $('#push-setup').disabled=!profile.pushConfigured;$('#push-setup').title=profile.pushConfigured?'Allow phone reminders':'Push notifications require server setup';}
function say(text){
 if(!state.speakBack||!('speechSynthesis'in window)||!('SpeechSynthesisUtterance'in window))return;
 try{speechSynthesis.cancel();const reply=new SpeechSynthesisUtterance(String(text||'').slice(0,280));reply.lang=$('#language').value==='auto'?state.replyLanguage:$('#language').value;reply.rate=.98;speechSynthesis.speak(reply);}catch(_){}
}
function setStatus(message,{error=false}={}){
 const el=$('#command-status');if(!el)return;
 el.textContent=String(message||'');el.classList.toggle('error',error);
}
function renderConversation(){
 const el=$('#conversation-feed');if(!el)return;
 const items=(state.conversation||[]).slice(-60);
 el.innerHTML=items.length?items.map(item=>{
  const who=item.role==='user'?'You':'Zippy',role=item.role==='user'?'user':'assistant';
  return '<div class="chat-bubble '+role+'"><strong>'+who+'</strong><p>'+
   esc(String(item.text||''))+'</p></div>';
 }).join(''):'<div class="chat-bubble assistant"><strong>Zippy</strong><p>Hi! Speak or type — I’m here to help.</p></div>';
 el.scrollTop=el.scrollHeight;
}
async function refreshConversation(){
 if(!state.user)return;
 const response=await api('/api/conversation');
 state.conversation=response.messages||[];
 renderConversation();
}
function setMic(active,message){
 $('#mic-button').classList.toggle('listening',active);
 $('#mic-button').setAttribute('aria-pressed',String(active));
 if(message)$('#mic-hint').textContent=message;
}
function result(text,{type='success',html='',pending=null}={}){say(text);const el=$('#command-result');el.hidden=false;el.className='command-result'+(type==='error'?' error':type==='notice'?' notice':'');el.innerHTML='<div>'+esc(text)+'</div>'+html;state.pendingInput=pending;if(!state.activeDraft)el.scrollIntoView({behavior:'smooth',block:'nearest'});}
function loading(val){state.busy=val;$('#command-send').disabled=val;$('#mic-button').disabled=val;$('#command-send').textContent=val?'…':'Send ➜';}
function renderReminder(item){const completed=item.state==='done',fired=item.state==='fired';const past=new Date(item.dueAt)<new Date();const emoji=item.entry_type==='appointment'?'▣':'◷';let buttons='';if(!completed){buttons='<button data-action="done" data-id="'+Number(item.id)+'">Done</button>'+(!fired?'<button data-action="snooze" data-id="'+Number(item.id)+'">+10m</button>':'<button data-action="snooze" data-id="'+Number(item.id)+'">Again</button>');}
 let call='';const relation=state.contacts.find(c=>String(c.relationship||'').toLowerCase()==='mother'||String(c.relationship||'').toLowerCase()==='ma');if(relation?.phone&&/\b(mother|mom|mama|ma|mamma)\b/i.test(item.title||'')){call='<a class="call-link" href="tel:'+esc(relation.phone.replace(/[^+0-9]/g,''))+'" title="Call contact">Call</a>'}
 return '<div class="reminder-item'+(completed?' done':'')+'"><span class="item-mark">'+emoji+'</span><div class="item-body"><strong>'+esc(item.title)+'</strong><small>'+esc(when(item.dueAt))+(past&&!completed?' · Due':'')+(item.recurrence?' · Repeats':'')+'</small></div><div class="item-actions">'+call+buttons+'</div></div>';
}
function render(){const list=state.reminders||[];const active=list.filter(x=>x.state==='open'||x.state==='fired');const today=active.filter(x=>keyFor(x.dueAt)===todayKey());$('#today-count').textContent=String(today.length);$('#today-description').textContent=today.length===1?'reminder to keep track of today':'reminders to keep track of today';$('#today-reminders').innerHTML=active.slice(0,5).map(renderReminder).join('')||'<p class="empty">Your mind is clear. Tell Zippy what to remember.</p>';$('#all-reminders').innerHTML=list.map(renderReminder).join('')||'<p class="empty">No reminders yet. Zippy is ready when you are.</p>';
 $('#contacts-list').innerHTML=state.contacts.map(c=>'<div class="reminder-item"><span class="item-mark">♙</span><div class="item-body"><strong>'+esc(c.name)+'</strong><small>'+esc(c.relationship||'Personal contact')+' · '+esc(c.phone||'No number yet')+'</small></div><div class="item-actions">'+(c.phone?'<a class="call-link" href="tel:'+esc(c.phone.replace(/[^0-9+]/g,''))+'">Call</a>':'')+'<button data-contact-remove="'+Number(c.id)+'">Remove</button></div></div>').join('')||'<p class="empty">Add private contacts, such as your mother or a friend.</p>';
 $('#alerts-list').innerHTML=state.alerts.slice(0,8).map(a=>'<div class="reminder-item alert-item"><span class="item-mark">♧</span><div class="item-body"><strong>'+esc(a.title)+'</strong><small>'+esc(when(a.createdAt))+(a.read_at?' · Read':' · New')+'</small></div>'+(a.read_at?'':'<div class="item-actions"><button data-alert-read="'+Number(a.id)+'">Dismiss</button></div>')+'</div>').join('')||'<p class="empty">You have no notifications. All caught up.</p>';}
function renderTimeline(){
 const feed=state.activity||[];
 $('#activity-list').innerHTML=feed.slice(0,24).map(item=>{
  const names={reminder_saved:'◷',reminder_due:'⏰',crm_sent:'↗',crm_reply:'↩',crm_completed:'✓',crm_status:'↻',crm_overdue:'!'};
  const task=Number(item.taskId)||null;
  return '<article class="timeline-item '+esc(item.kind)+'"><span class="timeline-mark" aria-hidden="true">'+
   (names[item.kind]||'✓')+'</span><div class="timeline-text"><strong>'+esc(item.title)+'</strong>'+
   '<p>'+esc(item.body||'')+'</p><small>'+esc(when(item.createdAt))+
   (task?' · CRM task #'+task:' · Personal')+'</small></div>'+
   (task?'<a class="timeline-link" href="https://uent.co.za/talk2me/workspace" target="_blank" rel="noopener">Open CRM ↗</a>':'')+'</article>';
 }).join('')||'<p class="empty">No actions yet. Your saved reminders, messages and real CRM replies will appear here.</p>';
 const sys=state.system;
 if(sys){
  const scheduler=sys.scheduler?.running?'Reminder scheduler ✓':'Reminder scheduler needs attention';
  const push=sys.push?.deviceSubscriptions>0?'Phone alerts enabled for this account':'Phone alerts not yet enabled';
  $('#live-status').textContent=scheduler+' · '+push+(sys.crmConnected?' · CRM connected':' · CRM not connected');
 }else $('#live-status').textContent='Checking reminder and notification service…';
}
function dueReminder(){
 if(!state.user||document.visibilityState==='hidden')return;
 const due=(state.alerts||[]).find(a=>!a.read_at&&state.reminders.some(r=>Number(r.id)===Number(a.reminder_id)
  &&r.state!=='done'&&r.state!=='cancelled'));
 if(!due)return;
 const dialog=$('#reminder-popup');
 if(dialog.open&&state.popupId===Number(due.id))return;
 const item=state.reminders.find(r=>Number(r.id)===Number(due.reminder_id));
 if(!item)return;
 if(dialog.open)dialog.close();
 state.popupId=Number(due.id);
 $('#popup-title').textContent='Remember: '+item.title;
 $('#popup-body').textContent='Zippy is reminding you to '+item.title.replace(/^[Rr]emind me to\s+/,'')+'.';
 $('#popup-when').textContent='Scheduled '+when(aDueTime(due,item));
 const who=(state.contacts||[]).find(c=>/^(?:mother|ma|mom|mamma)$/i.test(String(c.relationship||'')));
 const call=who&&/\b(mother|mom|ma|mamma)\b/i.test(item.title)&&who.phone;
 $('#popup-call').hidden=!call;
 if(call)$('#popup-call').href='tel:'+String(who.phone).replace(/[^+\d]/g,'');
 try{dialog.showModal();}catch(_){dialog.setAttribute('open','');}
 if(Date.now()-state.lastReminderSignal>30000){
  state.lastReminderSignal=Date.now();
  try{navigator.vibrate?.([250,140,250,140,350]);}catch(_){}
  // Audio may be blocked without an earlier user gesture; the visual alert
  // always remains visible regardless of sound/vibration permissions.
  try{if(state.speakBack)say('Zippy reminder. '+item.title);}catch(_){}
 }
}
function aDueTime(alert,item){return alert.scheduledAt||item.dueAt||alert.createdAt;}
async function refresh(){
 if(!state.user)return;
 const [r,c,a,feed,status]=await Promise.all([
  api('/api/reminders'),api('/api/contacts'),api('/api/alerts'),
  api('/api/activity'),api('/api/system/status')
 ]);
 state.reminders=r.reminders||[];state.contacts=c.contacts||[];state.alerts=a.alerts||[];
 state.activity=feed.items||[];state.system=status;
 render();renderTimeline();dueReminder();
}
function view(name){if(!['today','reminders','contacts','office'].includes(name))return;state.view=name;$$('[data-view]').forEach(el=>el.classList.toggle('selected',el.dataset.view===name));$('#today-grid').hidden=name!=='today';$('#reminders-view').hidden=name!=='reminders';$('#contacts-view').hidden=name!=='contacts';$('#office-view').hidden=name!=='office';$('#hero').hidden=name!=='today';$('#alerts-panel').hidden=name==='contacts'||name==='office';if(name==='reminders')$('#reminders-view').scrollIntoView({behavior:'smooth',block:'start'});}
function reviewedMessage(preview,heard=''){
 const name=String(preview.assignee?.displayName||preview.assignee?.name||'colleague').trim();
 const reference=String(preview.reference?.name||'').trim();
 let instruction=String(preview.instruction||'').trim();
 const af=/(?:^|\s)(?:vra|s[eê]|asseblief|bel|skakel|om my)\b/i.test(heard);
 if(reference&&/^(?:my|me)\s+(?:te\s+)?(?:bel|skakel|phone|call)$/i.test(instruction)){
  instruction=af?'Kan jy asseblief vir '+reference+' bel?':'Please phone '+reference+'.';
 }
 if(!instruction)instruction=String(heard||'Please follow up as discussed.').trim();
 const initial=instruction.charAt(0).toUpperCase()+instruction.slice(1);
 return (af?'Hallo ':'Hi ')+name+',\n\n'+initial+'\n\n'+(af?'Dankie.':'Thank you.');
}
function isExactStaffName(pv){
 const heard=String(pv.assignee?.heard||'').trim().toLowerCase();
 const actual=String(pv.assignee?.displayName||pv.assignee?.name||'').trim().split(/\s+/)[0].toLowerCase();
 return heard===actual;
}
function officePreview(data,{resume=false}={}){
 const pv=data.preview||{},name=pv.assignee?.displayName||pv.assignee?.name||'CRM staff';
 state.activeDraft={id:data.draftId,preview:pv,expiresAt:data.expiresAt||null};
 $('#review-recipient').textContent='To: '+name+' · Talk2Me CRM';
 $('#review-reference').textContent=pv.reference
  ?'Verified CRM person: '+pv.reference.name+' ('+pv.reference.kind+')'+(pv.reference.phone?' · '+pv.reference.phone:'')
  :'This instruction will be assigned to the selected staff member.';
 $('#review-message').value=reviewedMessage(pv,data.heard||'');
 const due=String(pv.dueAt||'').trim();
 const dueDate=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(due)
  ?new Date(due.replace(' ','T')+'+02:00'):new Date(due);
 $('#review-deadline').textContent='Follow-up deadline: '+
  (Number.isFinite(dueDate.getTime())?when(dueDate.toISOString()):'Confirm in Talk2Me');
 const fuzzy=Boolean(pv.confirmName&&!isExactStaffName(pv));
 $('#recipient-check-wrap').hidden=!fuzzy;
 $('#recipient-verify').value='';
 $('#review-hint').textContent=fuzzy
  ?'The spoken name may be approximate. Type the confirmed CRM staff first name before sending.'
  :'Nothing has been sent. Read or edit the message, then click Send or say "send" / "stuur".';
 $('#review-panel').hidden=false;
 result(resume?'Unsent draft restored for your review.':"Message prepared for "+name+". Check it before sending.",{type:'notice'});
 if(!resume)$('#review-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function hideDraft(){state.activeDraft=null;$('#review-panel').hidden=true;$('#recipient-verify').value='';}
function speakMessage(){
 const draft=state.activeDraft;
 if(!draft)return result('There is no message waiting for review.',{type:'notice'});
 if(!('speechSynthesis'in window)||!('SpeechSynthesisUtterance'in window))
  return result('Spoken reading is unavailable in this browser. The complete message is visible above.',{type:'notice'});
 try{
  speechSynthesis.cancel();
  const speech=new SpeechSynthesisUtterance($('#review-message').value);
  speech.lang=$('#language').value==='auto'?state.replyLanguage:$('#language').value;speech.rate=.88;
  speechSynthesis.speak(speech);
 }catch(e){result('Your browser could not read this message aloud.',{type:'notice'});}
}
async function sendDraft(byVoice=false){
 const draft=state.activeDraft;
 if(!draft)return result('No reviewed CRM message is waiting to be sent.',{type:'notice'});
 if(draft.expiresAt&&Date.now()>new Date(draft.expiresAt).getTime()){
  return result('This approval has expired for safety. Cancel and repeat the instruction to prepare a fresh draft.',{type:'error'});
 }
 const body=$('#review-message').value.trim();
 if(body.length<3||body.length>1750)return result('Please enter a message of 3 to 1,750 characters.',{type:'error'});
 const typed=$('#recipient-verify').value.trim(),near=Boolean(draft.preview.confirmName&&!isExactStaffName(draft.preview));
 if(near&&!typed)return result('Please type the CRM recipient’s verified first name before sending.',{type:'error'});
 const btn=$('#review-send');btn.disabled=true;
 try{
  const sent=await api('/api/crm/confirm',{method:'POST',body:{
   draftId:draft.id,editedMessage:body,typedName:typed,
   approvalMode:draft.preview.confirmName&&!near?'voice':'button'
  }});
  hideDraft();
  result(sent.text||'Sent to Talk2Me CRM. The task is being monitored.');
  await refresh();
 }catch(error){
  // Never automatically retry an uncertain send. Only the explicit button/
  // spoken approval can trigger a new submission.
  result(error.message+' Check Talk2Me if the connection was interrupted; do not send twice.',{type:'error'});
 }finally{btn.disabled=false;}
}
async function cancelDraft(){
 const draft=state.activeDraft;if(!draft)return;
 try{await api('/api/crm/cancel',{method:'POST',body:{draftId:draft.id}});}
 catch(e){result('Unable to cancel on the server: '+e.message,{type:'error'});return;}
 hideDraft();result('Cancelled. Nothing was sent.',{type:'notice'});
}
function draftSpeech(text){
 if(!state.activeDraft)return false;
 const s=String(text||'').trim().toLowerCase().replace(/[.!?]+$/,'').trim();
 if(/^(?:yes[\s,]+)?(?:send|send it|send message|send the message|stuur|stuur dit|stuur die boodskap|ja stuur|ja stuur dit|ja send|yes send)$/i.test(s)){
  sendDraft(true);return true;
 }
 if(/^(?:read|read it|read message|read the message|lees|lees die boodskap|lees dit|read aloud)$/i.test(s)){
  speakMessage();return true;
 }
 if(/^(?:cancel|cancel message|don't send|do not send|kanselleer|moenie stuur nie|moet nie stuur nie)$/i.test(s)){
  cancelDraft();return true;
 }
 const replacement=s.match(/^(?:change|replace|edit|verander|wysig)\s+(?:the\s+|die\s+)?(?:message|boodskap|it|dit)?\s*(?:to|na|met)\s+(.+)$/i);
 if(replacement&&replacement[1]){
  $('#review-message').value=replacement[1].trim();
  result('Message changed. Please read it and say “send” when ready.',{type:'notice'});
  return true;
 }
 if(/^(?:change|edit|verander|wysig)(?: it| dit| the message| die boodskap)?$/i.test(s)){
  $('#review-message').focus();
  result('Edit the message above or dictate “change message to…”',{type:'notice'});
  return true;
 }
 result('Your draft is still NOT SENT. Say “send”, “read message”, “change message to…” or “cancel”.',{type:'notice'});
 return true;
}
async function submitCommand(event){
 if(event)event.preventDefault();
 if(state.busy)return;
 let message=$('#command-input').value.trim();
 if(!message){setStatus('Speak or type a message before sending.');return;}
 if(state.activeDraft){
  const done=draftSpeech(message);
  if(done)$('#command-input').value='';
  return;
 }
 if(/^(?:send|send it|stuur|ja stuur|yes send)$/i.test(message)){
  return result('There is no reviewed message ready to send. First tell Zippy the instruction.',{type:'notice'});
 }
 if(state.pendingInput){
  const raw=state.pendingInput.original;
  const isNew=/^(zippy|remind|herinner|ask|tell|vra|stuur|send|book|schedule|i have)/i.test(message);
  if(!isNew&&raw)message=raw+' '+(/\b(at|om|teen|by)\b/i.test(message)?'':'at ')+message;
  state.pendingInput=null;
 }
 loading(true);setStatus('Checking your request…');
 try{
  const response=await api('/api/interpret',{method:'POST',body:{
   message,source:state.recognitionSource||'text',language:$('#language').value
  }});
  // Clear ONLY after the server accepted the request. Never lose a transcript
  // because of network or language-recognition failure.
  $('#command-input').value='';state.recognitionSource='text';
  state.replyLanguage=response.language||state.replyLanguage;
  if(response.status==='saved'){
   result(response.text);await refresh();
  }else if(response.status==='question'){
   result(response.question||response.text,{type:'notice',pending:{original:response.original||message}});
   $('#command-input').focus();
  }else if(response.status==='crm_preview'){
   officePreview(response);
  }else if(response.status==='agenda'){
   view('today');result(response.text);await refresh();
  }else if(response.status==='chat'||response.status==='crm_report'){
   result(response.text||'What else can I help with?');
  }else{
   result(response.text||response.question||'I need one more detail before I can do that.',{type:'notice'});
  }
  await refreshConversation().catch(()=>{});
  setStatus(response.status==='crm_preview'?'Draft ready. Review and approve before sending.':
   response.status==='crm_unavailable'?'The CRM could not be checked.': 'Answered. You can ask me something else.');
 }catch(error){
  setStatus('Not sent. Your words are still here; please try again.',{error:true});
  result(error.message,{type:'error'});
 }finally{loading(false);}
}
async function restorePendingDraft(){
 if(!state.user||state.activeDraft)return;
 try{
  const response=await api('/api/crm/pending');
  if(response.draft?.preview)officePreview(response.draft,{resume:true});
 }catch(_){/* Do not block personal reminders if the CRM draft is unavailable. */}
}
async function startVoice(){
 if(state.busy)return;
 // A second microphone tap stops the recording; it NEVER sends the message.
 if(state.mediaRecorder?.state==='recording'){
  state.mediaRecorder.stop();setStatus('Transcribing your recording…');return;
 }
 if(state.recognition){
  state.recognition.stop();setStatus('Finishing what I heard…');return;
 }
 const input=$('#command-input'),mode=$('#language').value;
 if(state.user?.voiceConfigured&&navigator.mediaDevices?.getUserMedia&&window.MediaRecorder){
  let stream;
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
   const preferred=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'];
   const type=preferred.find(t=>MediaRecorder.isTypeSupported(t));
   const options=type?{mimeType:type}:{};
   const recorder=new MediaRecorder(stream,options),chunks=[];
   state.mediaRecorder=recorder;state.mediaStream=stream;
   setMic(true,'Recording. Tap the microphone again to stop; then review and send.');
   setStatus('Listening…');
   recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
   recorder.onerror=()=>{setMic(false,'Recording failed. Type your message or try again.');setStatus('Microphone error.',{error:true});};
   recorder.onstop=async()=>{
    state.mediaRecorder=null;state.mediaStream=null;stream.getTracks().forEach(t=>t.stop());
    setMic(false,'Transcribing… your message is not sent.');
    const mime=recorder.mimeType||type||'audio/webm';
    const audio=new Blob(chunks,{type:mime});
    if(audio.size<200){setStatus('I did not hear enough audio. Try speaking again.',{error:true});return;}
    loading(true);
    try{
     const response=await fetch('/api/voice/transcribe',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':mime,'X-Zippy-Action':'1','X-Zippy-Language':mode},body:audio});
     const data=await response.json().catch(()=>({ok:false,error:'Speech service returned no response.'}));
     if(response.status===401){showLogin();throw Error('Please sign in again.');}
     if(!response.ok||data.ok===false)throw Error(data.error||'Could not transcribe the recording.');
     const text=String(data.text||'').trim(),prior=input.value.trim();
     if(!text)throw Error('No words were recognised. Try again or type.');
     input.value=prior?prior+' '+text:text;
     state.replyLanguage=data.language||state.replyLanguage;
     state.recognitionSource='voice';
     setStatus('I heard your message. Review or edit the words, then tap Send.');
     $('#mic-hint').textContent='Recording complete. Your words stay here until you send them.';
     input.focus();
    }catch(error){
     setStatus('Not sent. '+error.message,{error:true});
     result(error.message,{type:'error'});
    }finally{loading(false);}
   };
   recorder.start(250);
   setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},30000);
   return;
  }catch(error){
   if(stream)stream.getTracks().forEach(t=>t.stop());
   state.mediaRecorder=null;state.mediaStream=null;
   setMic(false,'Microphone access was denied or unavailable. You can still type.');
   setStatus('Microphone not available. '+(error.name==='NotAllowedError'?'Allow microphone permission.':'Please try typing.'),{error:true});
   return;
  }
 }
 // Local fallback: some browsers do not support microphone recording or the
 // optional server transcription is not configured. Do not auto-send results.
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Speech){
  setStatus('Voice transcription is unavailable here. Please type your request.',{error:true});
  return;
 }
 const rec=new Speech(),previous=input.value.trim();
 rec.lang=mode==='auto'?'en-ZA':mode;rec.continuous=false;rec.interimResults=true;
 state.recognition=rec;setMic(true,'Listening… tap the microphone again to stop.');
 setStatus(mode==='auto'?'Browser recognition is using English. Select Afrikaans for Afrikaans speech.':'Listening…');
 let heard='';
 rec.onresult=e=>{
  const words=[];
  for(let i=0;i<e.results.length;i++)words.push(String(e.results[i][0]?.transcript||'').trim());
  heard=words.filter(Boolean).join(' ');
  input.value=[previous,heard].filter(Boolean).join(' ');
 };
 rec.onerror=e=>{
  if(e.error!=='aborted')setStatus(e.error==='not-allowed'?'Allow microphone access to use voice.':
    'Voice was interrupted. Any words shown above are retained.',{error:true});
 };
 rec.onend=()=>{
  state.recognition=null;
  setMic(false,'Review your words and tap Send, or type a correction.');
  if(heard){
   input.value=[previous,heard].filter(Boolean).join(' ');
   state.recognitionSource='voice';
   setStatus('I heard your message. Review the words, then tap Send.');
  }else if(!input.value.trim())setStatus('No words recognised. Try again or type.',{error:true});
 };
 try{rec.start();}catch(error){
  state.recognition=null;setMic(false,'Microphone unavailable.');
  setStatus('The microphone could not start. Try typing instead.',{error:true});
 }
}
async function enableNotifications(){try{if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){result('Background notifications are not supported in this browser. You can still view reminders inside Zippy.',{type:'notice'});return;}if(!state.user.pushConfigured){result('The notification service must be configured on the Zippy server first.',{type:'notice'});return;}const permission=await Notification.requestPermission();if(permission!=='granted'){result('Please allow notifications for Zippy in your phone or browser settings.',{type:'notice'});return;}const reg=await navigator.serviceWorker.ready;const key=state.user.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(key+'='.repeat((4-key.length%4)%4));const arr=new Uint8Array([...raw].map(ch=>ch.charCodeAt(0)));const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:arr});await api('/api/push/subscribe',{method:'POST',body:{subscription:sub.toJSON()}});result('Zippy notifications are enabled on this device.');$('#push-setup').innerText='Alerts on';}catch(e){result('Notification setup: '+e.message,{type:'error'});}}
async function login(e){e.preventDefault();const el=$('#login-error');el.hidden=true;try{const response=await api('/api/login',{method:'POST',body:{email:$('#login-email').value,password:$('#login-password').value}});$('#login-password').value='';const profile=await api('/api/me');showApp(profile);await refresh();await restorePendingDraft();}catch(e){el.textContent=e.message;el.hidden=false;}}
async function remindForm(e){e.preventDefault();const form=$('#new-reminder-form');const fd=new FormData(form);const date=new Date(String(fd.get('dueAt')));try{const recur=String(fd.get('recurrence')||'');let recurrence=recur;if(recur==='weekly')recurrence='weekly:'+date.getDay();const data=await api('/api/reminders',{method:'POST',body:{title:fd.get('title'),dueAt:date.toISOString(),entryType:'reminder',recurrence}});$('#new-reminder-dialog').close();form.reset();result(data.text);await refresh();}catch(e){result(e.message,{type:'error'});}}
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;$('#install-button').hidden=false;});
async function installApp(){if(!deferredInstall){result('On iPhone: tap Share → Add to Home Screen. On desktop: use your browser Install App menu.',{type:'notice'});return;}deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#install-button').hidden=true;}
function bind(){
 $('#login-form').onsubmit=login;$('#command-form').onsubmit=submitCommand;$('#mic-button').onclick=startVoice;$('#push-setup').onclick=enableNotifications;$('#install-button').onclick=installApp;
 $('#review-read').onclick=speakMessage;
 $('#review-send').onclick=()=>sendDraft(false);
 $('#review-cancel').onclick=cancelDraft;
 $('#refresh-actions').onclick=async()=>{
  const b=$('#refresh-actions');b.disabled=true;
  try{await api('/api/activity/sync',{method:'POST',body:{}});await refresh();result('Checked the CRM for recorded replies and task progress.');}
  catch(e){result('Could not refresh CRM activity: '+e.message,{type:'notice'});}
  finally{b.disabled=false;}
 };
 const actOnDue=async kind=>{
  const alert=state.alerts.find(a=>Number(a.id)===state.popupId);
  if(!alert)return;
  const target=Number(alert.reminder_id);
  try{
   await api('/api/reminders/'+target+'/action',{method:'POST',body:{action:kind,minutes:10}});
   if($('#reminder-popup').open)$('#reminder-popup').close();
   state.popupId=null;await refresh();
   result(kind==='done'?'Reminder acknowledged.':'Snoozed for 10 minutes.');
  }catch(e){result('Could not update the reminder: '+e.message,{type:'error'});}
 };
 $('#popup-done').onclick=()=>actOnDue('done');
 $('#popup-snooze').onclick=()=>actOnDue('snooze');
 $('#reminder-popup').addEventListener('cancel',event=>event.preventDefault());
 try{state.speakBack=localStorage.getItem('zippy-speak-back')==='1';}catch(_){}
 $('#voice-replies').setAttribute('aria-pressed',String(state.speakBack));
 $('#voice-replies').onclick=()=>{state.speakBack=!state.speakBack;$('#voice-replies').setAttribute('aria-pressed',String(state.speakBack));$('#voice-replies').textContent=state.speakBack?'🔊 Replies on':'🔇 Voice replies off';try{localStorage.setItem('zippy-speak-back',state.speakBack?'1':'0');}catch(_){}};
 $('#language').onchange=()=>{try{localStorage.setItem('zippy-voice-language',$('#language').value);}catch(_){}};
 try{const saved=localStorage.getItem('zippy-voice-language');if(['af-ZA','en-ZA'].includes(saved))$('#language').value=saved;}catch(_){}
 $('#change-password').onclick=()=>{$('#password-error').hidden=true;$('#password-form').reset();$('#password-dialog').showModal();};
 $('#cancel-password').onclick=()=>$('#password-dialog').close();
 $('#password-form').onsubmit=async event=>{
  event.preventDefault();const f=new FormData(event.currentTarget),error=$('#password-error');error.hidden=true;
  if(f.get('newPassword')!==f.get('confirmPassword')){error.textContent='The new passwords do not match.';error.hidden=false;return;}
  try{await api('/api/password/change',{method:'POST',body:{currentPassword:f.get('currentPassword'),newPassword:f.get('newPassword')}});
   $('#password-dialog').close();showLogin();$('#login-error').textContent='Password updated. Sign in with your new password.';$('#login-error').hidden=false;
  }catch(e){error.textContent=e.message;error.hidden=false;}
 };
 $('#signout').onclick=async()=>{try{await api('/api/logout',{method:'POST',body:{}});}catch(_){}showLogin();};
 $$('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
 $$('[data-example]').forEach(b=>b.addEventListener('click',()=>{$('#command-input').value=b.dataset.example;state.pendingInput=null;$('#command-input').focus();document.querySelector('.command-section').scrollIntoView({behavior:'smooth'});}));
 $('#add-reminder').onclick=()=>$('#new-reminder-dialog').showModal();$('#close-reminder-dialog').onclick=()=>$('#new-reminder-dialog').close();$('#new-reminder-form').onsubmit=remindForm;
 $('#contact-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/contacts',{method:'POST',body:Object.fromEntries(f.entries())});e.currentTarget.reset();await refresh();result('Private contact saved.');}catch(err){result(err.message,{type:'error'});}};
 document.addEventListener('click',async e=>{const act=e.target.closest('[data-action]');const contact=e.target.closest('[data-contact-remove]');const read=e.target.closest('[data-alert-read]');try{if(act){await api('/api/reminders/'+act.dataset.id+'/action',{method:'POST',body:{action:act.dataset.action,minutes:10}});await refresh();}if(contact){if(!confirm('Remove this private contact?'))return;await api('/api/contacts/'+contact.dataset.contactRemove,{method:'DELETE',body:{}});await refresh();}if(read){await api('/api/alerts/'+read.dataset.alertRead+'/read',{method:'POST',body:{}});await refresh();}}catch(err){result(err.message,{type:'error'});}});
}
async function init(){bind();if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});try{const profile=await api('/api/me');if(profile.authenticated){showApp(profile);await refresh();await restorePendingDraft();}else showLogin();}catch(_){showLogin();}
 setInterval(()=>{if(state.user&&document.visibilityState!=='hidden')refresh().catch(err=>console.warn('[zippy] Poll failed',err.message));},25000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.user)refresh().catch(()=>{});});
 window.addEventListener('focus',()=>{if(state.user)refresh().catch(()=>{});});
 }
init();
