(() => {
  'use strict';
  const strip = document.querySelector('.t2m-os-launcher-scroll');
  const previous = document.querySelector('[data-launcher-scroll="previous"]');
  const next = document.querySelector('[data-launcher-scroll="next"]');
  if (!strip || !previous || !next) return;

  function update() {
    const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
    previous.disabled = strip.scrollLeft <= 4;
    next.disabled = strip.scrollLeft >= max - 4;
  }

  function move(direction) {
    const amount = Math.max(260, Math.round(strip.clientWidth * 0.72));
    strip.scrollBy({ left: amount * direction, behavior: 'smooth' });
  }

  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  strip.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  new MutationObserver(update).observe(strip, { childList: true });
  update();
})();
