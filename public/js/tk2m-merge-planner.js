'use strict';
(() => {
 const form=document.getElementById('merge-builder-form');
 if(!form)return;
 const boxes=Array.from(form.querySelectorAll('[data-merge-selected]'));
 const primary=form.querySelector('[data-merge-primary]');
 const donors=Array.from(form.querySelectorAll('[data-merge-donor]'));
 const fields=[...new Set(donors.map(r=>r.dataset.field))];
 const count=form.querySelector('#merge-selected-count');
 const submit=form.querySelector('#merge-preview-button');
 const selectedIds=()=>boxes.filter(b=>b.checked).map(b=>b.value);
 const choices=field=>donors.filter(r=>r.dataset.field===field);
 const validSelection=()=>fields.every(field=>choices(field).some(r=>r.checked&&!r.disabled));
 function update(){
  const selected=new Set(selectedIds());
  for(const box of boxes)box.closest('.merge-candidate')?.classList.toggle('is-selected',box.checked);
  if(count)count.textContent=selected.size+' selected';
  for(const option of primary.options){
   if(!option.value)continue;
   option.disabled=!selected.has(option.value);
  }
  if(!selected.has(primary.value))primary.value=boxes.find(b=>b.checked)?.value||'';
  for(const field of fields){
   const radios=choices(field);
   for(const radio of radios){
    // Never allow an excluded record or blank field to become the source.
    radio.disabled=!selected.has(radio.value)||radio.dataset.filled!=='1';
    radio.closest('.merge-field-tick')?.classList.toggle('is-unavailable',radio.disabled);
   }
   const current=radios.find(r=>r.checked&&!r.disabled);
   if(!current){
    const best=radios.find(r=>r.value===primary.value&&!r.disabled)||
      radios.find(r=>!r.disabled);
    for(const radio of radios)radio.checked=radio===best;
   }
   for(const radio of radios){
    radio.closest('.merge-field-tick')?.classList.toggle('is-chosen',radio.checked&&!radio.disabled);
   }
  }
  if(submit)submit.disabled=selected.size<2||!primary.value||!validSelection();
 }
 boxes.forEach(box=>box.addEventListener('change',update));
 primary?.addEventListener('change',update);
 donors.forEach(radio=>radio.addEventListener('change',update));
 form.addEventListener('submit',event=>{
  if(selectedIds().length<2||!primary.value||!validSelection()){
   event.preventDefault();
   alert('Select two or more customer records, choose the primary customer and tick one correct value for each field.');
  }
 });
 update();
})();
