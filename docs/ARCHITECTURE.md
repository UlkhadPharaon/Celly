# Architecture — Celly v0.2

How the shipped application is put together. For *why* each choice was made, see
[`../DECISIONS.md`](../DECISIONS.md); for the research that preceded it, see
[`RESEARCH.md`](RESEARCH.md).

## 1. Principles

1. **One renderer, one scene, one camera.** Pages are groups inside a single `THREE.Scene`; the 3D
   hands and the environment persist across navigation. Switching sections never re-creates the
   WebGL context.
2. **Pure logic is DOM-free.** Pinch detection, the gesture state machine, side resolution,
   filtering, scoring and the Leitner scheduler are plain TypeScript with no DOM/Three imports, so
   they run under Vitest in Node.
3. **DOM for text, WebGL for space.** Organelle overlays, quizzes, the HUD and labels are HTML:
   selectable, translatable, announced by screen readers and cheap to lay out. Only the cell,
   graph, hands and particles are rendered in 3D.
4. **The frame loop is the only clock.** Tweens, damping, camera moves and quality updates are all
   driven by the same `dt`; nothing schedules its own `setTimeout` for animation.
5. **Tracking never blocks rendering.** Inference runs once per camera frame; the render loop reuses
   the latest result.

## 2. Module map

```
src/
  main.ts                 boot: fonts, CSS, CellyApp, window.__celly
  types.ts                shared domain types (no DOM, no Three)
  core/
    app.ts                orchestrator: loop, frames, hover, intents, pages, settings, HUD
    store.ts              reactive Store<T> + versioned localStorage helpers
    tween.ts              cancellable numeric/vector tweens with easing
    math.ts               clamp, lerp, damp, distances, seeded RNG helpers
    events.ts             tiny typed emitter used by UI and pages
    device.ts             phone/tablet/desktop budgets, DPR caps, camera constraints
    replayHand.ts         synthetic 21-landmark hand for tests and screenshots
  tracking/
    handTracker.ts        getUserMedia, HandLandmarker (GPU→CPU), detect(), axis conversion
    landmarkFilter.ts     One-Euro filter per landmark
    handSide.ts           MediaPipe label flip, manual swap, slot matching, 150 ms debounce
    quality.ts            0–100 score from confidence, size, margin and jitter
  gestures/
    pinch.ts              ratio-based pinch value, fist rejection, hysteresis, 70 ms hold
    gestureEngine.ts      state machine → Intent[]; knows nothing about pages or Three
    cursor.ts             cursor descriptors shared by the engine and the UI
  scene/
    sceneManager.ts       renderer, camera, bloom, framings, environment, dust, quality modes
    cellModel.ts          procedural cell, 15 organelles, picking, isolation, selection halo
    knowledgeScene.ts     nodes, labels, edges, focus transform, picking
    knowledgeLayout.ts    deterministic seeded 3D force layout
    lowPolyHand.ts        generated 21-bone skinned hand mesh (default source)
    handMath.ts           palm basis, quaternion deltas, joint-angle metrics, scratch helpers
    handRig.ts            GLB/low-poly retargeting, procedural fallback, DrivenHand interface
    handLayer.ts          wrist→world placement, mirroring, scale cue, feedback
    shapes.ts             geometry factories shared by organelles
    textures.ts           procedural canvases (speckle, glow, cristae, grain…)
    types.ts              scene-side shared types
  pages/
    page.ts               Page / PageContext / PageActions contracts
    interactiveLab.ts     lab page: rail, selection, overlay, scale clamps
    knowledge.ts          graph page: focus, hops, camera framing, cross-links
    testing/
      testingPage.ts      home, MCQ, flashcards, results, review
      leitner.ts          1–5 box scheduler + persistence
      progress.ts         best score / attempts + grading labels
  ui/
    shell.ts              top bar, legend, toast, page layer, auto-rotate control
    tabs.ts               3-section navigation
    hud.ts                telemetry panel (hands, pinch, quality, FPS)
    overlay.ts            anchored info card + placement logic
    controlPanel.ts       webcam preview, mirror/swap, language, quality, accessibility
    onboarding.ts         3-step first-run flow + camera error states
    cursorLayer.ts        virtual cursors, pinch rings, hints (DOM)
    webcamPreview.ts      mirrored preview + landmark debug canvas
    buttons.ts            registry: gesture hit-testing, hover/press/dwell state
    dom.ts                el(), escapeHtml(), inline SVG icon set
  data/
    catalog.ts            typed exports + lookups + question helpers
    organelles.json       15 organelles, bilingual
    knowledge.json        36 nodes, bilingual
    questions.json        48 MCQ + 36 flashcards + 3 sets, bilingual
    cells.json            v0.1 cell metadata retained for reference
  styles/main.css         tokens, glass, grain, layout, cursor, responsive rules
```

## 3. Boot

```
main.ts
  └─ new CellyApp(#app)
       ├─ Shell (top bar, tabs, HUD, legend, control panel, cursor layer, overlay)
       ├─ SceneManager (renderer, camera, environment, bloom)
       ├─ HandTracker (lazy: only after the user enables the camera)
       ├─ HandLayer → loadHands() (generated low-poly default; GLB opt-in; procedural fallback)
       ├─ pages: InteractiveLab, KnowledgePage, TestingPage
       ├─ setPage('interactive', animate: false)
       └─ start(): requestAnimationFrame(loop)
```

On a first visit, `Onboarding.open()` runs before the camera is requested. The onboarding "Enable
camera" path calls `startCamera()`; the "Continue with mouse" path skips the tracker entirely. The
camera is also started automatically after onboarding if permission was already granted.

## 4. Frame loop

```
loop(now)
  dt = clamp((now - lastTime) / 1000, 0.0001, 0.05)
  tick()
    if synthetic hands are injected:
      frames = replay frames; updateHover(); stepGestures(); clear pinch edges
    else:
      raw    = tracker.ready ? tracker.detect() : null
      frames = buildFrames(raw, dt)
      updateHover()
      stepGestures(raw?.tMs ?? now)
      update dwell state on the button registry
  hands.update(frames, settings, dt, camera)
  currentPage.update(dt, elapsed)
  webcamPreview.draw(frames, settings)  // ~15 Hz, skipped while the preview is hidden
  updateCursors()
  updateHud(now)          // throttled to ~10 Hz
  scene.render(dt)        // reset renderer.info once per frame
```

`buildFrames()` is where raw detections become `HandFrame`s:

1. side resolution (`HandSideResolver`) with the label flip and user swap;
2. per-landmark One-Euro filtering (normalized and world);
3. pinch value, fist check and hysteresis (`updatePinch`);
4. cursor (thumb/index midpoint) in CSS pixels and NDC, palm point for rotation;
5. presence and a 250 ms tolerance for momentary detection drops.

`updateHover()` resolves two independent targets: a DOM button id from the `ButtonRegistry`
(hit-testing the real button rectangles) and a scene id from `page.pick(x, y)`. UI wins: while the
cursor is over a button, the scene under it is not hovered.

`stepGestures()` builds a `GestureContext` and calls `GestureEngine.step()`. The returned `Intent[]`
is dispatched to the active page, except `click`, which goes through the button registry, and
`hover`, which only updates chrome.

## 5. Tracking

| Stage | Detail |
|---|---|
| Camera | `getUserMedia({ video: device profile ideal, facingMode: 'user' })`: 1280×720 @ 30 desktop, 960×540 @ 30 tablet, 640×480 @ 24 phone |
| Model | `HandLandmarker`, `runningMode: 'VIDEO'`, `numHands: 2`, GPU delegate → CPU retry; the live delegate is reported honestly |
| Runtime | `public/mediapipe-wasm`, `public/models/hand_landmarker.task` (self-hosted) |
| Timing | `requestVideoFrameCallback` when available, otherwise `requestAnimationFrame` |
| Axes | MediaPipe world landmarks are image-aligned (y down, z toward −camera); converted once to y-up / +z toward the viewer |
| Filter | One-Euro with per-axis min-cutoff and beta; raw values stay available to the debug view |
| Sides | `Left`/`Right` flipped once (selfie assumption), then `handsSwap`; slots matched by nearest wrist; label changes debounced 150 ms; a lost hand starts a fresh slot |
| Quality | weighted confidence, hand size, frame margin and motion jitter → 0–100 + Good/Medium/Poor |

Callback latency, not inference, dominates perceived lag; the filter's beta is tuned so a deliberate
pinch is not rounded away.

## 6. Gestures

`pinch.ts` computes a dead-zoned palm-width ratio

```
r     = |tip[4] - tip[8]| / |mcp[5] - mcp[17]|
pinch = 1 - smoothstep(0.10k, 0.55k, r)
```

The normalized image landmarks drive the ratio; world landmarks are averaged in only when their
ratio is within 0.18 of the image ratio, so a noisy metric z can never break the gesture. `k` is the
user's sensitivity (0.7–1.5, Firm 0.8 / Normal 1.0 / Light 1.3), stored with the other settings.
Real pads touch with the landmark centres still ~2 cm apart, which is why the dead zone exists. A
fist (each fingertip closer to the wrist than its MCP) is rejected. `updatePinch()` implements enter
`> 0.55`, exit `< 0.38` and a 70 ms minimum hold; it returns `start`/`end` edges. `candidateSince`
uses **−1** as "no candidate" so a clock starting at 0 works.

Cursor mapping applies a reach gain before NDC conversion: the middle 84 % of the camera frame is
mapped to the full screen (`reach()`, 8 % → 0, 92 % → 1), with `unreach()` as its inverse for
synthetic hands. This keeps the edges of the UI reachable without leaving the frame; the 3D hand is
anchored to the same mapped cursor, so hand and pointer stay together.

`gestureEngine.ts` is a pure reducer. It receives hands, hover targets, page capabilities (swipe,
rotate, scale, dwell) and time; it returns the state, a hint, dwell progress, cursor descriptors and
intents. Rules:

- **Right pinch on a scene id** → `select`; on empty space → `unselect`.
- **Right pinch on a UI id** → click candidate; on release within 500 ms and 24 px → `click`.
- **Pinch + horizontal drag in empty space** → `swipe` move/end when the page enables it.
- **Left pinch + palm movement** → `rotate` (gain 7); active even while the right hand hovers.
- **Both hands pinching** → `scale`, ratio against the distance at gesture start, 0.35 lerp,
  clamped by the page. Two hands override rotate and suppress select.
- **Cooldown** — 150 ms after a two-hand gesture, no select/click can fire.
- **Hand loss** — when the primary hand disappears, click/swipe/rotate state is cleared and the
  engine returns to `IDLE`.

Intents are a closed union (`select`, `unselect`, `click`, `rotate`, `scale`, `swipe`, `hover`,
`state`), so pages implement `onIntent()` without importing the engine.

## 7. Scene

`SceneManager` owns the renderer (ACES tone mapping, sRGB, device-aware antialias), the perspective
camera, the composer (`RenderPass` → `UnrealBloomPass` → `OutputPass`), a procedural PMREM
environment, the lab floor/rings and the ambient dust. `deviceProfile()` supplies resolution,
geometry and camera budgets once, before the renderer is created:

| | Phone | Tablet | Desktop |
|---|---|---|---|
| Default quality | low | low | high |
| DPR cap (high / low) | 1.5 / 1 | 1.75 / 1 | 2 / 1 |
| Shadows / bloom | off / off | high only / high only | high only / high only |
| Dust / floor / ring | 120 / 48 / 96 | 220 / 64 / 128 | 420 / 96 / 180 |

The dust is a `ShaderMaterial` `Points` field: drift, wrap and a circular sprite are evaluated in
the vertex/fragment shader from `uTime`, so the 60 fps loop never rewrites or uploads positions. The
renderer runs with `info.autoReset = false`; `render()` resets it once and `renderStats` reports the
last frame (quality, device class, DPR, calls, triangles, points, geometries, textures, shadows,
bloom). Camera look-at vectors and projection scratch objects are reused.

It exposes three framings and tweens between them when pages change:

| Page | Camera position | Target | FOV |
|---|---|---|---|
| Interactive | `(0, 0.14, 7.15)` | origin | 42° |
| Knowledge | `(0, 0.85, 16.4)` | slightly above origin | 42° |
| Test | `(0, 0.4, 10.6)` | origin | 42° |

The cell rig is a nested transform:

```
rig (user rotation)
 └─ zoom (user scale)
     └─ focus (selection position tween)
         └─ contentRoot (selection scale tween)
             └─ organelle groups (named, raycastable)
```

Selection sets `focus`/`contentRoot` so the chosen organelle sits at the origin at a comfortable
size; unselect tweens back to the saved transform. Non-selected parts are ghosted through material
opacity, not hidden, so the cell keeps its spatial context.

Picking is a single raycast down the cell tree. Hits are ranked by specificity
(`membrane 0 … nucleus 4, ribosome 5, everything else 6`) with the nearest hit breaking ties, which
prevents the membrane and nuclear envelope from swallowing every pick.

The knowledge graph has its own root (`knowledgeGroup`), nodes as emissive spheres, billboard label
sprites and a single `LineSegments` buffer for edges with an animated time uniform. Focus tweens the
root, dims non-neighbours and restricts picking to the focused node's neighbours.

## 8. Pages

Every page implements `Page` (`src/pages/page.ts`):

```ts
interface Page {
  id: PageId;
  root: HTMLElement;
  enter(): void;                 // show the DOM, start tweens, set page capabilities
  exit(): void;                  // hide, cancel tweens, close overlay
  update(dt, elapsed): void;     // per-frame page animation
  onIntent(intent): void;        // select / unselect / rotate / scale / swipe
  pick(x, y): string | null;     // raycast from CSS pixels
  setHovered(id): void;          // highlight
  setLanguage(lang): void;
  setAutoRotate?(value): void;
  closeOverlay(): void;
  dispose(): void;
}
```

Pages receive a `PageContext` with the scene, button registry, shared overlay, shell, settings and
cross-section actions (`openLab`, `openKnowledge`, `openTest`, `toast`). The router is
`CellyApp.setPage()`: it calls `exit()` on the old page, `enter()` on the new one, tweens the camera,
updates the tabs and the auto-rotate control, and keeps the hands mounted.

## 9. Hands

`HandLayer` owns one `DrivenHand` per side. Each frame it

1. maps the wrist's normalized position to a world point on the camera ray at the fixed hand
   distance, so the projected wrist is exactly the tracked wrist;
2. damps only the scale (wrist→middle-MCP span, clamped) — position is assigned directly because
   the One-Euro filter has already removed camera noise;
3. passes the **unmirrored** world landmarks to the rig; `mirrorX`/`mirrorY` are screen-position
   transforms only;
4. applies the 21-joint retarget and updates the pinch glow, landmark markers and feedback.

`loadHands()` returns a generated low-poly skinned hand by default. Each hand is one mesh
(1,149 vertices) bound to 21 bones; `createLowPolyHand()` updates the armature world matrices before
constructing `THREE.Skeleton` and binding, so bone inverses are real and the palm/fingers stay
connected. `?hands=glb` opts into the authored `hands_rigged.glb` (mapped by `00_WRIST …
20_PINKY_TIP`); if that load fails the generated low-poly hand is used, and if generation fails too
the procedural glass hand takes over. All three implement `DrivenHand`, so the selection pipeline,
debug view and gesture engine do not know which is active.
Hot-path palm-basis and per-finger metric helpers use reusable out-parameters rather than allocating
per frame.

## 10. Data and persistence

Content is JSON imported at build time and typed in `catalog.ts`, which also exposes maps
(`ORGANELLE_BY_ID`, `KNOWLEDGE_BY_ID`, `MCQ_BY_ID`), localization (`loc`), and question helpers
(`shuffled`, `prepareQuestion`). There is no runtime fetch and no content CMS.

| Key | Contents |
|---|---|
| `celly:v02:leitner` | `{ [flashcardId]: { box, lastSeen, correct, wrong } }` |
| `celly:v02:progress` | `{ best: { [quizKey]: ratio }, attempts, lastPlayed }` |
| `celly:v02:settings` | language, mirror, swap, quality, reduced motion, high contrast, auto-rotate, dwell |
| `celly:v02:onboarded` | onboarding completed flag |

`loadJSON`/`saveJSON` swallow storage failures (private mode, quota), so the app degrades to a
session-only experience instead of throwing.

## 11. DOM layering and input ownership

```
#app
 └─ .stage            canvas (WebGL)
    ├─ .grain / .vignette
    ├─ .page-layer     page DOM (lab rail, knowledge hints, test cards)
    ├─ .topbar         brand, tabs, auto-rotate, help
    ├─ .left-rail      HUD + gesture legend  pointer-events: none
    ├─ .controls       preview + settings
    ├─ .overlay-anchor info card
    ├─ .onboarding     first-run flow
    └─ .cursor-layer   cursors + hints    pointer-events: none
```

Only real controls receive pointer events. The HUD and legend opt out entirely, so they can overlap
the scene — or a page card — without stealing a click. They share one flex-column rail so the legend
follows the HUD when it grows instead of being pinned at 50 % of the viewport; on viewports shorter
than 860 px and on the Test page the legend collapses to its header. The cursor layer is purely
visual.

At ≤1080 px the control panel becomes a centred bottom sheet (`max-width: 560px`) with a 78 px
collapsed header and a scrollable open state. Its header is sticky, its internal grid uses
`grid-auto-rows: max-content`, and its background is nearly opaque with no backdrop blur to avoid a
large mobile-GPU compositing cost. The panel keeps a fixed open height (`min(74dvh, 620px)`) and
slides between collapsed and open with a composited `transform`; `max-height` is deliberately never
animated, because that re-lays out the panel on every frame and can stall when the WebGL loop
saturates the main thread. Open/close also toggles the webcam preview's visibility and redraw flag. The sheet toggle (and every sheet control) is registered with the
gesture `ButtonRegistry`, so pinch can open and use it. The structure rail is drawn above the
collapsed peek; `Overlay.place()` measures the sheet's live rect and reserves that band. Safe-area
insets pad the topbar, sheet, test shell, onboarding and toasts. At ≤820 px the left HUD rail is
hidden. The webcam preview is only drawn while the sheet is open.

Mouse fallback: pointer movement drives the same hover/raycast path; clicks are dispatched through
the button registry; drag rotates and the wheel scales. Gesture and pointer input therefore share
one intent pipeline.

## 12. Test hooks

`window.__celly` exposes the app for Playwright and the screenshot harness:

| Member | Purpose |
|---|---|
| `injectHand(side, x, y, pinch, present)` | Build a synthetic 21-landmark hand and run it through the real pipeline |
| `clearInjectedHands()` | Remove synthetic hands and reset gesture state |
| `sceneAnchor(id)` | Project a scene element's world position to CSS pixels |
| `debugHand(side)` | Container/wrist/scale diagnostics, rig source and skin audit |
| `renderStats` | Quality, device class, DPR, calls, triangles, points, textures, shadows/bloom |
| `state` | Page, hands, hover, pinch, tracker and renderer snapshot |

Injected hands are built in `replayHand.ts` from the same anatomical model the filter and rig expect,
including the inverse mirror transform, so the cursor lands exactly on the requested pixel. E2E and
screenshots therefore exercise real hover, real pinch hysteresis and real intents.

## 13. Extension points

- **New organelle**: add a builder in `cellModel.ts`, an entry in `organelles.json`, a colour and a
  pick priority if it is a shell.
- **New knowledge node**: append to `knowledge.json` with links; the layout is seeded and will place
  it deterministically. No code change.
- **New quiz mode**: implement `onIntent` + a render function in `testingPage.ts`; scoring helpers
  and persistence already exist.
- **New gesture**: extend the `Intent` union, handle it in `gestureEngine.ts`, and implement it in
  the pages that support it. The engine stays page-agnostic.
- **New renderer effect**: add a pass in `sceneManager.ts`; quality modes can skip it.
