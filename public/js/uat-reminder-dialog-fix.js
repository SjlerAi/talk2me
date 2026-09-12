(() => {
  'use strict';

  function closeReminder(dialog, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    if (!dialog || !dialog.open) return;
    try { dialog.close('cancel'); } catch (_) { dialog.removeAttribute('open'); }
  }

  function bindDialog(dialog) {
    if (!dialog || dialog.dataset.uatCloseBound === '1') return;
    dialog.dataset.uatCloseBound = '1';

    dialog.addEventListener('click', event => {
      const closeButton = event.target.closest('header button[aria-label="Close"], footer button.secondary');
      if (closeButton) {
        closeReminder(dialog, event);
        return;
      }

      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (!inside) closeReminder(dialog, event);
      }
    }, true);

    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeReminder(dialog);
    });
  }

  function bindExisting() {
    document.querySelectorAll('.t2m-home-reminder-dialog').forEach(bindDialog);
  }

  bindExisting();

  const observer = new MutationObserver(bindExisting);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
