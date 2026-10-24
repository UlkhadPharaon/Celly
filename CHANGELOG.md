# Changelog

All notable changes to Celly. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the project uses `MAJOR.MINOR.PATCH` with a `v0.2` product label.

## [0.2.1] — 2026-10-24

A real-device pass: the synthetic hand pinched to a geometric zero, which hid everything a physical
hand does differently. Pinch now saturates on a natural pad-to-pad contact, the pointer reaches the
screen edges, and the left overlays no longer collide. A second pass then fixed the hand rig and the
selection pipeline at their root causes (see `DIAGNOSIS_ROUND2.md`).

### Added

- **Pinch sensitivity** — Firm / Normal / Light in the control panel, persisted with the other
  settings and included in the control-state snapshot.
- **Reach mapping** — the middle 84 % of the camera frame drives the full viewport; the usable box
  is shown in the webcam preview and the onboarding hands check.
- **Camera-distance guidance** — the hands check now asks for 60–80 cm at eye level.
- **Realistic pinch regression** — a touching-but-offset hand, plus a case where metric world z is
  deliberately wrong and the 2D ratio must win.
- **Hand-selection debug view** — `D` toggles raw/filtered/locked cursors, the pick radius, the
  armed target, the rig rest/angle/skin readout and the last 20 pinch events.
- **Built-in Selection test** — `T` runs ten organelles through the real pinch pipeline and reports
  hit rate and mean aim error. The final run is 10/10 with 0.5 px mean error.
- **Deterministic hand pose suite** — open, fist, pinch, point, peace, thumbs-up, OK, spread, wiggle,
  slow wrist rotation, palm, back and fast movement; 14 replay fixtures and screenshots in
  `docs/screenshots/hand-tests/`.
- **Skin audit and procedural fallback** — load-time weight/bind checks, rest-pose calibration, and
  a diagnostic control-panel switch between the rigged GLB and the procedural hand.
- **Verification harness** — `scripts/verify-hands.mjs` writes screenshots and the raw wrist/joint/
  latency/bone-stability metrics used in the final report.

### Changed

- **Pinch metric** — tip gap over palm width (MCP 5 → 17), mapped through a `0.10–0.55` smoothstep.
  Enter **0.55** / exit **0.38**, 70 ms hold. Image-space ratio is primary; world landmarks are
  blended only when they agree.
- **Left rail** — HUD and gesture legend now share one flex column; the legend auto-collapses below
  860 px and on the Test page instead of covering cards.
- **Knowledge labels** draw above nodes and edges but below the hands (`renderOrder`).
- **Screenshots** wait for the camera tween to finish, so the knowledge graph is captured at its
  configured framing, and use ANGLE SwiftShader with a matching window size instead of software
  compositing, which was producing ghost copies of the page. Stills also freeze CSS transitions and
  keyframes and wait on the overlay's computed visibility, because a late compositor start could
  otherwise capture the knowledge card while it was still fully transparent.
- **Knowledge labels** use near-white text with a dark halo and a category glow, so a label that
  crosses a node or its bloom stays readable.
- **Overlay placement** now measures the fixed HUD rail and control panel and picks the side of the
  anchor that fits between them. A left-hand knowledge node no longer opens its card over the
  gesture legend.
- **Flashcard backs** repeat the question above the answer, so a revealed card is self-contained
  and can be graded without remembering the front.
- **Shadow map** uses `PCFShadowMap`; Three r186 removed `PCFSoftShadowMap` and warned on every
  page load before falling back to the same mode.
- **Hand root** is the wrist, not the GLB armature origin. The armature translation is neutralised;
  `root.position` is the mapped wrist and `root.quaternion` is the shortest-arc palm delta. Position
  is direct; only orientation and fingers are damped, so fast movement does not drag the wrist.
- **Retargeting** uses an orthonormal palm basis, a per-bone rest table, parent-first local rotations
  and soft joint limits. Mirroring remains a screen-position transform rather than a reflection of
  the orientation data; left and right meshes are driven separately with positive scales.
- **Selection commits on release**, not pinch start, after a ≥100 ms hold and within a 36 px travel
  budget. The aim is locked to the position ~100 ms before pinch start (recent fallback after fast
  movement), and scene hover is frozen during the pinch.
- **Picking is per instance.** Every organelle instance has its own anchor and enlarged invisible
  proxy; screen-space proximity is primary and exact ray picking is the fallback. Sticky armed hover
  uses ~220 ms / ~96 px with 20 px hysteresis, and test/overlay anchors follow one instance instead
  of jumping to whichever instance is largest that frame.
- **Finger smoothing** uses shortest-arc quaternion damping with a confidence fallback to the rest
  pose; a missing or invalid GLB switches to the procedural hand.

### Fixed

- A pinch could never activate on a real hand because the world-only ratio saturated around 0.6.
- Screen corners were unreachable without leaning out of the camera frame.
- The HUD and legend overlapped on short viewports; the legend covered Test cards.
- Node spheres painted over their own labels; labels now stay legible.
- The hands check was frozen on “No hands yet”: `setHands` was never called, and its selector wrote
  the label into the second hand dot instead of the status text. The count is now fed from the HUD
  snapshot, so the onboarding sees the tracker live.
- The hand orbited around the armature origin during wrist rotation; it now rotates around the
  tracked wrist (0 px projection offset in the final suite).
- Fingers collapsed or tore because bone directions were applied without rest-pose calibration or
  parent-first rotations; the rest table and solver keep bone lengths constant (worst CV 0.039 %).
- Picking used aggregate centres for multi-instance organelles, so a pinch near a mitochondrion or
  lysosome could select the nucleus/nucleolus; each instance now owns its pick anchor and proxy.
- A pinch could commit the wrong target because the old aim lock re-picked during the gesture, or
  because a multi-instance marker jumped to another instance; the target is frozen and anchors have
  screen-space instance memory.
- The procedural-hand switch is verified in both directions through the real control; it follows the
  same wrist pose and restores the rigged GLB without a reload.

## [0.2.0] — 2026-10-22

A ground-up rebuild of the v0.1 cell viewer into a complete, gesture-driven learning app.

### Added

- **Hand tracking** — MediaPipe Tasks Vision `HandLandmarker` (1.1.0) with a locally served WASM
  runtime and float16 model. One-Euro landmark filter, 0–100 quality score, side resolution with
  debouncing, manual L/R swap, and display-only mirroring on both axes.
- **Gesture engine** — page-agnostic state machine (`IDLE`, `HOVER_UI`, `SELECTING`, `ROTATING`,
  `SCALING`, `SWIPING`, `COOLDOWN`) with pinch hysteresis (thresholds revised in 0.2.1),
  fist rejection, 250 ms hand-loss tolerance, click travel/time budgets, 150 ms post-scale cooldown,
  two-hand override, and swipe thresholding.
- **Interactive Lab** — procedural cell with 15 named, raycastable organelles, fresnel membrane,
  bloom, instanced ribosomes, auto-rotation with a Stop control, select-to-isolate with ghosting,
  focus tween, scale clamps, anchored info overlay and a full structure rail.
- **3D hands** — rigged GLB retargeting (21 bones per hand), translucent glass material, pinch glow,
  position damping, and a procedural glass-hand fallback. The container is anchored on the pinch
  midpoint so fingertips meet the virtual cursor.
- **Knowledge network** — 36 authored nodes and ~90 edges, deterministic 3D force layout, billboard
  labels, category colours, animated edges, focus fly-in, neighbour dimming, related-concept hops and
  cross-links into the Lab and Test sections.
- **Testing knowledge** — 48 MCQs with explanations, 36 flashcards on a Leitner 1–5 schedule, three
  10-question guided sets, shuffled options, scoring, review of mistakes, and persistent progress.
- **Onboarding** — three steps (camera consent, hands check, gesture primer), skippable, with
  camera-denied / insecure-context handling and a mouse-only path.
- **HUD & control panel** — hands, L/R chips, pinch value and bar, landmarks, quality, mirror state,
  tracker and render FPS, debug landmark view, webcam preview, language, swap, mirror, feedback,
  reduced motion, high contrast and dwell-to-click toggles.
- **Bilingual content** — every content string is `{ en, fr }`; the interface switches live.
- **Test harness** — 53 Vitest unit tests and 8 Playwright specs. A synthetic 21-landmark hand
  (`window.__celly.injectHand`) drives the real pipeline for gesture e2e tests and the screenshot
  harness.
- **Docs** — `README.md`, `PLAN.md`, `DECISIONS.md` (D-01…D-35), `ASSET_INVENTORY.md`,
  `CREDITS.md`, this changelog, and 11 regenerated screenshots.

### Changed

- The whole application was rebuilt on Vite 8 + TypeScript 6.0 with strict compiler settings,
  Three.js 0.186, and no UI framework.
- One renderer and one scene serve all three sections; pages are toggled groups, and the 3D hands
  persist across navigation.
- DOM replaces canvas text for the HUD, overlays, quizzes and labels.
- The v0.1 cell/lab modules, `src/app/App.ts`, `src/cell/*`, `src/util/math.ts`, `src/scene/
  LabEnvironment.ts` and `src/scene/Lighting.ts` were replaced by the modular v0.2 tree.

### Fixed

- Pinch state could never activate when the clock started at 0 because `candidateSince === 0` was
  used as the "no candidate" sentinel. The sentinel is now `-1`.
- The 3D hand drifted away from the cursor because it was anchored on the wrist; it is now
  corrected in screen space against the camera projection every frame.
- A dropped CSS transition could leave the virtual cursor or gesture hint painted after the hand had
  gone; hiding now uses `visibility: hidden` in addition to opacity.
- MediaPipe world landmarks were rendered upside-down; the image-aligned axes are now converted once
  in the tracker.
- The nuclear envelope swallowed every nucleus pick; ray hits are now resolved by specificity, with
  the nearest hit breaking ties.
- The HUD and gesture legend could intercept clicks and pinches aimed at the scene or at page
  controls; both are now pointer-transparent (interactive children opt back in).
- Stale gesture state (cursor, mid-pinch, swipe session) could persist when the last hand left the
  frame; the engine now resets to `IDLE` and clears in-flight candidates.
- Playwright's `devices['Desktop Chrome']` silently overrode the configured viewport; the project
  viewport is now applied after the device spread.
- Screenshot captures could contain stale, tiled page copies under GPU compositing; the harness uses
  software rasterisation (`--disable-gpu`) with an emulated viewport.

### Removed

- The v0.1 cell viewer, laboratory set dressing, osmosis experiment scaffolding and its probe
  scripts (preserved in git history).
- All scratch screenshots and one-off probe scripts from the v0.2 build.

### Notes

- No audio in this release (D-29).
- The rigged hand GLB is optional at build time. When it is absent, the procedural hand is used and
  every gesture still works.
