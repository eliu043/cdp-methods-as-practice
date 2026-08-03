const stage = document.getElementById('projectionStage');
const mount = document.getElementById('canvasMount');
const drawingField = document.getElementById('drawingField');
const mapField = document.getElementById('mapField');
const cameraToggle = document.getElementById('cameraToggle');
const outputToggle = document.getElementById('outputToggle');
const spectrumSelect = document.getElementById('spectrumSelect');
const sensorStatus = document.getElementById('sensorStatus');
const stateIndex = document.getElementById('stateIndex');
const stateName = document.getElementById('stateName');
const stateDetail = document.getElementById('stateDetail');

const states = [
  ['00', 'Evidence remains unresolved', 'The image retains incompatible dates, scales, and spectra.'],
  ['01', 'Property', 'Continuous ground is translated into boundary, title, and value.'],
  ['02', 'Suitability', 'Heterogeneous terrain is flattened into score and selection.'],
  ['03', 'Capacity', 'Water, power, roads, and fiber appear as reservable service.'],
  ['04', 'Demand', 'A projected future becomes a present commitment.']
];

const palettes = {
  visible: { filter: 'saturate(.72) contrast(1.06)', veil: [16, 19, 15, 20], signal: [221, 255, 48] },
  nir: { filter: 'grayscale(.25) sepia(.8) saturate(2.4) hue-rotate(292deg) contrast(1.22)', veil: [72, 0, 52, 32], signal: [255, 102, 180] },
  thermal: { filter: 'grayscale(.45) sepia(1) saturate(4.8) hue-rotate(330deg) contrast(1.35)', veil: [48, 0, 80, 24], signal: [255, 189, 47] },
  moisture: { filter: 'grayscale(.15) sepia(.5) saturate(2.9) hue-rotate(128deg) contrast(1.2)', veil: [0, 54, 62, 32], signal: [66, 237, 255] }
};
const spectrumOrder = ['visible', 'nir', 'thermal', 'moisture'];

let terrain;
let capture;
let poseLandmarker;
let detectorLoading = false;
let detectionBusy = false;
let cameraActive = false;
let cameraProximity = 0;
let pointerProximity = .08;
let proximity = .08;
let commitment = 0;
let lastDetection = 0;
let lastVideoTime = -1;
let lastBodySeenAt = 0;
let silhouetteImage;
let silhouetteContext;
let silhouetteBounds = { x: .2, y: .05, w: .6, h: .9 };
let silhouetteCoverage = 0;
let bodyCount = 0;
let spectrum = 'visible';
let outputMode = new URLSearchParams(location.search).get('output') === '1';

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

function fieldRects() {
  const d = drawingField.getBoundingClientRect();
  const m = mapField.getBoundingClientRect();
  return {
    drawing: { x: d.left, y: d.top, w: d.width, h: d.height },
    map: { x: m.left, y: m.top, w: m.width, h: m.height }
  };
}

function activeSpectrum() {
  if (spectrumSelect.value !== 'auto') return spectrumSelect.value;
  return spectrumOrder[Math.floor(millis() / 10500) % spectrumOrder.length];
}

function drawMirroredMap(mapRect, palette, glitch) {
  const sourceH = min(terrain.height, mapRect.h * 2.8);
  const panRange = max(1, terrain.height - sourceH);
  const panY = (millis() * .018) % panRange;
  const half = mapRect.w / 2;
  push();
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
  drawingContext.clip();
  drawingContext.filter = palette.filter;
  image(terrain, mapRect.x, mapRect.y, half, mapRect.h, 0, panY, terrain.width / 2, sourceH);
  push();
  translate(mapRect.x + mapRect.w, 0);
  scale(-1, 1);
  image(terrain, 0, mapRect.y, half, mapRect.h, 0, panY, terrain.width / 2, sourceH);
  pop();
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
  stroke(255, 255, 255, 80);
  strokeWeight(1);
  line(mapRect.x + half, mapRect.y, mapRect.x + half, mapRect.y + mapRect.h);
  noFill();
  rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
  pop();
}

function drawCommitmentLayer(rects, amount, palette) {
  if (amount < .03) return;
  const d = rects.drawing;
  const m = rects.map;
  const stageValue = amount * 4;
  const alpha = 40 + amount * 145;
  const [r, g, b] = palette.signal;
  push();
  noFill();
  stroke(r, g, b, alpha);
  strokeWeight(1);
  if (stageValue > .45) {
    for (let x = 1; x < 6; x += 1) line(d.x + d.w * x / 6, d.y, d.x + d.w * x / 6, d.y + d.h);
    for (let y = 1; y < 12; y += 1) line(d.x, d.y + d.h * y / 12, d.x + d.w, d.y + d.h * y / 12);
  }
  if (stageValue > 1.45) {
    noStroke();
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 10; y += 1) {
        const score = noise(x * .72 + 10, y * .54 + 20);
        fill(r, g, b, map(score, 0, 1, 5, 70) * amount);
        rect(d.x + x * d.w / 5, d.y + y * d.h / 10, d.w / 5, d.h / 10);
      }
    }
  }
  if (stageValue > 2.45) {
    stroke(r, g, b, alpha);
    strokeWeight(2);
    const y1 = d.y + d.h * .34;
    const y2 = d.y + d.h * .72;
    line(d.x - 70, y1, m.x + m.w + 70, y1);
    line(d.x - 35, y2, m.x + m.w + 35, y2);
    strokeWeight(5);
    point(d.x + d.w * .2, y1);
    point(d.x + d.w * .78, y2);
  }
  if (stageValue > 3.45) {
    const pulse = .55 + sin(millis() * .006) * .2;
    noStroke();
    fill(r, g, b, 65 * pulse);
    rect(d.x + d.w * .34, d.y + d.h * .43, d.w * .42, d.h * .19);
    fill(r, g, b, 220);
    textSize(8);
    textAlign(LEFT, BOTTOM);
    text('CAPACITY RESERVED / COMMITMENT PERSISTS', d.x + 8, d.y - 9);
  }
  pop();
}

function fittedShadow(panel, bounds) {
  const sourceAspect = bounds.w / max(.01, bounds.h);
  let w = panel.w * (.62 + proximity * .2);
  let h = w / sourceAspect;
  const maxHeight = panel.h * (.58 + proximity * .25);
  if (h > maxHeight) {
    h = maxHeight;
    w = h * sourceAspect;
  }
  return {
    x: panel.x + (panel.w - w) / 2,
    y: panel.y + panel.h * .88 - h,
    w,
    h
  };
}

function drawSegmentedShadow(panel, palette, alpha, difference = false) {
  if (!silhouetteImage || silhouetteCoverage < .004 || silhouetteCoverage > .82) return;
  const source = {
    x: silhouetteBounds.x * silhouetteImage.width,
    y: silhouetteBounds.y * silhouetteImage.height,
    w: silhouetteBounds.w * silhouetteImage.width,
    h: silhouetteBounds.h * silhouetteImage.height
  };
  const target = fittedShadow(panel, silhouetteBounds);
  const [r, g, b] = palette.signal;
  push();
  if (difference) blendMode(DIFFERENCE);
  tint(difference ? 244 : r, difference ? 243 : g, difference ? 239 : b, alpha);
  translate(target.x + target.w, 0);
  scale(-1, 1);
  image(silhouetteImage, 0, target.y, target.w, target.h, source.x, source.y, source.w, source.h);
  noTint();
  blendMode(BLEND);
  pop();
}

function drawFallbackShadow(rects, palette) {
  if (cameraActive || proximity < .12) return;
  const [r, g, b] = palette.signal;
  const drawFigure = (panel, alpha, difference) => {
    const s = panel.h * (.13 + proximity * .12);
    push();
    if (difference) blendMode(DIFFERENCE);
    translate(panel.x + panel.w * .5, panel.y + panel.h * .82);
    noStroke();
    fill(difference ? 244 : r, difference ? 243 : g, difference ? 239 : b, alpha);
    ellipse(0, -s * 2.9, s * .78, s * .9);
    beginShape();
    vertex(-s * .62, -s * 2.25);
    vertex(-s * .9, -s * .9);
    vertex(-s * .5, 0);
    vertex(s * .5, 0);
    vertex(s * .9, -s * .9);
    vertex(s * .62, -s * 2.25);
    endShape(CLOSE);
    blendMode(BLEND);
    pop();
  };
  drawFigure(rects.drawing, 105, false);
  drawFigure(rects.map, 105, true);
}

function drawDataShadow(rects, palette) {
  const shadowMemory = constrain(1 - (millis() - lastBodySeenAt) / 6000, 0, 1);
  if (cameraActive && silhouetteImage && shadowMemory > 0) {
    drawSegmentedShadow(rects.drawing, palette, 178 * shadowMemory, false);
    drawSegmentedShadow(rects.map, palette, 158 * shadowMemory, true);
  } else drawFallbackShadow(rects, palette);
}

function drawMetadata(rect, palette) {
  const [r, g, b] = palette.signal;
  push();
  fill(244, 243, 239, 150);
  noStroke();
  textSize(8);
  textAlign(LEFT, BOTTOM);
  text(`SPECTRUM / ${spectrum.toUpperCase()}`, rect.x, rect.y - 9);
  textAlign(RIGHT, BOTTOM);
  fill(r, g, b, 210);
  text(`PROXIMITY ${nf(proximity, 1, 2)}  ·  COMMITMENT ${nf(commitment, 1, 2)}`, rect.x + rect.w, rect.y - 9);
  pop();
}

async function setupDetector() {
  if (poseLandmarker || detectorLoading) return;
  detectorLoading = true;
  sensorStatus.textContent = 'Loading local body-mask model…';
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
    outputSegmentationMasks: true
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
  if (!poses?.length) {
    bodyCount = 0;
    cameraProximity *= .9;
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
  const boundX = constrain(minX - .07, 0, .88);
  const boundY = constrain(minY - .07, 0, .88);
  silhouetteBounds = {
    x: boundX,
    y: boundY,
    w: constrain(maxX - minX + .14, .12, 1 - boundX),
    h: constrain(maxY - minY + .14, .12, 1 - boundY)
  };
  lastBodySeenAt = millis();
}

function combineMasks(masks, poses) {
  if (!masks?.length || !poses?.length) return;
  const width = masks[0].width;
  const height = masks[0].height;
  if (!silhouetteImage || silhouetteImage.width !== width || silhouetteImage.height !== height) {
    silhouetteImage = createImage(width, height);
    silhouetteContext = silhouetteImage.canvas.getContext('2d', { willReadFrequently: true });
  }
  const combined = new Float32Array(width * height);
  for (const mask of masks) {
    const values = mask.getAsFloat32Array();
    for (let i = 0; i < combined.length; i += 1) combined[i] = max(combined[i], values[i]);
    mask.close?.();
  }
  const firstPose = poses[0];
  const torsoX = constrain((firstPose[11].x + firstPose[12].x + firstPose[23].x + firstPose[24].x) / 4, 0, 1);
  const torsoY = constrain((firstPose[11].y + firstPose[12].y + firstPose[23].y + firstPose[24].y) / 4, 0, 1);
  const torsoIndex = min(combined.length - 1, floor(torsoY * height) * width + floor(torsoX * width));
  const edgeIndexes = [0, width - 1, width * (height - 1), width * height - 1];
  const edgeConfidence = edgeIndexes.reduce((sum, index) => sum + combined[index], 0) / edgeIndexes.length;
  const invertMask = combined[torsoIndex] < edgeConfidence;
  const pixels = silhouetteContext.createImageData(width, height);
  let occupied = 0;
  for (let i = 0; i < combined.length; i += 1) {
    const rawConfidence = invertMask ? 1 - combined[i] : combined[i];
    const confidence = constrain((rawConfidence - .22) / .58, 0, 1);
    const alpha = confidence * confidence * (3 - 2 * confidence);
    if (alpha > .35) occupied += 1;
    const offset = i * 4;
    pixels.data[offset] = 255;
    pixels.data[offset + 1] = 255;
    pixels.data[offset + 2] = 255;
    pixels.data[offset + 3] = alpha * 255;
  }
  silhouetteCoverage = occupied / combined.length;
  silhouetteContext.putImageData(pixels, 0, 0);
}

async function startCamera() {
  try {
    await setupDetector();
    capture = createCapture({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    capture.size(320, 240);
    capture.hide();
    cameraActive = true;
    cameraToggle.textContent = 'Stop sensing';
    sensorStatus.textContent = 'Camera active · waiting for a body · frames remain local';
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
  cameraToggle.textContent = 'Begin local sensing';
  sensorStatus.textContent = 'Camera off · pointer is the proximity input';
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
      combineMasks(result.segmentationMasks, result.landmarks);
      sensorStatus.textContent = bodyCount
        ? `Camera active · ${bodyCount} ${bodyCount === 1 ? 'body' : 'bodies'} translated locally`
        : 'Camera active · waiting for a body · frames remain local';
    } finally {
      detectionBusy = false;
    }
  });
}

function updateState() {
  detectProximity();
  const target = cameraActive ? cameraProximity : pointerProximity;
  proximity = lerp(proximity, target, .075);
  if (proximity > commitment) commitment = lerp(commitment, proximity, .12);
  else commitment = max(0, commitment - .00013 * deltaTime);
  const index = constrain(floor(proximity * 4.7), 0, 4);
  stateIndex.textContent = states[index][0];
  stateName.textContent = states[index][1];
  stateDetail.textContent = proximity < .06 && commitment > .18
    ? 'The viewer has departed. Earlier commitments remain in the ground.'
    : states[index][2];
}

window.setup = function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent(mount);
  pixelDensity(min(2, window.devicePixelRatio || 1));
  noiseSeed(9173);
  randomSeed(9173);
  buildTerrain();
  stage.classList.toggle('output-mode', outputMode);
  stage.classList.toggle('preview-mode', !outputMode);
  outputToggle.setAttribute('aria-pressed', String(outputMode));
  outputToggle.textContent = outputMode ? 'Drawing preview' : 'Installation output';
};

window.draw = function draw() {
  clear();
  updateState();
  spectrum = activeSpectrum();
  const palette = palettes[spectrum];
  const rects = fieldRects();
  const transitionGlitch = sin(proximity * PI) * .54;
  const refusalPulse = proximity > .91 ? max(0, sin(millis() * .018)) * .35 : 0;
  drawMirroredMap(rects.map, palette, .06 + transitionGlitch + refusalPulse);
  drawCommitmentLayer(rects, commitment, palette);
  drawDataShadow(rects, palette);
  drawMetadata(rects.map, palette);
};

window.windowResized = function windowResized() { resizeCanvas(windowWidth, windowHeight); };
window.mouseMoved = function mouseMoved() {
  if (!cameraActive) pointerProximity = constrain(1 - mouseY / height, 0, 1);
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
