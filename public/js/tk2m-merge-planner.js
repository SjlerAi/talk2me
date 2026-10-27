'use strict';
(() => {
 const form=document.getElementById('merge-builder-form');
 if(!form)return;
 const boxes=Array.from(form.querySelectorAll('[data-merge-selected]'));
 const primary=form.querySelector('[data-merge-primary]');
 const donors=Array.from(form.querySelectorAll('[data-merge-donor]'));
 const count=form.querySelector('#merge-selected-count');
 const submit=form.querySelector('#merge-preview-button');
 const selectedIds=()=>boxes.filter(b=>b.checked).map(b=>b.value);
 function update(){
  const selected=new Set(selectedIds());
  for(const box of boxes)box.closest('.merge-candidate')?.classList.toggle('is-selected',box.checked);
  if(count)count.textContent=selected.size+' selected';
  for(const option of primary.options){
   if(!option.value)continue;
   option.disabled=!selected.has(option.value);
  }
  if(!selected.has(primary.value)){
   primary.value=boxes.find(b=>b.checked)?.value||'';
  }
  for(const select of donors){
   for(const option of select.options){
    if(!option.value)continue;
    option.disabled=!selected.has(option.value)||option.dataset.filled!=='1';
   }
   if(!selected.has(select.value)||select.selectedOptions[0]?.disabled){
    const best=Array.from(select.options).find(o=>o.value===primary.value&&!o.disabled) ||
      Array.from(select.options).find(o=>o.value&&!o.disabled);
    select.value=best?.value||'';
   }
  }
  if(submit)submit.disabled=selected.size<2||!primary.value||
   donors.some(s=>!s.value);
 }
 boxes.forEach(box=>box.addEventListener('change',update));
 primary?.addEventListener('change',update);
 donors.forEach(select=>select.addEventListener('change',()=>{
  const opt=select.selectedOptions[0];
  if(opt?.disabled)update();
 }));
 form.addEventListener('submit',event=>{
  const n=selectedIds().length;
  if(n<2||!primary.value||donors.some(x=>!x.value)){
   event.preventDefault();
   alert('Choose at least two customers, a primary record, and one source for every field.');
  }
 });
 update();
})();
