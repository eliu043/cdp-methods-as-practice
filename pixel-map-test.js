(() => {
  const canvas = document.getElementById('mapCanvas');
  if (!canvas) return;
  const context = canvas.getContext('2d', { alpha:false });
  const image = new Image();
  const buffer = document.createElement('canvas');
  const bufferContext = buffer.getContext('2d', { alpha:false });
  const duration = 24000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let elapsed = reduceMotion ? duration : 0;
  let previousTime = null;
  let frame = null;

  // The operational image begins with apparent authority, then loses resolution.
  // It stops before total abstraction so roads, parcels, and fields remain open
  // to interpretation rather than simply disappearing.
  function resolutionAt(legibility) {
    const eased = Math.pow(legibility, 1.35);
    return Math.round(42 * Math.pow(12.6, eased));
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    draw();
  }

  function draw() {
    if (!image.complete || !image.naturalWidth || !canvas.width) return;
    const progress = Math.min(1, elapsed / duration);
    const legibility = (100 - progress * 68) / 100;
    const shortEdge = resolutionAt(legibility);
    const viewRatio = canvas.width / canvas.height;
    const imageRatio = image.naturalWidth / image.naturalHeight;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (imageRatio > viewRatio) {
      sourceWidth = image.naturalHeight * viewRatio;
      sourceX = (image.naturalWidth - sourceWidth) * .58;
    } else {
      sourceHeight = image.naturalWidth / viewRatio;
      sourceY = (image.naturalHeight - sourceHeight) * .43;
    }

    if (canvas.width <= canvas.height) {
      buffer.width = shortEdge;
      buffer.height = Math.max(1, Math.round(shortEdge / viewRatio));
    } else {
      buffer.height = shortEdge;
      buffer.width = Math.max(1, Math.round(shortEdge * viewRatio));
    }

    bufferContext.imageSmoothingEnabled = true;
    bufferContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, buffer.width, buffer.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  }

  function tick(time) {
    if (previousTime === null) previousTime = time;
    if (!reduceMotion && elapsed < duration) {
      elapsed = Math.min(duration, elapsed + time - previousTime);
      draw();
    }
    previousTime = time;
    frame = elapsed < duration && !reduceMotion ? requestAnimationFrame(tick) : null;
  }

  window.restartOpeningPixelMap = () => {
    elapsed = 0;
    previousTime = null;
    draw();
    if (!frame && !reduceMotion) frame = requestAnimationFrame(tick);
  };

  window.addEventListener('resize', resize);
  image.addEventListener('load', () => {
    resize();
    draw();
    if (!reduceMotion) frame = requestAnimationFrame(tick);
  });
  image.src = 'assets/projection/fort-spunky-naip-2022.jpg';

  window.addEventListener('pagehide', () => cancelAnimationFrame(frame));
})();
