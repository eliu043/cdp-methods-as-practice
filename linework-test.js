import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const canvas = document.getElementById('lineworkCanvas');
const stage = document.querySelector('.stage');
const status = document.getElementById('modelStatus');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  surface: 'toon',
  paper: 'ivory',
  profileWeight: 3,
  creaseWeight: 1,
  threshold: 5,
  speed: 0.35,
  rotating: !reduceMotion,
  projection: 'orthographic',
};

const palettes = {
  ivory: { paper: 0xe9e4d6, ink: 0x161817, fill: 0xbac1b1, ghost: 0xc9c6ba },
  blue: { paper: 0xb9cbd0, ink: 0x162f39, fill: 0x8daeb4, ghost: 0x9db4b9 },
  black: { paper: 0x121311, ink: 0xe7e8df, fill: 0x4d5048, ghost: 0x2e302b },
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(palettes.ivory.paper, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(palettes.ivory.paper);
const aspect = 1;
const orthoCamera = new THREE.OrthographicCamera(-2.7 * aspect, 2.7 * aspect, 2.7, -2.7, 0.01, 100);
const perspectiveCamera = new THREE.PerspectiveCamera(31, aspect, 0.01, 100);
orthoCamera.position.set(4.4, 3.4, 5.2);
perspectiveCamera.position.copy(orthoCamera.position).multiplyScalar(1.35);
let camera = orthoCamera;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 12;
controls.target.set(0, 0.08, 0);

scene.add(new THREE.HemisphereLight(0xf4f0df, 0x6c746c, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
keyLight.position.set(-4, 7, 5);
scene.add(keyLight);

const modelRoot = new THREE.Group();
modelRoot.position.set(0.65, -0.2, 0);
scene.add(modelRoot);

let sourceModel = null;
let meshes = [];
let edgeObjects = [];
let edgeMaterials = [];

function gradientTexture() {
  const data = new Uint8Array([
    38, 38, 38,
    108, 108, 108,
    184, 184, 184,
    245, 245, 245,
  ]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RGBFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const toonGradient = gradientTexture();

function makeSurfaceMaterial(mode = state.surface) {
  const palette = palettes[state.paper];
  if (mode === 'line') {
    return new THREE.MeshBasicMaterial({ color: palette.paper, colorWrite: false, depthWrite: true });
  }
  if (mode === 'ghost') {
    return new THREE.MeshBasicMaterial({
      color: palette.ghost,
      opacity: 0.24,
      transparent: true,
      depthWrite: true,
    });
  }
  return new THREE.MeshToonMaterial({
    color: palette.fill,
    gradientMap: toonGradient,
  });
}

function buildFallback() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.24, 1.9), material);
  slab.position.y = -0.9;
  group.add(slab);

  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.5, 0.8), material);
  tower.position.set(-0.7, 0.46, -0.2);
  group.add(tower);

  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 0.75), material);
  bar.position.set(0.35, -0.1, 0.3);
  group.add(bar);

  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.58, 1.55, 12), material);
  cylinder.position.set(0.9, 0.25, -0.45);
  group.add(cylinder);

  return group;
}

function normalizeModel(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 3.15 / (Math.max(size.x, size.y, size.z) || 1);
  object.scale.setScalar(scale);
  object.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  object.updateMatrixWorld(true);
}

function disposeEdges() {
  edgeObjects.forEach((edge) => {
    edge.parent?.remove(edge);
    edge.geometry.dispose();
  });
  edgeMaterials.forEach((material) => material.dispose());
  edgeObjects = [];
  edgeMaterials = [];
}

function rebuildEdges() {
  disposeEdges();
  const palette = palettes[state.paper];
  const stageRect = stage.getBoundingClientRect();

  meshes.forEach((mesh) => {
    if (!mesh.geometry?.attributes?.position) return;
    const edges = new THREE.EdgesGeometry(mesh.geometry, state.threshold);
    const geometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
    edges.dispose();
    const material = new LineMaterial({
      color: palette.ink,
      linewidth: state.creaseWeight,
      transparent: true,
      opacity: 0.92,
      depthTest: true,
      depthWrite: false,
      alphaToCoverage: true,
    });
    material.resolution.set(stageRect.width || 1, stageRect.height || 1);
    const line = new LineSegments2(geometry, material);
    line.renderOrder = 3;
    line.frustumCulled = false;
    mesh.add(line);
    edgeObjects.push(line);
    edgeMaterials.push(material);
  });
}

function applySurface() {
  meshes.forEach((mesh) => {
    mesh.material?.dispose?.();
    mesh.material = makeSurfaceMaterial();
  });
}

function installModel(object, label) {
  if (sourceModel) modelRoot.remove(sourceModel);
  sourceModel = object;
  normalizeModel(sourceModel);
  modelRoot.add(sourceModel);
  meshes = [];
  sourceModel.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;
      meshes.push(child);
    }
  });
  applySurface();
  rebuildEdges();
  outlinePass.selectedObjects = meshes;
  status.classList.add('is-ready');
  status.querySelector('span:last-child').textContent = label;
}

const composer = new EffectComposer(renderer);
let renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const outlinePass = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
outlinePass.edgeStrength = 4.5;
outlinePass.edgeGlow = 0;
outlinePass.edgeThickness = state.profileWeight;
outlinePass.pulsePeriod = 0;
outlinePass.visibleEdgeColor.set(palettes.ivory.ink);
outlinePass.hiddenEdgeColor.set(palettes.ivory.ink);
composer.addPass(outlinePass);
composer.addPass(new OutputPass());

new GLTFLoader().load(
  'models/toy.glb',
  (gltf) => installModel(gltf.scene, 'models/toy.glb / live'),
  undefined,
  () => installModel(buildFallback(), 'Fallback massing study')
);

function setCamera(type) {
  const previous = camera;
  camera = type === 'perspective' ? perspectiveCamera : orthoCamera;
  camera.position.copy(previous.position).normalize().multiplyScalar(type === 'perspective' ? 7.4 : 6.2);
  camera.quaternion.copy(previous.quaternion);
  controls.object = camera;
  controls.update();
  renderPass.camera = camera;
  outlinePass.renderCamera = camera;
  state.projection = type;
  resize();
}

function updatePalette(name) {
  state.paper = name;
  document.body.dataset.paper = name;
  const palette = palettes[name];
  scene.background.set(palette.paper);
  renderer.setClearColor(palette.paper, 1);
  outlinePass.visibleEdgeColor.set(palette.ink);
  outlinePass.hiddenEdgeColor.set(palette.ink);
  applySurface();
  rebuildEdges();
}

function updatePressed(buttons, active) {
  buttons.forEach((button) => {
    const selected = button === active;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

const surfaceButtons = [...document.querySelectorAll('[data-surface]')];
surfaceButtons.forEach((button) => button.addEventListener('click', () => {
  state.surface = button.dataset.surface;
  updatePressed(surfaceButtons, button);
  applySurface();
}));

const projectionButtons = [...document.querySelectorAll('[data-projection]')];
projectionButtons.forEach((button) => button.addEventListener('click', () => {
  updatePressed(projectionButtons, button);
  setCamera(button.dataset.projection);
}));

const paperButtons = [...document.querySelectorAll('[data-paper]')];
paperButtons.forEach((button) => button.addEventListener('click', () => {
  updatePressed(paperButtons, button);
  updatePalette(button.dataset.paper);
}));

function bindRange(id, outputId, key, formatter, onInput) {
  const input = document.getElementById(id);
  const output = document.getElementById(outputId);
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    output.value = formatter(state[key]);
    onInput?.(state[key]);
  });
}

bindRange('profileWeight', 'profileValue', 'profileWeight', String, (value) => { outlinePass.edgeThickness = value; });
bindRange('creaseWeight', 'creaseValue', 'creaseWeight', String, (value) => edgeMaterials.forEach((material) => { material.linewidth = value; }));
bindRange('edgeThreshold', 'thresholdValue', 'threshold', (value) => `${value}°`, rebuildEdges);
bindRange('rotationSpeed', 'speedValue', 'speed', (value) => value.toFixed(2));

const rotationToggle = document.getElementById('autoRotate');
rotationToggle.classList.toggle('is-on', state.rotating);
rotationToggle.setAttribute('aria-checked', String(state.rotating));
rotationToggle.addEventListener('click', () => {
  state.rotating = !state.rotating;
  rotationToggle.classList.toggle('is-on', state.rotating);
  rotationToggle.setAttribute('aria-checked', String(state.rotating));
});

document.getElementById('resetView').addEventListener('click', () => {
  modelRoot.rotation.set(0.08, -0.4, -0.08);
  camera.position.set(4.4, 3.4, 5.2).normalize().multiplyScalar(state.projection === 'perspective' ? 7.4 : 6.2);
  controls.target.set(0, 0.08, 0);
  controls.update();
});

function resize() {
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  renderer.setSize(rect.width, rect.height, false);
  composer.setSize(rect.width, rect.height);
  const viewAspect = rect.width / rect.height;
  orthoCamera.left = -2.7 * viewAspect;
  orthoCamera.right = 2.7 * viewAspect;
  orthoCamera.top = 2.7;
  orthoCamera.bottom = -2.7;
  orthoCamera.updateProjectionMatrix();
  perspectiveCamera.aspect = viewAspect;
  perspectiveCamera.updateProjectionMatrix();
  edgeMaterials.forEach((material) => material.resolution.set(rect.width, rect.height));
}

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(stage);
resize();

const clock = new THREE.Clock();
modelRoot.rotation.set(0.08, -0.4, -0.08);

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  if (state.rotating) modelRoot.rotation.y += delta * state.speed;
  controls.update();
  composer.render();
}

animate();
