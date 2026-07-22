(()=>{
  'use strict';
  const configNode=document.getElementById('talk2me-os-config');
  if(!configNode)return;
  const config=JSON.parse(configNode.textContent||'{}');
  const basePath=String(config.basePath||'');
  let lastId=Number(sessionStorage.getItem('talk2me-task-notification-id')||0),initial=true;
  const bell=document.querySelector('[data-os-app="notifications"]');
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

  function paint(count){
    document.querySelectorAll('[data-badge="notifications"]').forEach(node=>{node.textContent=String(count||0);node.hidden=!count;});
  }
  function show(item){
    if(!item)return;
    document.querySelector('.task-notification-toast')?.remove();
    const toast=document.createElement('button');
    toast.type='button';toast.className='task-notification-toast';
    toast.innerHTML=`<strong>${item.action_required?'Action required':'Work update'}</strong><span>${esc(item.notification_text)}</span>`;
    toast.onclick=()=>window.Talk2MeOS?.openRoute(`${basePath}/tasks/${item.task_id}`,'Task Update','●');
    document.body.appendChild(toast);setTimeout(()=>toast.remove(),9000);
  }
  async function poll(){
    try{
      const response=await fetch(`${basePath}/api/tasks/notification-summary`,{cache:'no-store',headers:{Accept:'application/json'}});
      if(!response.ok)return;
      const data=await response.json();paint(data.totalCount);
      if(!initial&&Number(data.latestId)>lastId)show(data.latest?.[0]);
      lastId=Math.max(lastId,Number(data.latestId||0));sessionStorage.setItem('talk2me-task-notification-id',String(lastId));initial=false;
    }catch(_){ }
  }
  if(bell){
    bell.addEventListener('click',event=>{
      event.preventDefault();event.stopImmediatePropagation();
      window.Talk2MeOS?.openRoute(`${basePath}/tasks?view=notifications`,'Notifications','🔔');
    },true);
  }
  poll();setInterval(poll,12000);
})();
