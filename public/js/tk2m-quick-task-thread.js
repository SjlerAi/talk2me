(() => {
  'use strict';
  if(location.hostname!=='crm.tk2m.co.za'||window.top!==window||window.Talk2MeQuickTaskThread)return;
  const config=document.getElementById('talk2me-os-config');
  if(!config)return;
  const base=String(JSON.parse(config.textContent||'{}').basePath||'');
  const holder=document.createElement('div');
  holder.id='tk2m-quick-task-thread';
  holder.className='tk2m-thread-overlay';
  holder.hidden=true;
  holder.setAttribute('role','dialog');
  holder.setAttribute('aria-modal','true');
  holder.setAttribute('aria-labelledby','tk2m-thread-heading');
  holder.innerHTML=
   '<section class="tk2m-thread-window">'+
   '<header class="tk2m-thread-red"><div><small id="tk2m-thread-from">TASK</small><h2 id="tk2m-thread-heading">Task conversation</h2></div>'+
   '<button type="button" class="tk2m-thread-x" data-tk2m-thread-close aria-label="Close task conversation">×</button></header>'+
   '<div class="tk2m-thread-body">'+
   '<div class="tk2m-thread-original"><strong id="tk2m-thread-title"></strong><p id="tk2m-thread-message"></p>'+
   '<small id="tk2m-thread-meta"></small></div>'+
   '<div class="tk2m-thread-history" id="tk2m-thread-history" aria-label="Replies and updates"></div>'+
   '<div class="tk2m-thread-files" id="tk2m-thread-files"></div>'+
   '</div><form data-tk2m-thread-reply class="tk2m-thread-form">'+
   '<label for="tk2m-thread-reply-input">Reply or completion note</label>'+
   '<textarea id="tk2m-thread-reply-input" name="comment" placeholder="Type a quick reply..." rows="2" maxlength="4000"></textarea>'+
   '<p class="tk2m-thread-error" role="alert" data-tk2m-thread-error hidden></p>'+
   '<div class="tk2m-thread-actions"><button type="submit" data-tk2m-thread-send class="tk2m-thread-send">Send reply</button>'+
   '<button type="button" data-tk2m-thread-complete class="tk2m-thread-complete" hidden>Complete Task</button>'+
   '<button type="button" data-tk2m-thread-accept class="tk2m-thread-accept" hidden>Accept completed</button>'+
   '<button type="button" data-tk2m-thread-return class="tk2m-thread-return" hidden>Return for follow-up</button></div>'+
   '</form></section>';
  document.body.appendChild(holder);
  const heading=holder.querySelector('#tk2m-thread-heading');
  const from=holder.querySelector('#tk2m-thread-from');
  const title=holder.querySelector('#tk2m-thread-title');
  const message=holder.querySelector('#tk2m-thread-message');
  const meta=holder.querySelector('#tk2m-thread-meta');
  const history=holder.querySelector('#tk2m-thread-history');
  const files=holder.querySelector('#tk2m-thread-files');
  const text=holder.querySelector('#tk2m-thread-reply-input');
  const error=holder.querySelector('[data-tk2m-thread-error]');
  const send=holder.querySelector('[data-tk2m-thread-send]');
  const complete=holder.querySelector('[data-tk2m-thread-complete]');
  const accept=holder.querySelector('[data-tk2m-thread-accept]');
  const returnBtn=holder.querySelector('[data-tk2m-thread-return]');
  let selected=null,busy=false,pending=false;
  async function api(path,options={}){
    const response=await fetch(base+path,{
      credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json',...(options.body&&!(options.body instanceof FormData)?{'Content-Type':'application/json'}:{})},
      ...options
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw Error(data.error||'Request failed ('+response.status+')');
    return data;
  }
  function row(textValue,subValue){
    const div=document.createElement('div');div.className='tk2m-thread-entry';
    const p=document.createElement('p');p.textContent=String(textValue||'');
    const sub=document.createElement('small');sub.textContent=String(subValue||'');
    div.append(p,sub);return div;
  }
  function showError(e){
    error.textContent=e?.message||String(e||'Could not save. Please try again.');
    error.hidden=false;
  }
  function setButtons(){
    const permissions=selected?.permissions||{};
    send.disabled=busy||!permissions.canComment;
    complete.disabled=busy;accept.disabled=busy;returnBtn.disabled=busy;
    complete.hidden=!permissions.canUpdate;
    accept.hidden=!permissions.canApprove;
    returnBtn.hidden=!permissions.canApprove;
    send.hidden=!permissions.canComment;
  }
  function close(){
    if(busy)return;
    holder.hidden=true;selected=null;text.value='';error.hidden=true;
    document.body.classList.remove('tk2m-thread-active');
  }
  async function open(id){
    const taskId=Number(id);
    if(!Number.isSafeInteger(taskId)||taskId<=0)return false;
    if(busy)return false;
    holder.hidden=false;document.body.classList.add('tk2m-thread-active');
    selected=null;text.value='';error.hidden=true;
    heading.textContent='Opening task…';from.textContent='TASK';
    title.textContent='';message.textContent='';meta.textContent='';
    history.replaceChildren();files.replaceChildren();
    complete.hidden=true;accept.hidden=true;returnBtn.hidden=true;
    send.disabled=true;
    try{
      const data=await api('/api/uat/tasks/'+taskId);
      selected=data;const task=data.task||{};
      from.textContent='FROM '+String(task.created_by_name||'Colleague');
      heading.textContent='REPLY / COMPLETE';
      title.textContent=String(task.title||'Task');
      message.textContent=String(task.message||'');
      meta.textContent='To '+String(task.assigned_name||'Staff')+' · '+String(task.workflow_state||task.status||'open').replace(/_/g,' ');
      const comments=(Array.isArray(data.comments)?data.comments:[]).filter(x=>
        !/^(Task created|Opened \/ seen|Status changed to )/.test(String(x.comment||'')));
      for(const item of comments){
        const when=item.created_at?new Date(item.created_at).toLocaleString('en-ZA',{dateStyle:'short',timeStyle:'short'}):'';
        history.appendChild(row(item.comment,String(item.full_name||'Staff')+(when?' · '+when:'')));
      }
      if(!comments.length)history.appendChild(row('No replies yet.',''));
      for(const file of Array.isArray(data.attachments)?data.attachments:[]){
        const a=document.createElement('a');a.href=String(file.url||'#');
        a.textContent='📎 '+String(file.name||'Attachment');a.target='_blank';a.rel='noopener';
        files.appendChild(a);
      }
      setButtons();text.focus();return true;
    }catch(e){showError(e);return false;}
  }
  async function mutate(kind){
    if(!selected||busy)return;
    const id=Number(selected.task?.id),reply=text.value.trim(),permissions=selected.permissions||{};
    if(!id)return;
    if(kind==='reply'&&!reply){showError('Type a reply before sending.');return;}
    if(kind==='return'&&!reply){showError('Type what still needs to be done before returning the task.');return;}
    if(kind==='complete'&&!permissions.canUpdate||kind==='accept'&&!permissions.canApprove||kind==='reply'&&!permissions.canComment||kind==='return'&&!permissions.canApprove)return;
    busy=true;error.hidden=true;setButtons();
    try{
      if(kind==='reply'){
        const form=new FormData();form.set('comment',reply);
        await api('/api/uat/tasks/'+id+'/comments',{method:'POST',body:form});
      }else if(kind==='complete'){
        // The API requires a completion note. A deliberate tap on Complete Task
        // supplies a neutral one when no custom note is typed.
        await api('/api/uat/tasks/'+id+'/status',{
          method:'POST',body:JSON.stringify({status:'completed',completion_note:reply||'Completed'})
        });
      }else if(kind==='accept'){
        await api('/api/uat/tasks/'+id+'/decision',{method:'POST',body:JSON.stringify({action:'accept'})});
      }else if(kind==='return'){
        await api('/api/uat/tasks/'+id+'/decision',{method:'POST',body:JSON.stringify({action:'return',reason:reply})});
      }
      window.dispatchEvent(new Event('workspace:refresh'));
      if(kind==='complete'||kind==='accept'||kind==='return'){
        selected=null;holder.hidden=true;document.body.classList.remove('tk2m-thread-active');
      }else{
        selected=null;
        const data=await api('/api/uat/tasks/'+id);
        selected=data;
        // The message was saved. Refresh thread on the next microtask.
      }
      text.value='';
      if(kind==='reply'){
        busy=false;
        await open(id);
      }
    }catch(e){showError(e);}
    finally{busy=false;setButtons();}
  }
  holder.querySelector('[data-tk2m-thread-close]').addEventListener('click',close);
  holder.querySelector('[data-tk2m-thread-reply]').addEventListener('submit',e=>{e.preventDefault();mutate('reply');});
  complete.addEventListener('click',()=>mutate('complete'));
  accept.addEventListener('click',()=>mutate('accept'));
  returnBtn.addEventListener('click',()=>mutate('return'));
  holder.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}});
  window.Talk2MeQuickTaskThread={open,close};
})();
