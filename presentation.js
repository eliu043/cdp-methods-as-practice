(() => {
  const plane = document.getElementById('deckPlane');
  // This sequence is the presentation's causal argument, not a topical index.
  const slideOrder = ['opening','premise','projection','questions','lineages','situated','counter-computation','methods','precedents','representation','argument','capstone','negotiation'];
  slideOrder.forEach((id) => {
    const slide = document.getElementById(id);
    if (slide) plane.appendChild(slide);
  });
  const slides = [...plane.querySelectorAll('.slide')];
  const progress = document.getElementById('deckProgress');
  const prev = document.getElementById('prevSlide');
  const next = document.getElementById('nextSlide');
  let current = 0;
  let moving = false;
  let wheelTotal = 0;

  plane.style.height = `${slides.length * 100}vh`;

  slides.forEach((slide, index) => {
    slide.style.top = `${index * 100}vh`;
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Go to ${slide.id}`);
    dot.addEventListener('click', () => goTo(index));
    progress.appendChild(dot);
    slide.progressDot = dot;
  });

  function goTo(index, updateHash = true) {
    index = Math.max(0, Math.min(slides.length - 1, index));
    if (index === current && document.body.dataset.ready) return;
    slides[current]?.classList.remove('is-active');
    slides[current]?.progressDot.classList.remove('is-active');
    current = index;
    slides[current].classList.add('is-active');
    slides[current].progressDot.classList.add('is-active');
    plane.style.transform = `translate3d(0,${-current * 100}vh,0)`;
    prev.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    if (updateHash) history.replaceState(null, '', `#${slides[current].id}`);
    moving = true;
    setTimeout(() => { moving = false; }, 680);
    document.body.dataset.ready = 'true';
  }

  function move(delta) {
    if (!moving) goTo(current + delta);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); move(1); }
    if (event.key === 'Home') { event.preventDefault(); goTo(0); }
    if (event.key === 'End') { event.preventDefault(); goTo(slides.length - 1); }
  });
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));

  document.addEventListener('wheel', (event) => {
    wheelTotal += event.deltaY;
    if (Math.abs(wheelTotal) > 70) {
      move(wheelTotal > 0 ? 1 : -1);
      wheelTotal = 0;
    }
  }, {passive:true});

  let touchY = null;
  document.addEventListener('touchstart', (event) => { touchY = event.touches[0].clientY; }, {passive:true});
  document.addEventListener('touchend', (event) => {
    if (touchY === null) return;
    const dy = event.changedTouches[0].clientY - touchY;
    if (Math.abs(dy) > 45) move(dy < 0 ? 1 : -1);
    touchY = null;
  }, {passive:true});

  const start = slides.findIndex((slide) => `#${slide.id}` === location.hash);
  goTo(start >= 0 ? start : 0, false);
})();
