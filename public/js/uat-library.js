(() => {
  'use strict';

  const configNode=document.getElementById('library-config');
  const config=configNode?JSON.parse(configNode.textContent||'{}'):{};
  const basePath=String(config.basePath||'');
  const app=document.querySelector('[data-library-app]');
  if(!app)return;

  const state={documents:[],categories:[],suggestedCategories:[],canManage:false,category:'all',search:'',status:'active',selected:null};
  const grid=app.querySelector('[data-library-grid]');
  const count=app.querySelector('[data-library-count]');
  const resultTitle=app.querySelector('[data-library-result-title]');
  const categoryList=app.querySelector('[data-library-category-list]');
  const filters=app.querySelector('[data-library-filters]');
  const featured=app.querySelector('[data-library-featured]');
  const featuredGrid=app.querySelector('[data-library-featured-grid]');
  const searchInput=app.querySelector('[data-library-search]');
  const adminButton=app.querySelector('[data-library-admin]');
  const refreshButton=app.querySelector('[data-library-refresh]');
  const viewer=document.querySelector('[data-library-viewer]');
  const viewerBody=viewer.querySelector('[data-viewer-body]');
  const viewerTitle=viewer.querySelector('[data-viewer-title]');
  const viewerCategory=viewer.querySelector('[data-viewer-category]');
  const viewerMeta=viewer.querySelector('[data-viewer-meta]');
  const viewerDownload=viewer.querySelector('[data-viewer-download]');
  const viewerFavourite=viewer.querySelector('[data-viewer-favourite]');
  const adminDialog=document.querySelector('[data-library-admin-dialog]');
  const uploadForm=document.querySelector('[data-library-upload-form]');
  const adminDocuments=document.querySelector('[data-admin-documents]');
  const snapshotsList=document.querySelector('[data-snapshot-list]');
  const snapshotMonth=document.querySelector('[data-snapshot-month]');
  const replaceDialog=document.querySelector('[data-library-replace-dialog]');
  const replaceForm=document.querySelector('[data-library-replace-form]');
  const categoryOptions=document.getElementById('library-category-options');

  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const formatBytes=value=>{
    const bytes=Number(value||0);
    if(bytes<1024)return `${bytes} B`;
    if(bytes<1024*1024)return `${(bytes/1024).toFixed(bytes<10240?1:0)} KB`;
    return `${(bytes/(1024*1024)).toFixed(1)} MB`;
  };
  const formatDate=value=>{
    if(!value)return '';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return String(value);
    return d.toLocaleString([],{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  };
  const iconFor=doc=>({image:'▧',pdf:'PDF',spreadsheet:'XL',document:'W',presentation:'P',text:'TXT',download:'FILE'}[doc.previewKind]||'FILE');

  async function request(url,options={}){
    const response=await fetch(basePath+url,{credentials:'same-origin',cache:'no-store',...options});
    const type=response.headers.get('content-type')||'';
    const payload=type.includes('application/json')?await response.json():null;
    if(!response.ok)throw new Error(payload?.error||`Request failed (${response.status})`);
    return payload;
  }

  function fileUrl(versionId,download=false){
    return `${basePath}/api/uat/library/files/${versionId}${download?'?download=1':''}`;
  }

  function cardHtml(doc,{compact=false}={}){
    const image=doc.previewKind==='image'&&doc.versionId
      ? `<img src="${esc(fileUrl(doc.versionId))}" alt="">`
      : esc(iconFor(doc));
    return `<article class="library-card ${doc.companyFavourite?'is-featured':''}" data-library-open="${doc.id}">
      <button type="button" class="library-star ${doc.favourite?'is-active':''}" data-library-star="${doc.id}" aria-label="${doc.favourite?'Remove favourite':'Add favourite'}">${doc.favourite?'★':'☆'}</button>
      <div class="library-card-preview">${image}</div>
      <div class="library-card-copy">
        <span>${esc(doc.category)} · V${doc.versionNumber||1}</span>
        <strong title="${esc(doc.title)}">${esc(doc.title)}</strong>
        ${compact?'':`<p>${esc(doc.description||doc.originalName||'')}</p>`}
        <div class="library-card-meta"><span>${esc(doc.extension||'file')}</span><span>${esc(formatBytes(doc.bytes))}</span></div>
      </div>
    </article>`;
  }

  function visibleDocs(){
    const search=state.search.toLowerCase();
    return state.documents.filter(doc=>{
      if(state.category==='favourites'&&!doc.favourite)return false;
      if(state.category!=='all'&&state.category!=='favourites'&&doc.category!==state.category)return false;
      if(search){
        const hay=[doc.title,doc.description,doc.category,doc.originalName].join(' ').toLowerCase();
        if(!hay.includes(search))return false;
      }
      return true;
    });
  }

  function renderCategories(){
    categoryList.innerHTML=state.categories.map(category=>`<button type="button" class="${state.category===category?'is-active':''}" data-library-category="${esc(category)}"><span>▣</span><strong>${esc(category)}</strong></button>`).join('');
    app.querySelectorAll('[data-library-category]').forEach(button=>button.classList.toggle('is-active',button.dataset.libraryCategory===state.category));
    categoryOptions.innerHTML=state.suggestedCategories.map(category=>`<option value="${esc(category)}"></option>`).join('');
  }

  function renderFilters(){
    const types=[
      ['all','All'],
      ['image','Images'],
      ['pdf','PDF'],
      ['spreadsheet','Spreadsheets'],
      ['document','Word'],
      ['presentation','Presentations']
    ];
    filters.innerHTML=types.map(([key,label])=>`<button type="button" data-library-type="${key}">${label}</button>`).join('');
  }

  function render(){
    const docs=visibleDocs();
    count.textContent=String(docs.length);
    resultTitle.textContent=state.category==='all'?'All files':state.category==='favourites'?'My favourites':state.category;
    grid.innerHTML=docs.length?docs.map(doc=>cardHtml(doc)).join(''):`<div class="library-empty"><strong>No documents here yet</strong><span>Try another category or search.</span></div>`;
    const company=state.documents.filter(doc=>doc.companyFavourite&&doc.status==='active').slice(0,8);
    featured.hidden=!company.length;
    featuredGrid.innerHTML=company.map(doc=>cardHtml(doc,{compact:true})).join('');
    renderCategories();
  }

  async function load(status=state.status){
    state.status=status;
    const data=await request(`/api/uat/library/bootstrap?status=${encodeURIComponent(status)}`);
    state.documents=data.documents||[];
    state.categories=data.categories||[];
    state.suggestedCategories=data.suggestedCategories||[];
    state.canManage=Boolean(data.canManage);
    adminButton.hidden=!state.canManage;
    renderFilters();
    render();
    if(state.canManage)renderAdminDocuments();
  }

  async function toggleFavourite(id){
    const result=await request(`/api/uat/library/documents/${id}/favourite`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const doc=state.documents.find(item=>Number(item.id)===Number(id));
    if(doc)doc.favourite=Boolean(result.favourite);
    render();
    if(state.selected&&Number(state.selected.id)===Number(id)){
      state.selected.favourite=Boolean(result.favourite);
      viewerFavourite.textContent=result.favourite?'★ Favourite':'☆ Favourite';
    }
  }

  async function spreadsheetPreview(doc,sheet=''){
    viewerBody.innerHTML='<div class="library-no-preview"><strong>Loading spreadsheet…</strong></div>';
    const data=await request(`/api/uat/library/documents/${doc.id}/preview${sheet?'?sheet='+encodeURIComponent(sheet):''}`);
    const maxCols=Math.max(0,...(data.rows||[]).map(row=>row.length));
    const table=(data.rows||[]).map(row=>`<tr>${Array.from({length:maxCols},(_,i)=>`<td>${esc(row[i]??'')}</td>`).join('')}</tr>`).join('');
    viewerBody.innerHTML=`<section class="library-sheet"><div class="library-sheet-tabs">${(data.sheets||[]).map(name=>`<button type="button" class="${name===data.sheet?'is-active':''}" data-sheet-name="${esc(name)}">${esc(name)}</button>`).join('')}</div><table><tbody>${table}</tbody></table>${data.truncated?'<div class="library-empty">Preview limited to the first 200 rows. Download the original for the full workbook.</div>':''}</section>`;
    viewerBody.querySelectorAll('[data-sheet-name]').forEach(button=>button.onclick=()=>spreadsheetPreview(doc,button.dataset.sheetName));
  }

  async function openDocument(id){
    const data=await request(`/api/uat/library/documents/${id}`);
    const doc=data.document;
    state.selected=doc;
    viewerTitle.textContent=doc.title;
    viewerCategory.textContent=doc.category;
    viewerMeta.textContent=`Version ${doc.versionNumber} · ${formatBytes(doc.bytes)} · ${doc.uploadedByName||''} · ${formatDate(doc.versionCreatedAt)}`;
    viewerDownload.href=fileUrl(doc.versionId,true);
    viewerFavourite.textContent=doc.favourite?'★ Favourite':'☆ Favourite';
    viewerBody.innerHTML='';
    if(doc.previewKind==='image'){
      viewerBody.innerHTML=`<img src="${esc(fileUrl(doc.versionId))}" alt="${esc(doc.title)}">`;
    }else if(doc.previewKind==='pdf'||doc.previewKind==='text'){
      viewerBody.innerHTML=`<iframe title="${esc(doc.title)}" src="${esc(fileUrl(doc.versionId))}#view=FitH"></iframe>`;
    }else if(doc.previewKind==='spreadsheet'){
      spreadsheetPreview(doc).catch(error=>{viewerBody.innerHTML=`<div class="library-no-preview"><strong>Could not preview spreadsheet</strong><p>${esc(error.message)}</p></div>`;});
    }else{
      viewerBody.innerHTML=`<div class="library-no-preview"><strong>Original file ready</strong><p>Talk2Me keeps the original ${esc(doc.extension||'file')} safely in the Library. Use Download original to open it in the appropriate Office application.</p></div>`;
    }
    viewer.showModal();
  }

  function renderAdminDocuments(){
    if(!state.canManage)return;
    adminDocuments.innerHTML=state.documents.length?state.documents.map(doc=>`<article class="library-admin-row">
      <div><strong>${esc(doc.title)}</strong><small>${esc(doc.category)} · V${doc.versionNumber} · ${esc(doc.status)} · ${esc(doc.originalName)}</small></div>
      <div class="library-admin-row-actions">
        <button type="button" data-admin-replace="${doc.id}">New version</button>
        <button type="button" data-admin-edit="${doc.id}">Edit</button>
        <button type="button" data-admin-archive="${doc.id}" data-status="${doc.status==='active'?'archived':'active'}">${doc.status==='active'?'Archive':'Restore'}</button>
      </div>
    </article>`).join(''):'<div class="library-empty">No documents yet.</div>';
  }

  async function loadSnapshots(){
    if(!state.canManage)return;
    const data=await request('/api/uat/library/snapshots');
    snapshotsList.innerHTML=(data.snapshots||[]).length?data.snapshots.map(item=>`<article class="library-admin-row"><div><strong>${esc(item.month)} snapshot</strong><small>${item.documentCount} documents · ${formatBytes(item.bytes)} · ${esc(item.createdByName)} · ${formatDate(item.createdAt)}</small></div><div class="library-admin-row-actions"><a href="${basePath}/api/uat/library/snapshots/${item.id}">Download ZIP</a></div></article>`).join(''):'<div class="library-empty">No month-end snapshots yet.</div>';
  }

  app.addEventListener('click',event=>{
    const star=event.target.closest('[data-library-star]');
    if(star){event.preventDefault();event.stopPropagation();toggleFavourite(Number(star.dataset.libraryStar)).catch(error=>alert(error.message));return;}
    const card=event.target.closest('[data-library-open]');
    if(card){openDocument(Number(card.dataset.libraryOpen)).catch(error=>alert(error.message));return;}
    const category=event.target.closest('[data-library-category]');
    if(category){state.category=category.dataset.libraryCategory;render();return;}
  });

  filters.addEventListener('click',event=>{
    const button=event.target.closest('[data-library-type]');
    if(!button)return;
    filters.querySelectorAll('button').forEach(item=>item.classList.toggle('is-active',item===button));
    const type=button.dataset.libraryType;
    state.search='';
    searchInput.value='';
    if(type==='all'){state.category='all';render();return;}
    const docs=state.documents.filter(doc=>doc.previewKind===type);
    const original=state.documents;
    state.documents=docs;state.category='all';render();state.documents=original;
  });

  let searchTimer;
  searchInput.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{state.search=searchInput.value.trim();render();},120);
  });

  refreshButton.onclick=()=>load().catch(error=>alert(error.message));
  adminButton.onclick=()=>{adminDialog.showModal();renderAdminDocuments();loadSnapshots().catch(()=>{});};
  viewer.querySelector('[data-viewer-close]').onclick=()=>viewer.close();
  viewerFavourite.onclick=()=>state.selected&&toggleFavourite(state.selected.id).catch(error=>alert(error.message));
  viewer.querySelector('[data-viewer-fullscreen]').onclick=()=>{
    const shell=viewer.querySelector('.library-viewer-shell');
    if(document.fullscreenElement)document.exitFullscreen?.();else shell.requestFullscreen?.();
  };
  document.querySelector('[data-admin-close]').onclick=()=>adminDialog.close();

  document.querySelectorAll('[data-admin-tab]').forEach(button=>button.onclick=()=>{
    document.querySelectorAll('[data-admin-tab]').forEach(item=>item.classList.toggle('is-active',item===button));
    document.querySelectorAll('[data-admin-panel]').forEach(panel=>panel.hidden=panel.dataset.adminPanel!==button.dataset.adminTab);
    if(button.dataset.adminTab==='snapshots')loadSnapshots().catch(error=>alert(error.message));
  });

  uploadForm.onsubmit=async event=>{
    event.preventDefault();
    const status=uploadForm.querySelector('[data-upload-status]');
    const submit=uploadForm.querySelector('button[type="submit"]');
    submit.disabled=true;status.textContent='Uploading…';
    try{
      const form=new FormData(uploadForm);
      form.set('company_favourite',uploadForm.querySelector('[name="company_favourite"]').checked?'1':'0');
      await request('/api/uat/library/documents',{method:'POST',body:form});
      uploadForm.reset();status.textContent='✓ Published';
      await load();
      renderAdminDocuments();
    }catch(error){status.textContent=error.message;}
    finally{submit.disabled=false;}
  };

  adminDocuments.addEventListener('click',async event=>{
    const replace=event.target.closest('[data-admin-replace]');
    if(replace){
      const doc=state.documents.find(item=>Number(item.id)===Number(replace.dataset.adminReplace));
      if(!doc)return;
      replaceForm.reset();
      replaceForm.querySelector('[data-replace-id]').value=doc.id;
      replaceForm.querySelector('[data-replace-title]').textContent=doc.title;
      replaceDialog.showModal();
      return;
    }
    const archive=event.target.closest('[data-admin-archive]');
    if(archive){
      try{
        await request(`/api/uat/library/documents/${archive.dataset.adminArchive}/archive`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:archive.dataset.status})});
        await load('all');
        renderAdminDocuments();
      }catch(error){alert(error.message);}
      return;
    }
    const edit=event.target.closest('[data-admin-edit]');
    if(edit){
      const doc=state.documents.find(item=>Number(item.id)===Number(edit.dataset.adminEdit));
      if(!doc)return;
      const title=prompt('Document title',doc.title);if(title===null)return;
      const category=prompt('Category',doc.category);if(category===null)return;
      const description=prompt('Description',doc.description||'');if(description===null)return;
      try{
        await request(`/api/uat/library/documents/${doc.id}/meta`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          title,category,description,access_level:doc.accessLevel,company_favourite:doc.companyFavourite?'1':'0'
        })});
        await load('all');
      }catch(error){alert(error.message);}
    }
  });

  document.querySelector('[data-replace-save]').onclick=async()=>{
    const status=replaceForm.querySelector('[data-replace-status]');
    const id=replaceForm.querySelector('[data-replace-id]').value;
    const file=replaceForm.querySelector('[name="file"]').files[0];
    if(!file){status.textContent='Choose a file.';return;}
    const form=new FormData();form.set('file',file);status.textContent='Uploading…';
    try{
      await request(`/api/uat/library/documents/${id}/version`,{method:'POST',body:form});
      status.textContent='✓ New version published';
      await load('all');
      setTimeout(()=>replaceDialog.close(),500);
    }catch(error){status.textContent=error.message;}
  };

  snapshotMonth.value=new Date().toISOString().slice(0,7);
  document.querySelector('[data-create-snapshot]').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;const old=button.textContent;button.textContent='Creating…';
    try{
      const data=await request('/api/uat/library/snapshots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:snapshotMonth.value})});
      await loadSnapshots();
      if(confirm(`Snapshot created with ${data.documentCount} documents. Download it now?`))window.location.href=data.downloadUrl;
    }catch(error){alert(error.message);}
    finally{button.disabled=false;button.textContent=old;}
  };

  load().catch(error=>{
    grid.innerHTML=`<div class="library-empty"><strong>Could not load Library</strong><span>${esc(error.message)}</span></div>`;
  });
})();
