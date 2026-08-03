(() => {
  const plane = document.getElementById('deckPlane');
  // The presentation is a causal argument; the Field remains the topical precedent index.
  const slideOrder = ['opening','forecast','translation','situated','counter-knowledge','recursive-data','glitch-spectrum','composition','negotiation'];
  slideOrder.forEach((id) => {
    const slide = document.getElementById(id);
    if (slide) plane.appendChild(slide);
  });
  const slides = [...plane.querySelectorAll('.slide')];
  const progress = document.getElementById('deckProgress');
  const prev = document.getElementById('prevSlide');
  const next = document.getElementById('nextSlide');
  const editLayout = document.getElementById('editLayout');
  const saveLayout = document.getElementById('saveLayout');
  const resetLayout = document.getElementById('resetLayout');
  const layoutStatus = document.getElementById('layoutStatus');
  let current = 0;
  let moving = false;
  let wheelTotal = 0;
  let layoutEditing = false;
  let layoutDrag = null;

  const layoutSelector = [
    '.image-card',
    '.theory-note',
    '.knowledge-collage > a',
    '.knowledge-collage > figure',
    '.spectrum-collage > a',
    '.composition-reference'
  ].join(',');
  const layoutStorageKey = 'lots-in-commons-presentation-layout-v1';
  const layoutBucket = () => window.innerWidth <= 900 ? 'compact' : 'wide';

  function readLayouts() {
    try { return JSON.parse(localStorage.getItem(layoutStorageKey) || '{}'); }
    catch { return {}; }
  }

  function writeLayouts(layouts) {
    try { localStorage.setItem(layoutStorageKey, JSON.stringify(layouts)); return true; }
    catch { return false; }
  }

  function setLayoutStatus(message, clear = false) {
    layoutStatus.textContent = message;
    if (clear) setTimeout(() => {
      if (layoutStatus.textContent === message) layoutStatus.textContent = '';
    }, 2600);
  }

  const layoutTargets = [];
  slides.forEach((slide) => {
    [...slide.querySelectorAll(layoutSelector)].forEach((target, index) => {
      const identity = target.dataset.layoutId || [...target.classList].find((name) => !['image-card','book-ref'].includes(name)) || index;
      target.classList.add('layout-target');
      target.dataset.layoutKey = `${slide.id}:${identity}`;
      const handle = document.createElement('span');
      handle.className = 'layout-resize-handle';
      handle.setAttribute('aria-hidden', 'true');
      target.appendChild(handle);
      target.addEventListener('pointerdown', beginLayoutMove);
      target.addEventListener('click', (event) => {
        if (layoutEditing) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, true);
      layoutTargets.push(target);
    });
  });

  function applySavedLayouts() {
    const saved = readLayouts()[layoutBucket()] || {};
    layoutTargets.forEach((target) => {
      const value = saved[target.dataset.layoutKey];
      if (!value) return;
      target.style.left = `${value.left}%`;
      target.style.top = `${value.top}%`;
      target.style.width = `${value.width}%`;
      target.style.right = 'auto';
      target.style.bottom = 'auto';
    });
  }

  function beginLayoutMove(event) {
    if (!layoutEditing || event.button > 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const parent = target.offsetParent;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const left = targetRect.left - parentRect.left;
    const top = targetRect.top - parentRect.top;
    const originalStyle = Object.fromEntries(['left','top','right','bottom','width'].map((property) => [property, target.style[property]]));
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
    target.style.width = `${targetRect.width}px`;
    target.style.right = 'auto';
    target.style.bottom = 'auto';
    target.classList.add('is-layout-active');
    layoutDrag = {
      target,
      parentRect,
      startX:event.clientX,
      startY:event.clientY,
      left,
      top,
      width:targetRect.width,
      originalStyle,
      changed:false,
      resizing:event.target.classList.contains('layout-resize-handle')
    };
    document.addEventListener('pointermove', updateLayoutMove);
    document.addEventListener('pointerup', finishLayoutMove, {once:true});
    document.addEventListener('pointercancel', finishLayoutMove, {once:true});
  }

  function updateLayoutMove(event) {
    if (!layoutDrag) return;
    event.preventDefault();
    layoutDrag.changed = true;
    const dx = event.clientX - layoutDrag.startX;
    const dy = event.clientY - layoutDrag.startY;
    if (layoutDrag.resizing) {
      const maximum = Math.max(80, layoutDrag.parentRect.width - layoutDrag.left);
      const width = Math.max(80, Math.min(maximum, layoutDrag.width + dx));
      layoutDrag.target.style.width = `${width}px`;
    } else {
      const rect = layoutDrag.target.getBoundingClientRect();
      const left = Math.max(0, Math.min(layoutDrag.parentRect.width - rect.width, layoutDrag.left + dx));
      const top = Math.max(0, Math.min(layoutDrag.parentRect.height - rect.height, layoutDrag.top + dy));
      layoutDrag.target.style.left = `${left}px`;
      layoutDrag.target.style.top = `${top}px`;
    }
    layoutDrag.target.dataset.layoutDirty = 'true';
    setLayoutStatus('Unsaved layout changes');
  }

  function finishLayoutMove() {
    if (!layoutDrag) return;
    if (!layoutDrag.changed) {
      Object.entries(layoutDrag.originalStyle).forEach(([property, value]) => { layoutDrag.target.style[property] = value; });
    }
    layoutDrag.target.classList.remove('is-layout-active');
    layoutDrag = null;
    document.removeEventListener('pointermove', updateLayoutMove);
    document.removeEventListener('pointerup', finishLayoutMove);
    document.removeEventListener('pointercancel', finishLayoutMove);
  }

  function beginLayoutEditing() {
    layoutEditing = true;
    document.body.classList.add('layout-editing');
    editLayout.setAttribute('aria-pressed', 'true');
    editLayout.hidden = true;
    saveLayout.hidden = false;
    resetLayout.hidden = false;
    setLayoutStatus('Drag an image; use its lower-right handle to resize');
  }

  function saveLayoutEditing() {
    const layouts = readLayouts();
    const bucket = layoutBucket();
    layouts[bucket] = layouts[bucket] || {};
    layoutTargets.forEach((target) => {
      if (target.dataset.layoutDirty !== 'true') return;
      const parent = target.offsetParent;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (!parentRect.width || !parentRect.height || !targetRect.width) return;
      layouts[bucket][target.dataset.layoutKey] = {
        left:+(((targetRect.left - parentRect.left) / parentRect.width) * 100).toFixed(4),
        top:+(((targetRect.top - parentRect.top) / parentRect.height) * 100).toFixed(4),
        width:+((targetRect.width / parentRect.width) * 100).toFixed(4)
      };
      delete target.dataset.layoutDirty;
    });
    const saved = writeLayouts(layouts);
    layoutEditing = false;
    document.body.classList.remove('layout-editing');
    editLayout.setAttribute('aria-pressed', 'false');
    editLayout.hidden = false;
    saveLayout.hidden = true;
    resetLayout.hidden = true;
    setLayoutStatus(saved ? 'Layout saved in this browser' : 'This browser could not save the layout', true);
  }

  function resetCurrentSlideLayout() {
    const layouts = readLayouts();
    const bucket = layoutBucket();
    const currentTargets = [...slides[current].querySelectorAll('.layout-target')];
    currentTargets.forEach((target) => {
      ['left','top','right','bottom','width'].forEach((property) => target.style.removeProperty(property));
      delete target.dataset.layoutDirty;
      if (layouts[bucket]) delete layouts[bucket][target.dataset.layoutKey];
    });
    writeLayouts(layouts);
    setLayoutStatus('This slide has been reset', true);
  }

  editLayout.addEventListener('click', beginLayoutEditing);
  saveLayout.addEventListener('click', saveLayoutEditing);
  resetLayout.addEventListener('click', resetCurrentSlideLayout);
  applySavedLayouts();

  const translationNetwork = document.getElementById('translationNetwork');
  if (translationNetwork) {
    const canvas = translationNetwork.querySelector('canvas');
    const nodes = [...translationNetwork.querySelectorAll('[data-node]')];
    const edges = [
      {from:'forecast',to:'site',bend:-18},
      {from:'property',to:'site',bend:18},
      {from:'capacity',to:'site',bend:18},
      {from:'suitability',to:'site',bend:-18},
      {from:'forecast',to:'property',bend:-34,feedback:true},
      {from:'property',to:'suitability',bend:-26,feedback:true},
      {from:'suitability',to:'capacity',bend:-34,feedback:true},
      {from:'capacity',to:'forecast',bend:-26,feedback:true}
    ];

    function drawTranslationNetwork(active = null) {
      const rect = translationNetwork.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const context = canvas.getContext('2d');
      context.setTransform(ratio,0,0,ratio,0,0);
      context.clearRect(0,0,rect.width,rect.height);

      const points = Object.fromEntries(nodes.map((node) => {
        const nodeRect = node.getBoundingClientRect();
        return [node.dataset.node, {
          x:nodeRect.left - rect.left + nodeRect.width / 2,
          y:nodeRect.top - rect.top + nodeRect.height / 2
        }];
      }));

      edges.forEach((edge) => {
        const start = points[edge.from];
        const end = points[edge.to];
        if (!start || !end) return;
        const highlighted = active && (edge.from === active || edge.to === active);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx,dy) || 1;
        const middleX = (start.x + end.x) / 2 - (dy / length) * edge.bend;
        const middleY = (start.y + end.y) / 2 + (dx / length) * edge.bend;
        context.beginPath();
        context.moveTo(start.x,start.y);
        context.quadraticCurveTo(middleX,middleY,end.x,end.y);
        context.setLineDash(edge.feedback ? [5,7] : []);
        context.lineWidth = highlighted ? 1.5 : 1;
        context.strokeStyle = highlighted ? 'rgba(23,23,20,.82)' : 'rgba(23,23,20,.24)';
        context.stroke();
      });
      context.setLineDash([]);
    }

    function emphasizeNetwork(nodeId = null) {
      const connected = new Set([nodeId]);
      edges.forEach((edge) => {
        if (edge.from === nodeId) connected.add(edge.to);
        if (edge.to === nodeId) connected.add(edge.from);
      });
      nodes.forEach((node) => node.classList.toggle('is-network-active', Boolean(nodeId && connected.has(node.dataset.node))));
      drawTranslationNetwork(nodeId);
    }

    nodes.forEach((node) => {
      node.addEventListener('mouseenter', () => emphasizeNetwork(node.dataset.node));
      node.addEventListener('mouseleave', () => emphasizeNetwork());
      node.addEventListener('focusin', () => emphasizeNetwork(node.dataset.node));
      node.addEventListener('focusout', () => emphasizeNetwork());
    });
    window.addEventListener('resize', () => drawTranslationNetwork());
    requestAnimationFrame(() => drawTranslationNetwork());
  }

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
    if (event.key.toLowerCase() === 'e' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      layoutEditing ? saveLayoutEditing() : beginLayoutEditing();
      return;
    }
    if (layoutEditing) return;
    if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); move(1); }
    if (event.key === 'Home') { event.preventDefault(); goTo(0); }
    if (event.key === 'End') { event.preventDefault(); goTo(slides.length - 1); }
  });
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));

  document.addEventListener('wheel', (event) => {
    if (layoutEditing) return;
    wheelTotal += event.deltaY;
    if (Math.abs(wheelTotal) > 70) {
      move(wheelTotal > 0 ? 1 : -1);
      wheelTotal = 0;
    }
  }, {passive:true});

  let touchY = null;
  document.addEventListener('touchstart', (event) => { touchY = event.touches[0].clientY; }, {passive:true});
  document.addEventListener('touchend', (event) => {
    if (layoutEditing) { touchY = null; return; }
    if (touchY === null) return;
    const dy = event.changedTouches[0].clientY - touchY;
    if (Math.abs(dy) > 45) move(dy < 0 ? 1 : -1);
    touchY = null;
  }, {passive:true});

  const start = slides.findIndex((slide) => `#${slide.id}` === location.hash);
  goTo(start >= 0 ? start : 0, false);
})();
