(() => {
  'use strict';

  const configNode=document.getElementById('deals-config');
  const config=configNode?JSON.parse(configNode.textContent||'{}'):{};
  const basePath=String(config.basePath||'');
  const app=document.querySelector('[data-deals-app]');
  if(!app)return;

  const grid=app.querySelector('[data-deals-grid]');
  const count=app.querySelector('[data-deals-count]');
  const searchInput=app.querySelector('[data-deals-search]');
  const refreshButton=app.querySelector('[data-deals-refresh]');
  const loadMoreButton=app.querySelector('[data-deals-load-more]');
  const loadZone=app.querySelector('[data-deals-load-zone]');
  const status=app.querySelector('[data-deals-status]');
  const viewer=document.querySelector('[data-deals-viewer]');
  const viewerBody=viewer.querySelector('[data-deals-viewer-body]');
  const viewerTitle=viewer.querySelector('[data-deals-viewer-title]');
  const viewerMeta=viewer.querySelector('[data-deals-viewer-meta]');
  const viewerDownload=viewer.querySelector('[data-deals-download]');

  const state={documents:[],offset:0,total:0,hasMore:false,loading:false,query:'',limit:100};

  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const formatBytes=value=>{
    const bytes=Number(value||0);
    if(bytes<1024)return `${bytes} B`;
    if(bytes<1024*1024)return `${(bytes/1024).toFixed(bytes<10240?1:0)} KB`;
    return `${(bytes/(1024*1024)).toFixed(1)} MB`;
  };
  const formatDate=value=>{
    if(!value)return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return String(value);
    return date.toLocaleString([],{year:'numeric',month:'short',day:'numeric'});
  };
  const iconFor=doc=>({image:'▧',pdf:'PDF',spreadsheet:'XL',document:'W',presentation:'P',text:'TXT',download:'FILE'}[doc.previewKind]||'FILE');
  const officeLabel=doc=>({document:'Word',spreadsheet:'Excel',presentation:'PowerPoint'}[doc.previewKind]||doc.extension||'file');

  async function request(url,options={}){
    const response=await fetch(basePath+url,{credentials:'same-origin',cache:'no-store',...options});
    const type=response.headers.get('content-type')||'';
    const payload=type.includes('application/json')?await response.json():null;
    if(!response.ok)throw new Error(payload?.error||`Request failed (${response.status})`);
    return payload;
  }

  const fileUrl=(versionId,download=false)=>`${basePath}/api/uat/library/files/${versionId}${download?'?download=1':''}`;

  function cardHtml(doc){
    const preview=doc.previewKind==='image'&&doc.versionId
      ? `<img loading="lazy" src="${esc(fileUrl(doc.versionId))}" alt="">`
      : esc(iconFor(doc));
    return `<button type="button" class="deal-card ${doc.favourite?'is-favourite':''}" data-deal-id="${doc.id}">
      <div class="deal-preview">${preview}</div>
      <div class="deal-copy">
        <span>${esc(officeLabel(doc))} · V${doc.versionNumber||1}</span>
        <strong title="${esc(doc.title)}">${esc(doc.title)}</strong>
        <p>${esc(doc.description||doc.originalName||'')}</p>
        <div class="deal-meta"><span>${esc(formatBytes(doc.bytes))}</span><span>${esc(formatDate(doc.updatedAt))}</span></div>
      </div>
    </button>`;
  }

  function render(){
    count.textContent=String(state.total);
    if(!state.documents.length&&!state.loading){
      grid.innerHTML=`<div class="deals-empty"><div><strong>${state.query?'No matching deals':'No deals uploaded yet'}</strong><span>${state.query?'Try a different search.':'Deals uploaded in Library Management will appear here automatically.'}</span></div></div>`;
    }else{
      grid.innerHTML=state.documents.map(cardHtml).join('');
    }
    loadMoreButton.hidden=!state.hasMore||state.loading;
    status.textContent=state.loading?'Loading deals…':state.hasMore?`Showing ${state.documents.length} of ${state.total}`:(state.total?`Showing all ${state.total} deals`:'');
  }

  async function load({reset=false}={}){
    if(state.loading)return;
    state.loading=true;
    if(reset){
      state.offset=0;
      state.documents=[];
      state.hasMore=false;
    }
    render();
    try{
      const params=new URLSearchParams({
        offset:String(state.offset),
        limit:String(state.limit)
      });
      if(state.query)params.set('q',state.query);
      const data=await request(`/api/uat/deals?${params.toString()}`);
      const incoming=Array.isArray(data.documents)?data.documents:[];
      state.documents=reset?incoming:[...state.documents,...incoming];
      state.offset=Number(data.nextOffset||state.documents.length);
      state.total=Number(data.total||0);
      state.hasMore=Boolean(data.hasMore);
    }catch(error){
      status.textContent=error.message;
      if(!state.documents.length)grid.innerHTML=`<div class="deals-empty"><div><strong>Deals could not load</strong><span>${esc(error.message)}</span></div></div>`;
    }finally{
      state.loading=false;
      render();
    }
  }

  async function openDeal(id){
    const data=await request(`/api/uat/library/documents/${id}`);
    const doc=data.document;
    if(!doc||doc.category!=='Deals')throw new Error('This item is no longer in Deals.');
    if(doc.nativeLaunch&&['document','spreadsheet','presentation'].includes(doc.previewKind)){
      window.location.href=doc.nativeLaunch;
      return;
    }
    viewerTitle.textContent=doc.title;
    viewerMeta.textContent=`Version ${doc.versionNumber} · ${formatBytes(doc.bytes)} · ${doc.uploadedByName||''}`;
    viewerDownload.href=fileUrl(doc.versionId,true);
    viewerBody.innerHTML='';
    if(doc.previewKind==='image'){
      viewerBody.innerHTML=`<img src="${esc(fileUrl(doc.versionId))}" alt="${esc(doc.title)}">`;
    }else if(doc.previewKind==='pdf'||doc.previewKind==='text'){
      viewerBody.innerHTML=`<iframe title="${esc(doc.title)}" src="${esc(fileUrl(doc.versionId))}#view=FitH"></iframe>`;
    }else{
      viewerBody.innerHTML=`<div class="deals-no-preview"><strong>Original file ready</strong><p>Use Download original to open this deal in its normal application.</p></div>`;
    }
    viewer.showModal();
  }

  grid.addEventListener('click',event=>{
    const card=event.target.closest('[data-deal-id]');
    if(!card)return;
    const id=Number(card.dataset.dealId);
    const doc=state.documents.find(item=>Number(item.id)===id);
    if(doc?.nativeLaunch&&['document','spreadsheet','presentation'].includes(doc.previewKind)){
      window.location.href=doc.nativeLaunch;
      return;
    }
    openDeal(id).catch(error=>alert(error.message));
  });

  let searchTimer;
  searchInput.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
      state.query=searchInput.value.trim();
      load({reset:true});
    },180);
  });

  refreshButton.onclick=()=>load({reset:true});
  loadMoreButton.onclick=()=>load();
  viewer.querySelector('[data-deals-close]').onclick=()=>viewer.close();
  viewer.querySelector('[data-deals-fullscreen]').onclick=()=>{
    const shell=viewer.querySelector('.deals-viewer-shell');
    if(document.fullscreenElement)document.exitFullscreen?.();else shell.requestFullscreen?.();
  };

  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)&&state.hasMore&&!state.loading)load();
    },{root:null,rootMargin:'500px 0px'});
    observer.observe(loadZone);
  }

  load({reset:true});
})();
