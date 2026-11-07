# Celly — hand-tracking reliability and rendering performance audit

Date: 2026-11-02  
Scope: Celly `0.2.2` at commit `4a17a1d`, compared with Cellab `cell-lab.html`.

## 1. Executive summary

Celly’s low frame rate is not primarily a Three.js or DPR problem. The render loop runs at ~100 fps with tracking idle, and ~42 Hz when only the camera/tracker runs. With camera + tracking + render together it falls to ~20 fps because **MediaPipe inference runs synchronously inside `requestAnimationFrame`**, taking **56.2 ms p50 / 92.8 ms p95** on the test machine.

The selection reliability bug is independent: Celly fabricates a `lost` frame with `pinchEnd` on every tick that has no new camera frame, and commits scene selection only on pinch release after a 100 ms hold. A dropped detection therefore cancels an in-flight selection or turns a finger release into a synthetic release. Cellab does the opposite: it keeps hand state between detections and selects immediately on pinch start.

| Measure | Celly | Cellab |
|---|---:|---:|
| Inference p50 | 56.2 ms | n/a (async) |
| Inference p95 | 92.8 ms | n/a |
| Inference calls in 6 s | 93 | continuous, single-flight |
| Time inside inference, 6 s | **5,704 ms** | off main thread / async |
| Camera-on render | **~20 fps** | **30.3 fps** |
| Tracker throughput | 14–15 Hz | camera rate |
| Long tasks in 6 s | 74 / **4.7 s** | 5 / **386 ms** |
| Render only | 100 fps | n/a |
| Tracking only | 42 Hz | n/a |

The first fix (B) is small and ships reliability without architecture risk. The second (A) moves inference into a dedicated worker and removes the per-frame layout/pick costs that remain after the main thread is free.

## 2. Benchmark environment and method

- Intel UHD integrated GPU, Chromium, Windows.
- 1440×900 viewport, DPR 1 for controlled comparison, fake camera stream.
- Celly measured through its own test hooks / PerformanceObserver:
  - `renderedFrames` for render throughput.
  - `longtask` entries for main-thread stalls.
  - MediaPipe call duration wrapped around `detectForVideo`.
- Cellab measured with the same browser/machine, camera on, default quality.
- Scene inventory measured from `SceneManager.renderStats` and `CellModel`:
  - 15 parts, 69 pick anchors, 69 proxies.
  - 124 meshes, 58 materials (19 transparent), 79,270 triangles, 80 draw calls.
  - 23 textures, shadows enabled in high quality, Unreal bloom enabled.
  - Renderer DPR can reach 2 (`device.ts` / `preferredQuality`).

### Benchmark isolation table

| Configuration | Result | Conclusion |
|---|---:|---|
| Render only, tracker off | ~100 fps | Three scene is not the bottleneck. |
| Tracker only, render paused | ~42 Hz | Camera + MediaPipe alone cap tracking. |
| Camera on, low quality | ~20–22 fps | Quality reduction cannot compensate for a 56 ms main-thread block. |
| Camera 720p → 480p | still ~14 Hz | Model pre-processing resize dominates, not camera resolution. |
| Render disabled, camera on | 42 Hz | GPU contention with rendering contributes, but the main-thread block dominates. |

## 3. Root causes, ranked

### 3.1 Synchronous MediaPipe inference in `tick()` — primary performance bug

Evidence:

- `src/core/app.ts:594–600`: `tracker.detect()` is called directly from the RAF loop.
- `src/tracking/handTracker.ts:206–247`: `detect()` calls `lm.detectForVideo(video, ts)` synchronously.
- Measured 93 calls / 6 s, 5,704 ms inside inference.
- 74 long tasks / 6 s, 4.7 s total, exactly mirroring inference occupancy.

Consequence: every detection blocks rendering, DOM writes, gestures and input. No amount of DPR, shadow or bloom tuning fixes a 56 ms block.

Fix: move `HandLandmarker` into a module worker, transfer a `ImageBitmap` per camera frame, allow one in-flight detection, and consume the newest result from the RAF loop without waiting for it.

### 3.2 Fabricated loss frames — primary reliability bug

Evidence:

- `src/core/app.ts:552–576`: when no new camera frame exists, Celly copies the last `HandFrame`, sets `lost: true`, `pinching: false`, `pinchValue: 0`, `pinchStart: false`, `pinchEnd: last.pinching`.
- At 14 Hz tracking vs 60 fps rendering, this happens on most ticks.
- `src/gestures/gestureEngine.ts:161–167`: `lost` clears `selectCandidate`.
- `src/gestures/gestureEngine.ts:222–285`: selection is only committed on `pinchEnd` after `selectionHoldMs`.

Consequence: a pinch can be cancelled by the next stale tick before the user releases; a hand that is merely not re-detected yet is treated as an intentional release.

Fix:
- Persist the last frame unchanged between detections, with no `lost` / `pinchEnd`.
- Emit exactly one `lost` transition only after 250 ms without a detection.
- Preserve aim locks while the hand is inside the tolerance window.

### 3.3 Release-only selection with a 100 ms hold — interaction latency

Evidence:

- `DEFAULT_GESTURE.selectionHoldMs = 100`, `DEFAULT_PINCH.minHoldMs = 70`.
- `app.ts:646–653` freezes scene hover during pinch, but selection waits for release.
- Cellab `cell-lab.html:110–122` updates gesture state and selects on pinch start; release does not gate a scene selection.

Consequence: users feel a ~170–250 ms confirmation delay, and a lost hand during that window cancels the selection sentiment.

Fix: commit scene selection on `pinchStart`, keep UI button clicks on release, set pinch hold to zero, and keep the pre-pinch aim anchor for the emitted intent.

### 3.4 Per-frame picking and layout reads — remaining CPU/render cost

Evidence:

- `InteractiveLabPage.pick()` (`src/pages/interactiveLab.ts:593–621`) projects every one of **69 pick anchors twice** (`projectToScreen` for center + radius) and calls `camera.updateMatrixWorld()` each frame while a hand hovers.
- `SceneManager.projectToScreen()` (`sceneManager.ts:449–457`) reads `renderer.domElement.getBoundingClientRect()` on **every** projection: 138 layout reads per frame at 17 fps → measured **318 `getBoundingClientRect` in 6 s** from the overlay path alone, before pick projections are counted separately.
- `app.ts:766` calls `overlay.bounds()` every frame; `cursorLayer.ts:100–101` reads `offsetWidth/offsetHeight` every frame.
- `cellModel.update()` calls `root.updateWorldMatrix(true, true)` unconditionally; it also updates every visual part (hover/selection lerps, shader time, bob) even when nothing changed.
- 69 invisible proxy meshes + 69 anchors in a 124-mesh scene.
- `overlay.place()` (`ui/overlay.ts:182–246`) reads rail/controls/offsetHeight and writes width/left/top on every call; it is called from `update()` every 60 ms while an overlay is open.

Fix:
- Cache canvas rect in `SceneManager`, invalidate on resize.
- Build a screen-space pick table once per frame (or at ~30 Hz) and reuse it; do not project 69 anchors per call.
- Avoid `updateWorldMatrix(true,true)` when nothing changed; update once per frame before projection.
- Throttle overlay anchor updates to ~15–20 Hz and only write styles when values change.
- Cache hint dimensions.
- Cap DPR to 1.5 on integrated/mobile and simplify shadow/bloom defaults.

### 3.5 Startup cost — 20 MB before first interaction

Evidence from `dist/`:

- `vision_wasm_internal.wasm`: 12.7 MB.
- `hand_landmarker.task`: 7.6 MB.
- `three` chunk: 604 KB.
- main chunk: 272 KB; CSS: 52.9 KB.

The wasm/model are fetched on camera start, not necessarily on page load, but there is no progress UI and no preload/prefetch hint. The onboarding can appear before the tracker is ready.

Fix: prefetch model/wasm while onboarding is open, show progress, and only start inference after the worker reports ready. Keep the model local; CDN fallback remains.

## 4. Cellab reference behaviour to copy

`F:\TKS\BUILD\Cellab\cell-lab.html`:

- Line 110: persistent `st[]` state for both hands.
- Lines 111–119: pinch enter < 0.35, release > 0.55; rotation gain 7; zoom gain 4.
- Line 122: `if(!busy){ busy=true; H.send({image:v}).then(()=>busy=false) }` — async, single-flight, newest-frame backpressure.
- Line 126–129: render loop is separate and never owns inference.
- Line 68: simple renderer settings; shared geometry/materials (lines 84–85).

Celly already has a better scene, aim filtering, two-hand semantics and tests. We should copy the **architecture and gesture semantics**, not the old three.js/MediaPipe versions.

## 5. Remediation plan

### Phase B — reliability quick fix (ship first)

1. Persist last hand state across detection gaps; never synthesize `pinchEnd`.
2. Emit one `lost` after 250 ms, then let the hand retire.
3. Preserve aim locks inside the tolerance window.
4. Select scene targets on pinch start; keep UI clicks on release.
5. Set pinch `minHoldMs` to 0 and remove release-hold gating.
6. Update gesture hint text and unit/e2e expectations.

Acceptance:
- A scene target is selected on the first active pinch frame.
- No selection can be cancelled by a stale/lost tick.
- No synthetic pinch release is generated.
- `typecheck`, `lint`, unit and e2e pass.

### Phase A — worker + performance pass

1. Add `src/tracking/trackingWorker.ts` with MediaPipe `HandLandmarker`, GPU → CPU fallback, `init`/`frame`/`dispose` protocol.
2. Rewrite `HandTracker` to:
   - own camera lifecycle;
   - initialize the worker;
   - pump at most one `ImageBitmap` at a time (`busy` backpressure);
   - expose `poll()` for latest result and `trackerFps`;
   - fall back to in-page inference only if worker creation/init fails.
3. Remove inference from `tick()`; consume `poll()` once per RAF.
4. Add a worker/CPU health detail and startup progress.
5. Optimize picking: canvas rect cache, one projection table per frame, no per-call `getBoundingClientRect`.
6. Optimize overlay/cursor layout: cached rects/dimensions, 15–20 Hz overlay updates, write-on-change.
7. Tune device defaults: DPR cap, shadows/bloom policy, low-quality thresholds.
8. Avoid unconditional full world-matrix updates and idle part updates where safe.
9. Re-run isolated and combined benchmarks; record before/after.

Acceptance:
- Camera-on UI ≥ 50 fps on the test machine (or documented host limit), with no long task > 50 ms attributable to inference.
- Inference runs off the main thread; tracking remains ~15–30 Hz independent of render.
- Selection latency = one detection frame + one render frame.
- Unit/e2e/typecheck/lint/build pass.
- `progress.md` contains before/after measurements and every file/behaviour change.

## 6. Risks and guardrails

- **Worker + MediaPipe**: `OffscreenCanvas`/WebGL availability differs. Try GPU, fall back to CPU in worker, then in-page fallback. Never leave the app stuck if worker init fails.
- **ImageBitmap transfer**: create from the video element on the frame that a detection starts; close it in the worker after inference and on errors.
- **Handedness**: worker posts raw landmark + handedness data, main thread keeps side resolver, filters and gesture semantics unchanged.
- **Timestamp monotonicity**: worker owns a monotonic timestamp per detection.
- **Tests**: e2e uses injected frames and must not depend on camera timing; unit tests should assert immediate select and blank unselect.
- **Reduced motion / low quality**: keep existing visual intent; no feature removal.
- **No silent regression**: run the full suite after B and after A.

## 7. Evidence index

- `src/core/app.ts:552–600` — fake lost frames, sync detect in tick.
- `src/gestures/gestureEngine.ts:161–167, 222–285` — lost cancels selection, release-only commit.
- `src/gestures/pinch.ts:18` — `{ enter: 0.55, exit: 0.38, minHoldMs: 70 }`.
- `src/tracking/handTracker.ts:206–247` — sync `detectForVideo`.
- `src/pages/interactiveLab.ts:593–621` — 69 anchors × 2 projections.
- `src/scene/sceneManager.ts:449–457` — rect read per projection.
- `src/scene/cellModel.ts:766+` — finalize/update/pick anchors.
- `src/ui/overlay.ts:182–246` — layout-thrashing `place()`.
- `src/ui/cursorLayer.ts:97–108` — per-frame hint measurement.
- `dist/assets/*` — wasm/model/chunk sizes.
- `F:\TKS\BUILD\Cellab\cell-lab.html:110–129` — async send loop, persistent state, immediate selection.
