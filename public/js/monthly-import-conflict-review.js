'use strict';

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-conflict-decision]').forEach(form => {
    const approve = form.querySelector('[data-use-selected]');
    const choices = [...form.querySelectorAll('.candidate-choice-card input[type="radio"]')];
    if (!approve || !choices.length) return;

    const refresh = () => {
      const selected = choices.find(input => input.checked);
      approve.disabled = !selected;
      form.querySelectorAll('.candidate-choice-card').forEach(card => {
        card.classList.toggle('selected', Boolean(card.querySelector('input:checked')));
      });
    };

    choices.forEach(input => input.addEventListener('change', refresh));
    form.querySelectorAll('.candidate-open-link').forEach(link => {
      link.addEventListener('click', event => event.stopPropagation());
    });
    refresh();
  });
});
