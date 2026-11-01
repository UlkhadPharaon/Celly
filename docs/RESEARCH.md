# Research Notes — Cell-Mastering

Date: 2026-10-13. Sources consulted with live web search before writing any code.

## 1. MediaPipe Hand Landmarker on the web (`@mediapipe/tasks-vision`)

**API facts confirmed** (developers.google.com/edge API reference, ai.google.dev HandLandmarker
docs, unpkg `vision.d.ts`, MediaPipe tasks/web/vision README):

- Initialization is two-step: `FilesetResolver.forVisionTasks(basePath)` →
  `HandLandmarker.createFromOptions(vision, options)`.
- `basePath` is an *optional local directory* for the wasm files — this is exactly the hook we need
  to avoid the CDN. Files are `vision_wasm_internal.js/.wasm` (+ simd/simd_mt variants);
  `FilesetResolver` picks the SIMD variant itself, so **files must keep their original names**.
- Running modes: `IMAGE`, `VIDEO`, `LIVE_STREAM`. `VIDEO` is what we want: `detectForVideo(frame, ts)`
  returns synchronously, but **timestamps must be monotonically increasing** — a hard requirement we
  must enforce (we use `performance.now()` and drop stale frames, never re-use a timestamp).
- Options that matter: `numHands: 2`, `minHandDetectionConfidence` (default 0.5),
  `minHandPresenceConfidence` (0.5, controls palm re-detection when tracking confidence drops),
  `minTrackingConfidence` (0.5, IoU threshold between frames). Defaults are sane; we expose them in
  a settings panel rather than tuning blind.
- The model itself is `hand_landmarker.task` (~7.5 MB), served by Google at
  `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`.
  We download it once into `public/models/` so the app is offline-capable.
- Result shape: `landmarks` (21 × {x,y,z} normalized to image size; z is *relative*, wrist-centered,
  smaller = closer, roughly same magnitude as x) and `worldLandmarks` (21 × {x,y,z} **in meters**,
  origin at approximate hand geometric center).

**Decision D1 — host wasm + .task locally.** Copy `node_modules/@mediapipe/tasks-vision/wasm/*` to
`public/mediapipe-wasm/` via a `postinstall` script (reproducible, no committed binaries beyond the
model), and download `hand_landmarker.task` into `public/models/` (7.5 MB, well under the 50 MB
limit). `FilesetResolver.forVisionTasks('/mediapipe-wasm')`, `modelAssetPath: '/models/hand_landmarker.task'`.
Runtime fallback to the CDN only if the local fetch fails (and we surface that in the UI).

**Decision D2 — GPU delegate with CPU fallback.** `baseOptions.delegate: 'GPU'`; on any throw during
`createFromOptions` retry with `'CPU'` and show which one is live in the HUD. GPU delegate over WebGL2
can fail on some drivers/context-loss, so the fallback is not optional polish.

## 2. Hand → three.js interaction (pinch/grab, two-hand scale, depth)

**Codrops, "Creating a 3D Hand Controller Using a Webcam with MediaPipe and Three.js"
(tympanus.net, Oct 2024)** — the closest published working example. Key findings:

- MediaPipe's classic normalized landmarks have **no usable z**; the article estimates depth by
  taking two reference landmarks, projecting them back to screen space and using their apparent
  2D distance as a proxy for camera distance, then `mapLinear` + `clamp` into scene Z. That is the
  same "apparent size ⇒ depth" idea the mission asks for.
- Their mapping to world space is `x → -x + 0.5`, `y → -y + 0.5` (mirror + center) before unprojection.

**Google's own `worldLandmarks` output** (mediapipe docs + geaxgx/depthai_hand_tracker README)
gives meters with the hand center as origin — i.e. a real, model-provided depth channel, including
hand–hand relative distance when two hands are tracked.

**Decision D3 — depth is a fusion, not one trick.**
- Primary: apparent-hand-size depth. Hand scale metric = distance wrist(0)→middle MCP(9) in
  normalized image units; a *bigger* hand is *closer*. Calibrate `S0` at a pose the user is asked to
  hold during the calibration step, then `depth = k / (S/S0)`.
- Secondary/absolute: `worldLandmarks` provides inter-hand distance in meters, which is a much more
  stable signal for **two-hand scaling** than re-derived depth. We use it there.
- Everything goes through a calibrated mapping (a per-axis scale + gain slider, plus a
  "hold both hands up, then touch fingertips" calibration wizard) so we never claim a physical depth
  we do not have.

**Decision D4 — gestures are a separate pure module with hysteresis.** Codrops/p5 examples bury
thresholds in the render loop, which is exactly what produces flicker. We implement
`src/hand/gestures.ts` as pure functions of `(landmarks, previousState) → state`, thresholded with
separate enter/exit values (Schmitt trigger), so it is unit-testable with synthetic landmarks
(no DOM, no webcam).

Pinch: distance thumb-tip(4)↔index-tip(8), **normalized by hand size** (divide by wrist→middle-MCP
length) — required, otherwise a hand close to the camera is always "pinching".
Grab enter ≈ 0.28, release ≈ 0.42 (hysteresis band). Open palm (all tips far from MCPs) = release.
Index-point: tip(8) far from thumb, middle/ring/pinky curled.

**Decision D5 — hand overlay is procedural.** The shipped version draws 21 rounded joints and 21
line segments directly from the landmarks (see D-56); the earlier capsule/sphere mesh idea was
dropped along with the GLB retargeting path because the lines are lighter and clearer over the cell.

## 3. Open-license 3D cell models

- **NIH 3D Print Exchange / 3d.nih.gov**: confirmed open portal for biomedical models, individual
  items under CC licenses **or public domain**; per-item license must be read on the item page
  (AnatomyTOOL and re3data both stress that "the license as stated on that site holds"). NIH 3D now
  exports GLB with per-part visibility, which *would* be usable — but licensing is per-asset, downloads
  need interactive browsing/API, and models are authored for 3D **printing** (fused watertight shells,
  not semantically separable named organelles suitable for runtime isolation/opacity/color edits).
- Sketchbook/Thingiverse "cell" models: mostly "CC-BY-NC" or "some rights reserved", i.e.
  **non-commercial**, which is incompatible with a permissive MIT project and with the user's
  commercial ambitions. Rejected.
- Sketchfab free 3D cell models: typically CC-BY-NC-SA or CC-NC. Rejected on license.

**Decision D6 — procedural cells.** Per the mission's own fallback clause ("if nothing usable exists,
or no model has separable parts, generate procedurally"), we build the cell in three.js with one
**named mesh per organelle**. This gives us: guaranteed license-clean code, exact part separation
(required for isolate/hide/opacity/color/explode and for pulling a single organelle out), zero asset
weight, and morphing headroom for the osmosis deformations (procedural geometry can be deformed
per-vertex; a printed STL mesh cannot be cleanly exploded). Only genuinely CC0 assets are used for
*environment* dressing (HDRI), and everything is logged in `CREDITS.md`.

## 4. Osmosis: what "scientifically correct" means here

Sources: LibreTexts Introductory Biology 2.01 (Osmosis), plant-water-equation articles
(ABLE vol-36, uni-hamburg plant physiology), Varsity Tutors osmosis lesson.

- Water moves across the membrane down its own concentration gradient (from lower solute ⇒ higher
  water potential to higher solute). Net flux driven by ΔΨ.
- Solute potential: **van't Hoff** `Ψs = -i C R T` (i = van't Hoff factor; NaCl ≈ 1.9 for real
  solutions, 2 ideal). Total water potential `Ψ = Ψs + Ψp` (Ψp = pressure/turgor).
- Animal cell / RBC: no wall ⇒ volume follows osmosis until membrane tension limits it; hypotonic ⇒
  swell ⇒ **lysis** past a critical volume; hypertonic ⇒ water leaves ⇒ **crenation** (shrivelled).
  Isotonic (0.9% NaCl for humans) ⇒ stable, dynamic equilibrium.
- Plant cell: rigid wall ⇒ hypotonic water inflow builds **turgor pressure** which counter-balances
  Ψs, so the cell *stops* swelling and **cannot burst** (Ψ → 0 at turgor equilibrium). Hypertonic ⇒
  protoplast shrinks away from the wall = **plasmolysis**; the wall keeps its shape, so the visible
  effect is an internal membrane detaching.
- RBC: same as animal cell but with the classic surface-area-to-volume constraint — it can crenate
  and, in extreme hypotonicity, haemolyse (releasing Hb), which is why it is the clearest demo.

**Decision D7 — simulate a scalar volume ODE, drive the visuals from it.**
`dV/dt = Lp · R · A(V) · ΔΨ(t)` with `ΔΨ = (Ψs_in − Ψs_out) (+ Ψp for plant)`, explicit Euler with a
fixed small timestep, accumulator-based and paused when the tab is hidden. Membrane surface `A(V)`
derived from V (sphere: A ∝ V^(2/3)) so flux realistically slows as the cell swells.
Lysis = V ≥ V_crit (state flag, visual burst); plant wall = elastic Ψp(V) that kicks in above the
wall's rest volume, which *automatically* prevents bursting rather than being a special case.
Tonicity labels (0.2% / 0.9% / 3% NaCl) come straight from the mission brief and map to
physiological reality (hypo / iso / hyper for mammalian cells).
Particles: animated water (blue) crossing the membrane, solute (white/green) blocked by it — count
densities proportional to concentration so the visual matches the numbers. Live V-vs-t graph on a
canvas sparkline.

## 5. Engineering constraints / decisions

- **Webcam security context**: `getUserMedia` needs localhost or HTTPS. Dev on localhost is fine;
  GitHub Pages gives HTTPS for the demo build (mission says optional; we set it up).
- Camera error classes must be distinguishable and shown in UI: `NotAllowedError` (permission
  denied), `NotFoundError`/`OverconstrainedError` (no camera), `NotReadableError`/`InUseError`
  (device in use by another app), plus insecure-context detection.
- **Detection off the render path**: a dedicated rAF-driven loop + Web Worker holding the
  HandLandmarker. Frames go as transferred `ImageBitmap`s (no copy), results come back as typed
  arrays. Render never blocks on inference; if the worker fails to spawn, we run in-thread
  decoupled loop.
- **Never blocking rendering**: worker init is async and the scene renders immediately with a
  "initializing tracking" state.
- **Performance**: mid-range laptop (user's MSI Pulse GL66 / RTX 3050 4 GB / 16 GB RAM), target 60fps.
  Low/high quality toggle: shadow map on/off + resolution, light count, geometry segment counts,
  particle count, DPR clamp, HDRI on/off. Draw calls kept low by merging static lab geometry and
  instancing repeated organelles (ribosomes, mitochondria).
- **WebXR later, not now**: renderer created once, camera owned by an `SceneManager`, and an
  `XRSession` hook point left as a documented no-op stub, so `renderer.xr.enabled` can be flipped on
  without refactoring the hand pipeline (in headset mode the input source pipeline changes but the
  gesture *module* stays identical because it is pure).
- **i18n**: UI strings + organelle metadata in EN with FR available; organelle.json carries
  `{en, fr}` per field, so translation is data, not code.
- Versions pinned (no `@latest`): three `0.186.1`, @mediapipe/tasks-vision `1.1.0`,
  vite `8.3.4`, vitest `5.0.4`, @playwright/test `1.64.0` (checked live on npm, 2026-10-13).
- Tests: vitest unit tests on the pure gesture/depth/filter/osmosis modules with synthetic
  landmarks; Playwright Chromium smoke with `--use-fake-device-for-media-stream` /
  `--use-fake-ui-for-media-stream` asserting zero console errors.

## Open risks / things only the user can verify

1. Real-hand ergonomics: threshold values, gains, and comfort of grab/scale/rotate — I cannot see
   hands, so these are exposed as sliders and shipped with sane defaults from the calibration step.
2. Webcam quality under room lighting and MediaPipe detection distance on *this* machine.
3. GPU delegate availability on this driver (CPU fallback will kick in silently; HUD shows which).
