// Progressive scroll reveals. Content remains visible when JavaScript is
// unavailable and motion is disabled for visitors who request reduced motion.

document.addEventListener('DOMContentLoaded', function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  var selectors = [
    'main > section:not(.hero)',
    'main > figure',
    '.visual-media-grid figure',
    '.visual-block',
    '.lens-item',
    '.argument-list li',
    '.context-event',
    '.context-event-media',
    '.contemporaries-card',
    '.ontology-node',
    '.ontology-detail',
    '.source-row',
    '.sort-tally > div'
  ];

  var items = Array.prototype.slice.call(document.querySelectorAll(selectors.join(',')));
  document.documentElement.classList.add('reveal-enabled');

  items.forEach(function (item) {
    item.classList.add('scroll-reveal');

    var siblings = item.parentElement
      ? Array.prototype.filter.call(item.parentElement.children, function (child) {
          return items.indexOf(child) !== -1;
        })
      : [];
    var siblingIndex = siblings.indexOf(item);
    if (siblingIndex > 0) {
      item.style.setProperty('--reveal-delay', Math.min(siblingIndex, 5) * 70 + 'ms');
    }
  });

  var pending = items.slice();
  var frame = null;

  function revealVisibleItems() {
    frame = null;
    var revealLine = window.innerHeight * 0.93;

    pending = pending.filter(function (item) {
      var bounds = item.getBoundingClientRect();
      var isVisible = bounds.top < revealLine && bounds.bottom > 0;
      if (isVisible) item.classList.add('is-revealed');
      return !isVisible;
    });

    if (!pending.length) {
      window.removeEventListener('scroll', requestRevealCheck);
      window.removeEventListener('resize', requestRevealCheck);
    }
  }

  function requestRevealCheck() {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(revealVisibleItems);
  }

  window.addEventListener('scroll', requestRevealCheck, { passive: true });
  window.addEventListener('resize', requestRevealCheck);
  requestRevealCheck();
});

