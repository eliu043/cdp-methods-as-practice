/*
  "The Forecast Has Entered the Ground" — Physarum wall panel study.

  STAGE CHECKPOINT (1/2 of the staged build): the Physarum simulation is
  running on a placeholder Perlin-noise terrain, driven by the mouse as a
  stand-in for a tracked hand. NOT wired yet, in build order:
    3. MediaPipe Hands (real fingertip tracking, replacing the mouse)
    4. The real satellite substrate image (CFG.substratePath, currently unused)
    5. The rotated 90-degree projector blit (CFG.outputW/H/rotateDirection,
       currently unused — this canvas renders straight, unrotated, at grid
       resolution x CFG.cellPx, for easy viewing during development)

  Every tunable value lives in the CFG block below.
*/

const CFG = {
  // ---- Projector output — not applied yet (stage 5) ----
  outputW: 1920,        // projector's native landscape resolution
  outputH: 1080,
  rotateDirection: 1,    // 1 => +HALF_PI, -1 => -HALF_PI; flip if the projector is mounted the other way
  panelWidthIn: 36,      // physical wall panel, portrait
  panelHeightIn: 72,

  // ---- Simulation grid — coarse; always upscaled nearest-neighbor for render ----
  gridW: 108,
  gridH: 216,
  cellPx: 4,             // dev-canvas pixels per grid cell (unrotated, stage 1 view only)

  // ---- Physarum agents (Jones 2010 sense -> turn -> move -> deposit model) ----
  agentCount: 8000,      // agents active at start
  maxAgentCount: 24000,  // hard cap agents can grow to via hand-spawn (see handMode)
  sensorAngle: 0.45,     // radians, left/right sensor offset from heading
  sensorDistance: 5,     // grid cells ahead of the agent
  turnAngle: 0.35,       // radians turned per step toward the stronger sensor
  stepSize: 1.0,         // grid cells moved per sim step
  depositAmount: 5.0,    // trail value added at an agent's new cell each step
  decayRate: 0.06,       // fraction of trail removed per sim step
  diffuseRate: 0.6,      // 0..1 blend toward the 3x3-blurred trail each step
  simStepMs: 1000 / 60,  // fixed sim timestep — decoupled from render framerate
  trailDisplayMax: 80,   // trail value that maps to full-intensity color on screen

  // ---- Substrate: satellite image (stage 4) or placeholder Perlin terrain (now) ----
  useSubstrate: true,
  substratePath: 'assets/projection/fort-spunky-naip-2022.jpg', // same aerial projection.js uses — not loaded until stage 4
  substrateBiasTowardBright: true, // true: agents flow toward bright ground; false: toward dark
  substrateBiasStrength: 40,       // added to a sensor's sensed value, scaled by local luminance 0..1
  substrateOpacity: .35,           // how visible the terrain tint is under the trail

  // ---- Hand interaction — wired to the mouse for now, MediaPipe replaces it in stage 3 ----
  handMode: 'deposit',   // 'deposit' (attractant only) | 'deposit+spawn' (also grows new agents)
  handDepositStrength: 60,
  handDepositRadius: 6,  // grid cells
  handSpawnPerFrame: 3,

  // ---- Coordinate mapping: camera-space [0,1] -> grid-space. Calibrate on the wall ----
  // once the real camera is wired; each flag is testable right now with the mouse.
  mirrorX: true,
  swapAxes: true,
  flipMappedX: false,
  flipMappedY: false,
  showCalibrationDot: true,

  // ---- Palette ----
  colorBackground: [8, 9, 8],
  colorTrailLow: [10, 16, 13],
  colorTrailHigh: [214, 255, 60],
  colorAgent: [255, 84, 56],
  colorSubstrateTint: [130, 145, 118],

  showHUD: true
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let trail;              // Float32Array, current trail field, gridW*gridH
let trailNext;           // scratch buffer swapped in each diffuse/decay step
let substrate;            // Float32Array 0..255 luminance field, gridW*gridH (placeholder Perlin for now)
let agents;               // Float32Array, [x, y, heading] per agent, flat for perf
let activeAgentCount = 0;
let simGraphics;          // small p5.Graphics at exactly gridW x gridH — one pixel per cell
let simAccumulator = 0;
let handGX = 0;
let handGY = 0;
let handPresent = false;

function cellIndex(x, y) { return y * CFG.gridW + x; }

function wrapCoord(v, size) {
  v %= size;
  return v < 0 ? v + size : v;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let substrateImage; // loaded in preload(); null if substratePath is unset or fails to load

function preload() {
  if (!CFG.substratePath) return;
  substrateImage = loadImage(CFG.substratePath, () => {}, () => { substrateImage = null; });
}

function setup() {
  const canvas = createCanvas(CFG.gridW * CFG.cellPx, CFG.gridH * CFG.cellPx);
  canvas.parent(document.body);
  pixelDensity(1);
  noSmooth();

  trail = new Float32Array(CFG.gridW * CFG.gridH);
  trailNext = new Float32Array(CFG.gridW * CFG.gridH);
  if (substrateImage) buildSubstrateFromImage(substrateImage);
  else buildPlaceholderSubstrate();
  initAgentPool();

  simGraphics = createGraphics(CFG.gridW, CFG.gridH);
  simGraphics.pixelDensity(1);
  simGraphics.noSmooth();
}

// Stand-in terrain, used only when substrateImage failed to load or
// substratePath is unset — lets the substrate-bias behavior be tuned without
// a final image in hand.
function buildPlaceholderSubstrate() {
  substrate = new Float32Array(CFG.gridW * CFG.gridH);
  noiseSeed(1234);
  const scale = .05;
  for (let y = 0; y < CFG.gridH; y += 1) {
    for (let x = 0; x < CFG.gridW; x += 1) {
      substrate[cellIndex(x, y)] = noise(x * scale, y * scale) * 255;
    }
  }
}

// Center-crops the source image to the grid's aspect ratio (they're already
// close — the aerial scans are ~1200x2200, the grid is 108x216 — so this is
// a light crop, not a stretch), then downsamples one luminance sample per
// grid cell, nearest-neighbor to match the piece's chunky-pixel aesthetic.
function buildSubstrateFromImage(img) {
  substrate = new Float32Array(CFG.gridW * CFG.gridH);
  img.loadPixels();
  const targetAspect = CFG.gridW / CFG.gridH;
  const srcAspect = img.width / img.height;
  let cropX = 0;
  let cropY = 0;
  let cropW = img.width;
  let cropH = img.height;
  if (srcAspect > targetAspect) {
    cropW = img.height * targetAspect;
    cropX = (img.width - cropW) / 2;
  } else {
    cropH = img.width / targetAspect;
    cropY = (img.height - cropH) / 2;
  }
  for (let y = 0; y < CFG.gridH; y += 1) {
    for (let x = 0; x < CFG.gridW; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor(cropX + (x + .5) / CFG.gridW * cropW));
      const sy = Math.min(img.height - 1, Math.floor(cropY + (y + .5) / CFG.gridH * cropH));
      const o = 4 * (sy * img.width + sx);
      const r = img.pixels[o];
      const g = img.pixels[o + 1];
      const b = img.pixels[o + 2];
      substrate[cellIndex(x, y)] = r * .2126 + g * .7152 + b * .0722;
    }
  }
}

// ---------------------------------------------------------------------------
// Agent pool — fixed-size, so hand-spawn (handMode 'deposit+spawn') can grow
// the live count up to maxAgentCount without reallocating each frame.
// ---------------------------------------------------------------------------
function initAgentPool() {
  agents = new Float32Array(CFG.maxAgentCount * 3);
  resetAgents(CFG.agentCount);
}

function resetAgents(count) {
  activeAgentCount = min(count, CFG.maxAgentCount);
  for (let i = 0; i < activeAgentCount; i += 1) {
    agents[i * 3] = random(CFG.gridW);
    agents[i * 3 + 1] = random(CFG.gridH);
    agents[i * 3 + 2] = random(TWO_PI);
  }
}

function spawnOneAgentAt(gx, gy) {
  if (activeAgentCount >= CFG.maxAgentCount) return;
  const i = activeAgentCount;
  agents[i * 3] = gx;
  agents[i * 3 + 1] = gy;
  agents[i * 3 + 2] = random(TWO_PI);
  activeAgentCount += 1;
}

// ---------------------------------------------------------------------------
// Physarum core: sense -> turn -> move -> deposit, then diffuse -> decay.
// Jones (2010) model. Sampling is nearest-neighbor (matches the chunky pixel
// aesthetic) with toroidal (wrapping) edges.
// ---------------------------------------------------------------------------
function sampleField(field, x, y) {
  const xi = Math.floor(wrapCoord(x, CFG.gridW));
  const yi = Math.floor(wrapCoord(y, CFG.gridH));
  return field[cellIndex(xi, yi)];
}

// Value an agent's sensor reads at `offset` radians from its heading: trail
// strength plus, when the substrate is on, a luminance-scaled bias so agents
// preferentially follow the terrain (sign flips with substrateBiasTowardBright).
function senseAt(x, y, heading, offset, bias) {
  const a = heading + offset;
  const sx = x + Math.cos(a) * CFG.sensorDistance;
  const sy = y + Math.sin(a) * CFG.sensorDistance;
  let v = sampleField(trail, sx, sy);
  if (CFG.useSubstrate) v += bias * CFG.substrateBiasStrength * (sampleField(substrate, sx, sy) / 255);
  return v;
}

function stepAgents() {
  const bias = CFG.substrateBiasTowardBright ? 1 : -1;
  for (let i = 0; i < activeAgentCount; i += 1) {
    const base = i * 3;
    const x = agents[base];
    const y = agents[base + 1];
    let heading = agents[base + 2];

    const left = senseAt(x, y, heading, -CFG.sensorAngle, bias);
    const center = senseAt(x, y, heading, 0, bias);
    const right = senseAt(x, y, heading, CFG.sensorAngle, bias);

    if (center >= left && center >= right) {
      // straight ahead is strongest — keep heading
    } else if (left > right) {
      heading -= CFG.turnAngle;
    } else if (right > left) {
      heading += CFG.turnAngle;
    } else {
      heading += (random() < .5 ? -1 : 1) * CFG.turnAngle;
    }

    const nx = wrapCoord(x + Math.cos(heading) * CFG.stepSize, CFG.gridW);
    const ny = wrapCoord(y + Math.sin(heading) * CFG.stepSize, CFG.gridH);

    agents[base] = nx;
    agents[base + 1] = ny;
    agents[base + 2] = heading;

    trail[cellIndex(Math.floor(nx), Math.floor(ny))] += CFG.depositAmount;
  }
}

// Box-blur toward neighbors (diffuse) then multiply down (decay), swapping
// the double-buffer each step rather than allocating a new array.
function diffuseDecay() {
  const w = CFG.gridW;
  const h = CFG.gridH;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const ny = wrapCoord(y + oy, h);
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = wrapCoord(x + ox, w);
          sum += trail[cellIndex(nx, ny)];
        }
      }
      const blurred = sum / 9;
      const cur = trail[cellIndex(x, y)];
      const mixed = cur + (blurred - cur) * CFG.diffuseRate;
      trailNext[cellIndex(x, y)] = mixed * (1 - CFG.decayRate);
    }
  }
  const swap = trail;
  trail = trailNext;
  trailNext = swap;
}

// The hand is a moving attractant source: it deposits into the trail field
// (which then diffuses outward like any other trail) rather than pulling
// agents directly, so its influence spreads and fades exactly like the rest
// of the network. With no hand present this does nothing and the field
// relaxes back to being driven by the substrate alone.
function depositHand() {
  if (!handPresent) return;
  const r = CFG.handDepositRadius;
  const r2 = r * r;
  const cx = Math.floor(handGX);
  const cy = Math.floor(handGY);
  for (let oy = -r; oy <= r; oy += 1) {
    for (let ox = -r; ox <= r; ox += 1) {
      const d2 = ox * ox + oy * oy;
      if (d2 > r2) continue;
      const gx = wrapCoord(cx + ox, CFG.gridW);
      const gy = wrapCoord(cy + oy, CFG.gridH);
      const falloff = 1 - Math.sqrt(d2) / r;
      trail[cellIndex(gx, gy)] += CFG.handDepositStrength * falloff;
    }
  }
  if (CFG.handMode === 'deposit+spawn') {
    for (let i = 0; i < CFG.handSpawnPerFrame; i += 1) spawnOneAgentAt(handGX, handGY);
  }
}

function stepSimulation() {
  depositHand();
  stepAgents();
  diffuseDecay();
}

// ---------------------------------------------------------------------------
// Coordinate mapping: camera-space (or, until stage 3, mouse-space) [0,1]
// normalized coordinates -> grid-space. Each flag is a one-line flip meant to
// be calibrated on the wall once the real camera is wired — test them now
// with the mouse and the calibration dot (toggle with 'c').
// ---------------------------------------------------------------------------
function mapNormalizedToGrid(nx, ny) {
  let x = nx;
  let y = ny;
  if (CFG.mirrorX) x = 1 - x;               // webcams mirror by default
  if (CFG.swapAxes) { const t = x; x = y; y = t; } // camera axis <-> portrait grid axis
  if (CFG.flipMappedX) x = 1 - x;
  if (CFG.flipMappedY) y = 1 - y;
  return { gx: x * (CFG.gridW - 1), gy: y * (CFG.gridH - 1) };
}

// Stand-in for the MediaPipe fingertip until stage 3 — runs through the same
// mapNormalizedToGrid() pipeline as the real hand will, so the mirror/swap/flip
// flags are already testable.
function updateHandFromMouse() {
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) {
    handPresent = false;
    return;
  }
  const mapped = mapNormalizedToGrid(mouseX / width, mouseY / height);
  handGX = mapped.gx;
  handGY = mapped.gy;
  handPresent = true;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderSimGraphics() {
  simGraphics.loadPixels();
  const px = simGraphics.pixels;
  const bg = CFG.colorBackground;
  const sub = CFG.colorSubstrateTint;
  const lo = CFG.colorTrailLow;
  const hi = CFG.colorTrailHigh;
  const n = CFG.gridW * CFG.gridH;
  for (let i = 0; i < n; i += 1) {
    const s = CFG.useSubstrate ? (substrate[i] / 255) * CFG.substrateOpacity : 0;
    let r = bg[0] + (sub[0] - bg[0]) * s;
    let g = bg[1] + (sub[1] - bg[1]) * s;
    let b = bg[2] + (sub[2] - bg[2]) * s;
    const t = Math.min(1, trail[i] / CFG.trailDisplayMax);
    const tr = lo[0] + (hi[0] - lo[0]) * t;
    const tg = lo[1] + (hi[1] - lo[1]) * t;
    const tb = lo[2] + (hi[2] - lo[2]) * t;
    r += (tr - r) * t;
    g += (tg - g) * t;
    b += (tb - b) * t;
    const o = i * 4;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = 255;
  }
  simGraphics.updatePixels();

  simGraphics.noStroke();
  simGraphics.fill(CFG.colorAgent[0], CFG.colorAgent[1], CFG.colorAgent[2]);
  for (let i = 0; i < activeAgentCount; i += 1) {
    simGraphics.rect(Math.floor(agents[i * 3]), Math.floor(agents[i * 3 + 1]), 1, 1);
  }

  if (CFG.showCalibrationDot && handPresent) {
    simGraphics.noStroke();
    simGraphics.fill(255, 255, 255);
    simGraphics.circle(handGX, handGY, 3);
  }
}

function drawHUD() {
  push();
  fill(255, 255, 255, 220);
  noStroke();
  textFont('monospace');
  textSize(11);
  textAlign(LEFT, TOP);
  const lines = [
    `agents ${activeAgentCount}/${CFG.maxAgentCount}   fps ${nf(frameRate(), 1, 1)}`,
    `substrate ${CFG.useSubstrate ? 'on' : 'off'} (s)   bias toward ${CFG.substrateBiasTowardBright ? 'bright' : 'dark'} (b)`,
    `handMode ${CFG.handMode} (m)   calibration dot ${CFG.showCalibrationDot ? 'on' : 'off'} (c)`,
    `rotateDirection ${CFG.rotateDirection > 0 ? '+HALF_PI' : '-HALF_PI'} (r) — not applied to render yet`,
    `sensorAngle ${CFG.sensorAngle.toFixed(2)}  sensorDistance ${CFG.sensorDistance}  turnAngle ${CFG.turnAngle.toFixed(2)}`,
    `deposit ${CFG.depositAmount}  decay ${CFG.decayRate}  diffuse ${CFG.diffuseRate}`,
    '[n] reseed agents   [f] fullscreen   [h] hide HUD'
  ];
  lines.forEach((line, i) => text(line, 8, 8 + i * 14));
  pop();
}

// ---------------------------------------------------------------------------
// Main loop — fixed sim timestep, decoupled from render framerate. Capped at
// 8 sim steps per frame so a slow/stalled frame can't spiral trying to catch up.
// ---------------------------------------------------------------------------
window.draw = function draw() {
  updateHandFromMouse();

  simAccumulator += deltaTime;
  let steps = 0;
  while (simAccumulator >= CFG.simStepMs && steps < 8) {
    stepSimulation();
    simAccumulator -= CFG.simStepMs;
    steps += 1;
  }

  renderSimGraphics();
  image(simGraphics, 0, 0, width, height);

  if (CFG.showHUD) drawHUD();
};

window.keyPressed = function keyPressed() {
  const k = key.toLowerCase();
  if (k === 'h') CFG.showHUD = !CFG.showHUD;
  if (k === 's') CFG.useSubstrate = !CFG.useSubstrate;
  if (k === 'b') CFG.substrateBiasTowardBright = !CFG.substrateBiasTowardBright;
  if (k === 'r') CFG.rotateDirection *= -1;
  if (k === 'm') CFG.handMode = CFG.handMode === 'deposit' ? 'deposit+spawn' : 'deposit';
  if (k === 'c') CFG.showCalibrationDot = !CFG.showCalibrationDot;
  if (k === 'n') {
    resetAgents(CFG.agentCount);
    trail.fill(0);
  }
  if (k === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
};
