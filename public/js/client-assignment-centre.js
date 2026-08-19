(() => {
  const form = document.querySelector('[data-bulk-claim-form]');
  if (!form) return;

  const choices = [...form.querySelectorAll('[data-bulk-claim-checkbox]:not(:disabled)')];
  const selectAll = form.querySelector('[data-bulk-select-all]');
  const count = form.querySelector('[data-bulk-count]');
  const submit = form.querySelector('[data-bulk-submit]');

  function selectedChoices() {
    return choices.filter(choice => choice.checked);
  }

  function update() {
    const selected = selectedChoices().length;
    count.textContent = `${selected} selected`;
    submit.disabled = selected === 0;
    submit.textContent = selected ? `Claim selected (${selected})` : 'Claim selected';
    selectAll.checked = choices.length > 0 && selected === choices.length;
    selectAll.indeterminate = selected > 0 && selected < choices.length;
    selectAll.disabled = choices.length === 0;
  }

  selectAll.addEventListener('change', () => {
    choices.forEach(choice => { choice.checked = selectAll.checked; });
    update();
  });
  choices.forEach(choice => choice.addEventListener('change', update));

  form.addEventListener('submit', event => {
    const selected = selectedChoices().length;
    if (!selected) {
      event.preventDefault();
      update();
      return;
    }
    submit.disabled = true;
    submit.textContent = `Claiming ${selected}…`;
  });

  update();
})();
