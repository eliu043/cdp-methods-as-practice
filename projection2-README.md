# The Forecast Has Entered the Ground — Physarum study

A Physarum (slime-mold) agent simulation over a satellite-image substrate, meant to be
driven by a viewer's hand tracked live via MediaPipe Hands and projected onto a portrait
wall panel through a projector mounted on its side.

This is a separate, standalone piece from `projection.html` — same physical wall-panel
setup, a different technique (agent simulation instead of Game of Life / pose tracking).

## Current stage

Built in five stages; **stages 1, 2, and 4 are done**, 3 and 5 are not:

1. ✅ Scaffolding + the `CFG` block.
2. ✅ Physarum simulation running on placeholder Perlin-noise terrain, driven by the
   mouse as a stand-in for a tracked hand.
3. ⬜ MediaPipe Hands — real fingertip tracking, replacing the mouse.
4. ✅ The real satellite substrate image (`CFG.substratePath`), center-cropped to the
   grid's aspect and downsampled to one luminance sample per cell. Falls back to the
   placeholder Perlin terrain automatically if the image fails to load.
5. ⬜ The rotated 90° projector blit — right now the canvas renders straight/unrotated,
   sized to grid resolution × `CFG.cellPx`, for easy viewing during development.

## Running it

Serve over localhost, not `file://` — the webcam (once wired in stage 3) needs a secure
context, and it's good practice to test that way from the start:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/projection2.html`.

## Keyboard controls

| Key | Action |
| --- | --- |
| `h` | Toggle the HUD |
| `s` | Toggle the substrate on/off |
| `b` | Flip the substrate bias sign (flow toward bright ↔ dark) |
| `r` | Flip the rotation direction (`+HALF_PI` ↔ `-HALF_PI`) — has no visible effect until stage 5 |
| `m` | Switch hand mode: `deposit` ↔ `deposit+spawn` |
| `c` | Toggle the calibration dot |
| `n` | Reseed agents and clear the trail field |
| `f` | Toggle fullscreen |

Until MediaPipe is wired (stage 3), the mouse acts as the "hand": move it over the
canvas to deposit attractant (and, in `deposit+spawn` mode, spawn new agents). It's
routed through the same `mapNormalizedToGrid()` function the real camera coordinates
will use, so the mirror/swap/flip flags below are already testable today.

## `CFG` reference

### Projector output (stage 5 — not applied yet)
- `outputW` / `outputH` — the projector's native landscape resolution.
- `rotateDirection` — `1` for `+HALF_PI`, `-1` for `-HALF_PI`. Flip this if the projector
  ends up mounted the other way round once it's physically installed.
- `panelWidthIn` / `panelHeightIn` — the physical wall panel's portrait dimensions, used
  to compute how much of the rotated output the portrait content should fill.

### Simulation grid
- `gridW` / `gridH` — the coarse simulation resolution. Kept small on purpose; the
  simulation never runs at full projector resolution, only the final render is upscaled.
- `cellPx` — pixels per grid cell in the current unrotated dev canvas. Only relevant
  until stage 5 replaces the render path.

### Physarum agents
Standard Jones (2010) sense → turn → move → deposit model, run on a fixed timestep so
behavior doesn't depend on the render framerate:
- `agentCount` — agents active at startup.
- `maxAgentCount` — hard cap the population can grow to via hand-spawn.
- `sensorAngle` — radians the left/right sensors are offset from the agent's heading.
- `sensorDistance` — how far ahead (in grid cells) the sensors sample.
- `turnAngle` — radians turned per step toward whichever sensor reads strongest.
- `stepSize` — grid cells moved per sim step.
- `depositAmount` — trail value added at an agent's new cell each step.
- `decayRate` — fraction of trail removed per sim step.
- `diffuseRate` — 0–1 blend toward the 3×3-blurred trail each step.
- `simStepMs` — the fixed simulation timestep in milliseconds, independent of render fps.
- `trailDisplayMax` — the trail value that maps to full display intensity (tune this if
  the network looks too washed out or too saturated).

### Substrate
- `useSubstrate` — master on/off. When false, agents flow on a blank field driven only
  by the hand; when true, the substrate biases both sensing and the visible tint.
- `substratePath` — the aerial image to use once loaded (stage 4); currently unused.
- `substrateBiasTowardBright` — `true` flows agents toward bright ground, `false` toward
  dark. Which one reads better depends on the actual image — decide on the wall.
- `substrateBiasStrength` — how strongly luminance affects a sensor's reading.
- `substrateOpacity` — how visible the terrain tint is under the trail/agents.

### Hand interaction
- `handMode` — `'deposit'` (attractant only) or `'deposit+spawn'` (also spawns new
  agents at the hand position each frame, so the network visibly grows from the point).
- `handDepositStrength` / `handDepositRadius` — how much attractant the hand deposits,
  and over what radius (in grid cells).
- `handSpawnPerFrame` — new agents spawned per frame in `deposit+spawn` mode.

### Coordinate mapping — calibrate these once the real camera is wired
The camera sees the viewer upright and mirrored; the sim grid is portrait; the projector
is rotated 90°. Each flag below is a one-line flip:
- `mirrorX` — webcams mirror by default; usually `true`.
- `swapAxes` — swaps which camera axis maps to which grid axis, for the 90° relationship
  between camera space and the portrait grid.
- `flipMappedX` / `flipMappedY` — final left/right or up/down correction.
- `showCalibrationDot` — draws a small dot at the mapped grid position so you can see
  exactly where the mapping thinks your hand is, and flip flags until it tracks
  correctly. **Calibration steps once the camera is live:** stand where the sensor can
  see you, watch the dot, and toggle `mirrorX`/`swapAxes`/`flipMappedX`/`flipMappedY`
  one at a time until moving your hand right/left/up/down on the wall moves the dot the
  same way.

### Palette
`colorBackground`, `colorTrailLow` → `colorTrailHigh` (the trail intensity ramp),
`colorAgent` (agent marker color), `colorSubstrateTint` (terrain tint color).

## Privacy

Nothing about the webcam is stored or transmitted — once wired, processing is live and
ephemeral. Put a wall label saying so.
