const byId=id=>document.getElementById(id);
const toast=message=>{const el=byId('toast');el.textContent=message;el.classList.add('show');clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>el.classList.remove('show'),2200)};
const modal=byId('modal');
const drawer=byId('drawer');
const sidebar=byId('sidebar');

document.querySelectorAll('[data-toast]').forEach(el=>el.addEventListener('click',()=>toast(el.dataset.toast)));
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>{
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));
  const match=document.querySelector(`.nav-item[data-view="${el.dataset.view}"]`);
  if(match) match.classList.add('active');
  toast(`${el.dataset.view.charAt(0).toUpperCase()+el.dataset.view.slice(1)} workspace selected`);
  sidebar.classList.remove('open');
}));

byId('alerts').addEventListener('click',()=>drawer.classList.add('open'));
byId('closeDrawer').addEventListener('click',()=>drawer.classList.remove('open'));
byId('newInquiry').addEventListener('click',()=>modal.classList.add('open'));
byId('closeModal').addEventListener('click',()=>modal.classList.remove('open'));
byId('cancelModal').addEventListener('click',()=>modal.classList.remove('open'));
byId('menu').addEventListener('click',()=>sidebar.classList.toggle('open'));
modal.addEventListener('click',event=>{if(event.target===modal) modal.classList.remove('open')});
modal.querySelector('form').addEventListener('submit',event=>{event.preventDefault();modal.classList.remove('open');toast('Inquiry saved in preview mode')});

document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();byId('search').focus()}
  if(event.key==='Escape'){modal.classList.remove('open');drawer.classList.remove('open');sidebar.classList.remove('open');byId('results').classList.remove('show')}
});

const customers=[
  {name:'Michelle Jacobs',detail:'Account VB10452 · 082 555 0147 · Langebaan'},
  {name:'Coastal Office Solutions',detail:'Account V20418 · 4 active lines · Vredenburg'},
  {name:'Johan van Wyk',detail:'Account I99102 · Upgrade due · Saldanha'},
  {name:'West Coast Steel',detail:'Account VB77112 · 8 active lines · Atlantis'}
];
const search=byId('search');
const results=byId('results');
search.addEventListener('input',()=>{
  const value=search.value.trim().toLowerCase();
  if(!value){results.classList.remove('show');results.innerHTML='';return}
  const matches=customers.filter(item=>(item.name+' '+item.detail).toLowerCase().includes(value));
  results.innerHTML=matches.length?matches.map(item=>`<div class="result" data-name="${item.name}"><b>${item.name}</b><span>${item.detail}</span></div>`).join(''):'<div class="result"><b>No customers found</b><span>Try another name, number or account.</span></div>';
  results.classList.add('show');
  results.querySelectorAll('[data-name]').forEach(item=>item.addEventListener('click',()=>{search.value=item.dataset.name;results.classList.remove('show');toast(`${item.dataset.name} opened in Customer 360`)}));
});

document.addEventListener('click',event=>{if(!event.target.closest('.search')) results.classList.remove('show')});
