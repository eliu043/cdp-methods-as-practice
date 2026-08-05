const stage = document.getElementById('projectionStage');
const mount = document.getElementById('canvasMount');
const rotateStage = document.getElementById('rotateStage');
const mapField = document.getElementById('mapField');
const cameraToggle = document.getElementById('cameraToggle');
const outputToggle = document.getElementById('outputToggle');
const sensorStatus = document.getElementById('sensorStatus');
const stateName = document.getElementById('stateName');
const stateDetail = document.getElementById('stateDetail');

const scene = { id: 'remote', name: 'Remote view', detail: 'A 2022 aerial follows the Brazos through the Fort Spunky study aperture.' };

const palettes = {
  visible: { filter: 'saturate(.72) contrast(1.06)', veil: [16, 19, 15, 20], signal: [221, 255, 48] },
  nir: { filter: 'none', veil: [0, 0, 0, 0], signal: [255, 102, 180] },
  ndvi: { filter: 'none', veil: [0, 0, 0, 0], signal: [118, 151, 88] }
};
const spectrumOrder = ['visible', 'nir', 'ndvi'];

let terrain;
let aerialImages = [];
let falseColorAerial;
let ndviAerial;
let capture;
let poseLandmarker;
let detectorLoading = false;
let detectionBusy = false;
let cameraActive = false;
let cameraProximity = 0;
let pointerProximity = .08;
let proximity = .08;
let lastDetection = 0;
let lastVideoTime = -1;
let lastBodySeenAt = 0;
let bodyCount = 0;
let spectrum = 'visible';
let movementEnergy = 0;
let movementImpulse = 0;
let lastPoseCenter;
let lastPoseScale = 0;
let lastPointer = { x: 0, y: 0, time: 0 };
let driftClouds = {};
let palimpsestBuffer;
// Kept up to date but currently unused by any visible effect — the Game of
// Life layer runs purely off the imagery for now. Left wired up for a later
// pass where pose position could seed or bias the automaton.
let latestPoses = [];
const PALIMPSEST_W = 1280;
const PALIMPSEST_H = 640;
const PANEL_ASPECT = 2; // 72 x 36 in
let outputMode = new URLSearchParams(location.search).get('output') === '1';
const rotateParam = new URLSearchParams(location.search).get('rotate');
const rotateDirection = rotateParam === 'cw' || rotateParam === 'ccw' ? rotateParam : null;

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function buildTerrain() {
  const rand = seeded(41731);
  terrain = createGraphics(1200, 2200);
  terrain.pixelDensity(1);
  terrain.background(22, 27, 24);
  terrain.noStroke();
  for (let y = 0; y < terrain.height; y += 18) {
    for (let x = 0; x < terrain.width; x += 18) {
      const n = noise(x * .006, y * .006);
      const field = noise(x * .019 + 80, y * .019 + 40);
      const base = 36 + n * 92;
      terrain.fill(base * .76, base * (.83 + field * .18), base * .67, 235);
      terrain.rect(x, y, 19, 19);
    }
  }
  terrain.stroke(175, 166, 137, 92);
  terrain.strokeWeight(2);
  for (let i = 0; i < 52; i += 1) {
    const x = rand() * terrain.width;
    const w = 55 + rand() * 210;
    terrain.noFill();
    terrain.rect(x, -40, w, terrain.height + 80);
  }
  terrain.stroke(214, 205, 177, 62);
  terrain.strokeWeight(5);
  for (let i = 0; i < 12; i += 1) {
    const y = rand() * terrain.height;
    terrain.line(-50, y, terrain.width + 50, y + (rand() - .5) * 240);
  }
  terrain.noFill();
  terrain.stroke(28, 42, 46, 190);
  terrain.strokeWeight(38);
  terrain.beginShape();
  for (let y = -60; y < terrain.height + 60; y += 90) {
    terrain.curveVertex(terrain.width * .52 + sin(y * .006) * 170 + noise(y * .008) * 90, y);
  }
  terrain.endShape();
  terrain.stroke(80, 96, 86, 140);
  terrain.strokeWeight(3);
  for (let i = 0; i < 160; i += 1) terrain.circle(rand() * terrain.width, rand() * terrain.height, 3 + rand() * 13);
}

function buildDriftCloud(key, source, count, seed, sampleCrop) {
  const rand = seeded(seed);
  source.loadPixels();
  const density = source.pixelDensity?.() || 1;
  const pixelWidth = source.width * density;
  driftClouds[key] = Array.from({ length: count }, () => {
    const x = sampleCrop ? (sampleCrop.x + rand() * sampleCrop.w) / source.width : rand();
    const y = sampleCrop ? (sampleCrop.y + rand() * sampleCrop.h) / source.height : rand();
    const px = min(pixelWidth - 1, floor(x * source.width) * density);
    const py = min(source.height * density - 1, floor(y * source.height) * density);
    const offset = 4 * (py * pixelWidth + px);
    const color = [source.pixels[offset], source.pixels[offset + 1], source.pixels[offset + 2]];
    const luminance = color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
    const cropY = sampleCrop ? constrain((y * source.height - sampleCrop.y) / sampleCrop.h, 0, 1) : y;
    const spatialDepth = sampleCrop
      ? constrain(.06 + cropY * .78 + (1 - luminance / 255) * .09 + (rand() - .5) * .12, .03, 1)
      : .25 + rand() * .75;
    return {
      x,
      y,
      color,
      phase: rand() * TWO_PI,
      speed: .55 + rand() * 1.25,
      depth: spatialDepth,
      size: .55 + rand() * 1.2,
      wander: rand() * 1000
    };
  });
}

function buildDriftClouds() {
  historicalYears.forEach((year, index) => buildDriftCloud(`aerial-${year}`, aerialImages[index], 5600, 7000 + year));
  buildDriftCloud('cir-2022', falseColorAerial, 5600, 9222);
  buildDriftCloud('ndvi-2022', ndviAerial, 5600, 12222);
}

function buildPalimpsestBuffer() {
  palimpsestBuffer = createGraphics(PALIMPSEST_W, PALIMPSEST_H);
  palimpsestBuffer.pixelDensity(1);
  palimpsestBuffer.clear();
}

const LIFE_COLS = 320;
const LIFE_ROWS = 160;
const LIFE_CELL_PX = 4; // must equal PALIMPSEST_W / LIFE_COLS (and PALIMPSEST_H / LIFE_ROWS)
let lifeGrid;
let lifeColors;
let lastLifeStepTime = -Infinity;
let lastLifeSeedTime = -Infinity;
const LIFE_STEP_MS = 180;
const LIFE_RESEED_MS = 2200;
const LIFE_BLOOM_RESET_DENSITY = .82;

function buildLifeGrid() {
  lifeGrid = new Uint8Array(LIFE_COLS * LIFE_ROWS);
  lifeColors = new Array(LIFE_COLS * LIFE_ROWS).fill([40, 70, 110]);
}

// Reads whatever satellite imagery is currently on screen within the panel
// and samples one color + luminance per grid cell. Not called every frame —
// only at each reseed, since getImageData is a synchronous GPU->CPU readback.
function sampleImageGrid(panel) {
  const density = pixelDensity();
  const bx = Math.max(0, Math.floor(panel.x * density));
  const by = Math.max(0, Math.floor(panel.y * density));
  const bw = Math.max(1, Math.min(width * density - bx, Math.ceil(panel.w * density)));
  const bh = Math.max(1, Math.min(height * density - by, Math.ceil(panel.h * density)));
  const data = drawingContext.getImageData(bx, by, bw, bh).data;
  const luma = new Float32Array(LIFE_COLS * LIFE_ROWS);
  const colors = new Array(LIFE_COLS * LIFE_ROWS);
  for (let cy = 0; cy < LIFE_ROWS; cy += 1) {
    for (let cx = 0; cx < LIFE_COLS; cx += 1) {
      const sx = min(bw - 1, floor((cx + .5) / LIFE_COLS * bw));
      const sy = min(bh - 1, floor((cy + .5) / LIFE_ROWS * bh));
      const o = (sy * bw + sx) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const i = cy * LIFE_COLS + cx;
      luma[i] = r * .2126 + g * .7152 + b * .0722;
      colors[i] = [r, g, b];
    }
  }
  return { luma, colors };
}

// Seeds new living cells along luminance edges in the current imagery —
// roads, water lines, field boundaries — rather than clearing and restarting,
// so freshly-seeded life keeps merging with whatever pattern is mid-evolution.
// Also refreshes each cell's color, so as the aerial pan scrolls the automaton
// keeps drawing new ground color rather than running on a single stale frame.
function reseedLife(panel) {
  const { luma, colors } = sampleImageGrid(panel);
  lifeColors = colors;
  for (let cy = 0; cy < LIFE_ROWS; cy += 1) {
    for (let cx = 0; cx < LIFE_COLS; cx += 1) {
      const i = cy * LIFE_COLS + cx;
      const right = cx + 1 < LIFE_COLS ? luma[i + 1] : luma[i];
      const down = cy + 1 < LIFE_ROWS ? luma[i + LIFE_COLS] : luma[i];
      const edge = Math.abs(luma[i] - right) + Math.abs(luma[i] - down);
      if (edge > 26 && random() < .55) lifeGrid[i] = 1;
    }
  }
}

// Life Without Death (B3/S012345678) — "blooming flakes": birth still needs
// exactly 3 neighbors, but a living cell never dies regardless of neighbor
// count. Growth only ever spreads outward from each seed, crystalline and
// coral-like, rather than oscillating the way Conway's Life does. Returns
// the resulting live-cell density so the caller can reset once it blooms
// to fullness (nothing in this rule ever shrinks it back down on its own).
function stepLife() {
  const next = new Uint8Array(LIFE_COLS * LIFE_ROWS);
  let aliveCount = 0;
  for (let cy = 0; cy < LIFE_ROWS; cy += 1) {
    for (let cx = 0; cx < LIFE_COLS; cx += 1) {
      let n = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || nx >= LIFE_COLS || ny < 0 || ny >= LIFE_ROWS) continue;
          n += lifeGrid[ny * LIFE_COLS + nx];
        }
      }
      const i = cy * LIFE_COLS + cx;
      const born = lifeGrid[i] === 1 || n === 3 ? 1 : 0;
      next[i] = born;
      aliveCount += born;
    }
  }
  lifeGrid = next;
  return aliveCount / (LIFE_COLS * LIFE_ROWS);
}

// Writes directly into the buffer's pixel array rather than issuing a
// rect() draw call per living cell — at 320x160 cells that's up to ~25k
// cells, and raw pixel writes stay cheap where that many canvas draw calls
// would not. Relies on LIFE_CELL_PX being an exact, whole-number divisor of
// PALIMPSEST_W/H so each cell maps to a clean block of pixels.
function drawLife() {
  palimpsestBuffer.loadPixels();
  const buf = palimpsestBuffer.pixels;
  for (let cy = 0; cy < LIFE_ROWS; cy += 1) {
    for (let cx = 0; cx < LIFE_COLS; cx += 1) {
      const i = cy * LIFE_COLS + cx;
      if (!lifeGrid[i]) continue;
      const [r, g, b] = lifeColors[i];
      const startX = cx * LIFE_CELL_PX;
      const startY = cy * LIFE_CELL_PX;
      for (let py = 0; py < LIFE_CELL_PX; py += 1) {
        let o = ((startY + py) * PALIMPSEST_W + startX) * 4;
        for (let px = 0; px < LIFE_CELL_PX; px += 1) {
          buf[o] = r;
          buf[o + 1] = g;
          buf[o + 2] = b;
          buf[o + 3] = 255;
          o += 4;
        }
      }
    }
  }
  palimpsestBuffer.updatePixels();
}

// Cleared fully each frame — living cells are a hard, opaque cut into the
// image rather than a fading trace, so dead cells vanish immediately instead
// of ghosting out.
function updatePalimpsest(panel) {
  if (!palimpsestBuffer) return;
  palimpsestBuffer.clear();

  if (!panel) return;
  const now = millis();
  if (now - lastLifeSeedTime > LIFE_RESEED_MS) {
    reseedLife(panel);
    lastLifeSeedTime = now;
  }
  if (now - lastLifeStepTime > LIFE_STEP_MS) {
    const density = stepLife();
    lastLifeStepTime = now;
    if (density > LIFE_BLOOM_RESET_DENSITY) {
      lifeGrid.fill(0);
      reseedLife(panel);
      lastLifeSeedTime = now;
    }
  }
  drawLife();
}

function drawPalimpsestLayer(panel, opacity) {
  if (!palimpsestBuffer || opacity < .01) return;
  push();
  drawingContext.imageSmoothingEnabled = false;
  tint(255, 255 * opacity);
  image(palimpsestBuffer, panel.x, panel.y, panel.w, panel.h);
  drawingContext.imageSmoothingEnabled = true;
  pop();
}

// When rotated, the canvas-mount is rotated by CSS transform on #rotateStage,
// so getBoundingClientRect() would return post-rotation, viewport-space
// coordinates that no longer match the canvas's own (pre-transform) pixel
// space. The panel rect has to be computed analytically against the logical
// (un-rotated) canvas size instead of measured from the DOM in that case.
function logicalPanelRect(w, h) {
  const marginX = w * .05;
  const marginY = h * .12;
  const availW = w - marginX * 2;
  const availH = h - marginY * 2;
  let panelW = availW;
  let panelH = panelW / PANEL_ASPECT;
  if (panelH > availH) {
    panelH = availH;
    panelW = panelH * PANEL_ASPECT;
  }
  return { x: (w - panelW) / 2, y: (h - panelH) / 2, w: panelW, h: panelH };
}

function fieldRects() {
  if (rotateDirection) {
    const panel = logicalPanelRect(width, height);
    return { drawing: panel, map: panel };
  }
  const m = mapField.getBoundingClientRect();
  const panel = { x: m.left, y: m.top, w: m.width, h: m.height };
  return { drawing: panel, map: panel };
}

function activeSpectrum(scene, progress) {
  if (scene.id !== 'spectrum') return scene.id === 'loss' ? 'ndvi' : 'visible';
  const index = constrain(floor(progress * spectrumOrder.length), 0, spectrumOrder.length - 1);
  return spectrumOrder[index];
}

// The NAIP frames are tall, portrait scans (1200x2200); the panel is wide
// landscape. Start from a candidate crop height, then derive width from the
// panel's aspect ratio, but if that width would exceed the source image's
// width, fall back to cropping by the full width instead and derive height
// from that — this is the only way to guarantee the crop's own aspect always
// matches the panel's, so image() is scaling a same-shaped region, never
// stretching a mismatched one.
function aerialCrop(mapRect, sourceImage) {
  const aspect = mapRect.w / mapRect.h;
  let sourceH = sourceImage === terrain ? min(sourceImage.height, mapRect.h * 2.8) : sourceImage.height * .7;
  let sourceW = sourceH * aspect;
  if (sourceW > sourceImage.width) {
    sourceW = sourceImage.width;
    sourceH = sourceW / aspect;
  }
  const sourceX = (sourceImage.width - sourceW) / 2;
  const panRange = max(1, sourceImage.height - sourceH);
  return { x: sourceX, y: panRange * .5, w: sourceW, h: sourceH };
}

function drawAerialPan(mapRect, palette, glitch, sourceImage = aerialImages.at(-1) || terrain) {
  const crop = aerialCrop(mapRect, sourceImage);
  push();
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
  drawingContext.clip();
  drawingContext.filter = palette.filter;
  image(sourceImage, mapRect.x, mapRect.y, mapRect.w, mapRect.h, crop.x, crop.y, crop.w, crop.h);
  drawingContext.filter = 'none';
  noStroke();
  fill(...palette.veil);
  rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
  const sliceCount = floor(glitch * 18);
  for (let i = 0; i < sliceCount; i += 1) {
    const sy = mapRect.y + random(mapRect.h);
    const sh = random(2, 22 + glitch * 30);
    const shift = random(-1, 1) * glitch * mapRect.w * .11;
    copy(mapRect.x, sy, mapRect.w, sh, mapRect.x + shift, sy, mapRect.w, sh);
  }
  drawingContext.restore();
  noFill();
  stroke(255, 255, 255, 80);
  strokeWeight(1);
  rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
  pop();
  return crop;
}

function clipTo(panel, drawFn) {
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(panel.x, panel.y, panel.w, panel.h);
  drawingContext.clip();
  drawFn();
  drawingContext.restore();
}

function drawDriftingPixels(panel, key, source, amount, crop = { x: 0, y: 0, w: source.width, h: source.height }, options = {}) {
  const cloud = driftClouds[key];
  if (!cloud?.length || amount < .015) return;
  const pointCloudMode = options.pointCloudMode === true;
  const time = millis() * .001;
  const drift = panel.w * amount * (.012 + movementEnergy * .045);
  const binaryFrame = floor(time * (2 + movementEnergy * 14));
  const cameraX = sin(time * .16) * panel.w * .026;
  const cameraY = cos(time * .11) * panel.h * .008;
  const cameraScale = 1 + sin(time * .075) * .006;
  const movementCameraX = sin(time * 1.7) * movementEnergy * panel.w * .055;
  const movementCameraY = cos(time * 1.35) * movementEnergy * panel.h * .014;
  clipTo(panel, () => {
    push();
    noStroke();
    fill(3, 5, 4, pointCloudMode ? 255 : amount * 205);
    rect(panel.x, panel.y, panel.w, panel.h);
    for (const pointData of cloud) {
      const sourceX = pointData.x * source.width;
      const sourceY = pointData.y * source.height;
      if (sourceX < crop.x || sourceX > crop.x + crop.w || sourceY < crop.y || sourceY > crop.y + crop.h) continue;
      const normalizedX = (sourceX - crop.x) / crop.w;
      const normalizedY = (sourceY - crop.y) / crop.h;
      const phase = pointData.phase + time * pointData.speed;
      let offsetX = sin(phase + normalizedY * 5) * drift * pointData.depth;
      let offsetY = cos(phase * .73 + normalizedX * 4) * drift * pointData.depth * .7;
      let pointX = panel.x + normalizedX * panel.w + offsetX;
      let pointY = panel.y + normalizedY * panel.h + offsetY;
      if (pointCloudMode) {
        const transmissionValue = abs(sin(pointData.wander * 12.9898 + binaryFrame * 78.233));
        const dropoutThreshold = .018 + movementEnergy * .34;
        if (transmissionValue < dropoutThreshold) continue;
        const depthFactor = .18 + pointData.depth * 1.32;
        const centeredX = (normalizedX - .5) * panel.w;
        const centeredY = (normalizedY - .5) * panel.h;
        const depthScale = cameraScale + movementEnergy * (pointData.depth - .45) * .025;
        pointX = panel.x + panel.w * .5 + centeredX * depthScale + (cameraX + movementCameraX) * depthFactor;
        pointY = panel.y + panel.h * .5 + centeredY * depthScale + (cameraY + movementCameraY) * depthFactor;
      }
      fill(pointData.color[0], pointData.color[1], pointData.color[2], pointCloudMode ? 255 : 75 + amount * 180);
      const pointSize = pointCloudMode
        ? .65 + pointData.size * .56 + pointData.depth * .65
        : pointData.size * (.65 + amount * .9);
      rect(pointX, pointY, pointSize, pointSize);
    }
    pop();
  });
}

const historicalYears = [2010, 2014, 2018, 2022];

function drawHistoricalScene(panel, progress) {
  const yearIndex = constrain(floor(progress * historicalYears.length), 0, historicalYears.length - 1);
  const localProgress = (progress * historicalYears.length) % 1;
  const source = aerialImages[yearIndex];
  const crop = drawAerialPan(panel, palettes.visible, .015 + (1 - localProgress) * .16, source);
  const driftAmount = constrain(.08 + (1 - localProgress) * .38 + movementEnergy * .5, 0, .78);
  drawDriftingPixels(panel, `aerial-${historicalYears[yearIndex]}`, source, driftAmount, crop);
  clipTo(panel, () => {
    push();
    noStroke();
    fill(208, 194, 158, 10 + yearIndex * 3);
    rect(panel.x, panel.y, panel.w, panel.h);
    fill(244, 243, 239, 205);
    noStroke();
    textSize(18);
    textAlign(LEFT, TOP);
    text(historicalYears[yearIndex], panel.x + 10, panel.y + 10);
    textSize(8);
    fill(244, 243, 239, 105);
    text('USDA NAIP / FORT SPUNKY STUDY APERTURE', panel.x + 10, panel.y + 36);
    pop();
  });
}

function drawFilmScene(rects, scene, progress) {
  if (scene.id === 'remote') {
    const source = aerialImages.at(-1);
    const crop = drawAerialPan(rects.map, palettes.visible, .015, source);
    drawDriftingPixels(rects.map, 'aerial-2022', source, constrain(.08 + movementEnergy * .48, 0, .58), crop);
  }
  if (scene.id === 'history') drawHistoricalScene(rects.map, progress);
  if (scene.id === 'spectrum') {
    const imageSource = spectrum === 'nir' ? falseColorAerial : spectrum === 'ndvi' ? ndviAerial : aerialImages.at(-1);
    const cloudKey = spectrum === 'nir' ? 'cir-2022' : spectrum === 'ndvi' ? 'ndvi-2022' : 'aerial-2022';
    const localProgress = (progress * spectrumOrder.length) % 1;
    const crop = drawAerialPan(rects.map, palettes[spectrum], .025, imageSource);
    drawDriftingPixels(rects.map, cloudKey, imageSource, constrain(.08 + (1 - localProgress) * .34 + movementEnergy * .45, 0, .7), crop);
  }
  if (scene.id === 'loss') {
    const crop = drawAerialPan(rects.map, palettes.ndvi, .03 + progress * .32, ndviAerial);
    drawDriftingPixels(rects.map, 'ndvi-2022', ndviAerial, constrain(.18 + progress * .7 + movementEnergy * .25, 0, 1), crop);
  }
}

function drawMetadata(rect, palette) {
  const [r, g, b] = palette.signal;
  push();
  fill(244, 243, 239, 150);
  noStroke();
  textSize(8);
  textAlign(LEFT, BOTTOM);
  text(spectrum.toUpperCase(), rect.x, rect.y - 9);
  textAlign(RIGHT, BOTTOM);
  fill(r, g, b, 210);
  text(`MOTION ${nf(movementEnergy, 1, 2)}  ·  PROXIMITY ${nf(proximity, 1, 2)}`, rect.x + rect.w, rect.y - 9);
  pop();
}

async function setupDetector() {
  if (poseLandmarker || detectorLoading) return;
  detectorLoading = true;
  sensorStatus.textContent = 'Loading local movement model…';
  const { FilesetResolver, PoseLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm');
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
  const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const options = {
    baseOptions: { modelAssetPath, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 4,
    minPoseDetectionConfidence: .45,
    minPosePresenceConfidence: .45,
    minTrackingConfidence: .45,
    outputSegmentationMasks: false
  };
  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, options);
  } catch (gpuError) {
    options.baseOptions = { modelAssetPath, delegate: 'CPU' };
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, options);
  }
  detectorLoading = false;
}

function landmarkDistance(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function analyzePoses(poses) {
  latestPoses = poses || [];
  if (!poses?.length) {
    bodyCount = 0;
    cameraProximity *= .9;
    if (millis() - lastBodySeenAt > 1000) lastPoseCenter = undefined;
    return;
  }
  bodyCount = poses.length;
  let largestScale = 0;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const points of poses) {
    const leftShoulder = points[11];
    const rightShoulder = points[12];
    const leftHip = points[23];
    const rightHip = points[24];
    const shoulderWidth = landmarkDistance(leftShoulder, rightShoulder);
    const shoulderMid = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 };
    const hipMid = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
    const torsoHeight = landmarkDistance(shoulderMid, hipMid);
    largestScale = Math.max(largestScale, shoulderWidth * 1.65, torsoHeight * 2.05);
    for (const point of points) {
      if ((point.visibility ?? 1) < .35) continue;
      minX = min(minX, point.x);
      minY = min(minY, point.y);
      maxX = max(maxX, point.x);
      maxY = max(maxY, point.y);
    }
  }
  cameraProximity = constrain(map(largestScale, .18, .92, 0, 1), 0, 1);
  const poseCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  if (lastPoseCenter) {
    const translation = Math.hypot(poseCenter.x - lastPoseCenter.x, poseCenter.y - lastPoseCenter.y);
    const scaleChange = Math.abs(largestScale - lastPoseScale);
    movementImpulse = max(movementImpulse, constrain(translation * 4.5 + scaleChange * 3.2, 0, 1));
  }
  lastPoseCenter = poseCenter;
  lastPoseScale = largestScale;
  lastBodySeenAt = millis();
}

async function startCamera() {
  try {
    await setupDetector();
    capture = createCapture({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    capture.size(320, 240);
    capture.hide();
    cameraActive = true;
    cameraToggle.textContent = 'Stop sensing';
    sensorStatus.textContent = 'Camera active · waiting for movement · frames remain local';
  } catch (error) {
    cameraActive = false;
    detectorLoading = false;
    sensorStatus.textContent = 'Camera unavailable · pointer remains active';
    console.warn(error);
  }
}

function stopCamera() {
  if (capture?.elt?.srcObject) capture.elt.srcObject.getTracks().forEach((track) => track.stop());
  capture?.remove();
  capture = null;
  cameraActive = false;
  cameraProximity = 0;
  bodyCount = 0;
  lastPoseCenter = undefined;
  cameraToggle.textContent = 'Begin movement sensing';
  sensorStatus.textContent = 'Camera off · pointer movement disturbs transmission';
}

function detectProximity() {
  if (!cameraActive || !capture?.elt || !poseLandmarker || capture.elt.readyState < 2 || detectionBusy) return;
  if (millis() - lastDetection < 90 || capture.elt.currentTime === lastVideoTime) return;
  lastDetection = millis();
  lastVideoTime = capture.elt.currentTime;
  detectionBusy = true;
  poseLandmarker.detectForVideo(capture.elt, performance.now(), (result) => {
    try {
      analyzePoses(result.landmarks);
      sensorStatus.textContent = bodyCount
        ? `Camera active · ${bodyCount} ${bodyCount === 1 ? 'body' : 'bodies'} · movement translated locally`
        : 'Camera active · waiting for movement · frames remain local';
    } finally {
      detectionBusy = false;
    }
  });
}

function updateInteraction() {
  detectProximity();
  const target = cameraActive ? cameraProximity : pointerProximity;
  proximity = lerp(proximity, target, .075);
  movementEnergy = max(movementImpulse, movementEnergy * Math.pow(.91, deltaTime / 16.67));
  movementImpulse *= Math.pow(.72, deltaTime / 16.67);
}

window.preload = function preload() {
  aerialImages = historicalYears.map((year) => loadImage(`assets/projection/fort-spunky-naip-${year}.jpg`));
  falseColorAerial = loadImage('assets/projection/fort-spunky-naip-2022-cir.jpg');
  ndviAerial = loadImage('assets/projection/fort-spunky-naip-2022-ndvi.png');
};

// The physical projector is mounted on its side, so its native output is
// portrait relative to what the page composes. Rendering at swapped
// dimensions (and rotating that whole render via CSS on #rotateStage) means
// the artwork is authored in normal landscape logic throughout, then comes
// out upright once the tilted projector reprojects it.
function stageSize() {
  return rotateDirection ? { w: window.innerHeight, h: window.innerWidth } : { w: window.innerWidth, h: window.innerHeight };
}

window.setup = function setup() {
  if (rotateDirection) {
    rotateStage.classList.add(rotateDirection === 'cw' ? 'is-rotated-cw' : 'is-rotated-ccw');
    stage.classList.add('rotated');
  }
  const size = stageSize();
  const canvas = createCanvas(size.w, size.h);
  canvas.parent(mount);
  pixelDensity(min(2, window.devicePixelRatio || 1));
  noiseSeed(9173);
  randomSeed(9173);
  buildTerrain();
  buildDriftClouds();
  buildPalimpsestBuffer();
  buildLifeGrid();
  stateName.textContent = scene.name;
  stateDetail.textContent = scene.detail;
  stage.classList.toggle('output-mode', outputMode);
  stage.classList.toggle('preview-mode', !outputMode);
  outputToggle.setAttribute('aria-pressed', String(outputMode));
  outputToggle.textContent = outputMode ? 'Drawing preview' : 'Installation output';
};

window.draw = function draw() {
  clear();
  updateInteraction();
  spectrum = activeSpectrum(scene, 0);
  const palette = palettes[spectrum];
  const rects = fieldRects();
  drawFilmScene(rects, scene, 0);
  updatePalimpsest(rects.map);
  drawPalimpsestLayer(rects.map, 1);
  drawMetadata(rects.map, palette);
};

window.windowResized = function windowResized() {
  const size = stageSize();
  resizeCanvas(size.w, size.h);
};
window.mouseMoved = function mouseMoved() {
  const now = performance.now();
  if (lastPointer.time) {
    const elapsed = max(12, now - lastPointer.time);
    const distance = Math.hypot(mouseX - lastPointer.x, mouseY - lastPointer.y);
    movementImpulse = max(movementImpulse, constrain(distance / elapsed * .045, 0, 1));
  }
  lastPointer = { x: mouseX, y: mouseY, time: now };
  if (!cameraActive) pointerProximity = constrain(1 - mouseY / height, .04, 1);
};

cameraToggle.addEventListener('click', () => cameraActive ? stopCamera() : startCamera());
outputToggle.addEventListener('click', () => {
  outputMode = !outputMode;
  stage.classList.toggle('output-mode', outputMode);
  stage.classList.toggle('preview-mode', !outputMode);
  outputToggle.setAttribute('aria-pressed', String(outputMode));
  outputToggle.textContent = outputMode ? 'Drawing preview' : 'Installation output';
});
document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'p') outputToggle.click();
  if (event.key.toLowerCase() === 'h') stage.classList.toggle('controls-hidden');
  if (event.key.toLowerCase() === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});
