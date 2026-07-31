(() => {
  if (document.getElementById('talk2meCenteredToastStyles')) return;

  const style = document.createElement('style');
  style.id = 'talk2meCenteredToastStyles';
  style.textContent = `
    .toast{
      position:fixed!important;
      left:50%!important;
      right:auto!important;
      top:50%!important;
      bottom:auto!important;
      z-index:3200!important;
      display:block!important;
      max-width:min(520px,calc(100vw - 32px));
      padding:18px 24px!important;
      border:1px solid var(--line)!important;
      border-top:6px solid var(--red)!important;
      border-left:1px solid var(--line)!important;
      border-radius:16px!important;
      background:#fff!important;
      color:var(--ink)!important;
      box-shadow:0 24px 70px rgba(15,39,53,.28)!important;
      font-size:18px!important;
      font-weight:850!important;
      line-height:1.35!important;
      text-align:center!important;
      opacity:0;
      visibility:hidden;
      pointer-events:none;
      transform:translate(-50%,-50%) scale(.96);
      transition:opacity .18s ease,transform .18s ease,visibility .18s ease;
    }
    .toast.show{
      opacity:1;
      visibility:visible;
      transform:translate(-50%,-50%) scale(1);
    }
    @media(max-width:560px){
      .toast{font-size:16px!important;padding:16px 18px!important;}
    }
  `;
  document.head.appendChild(style);

  window.toast = message => {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = String(message || '');
    toast.classList.add('show');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
  };
})();
