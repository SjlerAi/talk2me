(() => {
  'use strict';

  const root = document.getElementById('approval-centre');
  if (!root) return;

  const basePath = String(root.dataset.basePath || '');
  const errorBox = document.getElementById('approval-action-error');
  let busy = false;

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function notifyParent() {
    try {
      window.parent.postMessage({ type: 'talk2me:approval-updated' }, window.location.origin);
    } catch (_) {}
  }

  document.addEventListener('submit', async event => {
    const form = event.target.closest('form[data-approval-action]');
    if (!form || busy) return;
    event.preventDefault();

    const submitter = event.submitter;
    const params = new URLSearchParams();
    new FormData(form).forEach((value, key) => params.append(key, String(value)));
    if (submitter?.name) params.append(submitter.name, submitter.value);
    if (new URLSearchParams(window.location.search).get('panel') === '1' && !params.has('panel')) params.set('panel', '1');

    busy = true;
    errorBox.hidden = true;
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    if (submitter) submitter.textContent = 'Updating...';

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'follow',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: params.toString()
      });

      if (!response.ok) {
        throw new Error(`The request could not be completed (HTTP ${response.status}).`);
      }

      notifyParent();
      const next = new URL(`${basePath}/approvals`, window.location.origin);
      next.searchParams.set('tab', form.dataset.returnTab || 'all');
      next.searchParams.set('updated', '1');
      if (new URLSearchParams(window.location.search).get('panel') === '1') next.searchParams.set('panel', '1');
      window.location.assign(next.href);
    } catch (error) {
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
      if (submitter) submitter.textContent = submitter.dataset.originalLabel || submitter.textContent.replace('Updating...', 'Try Again');
      showError(error.message || 'The approval could not be updated. Please refresh and try again.');
    }
  });

  document.querySelectorAll('form[data-approval-action] button').forEach(button => {
    button.dataset.originalLabel = button.textContent;
  });
})();
