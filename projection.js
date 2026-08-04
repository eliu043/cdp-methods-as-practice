const stage = document.getElementById('projectionStage');
const mount = document.getElementById('canvasMount');
const drawingField = document.getElementById('drawingField');
const mapField = document.getElementById('mapField');
const previousSceneButton = document.getElementById('previousScene');
const playToggle = document.getElementById('playToggle');
const nextSceneButton = document.getElementById('nextScene');
const cameraToggle = document.getElementById('cameraToggle');
const outputToggle = document.getElementById('outputToggle');
const sensorStatus = document.getElementById('sensorStatus');
const stateIndex = document.getElementById('stateIndex');
const stateName = document.getElementById('stateName');
const stateDetail = document.getElementById('stateDetail');
const filmTimeline = document.getElementById('filmTimeline');

const scenes = [
  { id: 'ground', name: 'Texas bluegrass', duration: 12000, detail: 'A dense spatial sample reveals depth through a slowly moving virtual camera.' },
  { id: 'remote', name: 'Remote view', duration: 12000, detail: 'A 2022 aerial follows the Brazos through the Fort Spunky study aperture.' },
  { id: 'history', name: 'Historical aerials', duration: 15000, detail: 'Registered NAIP acquisitions cut between 2010, 2014, 2018, and 2022.' },
  { id: 'wildflowers', name: 'Wildflower field', duration: 12000, detail: 'Photographic color occupies a porous volume; movement interrupts its transmission.' },
  { id: 'spectrum', name: 'Other spectrum', duration: 12000, detail: 'The 2022 four-band survey switches from natural color to infrared and computed NDVI.' },
  { id: 'capture', name: 'Capture', duration: 12000, detail: 'Living movement becomes an incomplete point cloud.' },
  { id: 'classification', name: 'Classification', duration: 12000, detail: 'Continuous ground becomes cells, scores, and comparable units.' },
  { id: 'commitment', name: 'Commitment', duration: 12000, detail: 'A forecast begins reserving capacity before construction.' },
  { id: 'loss', name: 'Index / loss', duration: 14000, detail: 'A computed vegetation index persists while its transmission loses resolution.' }
];

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
let texasBluegrassImage;
let wildflowerImage;
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
let bodyCount = 0;
let spectrum = 'visible';
let currentSceneIndex = 0;
let sceneElapsed = 0;
let filmPlaying = true;
let movementEnergy = 0;
let movementImpulse = 0;
let lastPoseCenter;
let lastPoseScale = 0;
let lastPointer = { x: 0, y: 0, time: 0 };
let grassBlades = [];
let cloudPoints = [];
let driftClouds = {};
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

function buildSceneMaterial() {
  const rand = seeded(90210);
  grassBlades = Array.from({ length: 190 }, (_, index) => ({
    x: rand(),
    height: .15 + rand() * .46,
    lean: (rand() - .5) * .24,
    phase: rand() * TWO_PI,
    depth: rand(),
    index
  }));
  cloudPoints = [];
  for (const blade of grassBlades) {
    for (let step = 0; step <= 11; step += 1) {
      cloudPoints.push({
        x: blade.x,
        y: step / 11,
        height: blade.height,
        lean: blade.lean,
        phase: blade.phase,
        depth: blade.depth,
        dropout: rand()
      });
    }
  }
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
  const fieldPanel = { w: 1, h: 2 };
  buildDriftCloud('bluegrass', texasBluegrassImage, 22000, 6214, coverCrop(fieldPanel, texasBluegrassImage));
  buildDriftCloud('wildflowers', wildflowerImage, 22000, 6417, coverCrop(fieldPanel, wildflowerImage));
  historicalYears.forEach((year, index) => buildDriftCloud(`aerial-${year}`, aerialImages[index], 5600, 7000 + year));
  buildDriftCloud('cir-2022', falseColorAerial, 5600, 9222);
  buildDriftCloud('ndvi-2022', ndviAerial, 5600, 12222);
}

function fieldRects() {
  const d = drawingField.getBoundingClientRect();
  const m = mapField.getBoundingClientRect();
  return {
    drawing: { x: d.left, y: d.top, w: d.width, h: d.height },
    map: { x: m.left, y: m.top, w: m.width, h: m.height }
  };
}

function activeSpectrum(scene, progress) {
  if (scene.id !== 'spectrum') return scene.id === 'loss' ? 'ndvi' : 'visible';
  const index = constrain(floor(progress * spectrumOrder.length), 0, spectrumOrder.length - 1);
  return spectrumOrder[index];
}

function aerialCrop(mapRect, sourceImage) {
  const sourceH = sourceImage === terrain ? min(sourceImage.height, mapRect.h * 2.8) : sourceImage.height * .7;
  const sourceW = min(sourceImage.width, sourceH * mapRect.w / mapRect.h);
  const sourceX = (sourceImage.width - sourceW) / 2;
  const panRange = max(1, sourceImage.height - sourceH);
  return { x: sourceX, y: (millis() * .012) % panRange, w: sourceW, h: sourceH };
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

function coverCrop(panel, source) {
  const panelAspect = panel.w / panel.h;
  const sourceAspect = source.width / source.height;
  if (sourceAspect > panelAspect) {
    const width = source.height * panelAspect;
    return { x: (source.width - width) / 2, y: 0, w: width, h: source.height };
  }
  const height = source.width / panelAspect;
  return { x: 0, y: (source.height - height) / 2, w: source.width, h: height };
}

function drawFieldScene(panel, progress, source, cloudKey, label) {
  const crop = coverCrop(panel, source);
  drawDriftingPixels(panel, cloudKey, source, 1, crop, { pointCloudMode: true });
  push();
  fill(244, 243, 239, 145);
  noStroke();
  textSize(8);
  textAlign(LEFT, TOP);
  text(label, panel.x + 10, panel.y + 10);
  pop();
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

function drawPointCloudScene(panel, progress) {
  clipTo(panel, () => {
    push();
    noStroke();
    fill(3, 4, 4, 245);
    rect(panel.x, panel.y, panel.w, panel.h);
    const wind = sin(millis() * .0014) * panel.w * .045;
    const reveal = constrain(progress * 1.7, 0, 1);
    for (const pointData of cloudPoints) {
      if (pointData.dropout > reveal) continue;
      const baseY = panel.y + panel.h * (.95 - pointData.depth * .1);
      const bladeHeight = pointData.height * panel.h * (.46 + pointData.depth * .54);
      const curve = pointData.y;
      const sway = sin(millis() * .0019 + pointData.phase) * panel.w * .035 + wind;
      const x = panel.x + pointData.x * panel.w + (pointData.lean * panel.w + sway) * curve * curve;
      const y = baseY - bladeHeight * curve;
      const jitter = (noise(pointData.x * 80, pointData.y * 30, millis() * .00025) - .5) * 5;
      fill(184, 214, 180, 40 + pointData.depth * 180);
      circle(x + jitter, y, .7 + pointData.depth * 1.6);
    }
    fill(244, 243, 239, 130);
    textSize(8);
    textAlign(LEFT, TOP);
    text('POINT CAPTURE / MOVEMENT EXCEEDS RECONSTRUCTION', panel.x + 10, panel.y + 10);
    pop();
  });
}

function drawClassificationScene(rects, progress) {
  const source = aerialImages.at(-1);
  const crop = drawAerialPan(rects.map, palettes.visible, .02, source);
  drawDriftingPixels(rects.map, 'aerial-2022', source, constrain(.04 + movementEnergy * .35, 0, .45), crop);
  const panels = [rects.drawing, rects.map];
  for (const panel of panels) {
    push();
    stroke(221, 255, 48, 55 + progress * 115);
    strokeWeight(1);
    noFill();
    const columns = 6;
    const rows = 12;
    for (let x = 1; x < columns; x += 1) line(panel.x + panel.w * x / columns, panel.y, panel.x + panel.w * x / columns, panel.y + panel.h);
    for (let y = 1; y < rows; y += 1) line(panel.x, panel.y + panel.h * y / rows, panel.x + panel.w, panel.y + panel.h * y / rows);
    noStroke();
    for (let x = 0; x < columns; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const score = noise(x * .63 + 4, y * .44 + 20);
        fill(221, 255, 48, score * progress * 46);
        rect(panel.x + x * panel.w / columns, panel.y + y * panel.h / rows, panel.w / columns, panel.h / rows);
      }
    }
    pop();
  }
}

function drawFilmScene(rects, scene, progress) {
  if (scene.id === 'ground') drawFieldScene(rects.map, progress, texasBluegrassImage, 'bluegrass', 'TEXAS BLUEGRASS / SPATIAL POINT FIELD');
  if (scene.id === 'wildflowers') drawFieldScene(rects.map, progress, wildflowerImage, 'wildflowers', 'WILDFLOWER FIELD / SPATIAL POINT FIELD');
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
  if (scene.id === 'capture') drawPointCloudScene(rects.map, progress);
  if (scene.id === 'classification') drawClassificationScene(rects, progress);
  if (scene.id === 'commitment') {
    const source = aerialImages.at(-1);
    const crop = drawAerialPan(rects.map, palettes.visible, .02, source);
    drawDriftingPixels(rects.map, 'aerial-2022', source, constrain(.04 + movementEnergy * .3, 0, .4), crop);
    drawCommitmentLayer(rects, constrain(progress * 1.35, 0, 1), palettes.visible);
  }
  if (scene.id === 'loss') {
    const crop = drawAerialPan(rects.map, palettes.ndvi, .03 + progress * .32, ndviAerial);
    drawDriftingPixels(rects.map, 'ndvi-2022', ndviAerial, constrain(.18 + progress * .7 + movementEnergy * .25, 0, 1), crop);
  }
}

function applyTransmissionGlitch(rects, intensity) {
  if (intensity < .025) return;
  const left = rects.drawing.x;
  const right = rects.map.x + rects.map.w;
  const top = min(rects.drawing.y, rects.map.y);
  const totalWidth = right - left;
  const totalHeight = max(rects.drawing.h, rects.map.h);
  push();
  const slices = floor(2 + intensity * 22);
  for (let i = 0; i < slices; i += 1) {
    const sy = top + random(totalHeight);
    const sh = random(2, 7 + intensity * 42);
    const shift = random(-1, 1) * intensity * totalWidth * .12;
    copy(left, sy, totalWidth, sh, left + shift, sy, totalWidth, sh);
  }
  noStroke();
  const blocks = floor(intensity * 18);
  for (let i = 0; i < blocks; i += 1) {
    const size = random(7, 22 + proximity * 75);
    fill(random() > .5 ? 4 : 235, random() > .5 ? 5 : 233, random() > .5 ? 5 : 226, 35 + intensity * 105);
    rect(left + random(totalWidth), top + random(totalHeight), size, size * random(.4, 1.8));
  }
  pop();
}

function drawCommitmentLayer(rects, amount, palette) {
  if (amount < .03) return;
  const d = rects.drawing;
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

function drawMetadata(rect, palette, scene, progress) {
  const [r, g, b] = palette.signal;
  push();
  fill(244, 243, 239, 150);
  noStroke();
  textSize(8);
  textAlign(LEFT, BOTTOM);
  const sceneNumber = String(currentSceneIndex + 1).padStart(2, '0');
  text(`SCENE ${sceneNumber}/${String(scenes.length).padStart(2, '0')}  ·  ${spectrum.toUpperCase()}`, rect.x, rect.y - 9);
  textAlign(RIGHT, BOTTOM);
  fill(r, g, b, 210);
  text(`MOTION ${nf(movementEnergy, 1, 2)}  ·  PROXIMITY ${nf(proximity, 1, 2)}  ·  ${floor(progress * 100)}%`, rect.x + rect.w, rect.y - 9);
  pop();
}

function buildTimeline() {
  filmTimeline.replaceChildren();
  scenes.forEach((scene, index) => {
    const segment = document.createElement('span');
    segment.title = `${String(index + 1).padStart(2, '0')} ${scene.name}`;
    segment.setAttribute('aria-label', segment.title);
    filmTimeline.appendChild(segment);
  });
}

function setScene(index) {
  currentSceneIndex = (index + scenes.length) % scenes.length;
  sceneElapsed = 0;
  const scene = scenes[currentSceneIndex];
  stateIndex.textContent = String(currentSceneIndex + 1).padStart(2, '0');
  stateName.textContent = scene.name;
  stateDetail.textContent = scene.detail;
  updateTimeline(0);
}

function updateTimeline(progress) {
  [...filmTimeline.children].forEach((segment, index) => {
    segment.classList.toggle('is-active', index === currentSceneIndex);
    segment.style.setProperty('--progress', index < currentSceneIndex ? '100%' : index === currentSceneIndex ? `${progress * 100}%` : '0%');
  });
}

function updateFilm() {
  const scene = scenes[currentSceneIndex];
  if (filmPlaying) sceneElapsed += min(deltaTime, 100);
  if (sceneElapsed >= scene.duration) {
    setScene(currentSceneIndex + 1);
    return { scene: scenes[currentSceneIndex], progress: 0 };
  }
  const progress = constrain(sceneElapsed / scene.duration, 0, 1);
  updateTimeline(progress);
  return { scene, progress };
}

function toggleFilm() {
  filmPlaying = !filmPlaying;
  playToggle.textContent = filmPlaying ? 'Pause film' : 'Play film';
  playToggle.setAttribute('aria-pressed', String(filmPlaying));
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
  if (proximity > commitment) commitment = lerp(commitment, proximity, .12);
  else commitment = max(0, commitment - .00013 * deltaTime);
  movementEnergy = max(movementImpulse, movementEnergy * Math.pow(.91, deltaTime / 16.67));
  movementImpulse *= Math.pow(.72, deltaTime / 16.67);
}

window.preload = function preload() {
  texasBluegrassImage = loadImage('assets/projection/texas-bluegrass.png');
  wildflowerImage = loadImage('assets/projection/texas-wildflower-field.png');
  aerialImages = historicalYears.map((year) => loadImage(`assets/projection/fort-spunky-naip-${year}.jpg`));
  falseColorAerial = loadImage('assets/projection/fort-spunky-naip-2022-cir.jpg');
  ndviAerial = loadImage('assets/projection/fort-spunky-naip-2022-ndvi.png');
};

window.setup = function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent(mount);
  pixelDensity(min(2, window.devicePixelRatio || 1));
  noiseSeed(9173);
  randomSeed(9173);
  buildTerrain();
  buildSceneMaterial();
  buildDriftClouds();
  buildTimeline();
  setScene(0);
  stage.classList.toggle('output-mode', outputMode);
  stage.classList.toggle('preview-mode', !outputMode);
  outputToggle.setAttribute('aria-pressed', String(outputMode));
  outputToggle.textContent = outputMode ? 'Drawing preview' : 'Installation output';
};

window.draw = function draw() {
  clear();
  updateInteraction();
  const { scene, progress } = updateFilm();
  spectrum = activeSpectrum(scene, progress);
  const palette = palettes[spectrum];
  const rects = fieldRects();
  drawFilmScene(rects, scene, progress);
  const cutIn = constrain(1 - progress / .075, 0, 1);
  const cutOut = constrain((progress - .91) / .09, 0, 1);
  const transitionGlitch = max(cutIn, cutOut) * .62;
  const movementGlitch = movementEnergy * (.35 + proximity * .65);
  const terminalLoss = scene.id === 'loss' ? progress * .24 : 0;
  applyTransmissionGlitch(rects, constrain(transitionGlitch + movementGlitch + terminalLoss, 0, 1));
  drawMetadata(rects.map, palette, scene, progress);
};

window.windowResized = function windowResized() { resizeCanvas(windowWidth, windowHeight); };
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

previousSceneButton.addEventListener('click', () => setScene(currentSceneIndex - 1));
playToggle.addEventListener('click', toggleFilm);
nextSceneButton.addEventListener('click', () => setScene(currentSceneIndex + 1));
cameraToggle.addEventListener('click', () => cameraActive ? stopCamera() : startCamera());
outputToggle.addEventListener('click', () => {
  outputMode = !outputMode;
  stage.classList.toggle('output-mode', outputMode);
  stage.classList.toggle('preview-mode', !outputMode);
  outputToggle.setAttribute('aria-pressed', String(outputMode));
  outputToggle.textContent = outputMode ? 'Drawing preview' : 'Installation output';
});
document.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    toggleFilm();
  }
  if (event.key === 'ArrowLeft') setScene(currentSceneIndex - 1);
  if (event.key === 'ArrowRight') setScene(currentSceneIndex + 1);
  if (event.key.toLowerCase() === 'p') outputToggle.click();
  if (event.key.toLowerCase() === 'h') stage.classList.toggle('controls-hidden');
  if (event.key.toLowerCase() === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});
