# The Forecast Has Entered the Ground

A browser-based p5.js installation for a portrait wall panel. Two agent populations displace colors already present in a real satellite raster:

- anatomical **left hand** releases contour-following flow agents;
- anatomical **right hand** releases radial infrastructure agents;
- both write into the same slowly healing pixel field;
- direct coupling lets constructed paths channel flow while dense flow erodes their invisible steering field.

This is continuous flow advection plus a radial infrastructure automaton informed by Jones-style trail sensing, not Langton's Ant or a turning turmite. The right-hand system builds quantized spokes and faceted orbital connectors around each hand-dwell hub. Visible trails are deliberately narrow—generally one 108×216 simulation cell wide. Untouched ground is rendered from the source-resolution NAIP raster; only displaced cells use the coarse simulation grid.

## Run

Serve the repository through localhost; camera access will not work through `file://`.

```bash
cd /path/to/cdp-methods-as-practice
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/projection2.html`. This is the single canonical installation URL. Its default output is a clean, black landscape projector canvas containing a portrait image rotated 90 degrees for the physical projector; press `O` when an upright development view is needed. The black surround minimizes projected light on the white wall around the image.

Click **Start hand tracking** once and grant camera permission. MediaPipe inference is performed in the page; frames are not stored or transmitted by this sketch.

## Interaction

Pause an index fingertip over the panel for the configured dwell interval:

- left fingertip releases flow-field agents;
- right fingertip releases radial infrastructure agents.

Motion resets the dwell counter. Existing populations age out, and when no hands or mouse input are present the field heals more quickly toward its untouched source.

The satellite, displacement field, glitches, and optional agent markers share a slow five-minute north–south drift. The pan eases almost to a stop during live interaction, while hand indicators remain fixed to the physical wall position.

Mouse fallback:

- hold the left button still to release flow agents;
- hold the right button still to release infrastructure agents.

## Keyboard controls

- `H`: HUD and camera controls
- `S`: restore and reload the real satellite substrate
- `X`: flip projector rotation direction (`+HALF_PI` / `-HALF_PI`)
- `O`: rotate-at-blit / upright preview
- `P`: slow satellite pan
- `D`: direct coupling
- `K`: calibration dots and labels
- `B`: swap MediaPipe handedness labels
- `V`: start or stop the camera
- `M`: live-agent markers
- `R`: restore the original field and clear all agents
- `Space`: pause simulation
- `F`: fullscreen

## On-site calibration

1. Open `projection2.html` and press `O` for an upright view while fingertip mapping and behavior are confirmed.
2. Start hand tracking and raise one hand at a time. Calibration dots should follow each index fingertip.
3. Confirm the anatomical left hand is labeled `LEFT · FLOW` and anatomical right is `RIGHT · INFRA`. Press `B`, or change `CFG.hands.swapHandedness`, if the camera/MediaPipe combination reverses them.
4. The default `mirrorX: false` makes a rightward hand movement travel downward after the `+90°` projector rotation. If positions are reversed in the final setup, adjust `mirrorX`, `swapAxes`, `flipMappedX`, and `flipMappedY`. The HUD reports their live values.
5. Press `O` for the physical projector orientation. If the portrait lands upside down, press `X` to reverse the quarter-turn.
6. Hide the HUD and camera button with `H`, then enter fullscreen with `F`.

## CFG guide

All tunable values live in the single `CFG` block at the top of `sketch.js`.

### Projector, grid, and substrate

- `projector.nativeWidth`, `nativeHeight`: native landscape projector output, currently 1920×1080.
- `projector.rotateAtBlit`: rotate the portrait render into the landscape output.
- `projector.rotationDirection`: `1` for `+HALF_PI`, `-1` for `-HALF_PI`.
- `grid.width`, `height`: coarse portrait simulation resolution, currently 108×216.
- `useSubstrate`: use the real satellite image when true. The exhibition defaults to true; placeholder terrain can only be enabled by editing this value directly.
- `substratePath`: Fort Spunky NAIP raster at `assets/projection/fort-spunky-naip-2022.jpg`.
- `placeholderSeed`: seed for the offline generated terrain fallback.
- `rendering.highResolutionUnderlay`: retain the detailed source raster beneath the simulation.
- `rendering.displacementThreshold`: ignore tiny field differences so healed cells become fully transparent.
- `rendering.displacementFullOpacityAt`: RGB difference at which a displaced cell completely covers the underlay.

### Slow pan

- `pan.enabled`: starts the shared image-space drift.
- `zoom`: overscan that creates travel room without exposing the black surround.
- `cycleSeconds`: duration of one top-to-bottom-to-top traversal; currently five minutes.
- `presenceSpeedMultiplier`: fraction of normal speed retained while a hand or mouse is active.
- `responseSeconds`: easing time when slowing for a viewer or resuming after absence.

### Shared field

- `simulation.hz`: fixed simulation update rate.
- `maxCatchUpSteps`: limits recovery work after a stalled tab.
- `smearStrength`: probability of a one-cell carried-color overwrite; this is not a color blend.
- `healRate`: per-step return of `field` toward immutable `original`; currently about 90% recovery in 43 seconds while hands remain visible.
- `absenceHealMultiplier`: accelerates healing when no live input is present; currently about 90% recovery in 18 seconds.

### Pixel glitch overlay

- `glitch.enabled`: toggles the independent palette-preserving overlay.
- `refreshHz`: how often its sparse tile arrangement changes.
- `baseTileCount`, `movementTileCount`: quiet flicker and additional hand-motion response.
- `lineThickness`, `lineMinLength`, `lineMaxLength`: dimensions of the narrow vertical strips in portrait/projected space.
- `maxOffsetCells`: maximum displacement from the sampled location.
- `opacity`: overlay strength; colors are sampled from the current satellite field.
- `motionDecayPerSecond`: how quickly a movement-triggered glitch returns to its quiet state.
- Press `G` to toggle the glitch layer during installation tuning.

### Flow agents

- `terrainNoiseBlend`: balance between satellite-luminance contours and curl-like Perlin drift (`0` terrain only, `1` noise only).
- `noiseScale`, `noiseTimeScale`, `steerRate`: organic drift and steering response.
- `stepSize`, `colorRefreshRate`: travel and carried-color refresh.
- `clusterSize`, `spawnRadius`, `lifespanSeconds`, `maxAgents`: population controls.
- `markerSize`, `markerColor`: optional live markers; markers do not write color.

### Infrastructure / Physarum agents

- `sensorAngle`, `sensorDistance`, `turnAngle`: three-sensor sense-and-turn geometry.
- `substrateLuminosityWeight`: faint source-image bias added to internal trail sensing.
- `stepSize`, `colorRefreshRate`: travel and carried-color refresh.
- `geometricSteer`: strength of the constructed geometry relative to organic trail sensing.
- `radialSpokes`: number of possible axes leaving each hand-dwell hub.
- `headingDivisions`: directional quantization of the faceted orbital connectors.
- `ringProbability`, `ringRadiusMin`, `ringRadiusMax`, `ringCorrection`: spoke-to-ring branching and connector geometry.
- `trailDeposit`, `trailDiffusion`, `trailDecay`: invisible steering field dynamics.
- `clusterSize`, `spawnRadius`, `lifespanSeconds`, `maxAgents`: population controls.
- `markerSize`, `markerColor`: optional distinct diagnostic markers.

### Direct coupling

- `directCoupling`: initial toggle state.
- `coupling.veinChannelStrength`: how strongly local infrastructure trail direction deflects flow.
- `flowErosionStrength`: extra trail decay under dense flow traffic.
- `minimumVeinDensity`: threshold below which veins do not directly channel flow.

Both populations still interact through the shared displaced image when direct coupling is off.

### Dwell and hand tracking

- `interaction.mouseDwellVelocityThreshold`, `handDwellVelocityThreshold`: maximum motion that counts as a pause.
- `dwellFrames`, `spawnCooldownMs`: duration and repeat rate for releases.
- `hands.detectionFps`: independently throttled MediaPipe rate.
- `hands.cameraWidth`, `cameraHeight`: requested webcam detail; higher values help when viewers stand farther from the wall camera.
- `hands.modelComplexity`, `minDetectionConfidence`, `minTrackingConfidence`: MediaPipe accuracy and stability controls.
- Last-known fingertip positions persist without a missed-frame timeout. They clear only when hand tracking is stopped.
- The HUD's `inference/result` counters should both continue increasing while tracking is active. If they stop, the webcam/MediaPipe loop—not hand visibility—is stalled.
- `hands.interpolation`: smoothing between detections.
- `hands.mirrorX`, `swapAxes`, `flipMappedX`, `flipMappedY`: camera-to-portrait-grid mapping.
- `hands.swapHandedness`: one-line correction for anatomical handedness.
- `hands.showCalibrationDots`: starting state for labeled fingertip dots.
- `hands.ghostIndicators`: keep faint left-flow and right-infrastructure pause cues visible while hands are absent.

## Performance knobs

Reduce these in order if frame rate drops:

1. `flow.maxAgents` and `physarum.maxAgents` (and cluster sizes);
2. `grid.width` / `grid.height` while preserving the 1:2 ratio;
3. `hands.detectionFps`.

The simulation timestep remains fixed even when render and MediaPipe rates differ, preventing machine-dependent speed changes.
