/*
 * THE FORECAST HAS ENTERED THE GROUND
 * Two palette-preserving automata contest a shared satellite raster.
 *
 * All on-site tuning lives in this single object.
 */
const CFG = {
  projector: {
    nativeWidth: 1920,
    nativeHeight: 1080,
    rotateAtBlit: true,
    rotationDirection: 1 // One-line flip: +1 = +HALF_PI, -1 = -HALF_PI.
  },

  grid: { width: 108, height: 216 },
  substratePath: 'assets/projection/fort-spunky-naip-2022.jpg',
  useSubstrate: true,
  placeholderSeed: 41731,

  simulation: {
    hz: 30,
    maxCatchUpSteps: 5,
    smearStrength: 0.72, // Probability of an exact palette-preserving overwrite.
    healRate: 0.0018, // About 90% recovery in 43 seconds while hands remain visible.
    absenceHealMultiplier: 2.4 // About 90% recovery in 18 seconds without hands.
  },

  rendering: {
    highResolutionUnderlay: true,
    displacementThreshold: 1.5, // RGB difference before a coarse displaced cell appears.
    displacementFullOpacityAt: 18
  },

  pan: {
    enabled: true,
    zoom: 1.06, // Small overscan keeps the portrait panel filled throughout the drift.
    cycleSeconds: 300, // One complete top -> bottom -> top traversal.
    presenceSpeedMultiplier: 0.06, // Nearly pause while a viewer is interacting.
    responseSeconds: 1.8
  },

  glitch: {
    enabled: true,
    refreshHz: 8,
    baseTileCount: 3,
    movementTileCount: 18,
    lineThickness: 1,
    lineMinLength: 4,
    lineMaxLength: 10,
    maxOffsetCells: 4,
    opacity: 190,
    motionDecayPerSecond: 0.18
  },

  flow: {
    terrainNoiseBlend: 0.30, // 0 = contour tangent, 1 = curl-noise only.
    noiseScale: 0.052,
    noiseTimeScale: 0.026,
    steerRate: 0.19,
    stepSize: 0.14,
    colorRefreshRate: 0.012,
    clusterSize: 18,
    spawnRadius: 1.35,
    lifespanSeconds: 58,
    maxAgents: 300,
    markerSize: 0.52,
    markerColor: [239, 236, 214, 150]
  },

  interaction: {
    mouseDwellVelocityThreshold: 0.18, // Grid cells per rendered frame.
    handDwellVelocityThreshold: 0.016, // Normalized distance per detection.
    dwellFrames: 12,
    spawnCooldownMs: 820
  },

  physarum: {
    sensorAngle: Math.PI / 4,
    sensorDistance: 3.6,
    turnAngle: Math.PI / 7,
    substrateLuminosityWeight: 0.08,
    stepSize: 0.15,
    colorRefreshRate: 0.009,
    clusterSize: 24,
    spawnRadius: 0.8,
    lifespanSeconds: 68,
    maxAgents: 320,
    geometricSteer: 0.72,
    radialSpokes: 12,
    headingDivisions: 8,
    ringProbability: 0.68,
    ringRadiusMin: 7,
    ringRadiusMax: 24,
    ringCorrection: 0.18,
    trailDeposit: 0.34,
    trailDiffusion: 0.16,
    trailDecay: 0.994,
    markerSize: 0.56,
    markerColor: [177, 201, 174, 145]
  },
  directCoupling: true,
  coupling: {
    veinChannelStrength: 0.48,
    flowErosionStrength: 0.15,
    minimumVeinDensity: 0.04
  },
  hands: {
    detectionFps: 15,
    cameraWidth: 960,
    cameraHeight: 720,
    modelComplexity: 1,
    minDetectionConfidence: 0.45,
    minTrackingConfidence: 0.45,
    interpolation: 0.34,
    // MediaPipe already runs in selfie mode. Leave X unmirrored so camera
    // rightward motion becomes downward motion after the +90° projector blit.
    mirrorX: false,
    swapAxes: false,
    flipMappedX: false,
    flipMappedY: false,
    swapHandedness: false,
    showCalibrationDots: true,
    ghostIndicators: true
  },

  hud: false,
  showMarkers: false // Hide live-agent dots; displaced satellite pixels remain visible.
};

let original;
let field;
let luminance;
let terrainFlowX;
let terrainFlowY;
let fieldImage;
let substrateImage;
let substrateCrop;
let flowAgents = [];
let physarumAgents = [];
let physarumTrail;
let trailScratch;
let flowDensity;
let simulationTime = 0;
let accumulator = 0;
let lastClock = 0;
let simulationPaused = false;

const mouseDwells = {
  flow: makeDwellState('flow'),
  physarum: makeDwellState('physarum')
};

const handStates = {
  Left: makeHandState('Left', 'flow'),
  Right: makeHandState('Right', 'physarum')
};

let handsModel;
let webcamVideo;
let cameraStream;
let detectionTimer;
let detectionLoopToken = 0;
let detectionBusy = false;
let cameraActive = false;
let cameraStatus = 'camera off';
let inferenceCount = 0;
let resultCount = 0;
let glitchTiles = [];
let nextGlitchAt = 0;
let glitchMotion = 0;
let panPhase = 0;
let panPosition = 0;
let panSpeedScale = 1;

function makeDwellState(type) {
  return { type, active: false, previous: null, frames: 0, lastSpawnAt: -Infinity, mapped: null };
}

function makeHandState(label, type) {
  return {
    label,
    type,
    detected: false, // True only when the latest inference contains this hand.
    hasPosition: false, // Last known cursor persists until tracking is stopped.
    target: null,
    display: null,
    previousDetection: null,
    dwellFrames: 0,
    lastSpawnAt: -Infinity
  };
}

function preload() {
  substrateImage = loadImage(
    CFG.substratePath,
    () => {},
    () => { substrateImage = null; }
  );
}

function setup() {
  const canvas = createCanvas(CFG.projector.nativeWidth, CFG.projector.nativeHeight);
  canvas.parent('installation');
  pixelDensity(1);
  noSmooth();
  drawingContext.imageSmoothingEnabled = false;
  frameRate(60);
  initializeSubstrate();
  document.getElementById('cameraToggle')?.addEventListener('click', toggleCamera);
  lastClock = performance.now();

  // URL-only local QA hook; never runs in the default installation.
  if (new URLSearchParams(location.search).get('autotest') === '1') {
    spawnFlowCluster(CFG.grid.width * .42, CFG.grid.height * .36);
    spawnFlowCluster(CFG.grid.width * .58, CFG.grid.height * .48);
    spawnFlowCluster(CFG.grid.width * .46, CFG.grid.height * .61);
    spawnFlowCluster(CFG.grid.width * .55, CFG.grid.height * .72);
    spawnPhysarumCluster(CFG.grid.width * .48, CFG.grid.height * .42);
    spawnPhysarumCluster(CFG.grid.width * .54, CFG.grid.height * .58);
  }
}

function initializeSubstrate() {
  noiseSeed(CFG.placeholderSeed);
  randomSeed(CFG.placeholderSeed);

  const cellCount = CFG.grid.width * CFG.grid.height;
  original = new Uint8ClampedArray(cellCount * 4);
  field = new Float32Array(cellCount * 4);
  luminance = new Float32Array(cellCount);
  terrainFlowX = new Float32Array(cellCount);
  terrainFlowY = new Float32Array(cellCount);
  physarumTrail = new Float32Array(cellCount);
  trailScratch = new Float32Array(cellCount);
  flowDensity = new Float32Array(cellCount);
  fieldImage = createImage(CFG.grid.width, CFG.grid.height);
  fieldImage.pixelDensity(1);

  if (CFG.useSubstrate && substrateImage?.width) sampleImageSubstrate();
  else generatePlaceholderTerrain();

  field.set(original);
  computeTerrainFlow();
  flowAgents = [];
  physarumAgents = [];
  glitchTiles = [];
  nextGlitchAt = 0;
  glitchMotion = 0;
  panPhase = 0;
  panPosition = 0;
  panSpeedScale = 1;
  simulationTime = 0;
  accumulator = 0;
}

function sampleImageSubstrate() {
  substrateImage.loadPixels();
  const sourceDensity = substrateImage.pixelDensity?.() || 1;
  const sourceAspect = substrateImage.width / substrateImage.height;
  const targetAspect = CFG.grid.width / CFG.grid.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceW = substrateImage.width;
  let sourceH = substrateImage.height;

  if (sourceAspect > targetAspect) {
    sourceW = sourceH * targetAspect;
    sourceX = (substrateImage.width - sourceW) / 2;
  } else {
    sourceH = sourceW / targetAspect;
    sourceY = (substrateImage.height - sourceH) / 2;
  }
  substrateCrop = { x: sourceX, y: sourceY, width: sourceW, height: sourceH };

  for (let y = 0; y < CFG.grid.height; y += 1) {
    for (let x = 0; x < CFG.grid.width; x += 1) {
      const sx = constrain(floor(sourceX + (x + .5) / CFG.grid.width * sourceW), 0, substrateImage.width - 1);
      const sy = constrain(floor(sourceY + (y + .5) / CFG.grid.height * sourceH), 0, substrateImage.height - 1);
      const sourceOffset = 4 * ((sy * sourceDensity) * (substrateImage.width * sourceDensity) + sx * sourceDensity);
      writeOriginal(x, y, [
        substrateImage.pixels[sourceOffset],
        substrateImage.pixels[sourceOffset + 1],
        substrateImage.pixels[sourceOffset + 2]
      ]);
    }
  }
}

// Generated fake satellite: macro land cover, a dark meandering watercourse,
// pale disturbed ground, and fine parcel variation. It is deliberately quiet.
function generatePlaceholderTerrain() {
  const w = CFG.grid.width;
  const h = CFG.grid.height;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const nx = x / w;
      const ny = y / h;
      const macro = noise(x * .026, y * .026);
      const detail = noise(x * .105 + 40, y * .105 + 80);
      const parcel = noise(floor(x / 9) * .31 + 120, floor(y / 13) * .31 + 50);
      const riverCenter = .49 + sin(ny * 12.5) * .15 + (noise(ny * 2.8 + 220) - .5) * .17;
      const riverWidth = .037 + noise(ny * 4 + 11) * .025;
      const riverDistance = abs(nx - riverCenter);

      let color;
      if (riverDistance < riverWidth) {
        const edge = riverDistance / riverWidth;
        color = [24 + edge * 15, 35 + edge * 20, 39 + edge * 18];
      } else if (macro > .67) {
        color = [104 + detail * 34, 102 + detail * 31, 77 + detail * 24];
      } else if (parcel > .62 && detail > .48) {
        color = [126 + detail * 25, 122 + detail * 23, 96 + detail * 20];
      } else {
        color = [48 + macro * 46 + detail * 13, 61 + macro * 52 + detail * 18, 45 + macro * 33 + detail * 12];
      }

      // A few restrained linear clearings make the contour response legible.
      const diagonal = abs(y - (h * .73 - x * .42));
      const vertical = abs(x - w * .76);
      if (diagonal < 1.1 || (vertical < .75 && y > h * .18 && y < h * .72)) {
        color = color.map((channel, index) => channel * .58 + [154, 145, 116][index] * .42);
      }
      writeOriginal(x, y, color);
    }
  }
}

function writeOriginal(x, y, color) {
  const offset = cellOffset(x, y);
  original[offset] = constrain(round(color[0]), 0, 255);
  original[offset + 1] = constrain(round(color[1]), 0, 255);
  original[offset + 2] = constrain(round(color[2]), 0, 255);
  original[offset + 3] = 255;
}

// The terrain vector is tangent to the original image's luminosity gradient:
// agents stream along light/dark seams instead of climbing across them.
function computeTerrainFlow() {
  const w = CFG.grid.width;
  const h = CFG.grid.height;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const offset = cellOffset(x, y);
      luminance[y * w + x] = original[offset] * .2126 + original[offset + 1] * .7152 + original[offset + 2] * .0722;
    }
  }

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const left = luminance[y * w + max(0, x - 1)];
      const right = luminance[y * w + min(w - 1, x + 1)];
      const up = luminance[max(0, y - 1) * w + x];
      const down = luminance[min(h - 1, y + 1) * w + x];
      const gx = right - left;
      const gy = down - up;
      const magnitude = max(.0001, sqrt(gx * gx + gy * gy));
      const index = y * w + x;
      terrainFlowX[index] = -gy / magnitude;
      terrainFlowY[index] = gx / magnitude;
    }
  }
}

function draw() {
  const now = performance.now();
  const elapsed = min(.2, (now - lastClock) / 1000);
  lastClock = now;
  if (!simulationPaused) accumulator += elapsed;

  const fixedStep = 1 / CFG.simulation.hz;
  let steps = 0;
  while (accumulator >= fixedStep && steps < CFG.simulation.maxCatchUpSteps) {
    simulate(fixedStep);
    accumulator -= fixedStep;
    steps += 1;
  }
  if (steps === CFG.simulation.maxCatchUpSteps) accumulator = 0;

  updateMouseDwells(now);
  interpolateHandPositions();
  renderInstallation();
}

function simulate(dt) {
  simulationTime += dt;
  glitchMotion *= pow(CFG.glitch.motionDecayPerSecond, dt);
  updateGlitchTiles();
  const inputPresent = Object.values(mouseDwells).some((state) => state.active)
    || Object.values(handStates).some((state) => state.detected);
  updateSlowPan(dt, inputPresent);
  healField(inputPresent ? 1 : CFG.simulation.absenceHealMultiplier);
  diffuseAndDecayPhysarumTrail();
  flowDensity.fill(0);

  for (let index = flowAgents.length - 1; index >= 0; index -= 1) {
    const agent = flowAgents[index];
    agent.age += dt;
    if (agent.age >= agent.lifespan) {
      flowAgents.splice(index, 1);
      continue;
    }
    advanceFlowAgent(agent);
  }

  for (let index = physarumAgents.length - 1; index >= 0; index -= 1) {
    const agent = physarumAgents[index];
    agent.age += dt;
    if (agent.age >= agent.lifespan) {
      physarumAgents.splice(index, 1);
      continue;
    }
    advancePhysarumAgent(agent);
  }

  if (CFG.directCoupling) erodeVeinsWithFlow();
}

// The satellite behaves like a nearly imperceptible scanning shot. Presence
// eases the movement almost to a stop so the ground remains stable beneath a
// viewer's hand; absence lets the five-minute traversal continue.
function updateSlowPan(dt, inputPresent) {
  if (!CFG.pan.enabled) return;
  const targetSpeed = inputPresent ? CFG.pan.presenceSpeedMultiplier : 1;
  const easing = 1 - Math.exp(-dt / CFG.pan.responseSeconds);
  panSpeedScale += (targetSpeed - panSpeedScale) * easing;
  panPhase = (panPhase + dt * panSpeedScale * TWO_PI / CFG.pan.cycleSeconds) % TWO_PI;
  panPosition = sin(panPhase);
}

// PALETTE-PRESERVING GLITCH OVERLAY
// Sparse vertical strips sample contiguous pixels already in the shared
// satellite field and relocate them by only a few cells. The layer flickers
// independently of the smear/heal buffer, so it never damages the substrate.
function updateGlitchTiles() {
  if (!CFG.glitch.enabled || simulationTime < nextGlitchAt) return;
  nextGlitchAt = simulationTime + 1 / CFG.glitch.refreshHz;
  glitchTiles = [];
  const count = round(CFG.glitch.baseTileCount + glitchMotion * CFG.glitch.movementTileCount);

  for (let index = 0; index < count; index += 1) {
    const length = floor(random(CFG.glitch.lineMinLength, CFG.glitch.lineMaxLength + 1));
    const sourceX = floor(random(CFG.grid.width));
    const sourceY = floor(random(CFG.grid.height - length + 1));
    const colors = [];
    for (let cell = 0; cell < length; cell += 1) {
      const sourceOffset = cellOffset(sourceX, sourceY + cell);
      colors.push([field[sourceOffset], field[sourceOffset + 1], field[sourceOffset + 2]]);
    }
    glitchTiles.push({
      x: constrain(sourceX + floor(random(-CFG.glitch.maxOffsetCells, CFG.glitch.maxOffsetCells + 1)), 0, CFG.grid.width - CFG.glitch.lineThickness),
      y: constrain(sourceY + floor(random(-CFG.glitch.maxOffsetCells, CFG.glitch.maxOffsetCells + 1)), 0, CFG.grid.height - length),
      width: CFG.glitch.lineThickness,
      height: length,
      colors
    });
  }
}

// Sparse global decay: the working field tends toward the untouched original.
// The multiplier increases when no surrogate hand is present, leaving only a
// faint long-decay memory after several minutes.
function healField(multiplier) {
  const rate = min(.25, CFG.simulation.healRate * multiplier);
  for (let index = 0; index < field.length; index += 4) {
    field[index] += (original[index] - field[index]) * rate;
    field[index + 1] += (original[index + 1] - field[index + 1]) * rate;
    field[index + 2] += (original[index + 2] - field[index + 2]) * rate;
    field[index + 3] = 255;
  }
}

// FLOW-FIELD ADVECTION
// 1. Read the precomputed contour tangent from the satellite luminosity.
// 2. Blend it with the tangent of animated Perlin noise (a curl-like drift).
// 3. Advance continuously, then overwrite only the occupied destination cell
//    with the agent's carried satellite color. No new hue is created.
function advanceFlowAgent(agent) {
  const w = CFG.grid.width;
  const h = CFG.grid.height;
  const cellX = constrain(floor(agent.x), 0, w - 1);
  const cellY = constrain(floor(agent.y), 0, h - 1);
  const index = cellY * w + cellX;
  let terrainX = terrainFlowX[index];
  let terrainY = terrainFlowY[index];

  // A contour has two valid directions; retain the direction closest to the
  // particle's current heading so it streams instead of reversing randomly.
  if (terrainX * cos(agent.heading) + terrainY * sin(agent.heading) < 0) {
    terrainX *= -1;
    terrainY *= -1;
  }

  const curl = sampleCurl(agent.x, agent.y, simulationTime);
  const blend = CFG.flow.terrainNoiseBlend;
  let desiredX = terrainX * (1 - blend) + curl.x * blend;
  let desiredY = terrainY * (1 - blend) + curl.y * blend;

  // DIRECT COUPLING: dense Physarum trail steers flow parallel to the local
  // vein, so infrastructure channels the weather without becoming visible.
  if (CFG.directCoupling && physarumTrail[index] > CFG.coupling.minimumVeinDensity) {
    const vein = localVeinDirection(cellX, cellY, agent.heading);
    const influence = constrain(physarumTrail[index], 0, 1) * CFG.coupling.veinChannelStrength;
    desiredX += vein.x * influence;
    desiredY += vein.y * influence;
  }
  const desiredHeading = atan2(desiredY, desiredX);
  agent.heading += angleDifference(agent.heading, desiredHeading) * CFG.flow.steerRate;

  agent.x += cos(agent.heading) * CFG.flow.stepSize;
  agent.y += sin(agent.heading) * CFG.flow.stepSize;
  containAgent(agent);

  const destination = cellOffset(floor(agent.x), floor(agent.y));
  flowDensity[floor(agent.y) * w + floor(agent.x)] += .18;
  if (random() < CFG.simulation.smearStrength) {
    field[destination] = agent.carried[0];
    field[destination + 1] = agent.carried[1];
    field[destination + 2] = agent.carried[2];
    field[destination + 3] = 255;
  }

  if (random() < CFG.flow.colorRefreshRate) {
    agent.carried[0] = field[destination];
    agent.carried[1] = field[destination + 1];
    agent.carried[2] = field[destination + 2];
  }
}

function sampleCurl(x, y, time) {
  const scale = CFG.flow.noiseScale;
  const t = time * CFG.flow.noiseTimeScale;
  const epsilon = .72;
  const noiseLeft = noise((x - epsilon) * scale, y * scale, t);
  const noiseRight = noise((x + epsilon) * scale, y * scale, t);
  const noiseUp = noise(x * scale, (y - epsilon) * scale, t);
  const noiseDown = noise(x * scale, (y + epsilon) * scale, t);
  let vx = noiseDown - noiseUp;
  let vy = -(noiseRight - noiseLeft);
  const magnitude = max(.0001, sqrt(vx * vx + vy * vy));
  vx /= magnitude;
  vy /= magnitude;
  return { x: vx, y: vy };
}

function localVeinDirection(x, y, heading) {
  const w = CFG.grid.width;
  const h = CFG.grid.height;
  const left = physarumTrail[y * w + max(0, x - 1)];
  const right = physarumTrail[y * w + min(w - 1, x + 1)];
  const up = physarumTrail[max(0, y - 1) * w + x];
  const down = physarumTrail[min(h - 1, y + 1) * w + x];
  let vx = -(down - up);
  let vy = right - left;
  const magnitude = max(.0001, sqrt(vx * vx + vy * vy));
  vx /= magnitude;
  vy /= magnitude;
  if (vx * cos(heading) + vy * sin(heading) < 0) {
    vx *= -1;
    vy *= -1;
  }
  return { x: vx, y: vy };
}

// INFRASTRUCTURE / PHYSARUM SENSE -> CONSTRUCT -> SMEAR
// Three forward sensors read only the faint internal trail (plus an optional
// original-substrate luminance bias). That organic heading is then pulled
// toward a hub-and-spoke construction: agents radiate from the hand pause and
// some turn onto faceted orbital connectors. Movement deposits internal trail,
// but the visible mark remains displaced satellite color in the shared field.
function advancePhysarumAgent(agent) {
  const left = sensePhysarum(agent, -CFG.physarum.sensorAngle);
  const center = sensePhysarum(agent, 0);
  const right = sensePhysarum(agent, CFG.physarum.sensorAngle);

  if (center < left || center < right) {
    if (left > right) agent.heading -= CFG.physarum.turnAngle;
    else if (right > left) agent.heading += CFG.physarum.turnAngle;
    else agent.heading += random() < .5 ? -CFG.physarum.turnAngle : CFG.physarum.turnAngle;
  }
  const constructedHeading = infrastructureHeading(agent);
  agent.heading += angleDifference(agent.heading, constructedHeading) * CFG.physarum.geometricSteer;
  agent.heading += random(-.006, .006);
  agent.x += cos(agent.heading) * CFG.physarum.stepSize;
  agent.y += sin(agent.heading) * CFG.physarum.stepSize;
  containAgent(agent);

  const x = floor(agent.x);
  const y = floor(agent.y);
  const cellIndex = y * CFG.grid.width + x;
  const destination = 4 * cellIndex;
  physarumTrail[cellIndex] = min(1.5, physarumTrail[cellIndex] + CFG.physarum.trailDeposit);

  if (random() < CFG.simulation.smearStrength) {
    field[destination] = agent.carried[0];
    field[destination + 1] = agent.carried[1];
    field[destination + 2] = agent.carried[2];
    field[destination + 3] = 255;
  }

  if (random() < CFG.physarum.colorRefreshRate) {
    agent.carried[0] = field[destination];
    agent.carried[1] = field[destination + 1];
    agent.carried[2] = field[destination + 2];
  }
}

function infrastructureHeading(agent) {
  const dx = agent.x - agent.hubX;
  const dy = agent.y - agent.hubY;
  const distance = max(.0001, sqrt(dx * dx + dy * dy));

  if (agent.mode === 'spoke' && agent.becomesRing && distance >= agent.ringRadius) {
    agent.mode = 'ring';
  }
  if (agent.mode === 'spoke') return agent.axisAngle;

  // Ring agents follow a tangent while correcting toward their assigned
  // radius. Quantizing that tangent makes polygonal service loops rather than
  // organic circles, producing a legible infrastructural geometry.
  const ux = dx / distance;
  const uy = dy / distance;
  const correction = constrain(
    (agent.ringRadius - distance) * CFG.physarum.ringCorrection,
    -.8,
    .8
  );
  const vx = -uy * agent.ringDirection + ux * correction;
  const vy = ux * agent.ringDirection + uy * correction;
  const tangent = atan2(vy, vx);
  const increment = TWO_PI / CFG.physarum.headingDivisions;
  return round(tangent / increment) * increment;
}

function sensePhysarum(agent, sensorOffset) {
  const angle = agent.heading + sensorOffset;
  const x = constrain(floor(agent.x + cos(angle) * CFG.physarum.sensorDistance), 0, CFG.grid.width - 1);
  const y = constrain(floor(agent.y + sin(angle) * CFG.physarum.sensorDistance), 0, CFG.grid.height - 1);
  const index = y * CFG.grid.width + x;
  return physarumTrail[index] + luminance[index] / 255 * CFG.physarum.substrateLuminosityWeight;
}

function diffuseAndDecayPhysarumTrail() {
  const w = CFG.grid.width;
  const h = CFG.grid.height;
  const diffusion = CFG.physarum.trailDiffusion;
  const decay = CFG.physarum.trailDecay;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = y * w + x;
      const center = physarumTrail[index];
      const left = physarumTrail[y * w + max(0, x - 1)];
      const right = physarumTrail[y * w + min(w - 1, x + 1)];
      const up = physarumTrail[max(0, y - 1) * w + x];
      const down = physarumTrail[min(h - 1, y + 1) * w + x];
      const neighborhood = (center * 4 + left + right + up + down) / 8;
      trailScratch[index] = (center + (neighborhood - center) * diffusion) * decay;
    }
  }
  const swap = physarumTrail;
  physarumTrail = trailScratch;
  trailScratch = swap;
}

// DIRECT COUPLING: current flow occupancy locally accelerates trail decay,
// allowing weather to wear down the otherwise self-reinforcing vein network.
function erodeVeinsWithFlow() {
  for (let index = 0; index < physarumTrail.length; index += 1) {
    if (flowDensity[index] <= 0) continue;
    const erosion = min(.82, flowDensity[index] * CFG.coupling.flowErosionStrength);
    physarumTrail[index] *= 1 - erosion;
  }
}

function containAgent(agent) {
  const w = CFG.grid.width;
  const h = CFG.grid.height;
  if (agent.x < 0 || agent.x >= w) {
    agent.x = constrain(agent.x, 0, w - .001);
    agent.heading = PI - agent.heading;
  }
  if (agent.y < 0 || agent.y >= h) {
    agent.y = constrain(agent.y, 0, h - .001);
    agent.heading = -agent.heading;
  }
}

function angleDifference(from, to) {
  return atan2(sin(to - from), cos(to - from));
}

function spawnFlowCluster(x, y) {
  const available = max(0, CFG.flow.maxAgents - flowAgents.length);
  const count = min(CFG.flow.clusterSize, available);
  for (let index = 0; index < count; index += 1) {
    const angle = random(TWO_PI);
    const radius = sqrt(random()) * CFG.flow.spawnRadius;
    const px = constrain(x + cos(angle) * radius, 0, CFG.grid.width - .001);
    const py = constrain(y + sin(angle) * radius, 0, CFG.grid.height - .001);
    const offset = cellOffset(floor(px), floor(py));
    flowAgents.push({
      x: px,
      y: py,
      heading: random(TWO_PI),
      carried: [field[offset], field[offset + 1], field[offset + 2]],
      age: 0,
      lifespan: CFG.flow.lifespanSeconds * random(.82, 1.18)
    });
  }
}

function spawnPhysarumCluster(x, y) {
  const available = max(0, CFG.physarum.maxAgents - physarumAgents.length);
  const count = min(CFG.physarum.clusterSize, available);
  const hubRotation = random(TWO_PI);
  for (let index = 0; index < count; index += 1) {
    const angle = random(TWO_PI);
    const radius = sqrt(random()) * CFG.physarum.spawnRadius;
    const px = constrain(x + cos(angle) * radius, 0, CFG.grid.width - .001);
    const py = constrain(y + sin(angle) * radius, 0, CFG.grid.height - .001);
    const offset = cellOffset(floor(px), floor(py));
    const spoke = index % CFG.physarum.radialSpokes;
    const axisAngle = hubRotation + spoke / CFG.physarum.radialSpokes * TWO_PI;
    physarumAgents.push({
      x: px,
      y: py,
      hubX: x,
      hubY: y,
      heading: axisAngle,
      axisAngle,
      mode: 'spoke',
      becomesRing: random() < CFG.physarum.ringProbability,
      ringRadius: random(CFG.physarum.ringRadiusMin, CFG.physarum.ringRadiusMax),
      ringDirection: index % 2 === 0 ? 1 : -1,
      carried: [field[offset], field[offset + 1], field[offset + 2]],
      age: 0,
      lifespan: CFG.physarum.lifespanSeconds * random(.82, 1.18)
    });
  }
}

function cellOffset(x, y) {
  const safeX = constrain(x, 0, CFG.grid.width - 1);
  const safeY = constrain(y, 0, CFG.grid.height - 1);
  return 4 * (safeY * CFG.grid.width + safeX);
}

function renderInstallation() {
  background(0);
  updateFieldImage();
  const panel = presentationRect();
  drawingContext.imageSmoothingEnabled = false;

  push();
  translate(width / 2, height / 2);
  if (CFG.projector.rotateAtBlit) rotate(CFG.projector.rotationDirection * HALF_PI);

  // Clip the zoomed image layers to the exact 1:2 panel. All land-bound
  // layers receive the same transform; hand indicators and HUD do not.
  const pan = slowPanTransform(panel);
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(-panel.portraitWidth / 2, -panel.portraitHeight / 2, panel.portraitWidth, panel.portraitHeight);
  drawingContext.clip();
  push();
  translate(0, pan.offsetY);
  scale(pan.zoom);
  if (CFG.useSubstrate && CFG.rendering.highResolutionUnderlay && substrateImage?.width && substrateCrop) {
    // Keep the untouched NAIP raster at source resolution. The coarse field
    // drawn next contains alpha only where an agent has displaced a cell.
    image(
      substrateImage,
      -panel.portraitWidth / 2, -panel.portraitHeight / 2,
      panel.portraitWidth, panel.portraitHeight,
      substrateCrop.x, substrateCrop.y, substrateCrop.width, substrateCrop.height
    );
  }
  image(fieldImage, -panel.portraitWidth / 2, -panel.portraitHeight / 2, panel.portraitWidth, panel.portraitHeight);
  drawGlitchOverlay(panel);
  if (CFG.showMarkers) drawAgentMarkers(panel);
  pop();
  drawingContext.restore();

  if (CFG.hands.showCalibrationDots) drawHandCalibration(panel);
  if (CFG.hud) drawHud(panel);
  pop();
}

function slowPanTransform(panel) {
  const zoom = CFG.pan.enabled ? max(1, CFG.pan.zoom) : 1;
  const travelY = panel.portraitHeight * (zoom - 1) / 2;
  return {
    zoom,
    offsetY: CFG.pan.enabled ? panPosition * travelY : 0
  };
}

function drawGlitchOverlay(panel) {
  if (!CFG.glitch.enabled || glitchTiles.length === 0) return;
  const scaleX = panel.portraitWidth / CFG.grid.width;
  const scaleY = panel.portraitHeight / CFG.grid.height;
  noStroke();
  for (const tile of glitchTiles) {
    for (let cell = 0; cell < tile.height; cell += 1) {
      const color = tile.colors[cell];
      fill(color[0], color[1], color[2], CFG.glitch.opacity);
      rect(
        -panel.portraitWidth / 2 + tile.x * scaleX,
        -panel.portraitHeight / 2 + (tile.y + cell) * scaleY,
        tile.width * scaleX,
        scaleY
      );
    }
  }
}

function updateFieldImage() {
  fieldImage.loadPixels();
  const revealUnderlay = CFG.useSubstrate
    && CFG.rendering.highResolutionUnderlay
    && substrateImage?.width;
  for (let index = 0; index < field.length; index += 4) {
    fieldImage.pixels[index] = constrain(round(field[index]), 0, 255);
    fieldImage.pixels[index + 1] = constrain(round(field[index + 1]), 0, 255);
    fieldImage.pixels[index + 2] = constrain(round(field[index + 2]), 0, 255);
    if (revealUnderlay) {
      const difference = max(
        abs(field[index] - original[index]),
        abs(field[index + 1] - original[index + 1]),
        abs(field[index + 2] - original[index + 2])
      );
      fieldImage.pixels[index + 3] = difference <= CFG.rendering.displacementThreshold
        ? 0
        : constrain(map(
          difference,
          CFG.rendering.displacementThreshold,
          CFG.rendering.displacementFullOpacityAt,
          0,
          255
        ), 0, 255);
    } else {
      fieldImage.pixels[index + 3] = 255;
    }
  }
  fieldImage.updatePixels();
}

function presentationRect() {
  const portraitHeight = CFG.projector.rotateAtBlit ? width : height;
  const portraitWidth = portraitHeight / 2;
  return { portraitWidth, portraitHeight };
}

function drawAgentMarkers(panel) {
  const scaleX = panel.portraitWidth / CFG.grid.width;
  const scaleY = panel.portraitHeight / CFG.grid.height;
  noStroke();
  fill(...CFG.flow.markerColor);
  let markerSize = max(1, CFG.flow.markerSize * min(scaleX, scaleY));
  for (const agent of flowAgents) {
    const x = -panel.portraitWidth / 2 + (agent.x + .5) * scaleX;
    const y = -panel.portraitHeight / 2 + (agent.y + .5) * scaleY;
    circle(x, y, markerSize);
  }

  fill(...CFG.physarum.markerColor);
  markerSize = max(1, CFG.physarum.markerSize * min(scaleX, scaleY));
  for (const agent of physarumAgents) {
    const x = -panel.portraitWidth / 2 + (agent.x + .5) * scaleX;
    const y = -panel.portraitHeight / 2 + (agent.y + .5) * scaleY;
    circle(x, y, markerSize);
  }
}

function drawHandCalibration(panel) {
  const scaleX = panel.portraitWidth / CFG.grid.width;
  const scaleY = panel.portraitHeight / CFG.grid.height;
  textFont('monospace');
  textSize(13);
  textAlign(LEFT, CENTER);
  for (const state of Object.values(handStates)) {
    const located = state.hasPosition && state.display;
    if (!located && !CFG.hands.ghostIndicators) continue;
    const fallbackX = state.type === 'flow' ? .13 : .60;
    const x = located
      ? -panel.portraitWidth / 2 + state.display.x * scaleX
      : -panel.portraitWidth / 2 + panel.portraitWidth * fallbackX;
    const y = located
      ? -panel.portraitHeight / 2 + state.display.y * scaleY
      : panel.portraitHeight / 2 - 92;
    const color = state.type === 'flow' ? CFG.flow.markerColor : CFG.physarum.markerColor;
    const alpha = located ? 255 : 68;
    noStroke();
    fill(...color.slice(0, 3), located ? alpha : 22);
    circle(x, y, located ? 11 : 18);
    noFill();
    stroke(...color.slice(0, 3), alpha);
    strokeWeight(located ? 2 : 1);
    circle(x, y, located ? 34 : 18);
    if (located) {
      line(x - 24, y, x - 12, y);
      line(x + 12, y, x + 24, y);
      line(x, y - 24, x, y - 12);
      line(x, y + 12, x, y + 24);
    }
    const labelOnLeft = located && x > panel.portraitWidth / 2 - 225;
    const labelX = labelOnLeft ? x - 216 : x + 22;
    noStroke();
    fill(5, 6, 5, located ? 220 : 72);
    rect(labelX, y - 11, 194, 22);
    fill(...color.slice(0, 3), alpha);
    const systemLabel = state.type === 'physarum' ? 'INFRA' : state.type.toUpperCase();
    const status = located
      ? (state.detected ? `TRACKING ${state.dwellFrames}/${CFG.interaction.dwellFrames}` : 'POSITION HELD')
      : 'PAUSE HERE';
    text(`${state.label.toUpperCase()} · ${systemLabel} · ${status}`, labelX + 6, y);
  }
}

function drawHud(panel) {
  push();
  const left = -panel.portraitWidth / 2 + 14;
  const top = -panel.portraitHeight / 2 + 14;
  const hudWidth = panel.portraitWidth - 28;
  const fontSize = constrain(panel.portraitWidth / 50, 11, 18);
  const leading = fontSize * 1.42;
  noStroke();
  fill(0, 205);
  rect(left - 7, top - 7, hudWidth, leading * 9 + 14);
  fill(239, 236, 225);
  textFont('monospace');
  textSize(fontSize);
  textLeading(leading);
  textAlign(LEFT, TOP);
  const inputPresent = Object.values(mouseDwells).some((state) => state.active)
    || Object.values(handStates).some((state) => state.detected);
  const flowDwell = mouseDwells.flow.active ? mouseDwells.flow.frames : handStates.Left.dwellFrames;
  const veinDwell = mouseDwells.physarum.active ? mouseDwells.physarum.frames : handStates.Right.dwellFrames;
  text([
    'THE FORECAST HAS ENTERED THE GROUND',
    `${CFG.grid.width}×${CFG.grid.height} grid · ${CFG.simulation.hz} Hz fixed step · ${nf(frameRate(), 2, 1)} fps`,
    `flow ${flowAgents.length}/${CFG.flow.maxAgents} · infrastructure ${physarumAgents.length}/${CFG.physarum.maxAgents} · coupling ${CFG.directCoupling ? 'ON' : 'OFF'}`,
    `dwell L/flow ${flowDwell}/${CFG.interaction.dwellFrames} · R/infra ${veinDwell}/${CFG.interaction.dwellFrames} · ${inputPresent ? 'PRESENCE' : 'ABSENCE HEAL'}`,
    `substrate ${CFG.useSubstrate && substrateImage ? 'NAIP 2022' : 'PLACEHOLDER'} · smear ${CFG.simulation.smearStrength.toFixed(2)} · heal ×${inputPresent ? 1 : CFG.simulation.absenceHealMultiplier}`,
    `camera ${cameraStatus} · inference/result ${inferenceCount}/${resultCount} · rotation ${CFG.projector.rotateAtBlit ? (CFG.projector.rotationDirection > 0 ? '+90°' : '-90°') : 'PREVIEW'}`,
    `mapping mx:${Number(CFG.hands.mirrorX)} swap:${Number(CFG.hands.swapAxes)} fx:${Number(CFG.hands.flipMappedX)} fy:${Number(CFG.hands.flipMappedY)} handSwap:${Number(CFG.hands.swapHandedness)}`,
    'L mouse flow · R mouse infrastructure · H HUD · G glitch · D coupling · K calibration · B handedness',
    'S reload satellite · P pan · X rotation · O preview · V camera · R reset · F fullscreen'
  ].join('\n'), left, top);
  pop();
}

// Mouse fallback mirrors the hand-dwell gesture: movement does little, while
// a pause releases the population bound to that anatomical-hand surrogate.
function updateMouseDwells(now) {
  for (const state of Object.values(mouseDwells)) updateMouseDwellState(state, now);
}

function updateMouseDwellState(state, now) {
  if (!state.active) {
    state.frames = 0;
    state.previous = null;
    state.mapped = null;
    return;
  }

  const mapped = canvasToPortraitGrid(mouseX, mouseY);
  state.mapped = mapped;
  if (!mapped) {
    state.frames = 0;
    state.previous = null;
    return;
  }

  const velocity = state.previous ? dist(mapped.x, mapped.y, state.previous.x, state.previous.y) : Infinity;
  if (Number.isFinite(velocity)) {
    glitchMotion = max(glitchMotion, constrain(velocity / 4, 0, 1));
  }
  state.frames = velocity < CFG.interaction.mouseDwellVelocityThreshold ? state.frames + 1 : 0;
  state.previous = mapped;

  if (state.frames >= CFG.interaction.dwellFrames && now - state.lastSpawnAt >= CFG.interaction.spawnCooldownMs) {
    spawnBoundCluster(state.type, mapped.x, mapped.y);
    state.lastSpawnAt = now;
  }
}

async function toggleCamera() {
  if (cameraActive) {
    stopCamera();
    return;
  }
  const button = document.getElementById('cameraToggle');
  try {
    cameraStatus = 'requesting permission';
    if (button) button.textContent = 'Requesting camera…';
    if (!window.Hands) throw new Error('MediaPipe Hands did not load');

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: CFG.hands.cameraWidth },
        height: { ideal: CFG.hands.cameraHeight }
      },
      audio: false
    });
    webcamVideo = document.getElementById('handCamera');
    webcamVideo.srcObject = cameraStream;
    await webcamVideo.play();

    if (!handsModel) {
      handsModel = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
      });
      handsModel.setOptions({
        maxNumHands: 2,
        modelComplexity: CFG.hands.modelComplexity,
        minDetectionConfidence: CFG.hands.minDetectionConfidence,
        minTrackingConfidence: CFG.hands.minTrackingConfidence,
        selfieMode: true
      });
      handsModel.onResults(handleHandResults);
    }

    cameraActive = true;
    cameraStatus = 'active · frames remain local';
    inferenceCount = 0;
    resultCount = 0;
    if (button) button.textContent = 'Stop hand tracking';
    startHandDetectionLoop();
  } catch (error) {
    cameraStatus = 'unavailable · mouse fallback active';
    if (button) button.textContent = 'Start hand tracking';
    console.warn(error);
    stopCameraTracks();
  }
}

function stopCamera() {
  detectionLoopToken += 1;
  clearTimeout(detectionTimer);
  detectionTimer = undefined;
  stopCameraTracks();
  cameraActive = false;
  cameraStatus = 'camera off';
  for (const state of Object.values(handStates)) {
    state.detected = false;
    state.hasPosition = false;
    state.target = null;
    state.display = null;
    state.previousDetection = null;
    state.dwellFrames = 0;
  }
  const button = document.getElementById('cameraToggle');
  if (button) button.textContent = 'Start hand tracking';
}

function stopCameraTracks() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  if (webcamVideo) webcamVideo.srcObject = null;
}

async function runHandDetection() {
  if (!cameraActive || detectionBusy || !webcamVideo || webcamVideo.readyState < 2) return;
  detectionBusy = true;
  try {
    inferenceCount += 1;
    await handsModel.send({ image: webcamVideo });
  } catch (error) {
    cameraStatus = 'tracking interrupted · mouse fallback active';
    console.warn(error);
  } finally {
    detectionBusy = false;
  }
}

// MediaPipe's classic solution is most stable when each frame begins only
// after the previous send() completes. A setInterval can race its internal
// graph or leave the video pipeline apparently frozen after the first result.
function startHandDetectionLoop() {
  const token = ++detectionLoopToken;
  const interval = 1000 / CFG.hands.detectionFps;

  const tick = async () => {
    if (!cameraActive || token !== detectionLoopToken) return;
    await runHandDetection();
    if (!cameraActive || token !== detectionLoopToken) return;
    detectionTimer = setTimeout(tick, interval);
  };

  tick();
}

function handleHandResults(results) {
  resultCount += 1;
  const now = performance.now();
  const landmarks = results.multiHandLandmarks || [];
  const handedness = results.multiHandedness || [];

  // Detection is frame-local, but visual position is intentionally persistent.
  for (const state of Object.values(handStates)) state.detected = false;

  for (let index = 0; index < landmarks.length; index += 1) {
    const tip = landmarks[index]?.[8];
    if (!tip) continue;
    const classification = handedness[index];
    let label = classification?.label
      || classification?.[0]?.label
      || classification?.classification?.[0]?.label;
    if (label !== 'Left' && label !== 'Right') continue;
    if (CFG.hands.swapHandedness) label = label === 'Left' ? 'Right' : 'Left';

    const state = handStates[label];
    const mapped = mapCameraPointToGrid(tip.x, tip.y);
    const velocity = state.previousDetection
      ? Math.hypot(
        mapped.normalizedX - state.previousDetection.normalizedX,
        mapped.normalizedY - state.previousDetection.normalizedY
      )
      : Infinity;
    if (Number.isFinite(velocity)) {
      glitchMotion = max(glitchMotion, constrain(velocity / .055, 0, 1));
    }
    state.dwellFrames = velocity < CFG.interaction.handDwellVelocityThreshold ? state.dwellFrames + 1 : 0;
    state.previousDetection = mapped;
    state.target = { x: mapped.displayX, y: mapped.displayY };
    if (!state.display) state.display = { ...state.target };
    state.detected = true;
    state.hasPosition = true;

    if (state.dwellFrames >= CFG.interaction.dwellFrames && now - state.lastSpawnAt >= CFG.interaction.spawnCooldownMs) {
      spawnBoundCluster(state.type, mapped.x, mapped.y);
      state.lastSpawnAt = now;
    }
  }

  // Missing inference frames do not clear target/display/hasPosition. The
  // last known cursor remains fully visible until the camera is stopped.
}

// COORDINATE + HANDEDNESS TRANSFORM
// MediaPipe supplies normalized upright camera coordinates. These explicit
// switches map the mirrored camera into the portrait simulation grid before
// the independent ±90° projector blit. swapHandedness corrects labels only.
function mapCameraPointToGrid(cameraX, cameraY) {
  let x = CFG.hands.mirrorX ? 1 - cameraX : cameraX;
  let y = cameraY;
  if (CFG.hands.swapAxes) [x, y] = [y, x];
  if (CFG.hands.flipMappedX) x = 1 - x;
  if (CFG.hands.flipMappedY) y = 1 - y;
  x = constrain(x, 0, 1);
  y = constrain(y, 0, 1);
  const imagePoint = portraitPointToImageGrid(x, y);
  return {
    normalizedX: x,
    normalizedY: y,
    // Indicators stay at the physical fingertip while spawning is mapped
    // into the satellite coordinate currently passing underneath it.
    displayX: x * CFG.grid.width,
    displayY: y * CFG.grid.height,
    x: imagePoint.x,
    y: imagePoint.y
  };
}

function portraitPointToImageGrid(normalizedX, normalizedY) {
  const panel = presentationRect();
  const pan = slowPanTransform(panel);
  const imageX = ((normalizedX - .5) / pan.zoom) + .5;
  const offsetNormalizedY = pan.offsetY / panel.portraitHeight;
  const imageY = ((normalizedY - .5 - offsetNormalizedY) / pan.zoom) + .5;
  return {
    x: constrain(imageX, 0, 1) * CFG.grid.width,
    y: constrain(imageY, 0, 1) * CFG.grid.height
  };
}

function interpolateHandPositions() {
  for (const state of Object.values(handStates)) {
    if (!state.hasPosition || !state.target) continue;
    if (!state.display) state.display = { ...state.target };
    state.display.x = lerp(state.display.x, state.target.x, CFG.hands.interpolation);
    state.display.y = lerp(state.display.y, state.target.y, CFG.hands.interpolation);
  }
}

// Inverse of the presentation transform. Development can use an upright portrait
// preview; when rotateAtBlit is true this same function accounts for the
// ±90° projector rotation without changing the simulation coordinates.
function canvasToPortraitGrid(canvasX, canvasY) {
  const panel = presentationRect();
  const dx = canvasX - width / 2;
  const dy = canvasY - height / 2;
  let portraitX;
  let portraitY;

  if (!CFG.projector.rotateAtBlit) {
    portraitX = dx + panel.portraitWidth / 2;
    portraitY = dy + panel.portraitHeight / 2;
  } else if (CFG.projector.rotationDirection > 0) {
    portraitX = dy + panel.portraitWidth / 2;
    portraitY = -dx + panel.portraitHeight / 2;
  } else {
    portraitX = -dy + panel.portraitWidth / 2;
    portraitY = dx + panel.portraitHeight / 2;
  }

  if (portraitX < 0 || portraitX >= panel.portraitWidth || portraitY < 0 || portraitY >= panel.portraitHeight) return null;
  return portraitPointToImageGrid(
    portraitX / panel.portraitWidth,
    portraitY / panel.portraitHeight
  );
}

function mousePressed() {
  if (mouseButton === LEFT) {
    activateMouseDwell(mouseDwells.flow);
    return false;
  }
  if (mouseButton === RIGHT) {
    activateMouseDwell(mouseDwells.physarum);
    return false;
  }
  return true;
}

function mouseReleased() {
  mouseDwells.flow.active = false;
  mouseDwells.physarum.active = false;
  return false;
}

function activateMouseDwell(state) {
  state.active = true;
  state.frames = 0;
  state.previous = null;
}

function spawnBoundCluster(type, x, y) {
  if (type === 'flow') spawnFlowCluster(x, y);
  else spawnPhysarumCluster(x, y);
}

function keyPressed() {
  if (key === 'h' || key === 'H') {
    CFG.hud = !CFG.hud;
    document.body.classList.toggle('hud-hidden', !CFG.hud);
  }
  if (key === 'm' || key === 'M') CFG.showMarkers = !CFG.showMarkers;
  if (key === 'g' || key === 'G') CFG.glitch.enabled = !CFG.glitch.enabled;
  if (key === 'p' || key === 'P') CFG.pan.enabled = !CFG.pan.enabled;
  if (key === 'd' || key === 'D') CFG.directCoupling = !CFG.directCoupling;
  if (key === 'k' || key === 'K') CFG.hands.showCalibrationDots = !CFG.hands.showCalibrationDots;
  if (key === 'b' || key === 'B') CFG.hands.swapHandedness = !CFG.hands.swapHandedness;
  // Exhibition safeguard: S can recover/reload the NAIP raster but cannot
  // accidentally switch the public piece back to generated placeholder land.
  if (key === 's' || key === 'S') { CFG.useSubstrate = true; initializeSubstrate(); }
  if (key === 'x' || key === 'X') CFG.projector.rotationDirection *= -1;
  if (key === 'o' || key === 'O') CFG.projector.rotateAtBlit = !CFG.projector.rotateAtBlit;
  if (key === 'r' || key === 'R') { CFG.placeholderSeed += 1; initializeSubstrate(); }
  if (key === 'v' || key === 'V') toggleCamera();
  if (key === ' ') simulationPaused = !simulationPaused;
  if (key === 'f' || key === 'F') fullscreen(!fullscreen());
  return false;
}

document.addEventListener('contextmenu', (event) => event.preventDefault());
