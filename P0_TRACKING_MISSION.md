# P0 Mission — Celly real-time tracking failure

Status: audit target
Scope: `F:\TKS\BUILD\Celly`
Reference: `F:\TKS\BUILD\Cellab` (read-only)

## 1. Problem statement

Celly's live webcam experience is materially worse than Cellab on the same hardware,
camera, browser, lighting and hand movements. The defects reported by the user are:

1. The webcam preview itself looks delayed and sluggish.
2. Hand landmarks lag behind physical movement.
3. Landmarks repeatedly appear and disappear while the hand is visibly present.
4. The hand skeleton distorts or shows broken geometry.
5. Pinch activates and deactivates unpredictably.
6. Interaction feels delayed, unstable and frustrating.

Cellab, the reference application, shows a live camera feed, detects hands after model
warm-up, follows landmarks smoothly, and pinches responsively with the same camera.

The previous `progress.md`, `AUDIT_HAND_TRACKING_AND_PERFORMANCE.md`, `DECISIONS.md` and
`FINAL_REPORT_ROUND2.md` claim the problem is solved. The user's physical test contradicts
that claim. Passing unit, E2E and build checks is necessary but not sufficient evidence.

## 2. Verified repository and deployment state

- Working tree: clean before this mission.
- Current branch: `main`.
- HEAD: `e9713fc` — `deploy: add wrangler.toml for Cloudflare Pages`.
- Cloudflare Pages project: `celly`, production branch `main`.
- Current production deployment: `c3eede41-63ae-4f04-af00-859a959d0f45`, source `1026e09`.
- `1026e09` differs from `e9713fc` only by the `wrangler.toml` deployment file.
- Live URL verified: `https://celly-epp.pages.dev`.
- The URL in the mission, `https://celly-app.pages.dev`, does not resolve.
- Live `index.html` asset: `assets/index-BYl9Wf_e.js`; the local `dist/index.html` names
  the same asset. The live build is therefore the current local source, not an older
  revision.

## 3. Verified facts about the current implementation

These facts were read from the current code before the audit. They are not assumptions.

### 3.1 Camera preview

`src/ui/webcamPreview.ts` renders the camera image into a 320x180 canvas with
`ctx.drawImage(source, ...)`. Line 64 returns early when
`now - this.lastDraw < 66`, capping preview redraws at about 15 FPS. The same canvas also
draws the landmark skeleton. `WebcamPreview.draw()` is called from the single Three.js
`requestAnimationFrame` loop in `src/core/app.ts` (line 650). The preview therefore
inherits every stall in the 3D render and tracking pipeline.

### 3.2 Camera acquisition

`src/tracking/handTracker.ts` requests, on desktop:

- width 1280
- height 720
- frame rate 30 with a hard `max: 30`
- facing mode `user`
- audio off

Cellab requests only `{ width: 640, height: 480 }` and otherwise accepts the browser
default. It also displays the stream in a native `<video id="vid">` element with
`transform: scaleX(-1)`.

### 3.3 Frame scheduling

`HandTracker.poll()` calls `pump()` on every Three.js render tick. `pump()` checks
`video.currentTime`, calls `createImageBitmap(video)` on the main thread, and transfers the
bitmap to the worker. Single-flight backpressure exists (`capturing`, `inFlight`), but
frame capture is driven by the 3D render loop, not by camera frames. If the 3D render
drops to 20 FPS, capture and result consumption also drop to 20 FPS even when the camera
and worker are ready for 30 FPS.

### 3.4 MediaPipe configuration

`src/tracking/trackingWorker.ts` uses `@mediapipe/tasks-vision` 1.1.0 with:

- `runningMode: 'VIDEO'`
- `numHands: 2`
- `minHandDetectionConfidence: 0.5`
- `minHandPresenceConfidence: 0.5`
- `minTrackingConfidence: 0.5`
- GPU delegate first, CPU fallback

Cellab uses the legacy `@mediapipe/hands@0.4.1675469240` solution with:

- `maxNumHands: 2`
- `modelComplexity: 1`
- `minDetectionConfidence: 0.6`
- `minTrackingConfidence: 0.5`

No controlled GPU-vs-CPU comparison has been recorded on the user's hardware.

### 3.5 Landmark processing

`src/core/frameProcessor.ts` applies a One-Euro filter to every normalized and world
landmark coordinate before building `HandFrame`. The filter defaults are
`minCutoff = 1.2`, `beta = 0.08` (`src/tracking/landmarkFilter.ts`). It also:

- resolves left/right identity with a 150 ms flip debounce;
- keeps the last pose for 250 ms after the last detection;
- emits one `present: false` frame after that window;
- rejects pinch when any of landmarks 0, 4, 8 or 9 leaves a 0.004..0.996 image margin;
- suppresses pinch when `isFist()` reports three or more curled fingers.

Cellab uses raw MediaPipe landmarks with no smoothing, no persistence window and no
visibility gate.

### 3.6 Pinch

Celly computes `1 - smoothstep(0.1, 0.55, distance(4,8) / distance(5,17))`, blends in
metric world landmarks when they agree with the image, then applies enter 0.55 / exit 0.38
hysteresis. Cellab computes `distance(4,8) / distance(0,9)` and applies a single
`was ? < 0.55 : < 0.35` test. Celly's `isFist()` gate can fire on a natural pinch when the
index tip sits closer to the wrist than the index MCP and the other fingers are curled.

### 3.7 Interaction

Celly selects a scene target on `pinchStart`, freezes the pre-pinch aim anchor, and uses a
250 ms hand-loss tolerance. UI buttons click on pinch release. Cellab selects on the
transition into pinch and does not use a pre-pinch look-back or a release hold.

## 4. User's required implementation direction

The mission requires, in priority order:

1. Native, smooth webcam preview with no artificial 15 FPS ceiling.
2. Camera-frame acquisition independent of Three.js rendering.
3. Reliable real-time MediaPipe detection.
4. Accurate, stable landmarks.
5. Natural pinch detection.
6. Responsive 3D hand interaction.
7. No unnecessary processing or latency.

The mission allows replacing parts of the tracking architecture when evidence justifies
it, but forbids a technology migration without comparative evidence. It also forbids
adding smoothing, Kalman filters, extra workers or GPU shaders without a demonstrated
bottleneck.

## 5. Proposed execution plan (the plan under audit)

### Phase 0 — Evidence and diagnostics

1. Add a diagnostic mode that records, per second:
   - camera source FPS, preview FPS, dropped video frames;
   - capture FPS, worker FPS, inference duration;
   - end-to-end frame age from capture to consumed result;
   - raw hands, accepted hands, per-hand detector score;
   - pinch value and pinch start/end transitions;
   - render FPS;
   - p50/p95/max for inference and end-to-end age.
2. Surface the actual worker delegate (GPU or CPU), actual camera settings and actual
   preview element size in the HUD/debug panel.
3. Add `?tracker=cpu` and `?tracker=gpu` URL overrides so the delegate can be compared
   without editing code.
4. Keep a diagnostic ring buffer and expose it through a test hook for Playwright and
   manual inspection.

### Phase 1 — Native camera preview

1. Replace the preview's canvas camera image with a native `<video>` element that plays
   the same `MediaStream`.
2. Mirror the video with CSS `transform: scaleX(-1)` when `settings.mirrorX` is true.
3. Keep a transparent canvas overlay for skeleton and pinch feedback only. Size it to the
   preview's CSS box and draw it at display rate.
4. Remove the 15 FPS throttle from the camera image path.
5. Keep the preview independent of the Three.js render loop: video playback is native and
   the overlay draw must not block it.

### Phase 2 — Camera-frame scheduling

1. Move frame capture out of `poll()`.
2. Use `requestVideoFrameCallback()` when available; fall back to a `requestAnimationFrame`
   check of `video.currentTime` or a bounded timer when it is not.
3. Keep single-flight backpressure: one capture and one worker inference at a time.
4. Drop obsolete frames rather than queueing them.
5. Pass the capture timestamp with each bitmap and preserve it through the worker.
6. `poll()` becomes a drain of completed results only.
7. Dispose or transfer every `ImageBitmap` exactly once.
8. Stop and restart the frame scheduler when the camera or worker lifecycle changes.

### Phase 3 — Camera and model configuration

1. Lower desktop camera constraints to Cellab's proven 640x480 at 30 FPS unless evidence
   shows a better trade-off.
2. Make the MediaPipe delegate observable and switchable.
3. Align confidence settings with Cellab where they affect stability:
   detection 0.6, presence 0.5, tracking 0.5.
4. Record warm-up time and the first-result time.
5. If GPU inference is slower than CPU on the actual machine, default to CPU and report
   the measured difference.

### Phase 4 — Landmark correctness

1. Record raw landmarks, filtered landmarks and rendered skeleton positions side by side.
2. Verify mirroring is applied exactly once across:
   - raw normalized coordinates;
   - world coordinates;
   - pointer mapping;
   - skeleton placement.
3. Reduce or remove One-Euro filtering by default. Match Cellab's raw-landmark behavior
   unless measurements prove filtering is needed.
4. Fix hand identity so a side swap cannot transfer filter state or pinch state to the
   other hand.
5. Shorten the 250 ms persistence window only if it causes visible freezing; never hide a
   hand that the detector is still reporting.

### Phase 5 — Pinch

1. Replace the palm-width + world blend with the simpler and proven Cellab signal:
   `distance(4,8) / distance(0,9)`, with equivalent enter/exit thresholds.
2. Remove the `isFist()` suppression from the pinch path, or restrict it so it cannot fire
   on a natural thumb-index pinch.
3. Remove the image-margin gate that kills an active pinch at the frame edge.
4. Keep hysteresis and immediate selection on pinch start.
5. Log every pinch transition with distance ratio, palm ratio and timestamp for 30
   pinch/release cycles per hand.

### Phase 6 — Verification

1. Run the full automated gate: typecheck, lint, unit tests, E2E and production build.
2. Add unit tests for frame scheduling, bitmap disposal, delegate override, raw-landmark
   mode, pinch transitions and hand-loss behavior.
3. Add an E2E test that the preview uses a `<video>` element and that no canvas
   `drawImage` camera copy exists.
4. Produce a manual hardware test protocol with the seven isolation configurations from the
   mission.
5. Do not declare success until physical webcam results are recorded.

## 6. Out of scope

- Modifying Cellab.
- Rewriting the educational pages, scene content or quiz data.
- Introducing a new inference engine without comparative measurements.
- Adding Kalman filters, extra workers or GPU compute shaders.

## 7. Open risks

- The user's test machine, browser and GPU are not available to the implementation
  environment. Physical measurements must be supplied by the user or performed on the
  target machine.
- A worker GPU delegate may behave differently from Cellab's main-thread legacy solution.
- Lowering camera resolution may reduce detail; it must be validated against the user's
  real camera.
- Removing smoothing may expose detector jitter that the filter currently hides.
- The 3D scene may contend with MediaPipe for GPU resources; diagnostics must separate
  render cost from inference cost.
