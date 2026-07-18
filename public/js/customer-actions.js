document.addEventListener('DOMContentLoaded',()=>{
  const match=location.pathname.match(/\/customers\/(\d+)\/360\/?$/);if(!match)return;
  const actions=document.querySelector('.customer-head .hero-actions');if(!actions)return;
  const labels=[...actions.querySelectorAll('a,button')].map(x=>x.textContent.trim().toLowerCase());
  const primary=actions.querySelector('a');
  let mobile=null;
  const panelSuffix=new URLSearchParams(location.search).get('panel')==='1'?'?panel=1':'';
  if(!labels.includes('add mobile line')){mobile=document.createElement('a');mobile.className='btn opportunity';mobile.href=`${location.pathname.replace(/\/360\/?$/,'')}/add-mobile${panelSuffix}`;mobile.textContent='Add Mobile Line';actions.insertBefore(mobile,primary?.nextSibling||actions.firstChild)}
  if(!labels.includes('add fixed service')){const fixed=document.createElement('a');fixed.className='btn opportunity';fixed.href=`${location.pathname.replace(/\/360\/?$/,'')}/add-fixed${panelSuffix}`;fixed.textContent='Add Fixed Service';actions.insertBefore(fixed,mobile?.nextSibling||primary?.nextSibling||actions.firstChild)}
});
