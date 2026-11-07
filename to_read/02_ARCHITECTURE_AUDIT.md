# 02_ARCHITECTURE_AUDIT.md — Celly v0.2

## Architecture Audit

### Design strengths (still valid)

#### 1. Pure logic separation
Gesture engine, pinch detection, side resolution, filtering are DOM-free and unit-testable. All pass under Vitest in Node without JSDOM or canvas mocking.

#### 2. Single WebGL context
One renderer, one scene, four groups (`labGroup`, `knowledgeGroup`, `testGroup`, `handGroup`). Pages are visibility toggles. Hands persist across navigation.

#### 3. Allocation-free render loop
Scratch vectors reused across frames. `SceneManager.render()` resets `renderer.info` once per frame. Camera framings use lerpVectors.

#### 4. Worker offloading for inference
New architecture moves MediaPipe inference to a dedicated Web Worker with single-flight backpressure: at most one ImageBitmap is in flight at a time. This prevents inference from ever queuing up and blocking the main thread.

**How it works:**
- `trackingWorker.ts` owns the `HandLandmarker`. Receives `ImageBitmap` via transferable messages.
- Main thread captures `createImageBitmap(video)`, transfers ownership to worker.
- Worker runs inference, posts result with `{type:'result', frame, inferenceMs}` back.
- Main thread consumes via `tracker.poll()`. A new result replaces any unconsumed one.
- Import scripts shim handles Vite ES module worker loading of MediaPipe WASM glue.

#### 5. Skeleton hand overlay
Lightweight replacement for GLB rig. Uses `LineMaterial` (via `LineSegments2`) for bones and custom shader material for joints with dark rim + colored core for readability against bright cell membrane/bloom. Constant CSS-pixel point size independent of camera distance.

#### 6. Documented decisions
DECISIONS.md D-01 through D-54+ documented, cross-referenced in code comments.

---

### Architectural weaknesses

#### W-01: No error boundary — CRITICAL (unchanged since v0.2.1)

**Severity: Critical**

```typescript
// src/main.ts — zero error handling
const app = new CellyApp(mount);
app.start();
window.__celly = app;
```

No `try/catch`, no `window.onerror`, no `unhandledrejection` handler. Any crash (Three.js renderer failure, WASM init error, corrupted localStorage, JSON parse error in data files) produces a blank page with no recovery UI.

**Impact:** If the worker's wasm loader fails (e.g., CDN blocked by corporate firewall), `trackingWorker.ts` reports `fatal:true` error → `reject(new Error(...))` → `setTracking('error')` → user sees only "Hand tracking unavailable." The camera stream may still be live but gesture input stops working with no way to retry within the app.

**Recommended fix:** Wrap `CellyApp` construction/start in try/catch. Install `window.onerror` + `unhandledrejection` handlers showing a recovery overlay with "Retry" and "Reload" buttons. See SPEC-01.

**Priority: P0**

---

#### W-02: DECISIONS.md contradiction — D-12 vs Web Worker implementation

**Severity: Medium**

DECISIONS.md D-12 states: *"Tracking on the main thread, not a worker. MediaPipe tasks-vision in VIDEO mode runs synchronously in ~4–8 ms on the target GPU; a worker adds a frame of transfer latency and ImageBitmap copy complexity for no gain at 720p."*

The current codebase explicitly puts inference in a worker (`trackingWorker.ts`). The rationale for keeping things on-main-thread has changed (the skeletal hand overlay needs lower main-thread overhead, the worker was added after the initial design decision). But the documentation hasn't been updated.

**Recommended fix:** Update DECISIONS.md to reflect D-12 supersession. Add a new entry (D-N) documenting why the worker approach was adopted: improved main-thread responsiveness, decoupled inference from rendering frame budget, single-flight backpressure pattern.

**Priority: P3**

---

#### W-03: God object — `CellyApp` (~1253 lines, growing)

**Severity: Medium**

`CellyApp` orchestrates: boot sequence, settings management, camera lifecycle, input binding, frame building from async detections, hover resolution, gesture dispatching, HUD updates, cursor updates, debug overlay, page routing, worker integration, test injection. At 1253 lines and growing (uncommitted work adds detection timing adaptation, lost-frame refinement), it's approaching unmanageable scope.

**Priority: P3**

---

#### W-04: Gesture state simplification removes safety margins

**Severity: High**

Uncommitted changes simplify selection from:
- **Old:** Pinch enter → hold ≥70ms → freeze aim → wait ≥100ms hold → release with ≤36px travel check → commit
- **New:** Pinch enters immediately (minHoldMs=0) → select fires on first active pinch frame → no travel check

The old system had three independent safeguards against misfires: hold time validation, frozen pre-pinch aim anchor, and travel budget rejection. The new system has none of these. Selection fires the instant fingers close above threshold.

This was a deliberate trade-off ("like Cellab"), reducing false negatives (missed selections) at the cost of increased false positives (accidental selections). Whether this trade-off is correct depends on empirical user testing data that we don't have from the audit.

**Priority: P1** — Needs verification before committing to production.

---

#### W-05: No dependency version pinning for CDN fallback

**Severity: Low-Medium**

`trackingWorker.ts` uses `CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'` as fallback when local wasm folder cannot load. This means:
- Dependency on external service availability
- Potential breaking change if jsDelivr serves newer major version
- CORS requirements must be satisfied

The model path is always local (`public/models/hand_landmarker.task`), which is correct. Only the WASM runtime can come from CDN.

**Priority: P3**

---

#### W-06: EffectComposer recreation on quality toggle not implemented yet

**Severity: Medium**

The queued/expected `applyQuality()` optimization (dispose composer, rebuild passes) is NOT present in committed code. Quality toggle (`sceneManager.ts:setQuality()`) calls `applyQuality()` which sets DPR, shadow map enable/disable, bloom enable/disable, dust draw range — but doesn't dispose/recreate the composer. Old render targets accumulate over multiple high→low→high cycles.

**Priority: P2**

---

### Data flow (updated for worker architecture)

```
Camera → video element → createImageBitmap → Worker.postMessage(bitmap, [transfer])
                                                              ↓
                                                    HandLandmarker.detectForVideo()
                                                              ↓
                                                    {hands[], worldLandmarks[]}
                                                              ↓
                                            post({type:'result', frame, inferenceMs})
                                                              ↓
                                                    tracker.pending = frame
                                                    tracker.inferenceMs = ms
                                                              ↓
                                          app.ts: const raw = this.tracker.poll()
                                                              ↓
                                          buildFrames(raw, detectionDt(raw))
         ┌─────────────┬───────────┼──────────────┬──────────────┐
         ↓             ↓           ↓              ↓              ↓
    SideResolver   One-Euro     pinchValue()     cursor()      presence+tolerance
    (label flip)   filters                            (reach gain)
                                                              ↓
                                        HandFrame[] ←→ stepGestures(lastTickMs)
                                                                 ↓
                                            Intent[] → currentPage.onIntent()
                                                                 ↓
                                      skeletonHand.apply(world, pinch, dt, conf)
                                                                 ↓
                                       scene.render(dt) → composer.render()
```
