document.addEventListener('DOMContentLoaded', function () {
  var buckets = Array.prototype.slice.call(document.querySelectorAll('.bucket'));
  var expandAll = document.getElementById('expandAll');
  var collapseAll = document.getElementById('collapseAll');
  var chapters = Array.prototype.slice.call(document.querySelectorAll('.chapter'));
  var marker = document.getElementById('chapterMarker');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (expandAll) {
    expandAll.addEventListener('click', function () {
      buckets.forEach(function (bucket) { bucket.open = true; });
    });
  }

  if (collapseAll) {
    collapseAll.addEventListener('click', function () {
      buckets.forEach(function (bucket) { bucket.open = false; });
    });
  }

  if ('IntersectionObserver' in window && !reduceMotion) {
    var chapterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        chapters.forEach(function (chapter) { chapter.classList.remove('is-active'); });
        entry.target.classList.add('is-active');
        if (marker) marker.textContent = entry.target.dataset.chapter + ' / 04';
      });
    }, { rootMargin: '-38% 0px -38% 0px', threshold: 0 });

    chapters.forEach(function (chapter) { chapterObserver.observe(chapter); });
  }

  var precedentCards = Array.prototype.slice.call(document.querySelectorAll('.precedent-card'));
  var resetReferences = document.getElementById('resetReferences');
  var referenceStorageKey = 'lots-in-commons-reference-positions-v5';
  var savedReferencePositions = {};
  var topCardZIndex = 20;

  try {
    savedReferencePositions = JSON.parse(window.localStorage.getItem(referenceStorageKey)) || {};
  } catch (error) {
    savedReferencePositions = {};
  }

  function setCardPosition(card, x, y) {
    card.dataset.dragX = String(x);
    card.dataset.dragY = String(y);
    card.style.setProperty('--drag-x', x + 'px');
    card.style.setProperty('--drag-y', y + 'px');
  }

  function clampCardPosition(card, x, y) {
    var parent = card.offsetParent;
    if (!parent) return { x: x, y: y };

    return {
      x: Math.min(Math.max(x, -card.offsetLeft), parent.clientWidth - card.offsetLeft - card.offsetWidth),
      y: Math.min(Math.max(y, -card.offsetTop), parent.clientHeight - card.offsetTop - card.offsetHeight)
    };
  }

  function saveReferencePositions() {
    var positions = {};
    precedentCards.forEach(function (card) {
      positions[card.id] = {
        x: Number(card.dataset.dragX) || 0,
        y: Number(card.dataset.dragY) || 0
      };
    });

    try {
      window.localStorage.setItem(referenceStorageKey, JSON.stringify(positions));
    } catch (error) {
      // The draggable references still work when local storage is unavailable.
    }
  }

  if (resetReferences) {
    resetReferences.addEventListener('click', function () {
      precedentCards.forEach(function (card) {
        card.style.removeProperty('z-index');
        setCardPosition(card, 0, 0);
      });

      try {
        window.localStorage.removeItem(referenceStorageKey);
      } catch (error) {
        // Resetting the visible arrangement does not depend on local storage.
      }
    });
  }

  precedentCards.forEach(function (card) {
    var handle = card.querySelector('.drag-handle');
    var savedPosition = savedReferencePositions[card.id];
    if (!handle) return;

    if (savedPosition && window.innerWidth > 620) {
      setCardPosition(card, Number(savedPosition.x) || 0, Number(savedPosition.y) || 0);
    } else {
      setCardPosition(card, 0, 0);
    }

    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;

      event.preventDefault();
      var pointerId = event.pointerId;
      var startPointerX = event.clientX;
      var startPointerY = event.clientY;
      var startCardX = Number(card.dataset.dragX) || 0;
      var startCardY = Number(card.dataset.dragY) || 0;

      topCardZIndex += 1;
      card.style.zIndex = String(topCardZIndex);
      card.classList.add('is-dragging');
      handle.setPointerCapture(pointerId);

      function moveCard(moveEvent) {
        var nextPosition = clampCardPosition(
          card,
          startCardX + moveEvent.clientX - startPointerX,
          startCardY + moveEvent.clientY - startPointerY
        );
        setCardPosition(card, nextPosition.x, nextPosition.y);
      }

      function stopDragging() {
        card.classList.remove('is-dragging');
        saveReferencePositions();
        handle.removeEventListener('pointermove', moveCard);
        handle.removeEventListener('pointerup', stopDragging);
        handle.removeEventListener('pointercancel', stopDragging);
      }

      handle.addEventListener('pointermove', moveCard);
      handle.addEventListener('pointerup', stopDragging);
      handle.addEventListener('pointercancel', stopDragging);
    });

    handle.addEventListener('keydown', function (event) {
      var direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      }[event.key];
      if (!direction) return;

      event.preventDefault();
      var distance = event.shiftKey ? 30 : 10;
      var nextPosition = clampCardPosition(
        card,
        (Number(card.dataset.dragX) || 0) + direction[0] * distance,
        (Number(card.dataset.dragY) || 0) + direction[1] * distance
      );
      setCardPosition(card, nextPosition.x, nextPosition.y);
      saveReferencePositions();
    });

    handle.addEventListener('dblclick', function () {
      setCardPosition(card, 0, 0);
      saveReferencePositions();
    });
  });

  var canvas = document.getElementById('fieldCanvas');
  if (!canvas || reduceMotion) return;

  var context = canvas.getContext('2d');
  var width = 0;
  var height = 0;
  var pixelRatio = 1;
  var scrollPosition = window.scrollY;
  var mouseX = 0.5;
  var mouseY = 0.5;
  var frameRequested = false;

  var threads = [
    { y: 0.16, bend: 0.18, speed: 0.032, offset: 0.06 },
    { y: 0.32, bend: -0.13, speed: -0.021, offset: 0.31 },
    { y: 0.49, bend: 0.10, speed: 0.027, offset: 0.52 },
    { y: 0.67, bend: -0.17, speed: -0.018, offset: 0.74 },
    { y: 0.84, bend: 0.12, speed: 0.024, offset: 0.91 }
  ];

  function resizeCanvas() {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    requestDraw();
  }

  function drawField() {
    frameRequested = false;
    context.clearRect(0, 0, width, height);

    var scrollPhase = scrollPosition * 0.00045;
    var cursorPullX = (mouseX - 0.5) * 42;
    var cursorPullY = (mouseY - 0.5) * 30;

    threads.forEach(function (thread, index) {
      var baseY = height * thread.y;
      var phase = scrollPhase * thread.speed * 100 + thread.offset * Math.PI * 2;
      var amplitude = height * thread.bend;

      context.beginPath();
      context.moveTo(-30, baseY + Math.sin(phase) * 12);
      context.bezierCurveTo(
        width * 0.28 + cursorPullX,
        baseY + amplitude + cursorPullY * (index % 2 ? -0.3 : 0.3),
        width * 0.68 - cursorPullX,
        baseY - amplitude,
        width + 30,
        baseY + Math.cos(phase) * 18
      );
      context.strokeStyle = index === 2 ? 'rgba(255, 76, 34, .34)' : 'rgba(17, 17, 15, .18)';
      context.lineWidth = index === 2 ? 1.1 : 0.75;
      context.stroke();

      for (var nodeIndex = 0; nodeIndex < 3; nodeIndex += 1) {
        var nodeX = width * (((nodeIndex + 1) / 4) + Math.sin(phase + nodeIndex) * 0.025);
        var nodeY = baseY + Math.sin(phase + nodeIndex * 1.7) * amplitude * 0.42;
        context.beginPath();
        context.arc(nodeX, nodeY, index === 2 ? 2.8 : 1.8, 0, Math.PI * 2);
        context.fillStyle = index === 2 ? 'rgba(255, 76, 34, .55)' : 'rgba(17, 17, 15, .34)';
        context.fill();
      }
    });
  }

  function updateDrift() {
    document.querySelectorAll('[data-drift]').forEach(function (word) {
      var bounds = word.getBoundingClientRect();
      var distance = bounds.top + bounds.height / 2 - height / 2;
      var speed = Number(word.dataset.drift) || 0;
      word.style.transform = 'translate3d(' + (distance * speed).toFixed(2) + 'px, 0, 0)';
    });
  }

  function requestDraw() {
    if (frameRequested) return;
    frameRequested = true;
    window.requestAnimationFrame(function () {
      drawField();
      updateDrift();
    });
  }

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('scroll', function () {
    scrollPosition = window.scrollY;
    requestDraw();
  }, { passive: true });
  window.addEventListener('pointermove', function (event) {
    mouseX = event.clientX / Math.max(width, 1);
    mouseY = event.clientY / Math.max(height, 1);
    requestDraw();
  }, { passive: true });

  resizeCanvas();
});
