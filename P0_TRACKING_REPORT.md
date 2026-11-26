# P0 — Real-time hand tracking recovery

Branch: `p0-tracking-recovery` (from `main` at `e9713fc`)
Date: 2026-11-25

**Status: implementation complete; automated gates pass; physical webcam validation outstanding.**
The agent cannot point a real camera at a real hand. Every claim below that depends on human
hardware is marked *pending* and has a protocol in §8. Nothing in this report was measured on the
software rasteriser and presented as real performance.

---

## 1. Root causes

The lag, the disappearing hands and the unclickable controls had separate causes. Fixing one did
not fix the others.

| # | Symptom | Root cause | Evidence (pre-fix) | Fix |
|---|---|---|---|---|
| 1 | Cursor and scene stutter, "crash, crash, crash" | MediaPipe inference ran synchronously inside the `requestAnimationFrame` loop. 56.2 ms p50 / 92.8 ms p95 per detection, 4.7 s of long tasks in 6 s. | Audit §3.1: `app.ts` called `tracker.detect()` from `tick()`; 93 calls / 5,704 ms in 6 s | Inference moved to a module worker; `HandTracker` only posts frames and drains results |
| 2 | Preview capped well below camera rate | The camera clock was the render clock. A slow Three.js frame meant a late capture, and a capture in flight meant a dropped frame. | Audit §3.1 / §3.4 | `FrameScheduler` drives capture from `requestVideoFrameCallback` with a 1 s watchdog and a 16 ms timer fallback; render rate no longer gates capture |
| 3 | Hands vanish mid-gesture; pinch cancels itself | A render tick without a new detection fabricated `lost:true, pinching:false, pinchEnd:last.pinching`. At 14 Hz tracking against 60 fps rendering that was most ticks. | Audit §3.2 | Persist the last pose unchanged inside the tolerance window; emit **one** `present:false` frame after 420 ms; never synthesise a release |
| 4 | Pinch feels late, or fires on its own | Pinch value was computed from smoothed landmarks behind a 70 ms hold, a fist gate and a frame-margin gate; scene selection committed only on release after a further 100 ms hold. | Audit §3.3; `pinch.ts`, `frameProcessor.ts` | Pinch reads **raw** landmarks, `minHoldMs: 0`, `enter 0.55 / exit 0.20`, no fist or margin gate; scene targets commit on `pinchStart`; UI stays on release |
| 5 | Buttons ignore a real pinch | The click's travel budget was measured from the thumb/index contact **midpoint**, which slides ~25–50 px as the fingers close, so the 24 px budget was spent before the hand moved. Rejections were silent. | New: reproduced with the synthetic hand in `handClick.spec.ts` | Press point and travel now use the pointer (`cursor`); rejections are logged as `held-too-long` / `moved-too-far` |
| 6 | Cursor steps instead of gliding | The ring was drawn from the newest detection only: 20–30 Hz motion on a 60–120 Hz display. | `updateCursors()` drew `frame.cursor` verbatim | `CursorMotion` display-only follower (τ 26 ms) advances the ring every rendered frame; hover/aim/pinch keep detection-time positions |
| 7 | Some controls are mouse-only | `ButtonRegistry.hitTest` only knew explicitly registered rects. The selection-test panel, HUD actions and native links were never registered. | `grep .register(` shows 22 registrations against 49 click listeners | Universal fallback: `document.elementFromPoint` → `closest(interactive selector)` → stable `dom:N` entry that calls `element.click()`; disabled elements excluded |
| 8 | Capture cost per frame | 1280×720 was copied to an `ImageBitmap` on every captured frame, 4× the pixels of the reference. | `device.ts` pre-fix profile | 640×480 desktop, 960×540 tablet, 480×360 phone; `?tracker=cpu|gpu` pins the delegate for A/B |
| 9 | Long-run degradation | A machine that cannot hold 30 fps kept the high-quality bloom/shadow path, which made the stutter self-sustaining. | — | One-way 8 s + 5 s guard: high → low, disabled the moment the user picks a quality |

---

## 2. Cellab vs Celly

Cellab is a single-file prototype with no UI clicking, no smoothing and no telemetry. Its
*mechanics* are the reference: async single-flight inference, 640×480, raw landmarks, pinch on
start, persistent hand state.

| Concern | Cellab (`cell-lab.html`) | Celly before | Celly now |
|---|---|---|---|
| Camera | 640×480 | 1280×720 desktop | 640×480 desktop, 960×540 tablet, 480×360 phone |
| Inference | `@mediapipe/hands`, async `send()`, `busy` flag drops frames | Synchronous `detectForVideo` on the main thread, in rAF | `@mediapipe/tasks-vision` in a worker, single-flight, bounded queue of 4, oldest dropped |
| Capture clock | every rAF, gated by `busy` | every rAF, gated by `busy` | `requestVideoFrameCallback` + watchdog, independent of render |
| Hand loss | `if(!lm) s.p=s.g=0` — one miss clears the hand | Fabricated `lost` on every stale tick | 420 ms pose replay, then one explicit lost frame |
| Pinch signal | raw ratio, enter < 0.35, stay < 0.55 | smoothed landmarks, 70 ms hold, fist + margin gates | raw landmarks, enter 0.55 / exit 0.20, no gates, no hold |
| Selection commit | on pinch start | on release after 100 ms hold | scene: pinch start; UI: release |
| Pointer | raw index tip | filtered index tip, drawn at detection rate | filtered tip for aim, eased tip for display |
| UI by hand | none | registered controls only | every native interactive element |
| Telemetry | none | none | HUD + `window.__celly.trackingState()` |
| Scene | 15 parts, no post-processing | 124 meshes, bloom + shadows at high | same scene, one-way auto downgrade |

---

## 3. What changed, by layer

### 3.1 Capture and inference (`frameScheduler.ts`, `handTracker.ts`, `trackingWorker.ts`)

- `FrameScheduler` requests a frame from the camera exactly as fast as the camera produces one.
  A 1 s watchdog and a 16 ms timer cover browsers where `requestVideoFrameCallback` stalls, and
  the HUD's `Capture` field names the active mode (`video-frame` / `timer`).
- `pump()` is single-flight: one frame in the worker at a time. Queue length is bounded at 4 and
  the **oldest** frame is dropped, so inference never works through a backlog of stale images.
- A 1 px capture element stays visible enough for `rVFC` to keep firing. The preview is a native
  `<video>` per panel sharing one `MediaStream`, so preview resolution costs no canvas work.
- `?tracker=cpu` / `?tracker=gpu` pins the MediaPipe delegate without editing code (A/B and
  driver debugging).

### 3.2 Gesture pipeline (`frameProcessor.ts`, `pinch.ts`, `gestureEngine.ts`)

- Pinch value from raw image + world landmarks, hysteresis `0.55 / 0.20`, `minHoldMs 0`.
- Invalid, NaN, low-score and degenerate detections are treated as *absent*, not as a release.
- Scene selection commits on the first active pinch frame with the pre-pinch aim anchor; UI
  clicks commit on release, with a 1500 ms hold budget and 24 px pointer travel budget.
- Rejected clicks are recorded in the pinch log with the budget that failed.

### 3.3 Pointer and interaction (`cursorMotion.ts`, `buttons.ts`)

- The drawn ring eases towards the newest detection at render rate (τ 26 ms); it snaps on a
  >260 px re-acquisition or a >350 ms gap. Aim locks and pinch targets never use the eased point.
- `ButtonRegistry` resolves any unregistered native interactive element through
  `elementFromPoint`, caches one stable `dom:N` id per element, and activates it with
  `element.click()` — so late-added listeners work. Disabled controls and `aria-disabled` are
  excluded; entries for removed nodes are pruned.

### 3.4 Quality guard (`app.ts`)

After 8 s of boot, five sustained seconds below 30 render fps downgrade high → low once. Any
explicit quality choice (mouse or hand) disables the guard for the rest of the session.

---

## 4. Telemetry

`window.__celly.trackingState()` and the debug HUD expose the same numbers:

| Field | Meaning |
|---|---|
| `cameraFps` | frames the camera device reports |
| `captureFps` | frames actually submitted to the worker |
| `previewFps` | frames the visible `<video>` presents |
| `trackerFps` | completed inferences per second |
| `inferenceMs` | worker inference time |
| `resultAgeMs` | age of the newest detection at read time |
| `queued` / `busy` | worker queue depth / single-flight state |
| `captureMode` | `video-frame`, `timer` or `stopped` |
| `rawHands` / `acceptedHands` | detected vs pipeline-accepted hands |
| `droppedFrames` | camera frames the browser dropped |
| `frameAgeP50/P95/Max` | capture → main-thread delivery latency |

`trackingState()` is also what the E2E specs assert on, so the HUD cannot drift from the API.

---

## 5. Verification

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | see §5.1 |
| Lint | `npm run lint` | pass |
| Unit | `npm test` | see §5.1 |
| E2E | `npx playwright test` | see §5.1 |
| Build | `npm run build` | see §5.1 |

### 5.1 Recorded results

*(filled from the final clean run — see the accompanying shell log `test-results/full-e2e.log`)*

The E2E suite runs with Chromium's fake camera. This host has no hardware GL: SwiftShader renders
~1.3–2 fps and a synthetic pinch takes ~600–700 ms of wall clock. Those numbers say nothing about
a real machine and are not quoted as performance. What the suite proves is **behaviour**: the
unregistered close button is hovered through `dom:1` and activated by a pinch, selection still
commits on pinch start, hand loss still retires after the window, DPR and quality paths still work.

---

## 6. Modified files

New:

- `src/tracking/frameScheduler.ts` — camera-clock scheduler.
- `src/gestures/cursorMotion.ts` — display-only cursor follower.
- `tests/unit/frameScheduler.test.ts`, `tests/unit/cursorMotion.test.ts`
- `tests/e2e/handClick.spec.ts` — unregistered native button, hand-only.
- `P0_TRACKING_REPORT.md` (this file), `P0_TRACKING_MISSION.md`.

Modified:

- `src/tracking/handTracker.ts`, `src/tracking/trackingWorker.ts`, `src/tracking/trackingProtocol.ts`
- `src/core/app.ts`, `src/core/device.ts`, `src/core/frameProcessor.ts`, `src/core/strings.ts`
- `src/gestures/gestureEngine.ts`, `src/gestures/pinch.ts`
- `src/ui/buttons.ts`, `src/ui/hud.ts`, `src/ui/onboarding.ts`, `src/ui/webcamPreview.ts`
- `src/styles/main.css`
- `tests/e2e/cameraProfile.spec.ts`, `tests/e2e/trackingWorker.spec.ts`
- `tests/unit/device.test.ts`, `tests/unit/frameProcessor.test.ts`, `tests/unit/gestureEngine.test.ts`

`eslint.config.js` now ignores the untracked `Celly By claude/` nested checkout, which is not
source of this project.

---

## 7. What still cannot be claimed

- **Smoothness on real hardware is unverified.** The software rasteriser cannot measure it.
- **≥95 % pinch success over 30 cycles per hand is unverified.**
- **Zero accidental selections in 2 minutes idle is unverified.**
- **p50/p95 end-to-end latency on real hardware is unverified.**

These are the acceptance criteria of the mission and they need the checklist below.

---

## 8. Hardware validation checklist

### 8.1 A/B protocol (Celly vs Cellab, same camera, same light, same seat)

1. `npm run build && npm run preview` (or the deployed URL). Open `/?tracker=gpu`, press `D` for
   the debug HUD.
2. Record the screen at 60 fps: 30 pinch cycles with the right hand, 30 with the left, then 2
   minutes with hands out of frame.
3. Repeat on `/?tracker=cpu`. Repeat Cellab's `cell-lab.html` on `:5173` with the same 30 cycles.
4. From the recording, count: detected pinches, misses, double-fires, and idle selections.
5. Screenshot the HUD at rest and during motion; note `Camera`, `Capture`, `Preview`, `Raw`,
   `Age`, `Infer`, `Queue`, `Render`.

Pass criteria (mission):

- ≥ 95 % of pinches activate on the first attempt, per hand.
- No cursor or hand disappearance while the hand is in frame.
- No click without an intentional pinch in 2 idle minutes.
- Cursor motion reads as continuous, not stepped, on a 60 Hz display.
- Every visible control (tabs, toggles, quality, language, help, close, restart) activates by hand.

### 8.2 If a criterion fails

Report the HUD line and the pinch log (last 20 attempts, with `reason`) from `window.__celly`.
`held-too-long` means the press budget is too tight for that user; `moved-too-far` means the
pointer moved; a missing entry means the pinch never started (`Raw` vs `Age` will show whether
detections stopped).

### 8.3 Deployment

`npm run build` produces `dist/`; Cloudflare Pages project `celly` serves it. The last verified
deployment before this branch is `c3eede41-63ae-4f04-af00-859a959d0f45` (source `1026e09`); this
branch's build replaces it once validated.
