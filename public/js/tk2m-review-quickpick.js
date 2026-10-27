'use strict';
// Inline review choices reuse the existing staged merge proposal preview API.
// This script NEVER changes customer, account, mobile-line or upgrade data.
(() => {
  const form=document.getElementById('review-quick-merge-form');
  if(!form)return;
  const selectedInputs=Array.from(form.querySelectorAll('[data-pick-selected]'));
  const primaryInputs=Array.from(form.querySelectorAll('[data-pick-primary]'));
  const fieldRows=Array.from(form.querySelectorAll('[data-pick-field-row]'));
  const preview=form.querySelector('#review-pick-preview');
  const progress=form.querySelector('#review-pick-progress');
  const count=form.querySelector('#review-pick-selected-count');
  const selectedIds=()=>new Set(selectedInputs.filter(x=>x.checked).map(x=>x.value));

  function refresh() {
    const selected=selectedIds();
    selectedInputs.forEach(x=> {
      x.closest('th')?.classList.toggle('review-pick-included',x.checked);
    });
    primaryInputs.forEach(x=>{
      x.disabled=!selected.has(x.value);
      if(x.disabled)x.checked=false;
    });
    let undecided=0;
    for(const row of fieldRows) {
      const choices=Array.from(row.querySelectorAll('[data-pick-donor]'));
      const selectedChoices=choices.filter(x=>selected.has(x.value));
      const nonempty=selectedChoices.filter(x=>x.dataset.pickValue.trim().length>0);
      for(const choice of choices){
        choice.disabled=!selected.has(choice.value) ||
          (nonempty.length>0 && !choice.dataset.pickValue.trim());
        if(choice.disabled)choice.checked=false;
      }
      const available=choices.filter(x=>!x.disabled);
      if(!available.some(x=>x.checked) && available.length) {
        // Same non-blank value across selected records, or only one source
        // with a value: prefill a safe obvious choice to save reviewer clicks.
        // Conflicting values always require a deliberate tick.
        const values=new Set(nonempty.map(x=>x.dataset.pickValue));
        const suggested=nonempty.length>0&&values.size===1 ?
          nonempty[0] : (nonempty.length===0?available[0]:null);
        if(suggested)suggested.checked=true;
      }
      const chosen=available.find(x=>x.checked);
      if(!chosen)undecided++;
      row.classList.toggle('review-pick-needs-choice',selected.size>=2&&!chosen);
      choices.forEach(x=>x.closest('[data-pick-choice]')?.classList.toggle('is-picked',x.checked&&!x.disabled));
    }
    const primary=primaryInputs.some(x=>x.checked&&!x.disabled);
    const ready=selected.size>=2&&primary&&undecided===0;
    preview.disabled=!ready;
    count.textContent=selected.size+' records selected';
    if(selected.size<2) {
      progress.textContent='Tick two or more customer records to compare.';
    }else if(!primary){
      progress.textContent='Choose which selected customer record will be kept.';
    }else if(undecided){
      progress.textContent=undecided+' field'+(undecided===1?'':'s')+
        ' with different values need'+(undecided===1?'s':'')+' your tick.';
    }else {
      progress.textContent='All values chosen. Check the details and preview your proposal.';
    }
  }
  selectedInputs.forEach(x=>x.addEventListener('change',refresh));
  primaryInputs.forEach(x=>x.addEventListener('change',refresh));
  form.querySelectorAll('[data-pick-donor]').forEach(x=>x.addEventListener('change',refresh));
  form.addEventListener('submit',e=>{
    refresh();
    if(preview.disabled){
      e.preventDefault();
      progress?.scrollIntoView({block:'nearest',behavior:'smooth'});
    }
  });
  refresh();
})();
