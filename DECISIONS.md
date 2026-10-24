# Decisions — Celly v0.2

Every ambiguity in the brief, and the interpretation chosen. Numbered for reference in code
comments (`D-nn`).

## Project & stack

**D-01 — Build in place.** The brief allows `/celly-v0.2` "or as appropriate". Built directly in
`D:\TKS\BUILD\Celly` (the repo that already carries the cell work, the MediaPipe runtime and the
hand GLBs). v0.1 code is replaced, not deleted from history.

**D-02 — No UI framework.** Vanilla TS + a 60-line reactive store. The UI is mostly imperative
WebGL + anchored DOM cards; Preact/Svelte would add a build layer without removing any complexity.
Keeps the bundle lean and the render loop allocation-free.

**D-03 — Custom tween engine, not GSAP.** GSAP is ~70 kB for what is needed here: cancellable
numeric/vector tweens with easing, driven by the existing clock. `core/tween.ts` is ~140 lines,
tree-shakeable, and cannot fight the render loop. Brief explicitly allows "a tiny tween util".

**D-04 — Custom deterministic 3D force layout, not `d3-force-3d`.** The brief allows either.
A seeded Fruchterman–Reingold variant (repulsion + spring + centring + fixed 300 ticks, run once
at boot) gives reproducible layouts across reloads and screenshots, and removes 3 dependencies.
Layout is precomputed, then rendered — no simulation cost per frame.

**D-05 — ESLint + Prettier.** Added as the brief requests. Flat config, `typescript-eslint`
recommended set, no type-aware rules (keeps lint <2 s). TypeScript is pinned to **6.0.3**:
`typescript-eslint` 8 refuses to run against the 7.x native compiler ("does not support TS 7.0"),
and 6.0 is the newest release inside its supported range. The source is strict TS and type-checks
identically on both.

**D-06 — Three.js 0.186.1 (pinned, already vendored).** "Latest stable" is honoured by the
version already installed and type-matched (`@types/three@0.186.0`); upgrading mid-build would
risk `EffectComposer`/`OutlinePass` API churn for no user-visible gain.

## Rendering

**D-07 — One renderer, one scene, three page groups.** The brief requires hands and tracking to
persist across pages. A single `THREE.Scene` with `labGroup` / `knowledgeGroup` / `testGroup` /
`handGroup` and one camera that is tweened between page framings gives seamless transitions and
guarantees the hands never re-initialise.

**D-08 — Selection outline = custom back-face shell, not `OutlinePass`.** `OutlinePass` needs a
second render target pass and depth/normal textures, and interacts badly with a translucent
membrane. A scaled back-face clone with an additive fresnel material is cheaper, always follows
the mesh, and reads better on a ghosted cell. Bloom (`UnrealBloomPass`, low strength) is added for
the glow language only.

**D-09 — Procedural cell.** No cell model exists in the folder (only reference images). Runtime
procedural geometry gives per-organelle transforms, morph targets for isolation, and zero asset
weight. Blender export was possible but would freeze the part hierarchy.

**D-10 — Hands get a material override.** The GLBs ship with either no material or photographic
hologram textures. To guarantee the "semi-transparent / stylised, never hides the cell" requirement
in every lighting state, the loaded meshes are re-materialled at runtime: dark glass body, cyan
fresnel rim, additive pinch glow. The GLB's textures are ignored (they remain in the file, unused).

**D-11 — DOM for text-heavy UI, WebGL for space.** MCQ options, overlay text and flashcards live in
DOM (crisp at any DPR, accessible, keyboard-navigable, ARIA-able) while the stage, cell, network and
hands are WebGL. Flashcards use CSS 3D transforms for the flip. This satisfies "3D-style card"
without making text unreadable.

## Tracking & gestures

**D-12 — Tracking on the main thread, not a worker.** MediaPipe `tasks-vision` in `VIDEO` mode
runs synchronously in ~4–8 ms on the target GPU; a worker adds a frame of transfer latency and
`ImageBitmap` copy complexity for no gain at 720p. The loop uses `requestVideoFrameCallback` when
available and never queues more than one inference. A worker remains a documented v0.3 option.

**D-13 — Pinch value direction.** Brief: `value = 1 − clamp(dist(4,8)/handScale)`. Therefore
**1 = fully pinched**. The original implementation used `handScale = dist(0,9)` in world landmarks
and enter > 0.80 / exit < 0.60. Real-device testing showed that metric never rose above ~0.65: the
finger *pads* touch while landmark centres stay 1–3 cm apart, and MediaPipe's z is noisy at 60–80 cm.
D-38 replaces the normaliser and the mapping; the direction and the 70 ms hold are unchanged.

**D-14 — Fist rejection.** If ≥3 of the four non-thumb fingertips are closer to the wrist than
their own MCP, the hand is a fist and pinch is forced false. Prevents "grab rotate" firing when the
user relaxes their hand.

**D-15 — Handedness resolution.** MediaPipe labels handedness for a *non-mirrored* image. The UI
shows a mirrored selfie view by default. `handSide.ts` computes the user's anatomical side as
`mirrored ? flip(mediapipeLabel) : mediapipeLabel`, then applies an optional user swap. Identity is
stabilised across frames by nearest-wrist matching with a 120 ms switch lock, so labels never flicker.

**D-16 — Mirror semantics.** `mirrorX` flips the screen mapping of hands and cursors (selfie view).
`mirrorY` flips vertical mapping (for ceiling-mounted or inverted cameras). Both are display-only:
they never change which physical hand is Left/Right, which is handled by D-15. This is the only
interpretation that keeps "hands swap" meaningful.

**D-17 — Cursor ownership.** Right hand is the primary UI pointer. The left cursor is rendered but
does not hit-test buttons **unless** no right hand is present. Inside the Lab, left pinch is always
rotate, so it must not also click UI.

**D-18 — Gesture state machine is a pure function.** `step(prev, input, dt) → {state, intents}`,
no DOM, no Three.js. Unit-tested with synthetic landmark streams. `SCALING` has absolute priority;
entering it cancels rotation; leaving it starts a 150 ms `COOLDOWN` where rotation is ignored.

**D-19 — Select vs unselect is decided by the raycast, not by the gesture.** A right pinch always
produces `PINCH_START`; `InteractionRouter` raycasts the scene under the cursor and emits `select`
if something was hit and `unselect` if not. This keeps the gesture engine page-agnostic.

**D-20 — Buttons need pinch *and* release inside the same rect within 500 ms and < 24 px of travel.**
A pinch that starts on a button but drags away cancels the click. Prevents accidental answers.

**D-21 — Dwell-to-click is off by default.** Offered as an accessibility toggle (900 ms with a
progress ring) because it fights the rotate gesture if left on.

**D-22 — Selecting an organelle rotates/scales the whole cell rig, recentred on that organelle.**
The brief says the selected element "becomes the element under interaction". Rather than giving one
part an independent transform (which breaks its relationship to the membrane), the rig is tweened so
the part sits at the origin at a comfortable scale; the rest of the cell is ghosted to 8 %. Rotation
and scale then feel identical to whole-cell manipulation and unselect restores the saved transform
exactly.

**D-23 — Ghost, don't hide.** Isolation fades non-selected parts to 8 % (opaque parts) / 3 %
(translucent) rather than hiding them, preserving spatial context and avoiding a "pop". The brief
allows either.

**D-24 — Two-hand scale is ratio-based.** `factor = dist(now) / dist(at gesture start)`, smoothed
with a 0.35 lerp per frame, clamped to the page's min/max. No absolute mapping, so there is no jump
on gesture start.

## Content

**D-25 — Bilingual data, EN default.** Every user-facing content string is `{ en, fr }`; UI chrome
uses a small dictionary. A language toggle lives in the control panel and persists. This reuses the
v0.1 bilingual metadata and satisfies §6.4.

**D-26 — Knowledge graph is authored, not derived.** 36 nodes with hand-written edges — deriving
edges from organelle `relatedIds` alone would leave "Processes" and "Molecules" disconnected.

**D-27 — Flashcard convention.** Swipe **right = "I knew it"**, **left = "I didn't know it"** (per
brief). Leitner boxes 1–5: right → box+1 (mastered at 5), left → box 1. Due cards ordered by box,
then by last-seen. Stored under `celly:v02:leitner`.

**D-28 — Questionnaire sets are fixed curricula**, not random draws: "Cell basics", "Energy &
transport", "Genetics & division" — 10 questions each, difficulty-ordered, so a session is a
coherent lesson. MCQ mode and flashcards draw randomly.

**D-29 — No audio.** Nothing in the brief specifies sound and adding it would force autoplay-policy
handling on first gesture. Recorded as a v0.3 suggestion.

## Delivery

**D-30 — Screenshots via Playwright with a synthetic landmark replay.** A headless camera cannot
produce hands. `tests/e2e/replay` injects a recorded 21-landmark stream through a debug hook so the
gesture states (select, focus, swipe) are real and reproducible for the screenshots.

## Hand presentation (post-build)

**D-31 — Anchor the hand on its pinch midpoint, not its wrist.** The GLB includes forearm geometry
and its visual fingertips do not coincide with the driven bone tips when the container is placed by
the wrist. Each frame, after the wrist damping and the rig retarget, the pinch midpoint (bones 4/8)
is projected through the camera, the screen-space error against the virtual cursor is converted to
world units at that depth, and the container is moved by that delta. Because the correction is
applied *after* damping, it cannot lag; because it is a full correction rather than an integral
term, it converges in one frame. The procedural fallback implements the same interface, so the
interaction does not change when the GLB is missing.

**D-32 — The "no pinch candidate" sentinel is −1, not 0.** `0` is a valid clock value (unit tests,
any timer starting at zero), so using it for "no candidate" prevented the pinch from ever becoming
active on such a clock. Hysteresis state now uses −1 and the tests cover the t=0 case.

**D-33 — Telemetry is pointer-transparent.** The HUD and the gesture legend are read-only overlays:
`pointer-events: none` with `<summary>`/buttons opting back in. Telemetry must never swallow a
click or a pinch aimed at the scene or at page controls. Playwright surfaced this as
"…from <aside class=hud> intercepts pointer events" while clicking a quiz card.

**D-34 — "No signal" and "Waiting" are different states.** With the camera live but no hands in
frame, the HUD now reads *Waiting*; *No signal* is reserved for a tracker that is not running.
`tracker.ready` is passed through `HudState` so the copy can make that distinction.

## Verification (post-build)

**D-35 — Playwright's viewport is applied after the device preset.** `devices['Desktop Chrome']`
carries a 1280×720 viewport; spreading the device object after the project's `use` block silently
overrode the configured 1440×900 and pushed layout-sensitive controls under the HUD.

**D-36 — Gesture e2e re-aims at the live scene.** The cell auto-rotates and the knowledge graph
drifts, so one anchor read can be stale; an organelle can also sit behind another. The lab test
freezes auto-rotation, polls candidate organelles until one genuinely self-hovers at its projected
anchor, and pinches by re-reading the anchor in the same task. The knowledge test prefers nodes near
the rotation axis (`golgi`, `nucleus`, `ribosome`) because peripheral nodes move fastest.

**D-37 — Screenshots are SwiftShader-rendered, with a normal compositor.** Hardware GL on the build
machine intermittently captured stale, tiled or rescaled copies. The first workaround, `--disable-gpu`,
routed the page through the software compositor, which produced the same ghost tiles whenever a WebGL
canvas repainted. Chrome now runs with ANGLE pinned to SwiftShader (`--use-angle=swiftshader`), the
GPU process left enabled, `--force-device-scale-factor=1`, `--hide-scrollbars`, a
`--window-size=1600,1000` that matches the emulated viewport, and `captureBeyondViewport: false`
(extends D-30).

## Real-device pass (post-build)

**D-38 — Pinch is a dead-zoned tip-gap / palm-width ratio.** The normaliser is now palm width
(`dist(mcp5, mcp17)`), which is stable under wrist flexion and hand distance, and the value is
`1 - smoothstep(0.10k, 0.55k, ratio)` rather than `1 - ratio`. The dead zone is the important part:
a natural pad-to-pad pinch keeps the marker centres ~2 cm apart, so it saturates at 1.0 instead of
stalling around 0.6, while an open hand still reads 0. Enter/exit are **0.55 / 0.38**. The ratio is
computed in normalized image space; world landmarks are averaged in only when their ratio agrees
within 0.18, so noisy metric z cannot break the gesture. `k` is a persisted sensitivity setting
(0.7–1.5; Firm 0.8 / Normal 1.0 / Light 1.3), exposed as three buttons because a range input is a
poor pinch target. Regression: `tests/unit/pinch.test.ts` includes a touching-but-offset hand with
deliberately corrupted world z.

**D-39 — The camera's middle 84 % maps to the full screen.** Mapping the whole video frame to the
viewport forced users to leave the frame to reach the tabs or the control panel. `reach()` maps
8–92 % to 0–1 with a ~1.19× gain and clamps outside it; `unreach()` is its inverse and is used by
`injectHand`, so synthetic hands still land exactly on their requested CSS pixel. The gain is applied
after mirroring, and the 3D hand is anchored on the same mapped cursor. Onboarding now states the
60–80 cm / eye-level distance, and both the preview and the hands-check frame draw the usable 8–92 %
box.

**D-40 — HUD and legend share one left rail.** They used to be independently fixed (HUD at
`top: 74px`, legend at `top: 50%`), so they overlapped as soon as the HUD grew or the viewport fell
below ~900 px, and the legend sat over the Test cards. One `.left-rail` flex column now stacks them
with a 10 px gap and a `max-height`; the legend auto-collapses to its header under 860 px and on the
Test page. The rail and both children stay `pointer-events: none`, so nothing is stolen from the
scene.

**D-41 — Knowledge labels render above the graph but below the hands.** `depthTest: false` alone
was not enough: transparent nodes are sorted by distance and still painted over nearer text, and a
node's bloom halo washed out a label in the same colour. Labels get `renderOrder = 1`, graph meshes
stay at 0, and hand meshes/sprites get `renderOrder = 2`. The texture is now near-white text with a
dark halo and a category-coloured glow, so it stays readable when it does pass over a node or a
bloom. Hand meshes still occlude labels correctly.

**D-42 — The screenshot harness waits for camera tweens.** Camera moves are `dt`-driven and `dt` is
clamped to 50 ms; SwiftShader renders at 2–4 fps, so a 780 ms transition takes several wall-clock
seconds and fixed waits captured the knowledge page halfway between framings (12.1 instead of 16.4
units, which also made the graph look the wrong size). `scripts/shots.mjs` now waits on
`__celly.scene.transitioning === false` after every page change.

**D-43 — Floating cards reserve the fixed chrome.** `Overlay.place()` measures the `.left-rail` and
`.controls` boxes and treats the space between them as the usable band. It opens on the side of the
anchor that fits, preferring the right whenever it fits. This keeps a left-side knowledge node from
opening its card over the gesture legend (the first v0.2.1 capture of 07 did exactly that) while
still leaving the selected node visible. Both e2e overlay tests assert that the card's rect does not
intersect either rail.

**D-44 — A flashcard back restates its question.** A Leitner card is graded after the flip, so the
answer side cannot rely on the user remembering the front. The back now shows the prompt above the
"Correct answer" line. It remains one flip, and the 300 px card still fits without scrolling.

**D-45 — Stills freeze CSS time.** The capture harness disables transitions and keyframe animations,
then waits until any open overlay reports `visibility: visible` and opacity above 0.99. Under the
software compositor a 320 ms fade can start seconds late; 07 was captured with the correct
`is-open` DOM state and a computed opacity of 0, which is why the card vanished from the shot. The
overlay's 78 % glass is raised to 97 % for stills because the blur is disabled for capture; without
that, bright graph labels printed through the card text. This is a screenshot policy, not an app
mode.

## Hand-tracking round 2

**D-46 — The wrist is the only hand pivot.** The GLB armature node translations were the pivot bug:
the container rotated around the armature origin, so a wrist roll orbited the whole hand. The
armature translation is neutralised and the container origin is placed exactly at the mapped wrist.
The rig builds an orthonormal palm basis with Gram–Schmidt (`palmBasis`), uses
`root.quaternion = palmDelta × inverse(restPose)`, and slerps on the shortest arc. Position is
assigned directly each frame; only orientation and finger rotations are damped. Mirror/swap is a
screen-position transform and is never applied to the world landmarks used for the basis: reflecting
them produced a left-handed frame and non-unit quaternions. The left and right GLB meshes stay
separate, with no negative scales. Acceptance: 0 px wrist offset at every sampled pose and a
palm/back dot of -0.991.

**D-47 — Reimplementation, not a port, of the MIT reference rig.** `bandinopla/three-mediapipe-rig`
was studied for its wrist-centred root, rest-pose capture, parent-first local rotations and angle
comparison. It is MIT-licensed, but its scene graph, bone names and frame conventions are not
Celly's. Copying it would have imported a second set of assumptions and made the GLB-specific
calibration and Celly's constraints harder to audit. Celly therefore reimplements the principles in
`src/scene/handMath.ts` / `handRig.ts` with its own rest table, joint limits, skin audit and
procedural fallback. The reference is credited in `CREDITS.md`; its code is not shipped.

**D-48 — Selection commits on release, from a frozen pre-pinch aim.** Committing on pinch start made
a crossing pinch select before the user could hold or abort. The engine now captures the target on
pinch start, requires a ≥100 ms hold and rejects travel over 36 px, then selects on release. The aim
is the position 100 ms before the pinch (35 ms fallback if the hand moved >55 px, because the pinch
convergence then carries the cursor away from the intended point). A pinch released too quickly, or
after too much travel, logs a rejection instead of selecting. Empty-space pinches keep the previous
v0.2.1 semantics: left-only unselects and rotates immediately; right-empty defers unselect to
release on interactive pages; swipe-enabled pages unselect immediately.

**D-49 — One anchor per instance, armed hover, and a frozen target.** An aggregate centre for a
multi-instance organelle sits near the cell centre, which is why aiming at a mitochondrion could
pick the nucleus. Each instance now has a pick anchor and an enlarged invisible proxy. Screen-space
proximity (40–62 px by hand span) is primary and the exact ray is the fallback; membrane, cytoplasm
and particles are blank. A ~220 ms / ~96 px sticky target with 20 px hysteresis absorbs jitter. Once
a pinch starts, scene hover is frozen: the engine selected the target captured at pinch start, so
re-picking the 100 ms-old locked aim cannot silently change it. Selection-test and overlay anchors
pick the largest projected instance when first shown, then follow it through screen-space anchor
memory; choosing “largest every frame” made a vacuole/Golgi ring jump 279 px during rotation. The
first implementation’s “least contested point” experiment was rejected because it placed labels in
empty space at the edge of large bounding spheres.

**D-50 — Rest calibration, parent-first rotations, and a healthy-skin fallback.** Each driven bone
captures its rest direction in parent space, rest local quaternion and a soft flexion limit. The
solver walks parent first and solves only local rotations, so bone lengths cannot change. Quaternion
targets use shortest-arc damping; low tracker confidence eases to rest, and a missing/invalid GLB
falls back to a procedural glass hand that follows the same wrist and landmarks. On load, skin
weights are normalised to four influences and audited (unweighted vertices, weight sums, finite
bind matrices); failures are logged in the debug overlay instead of producing silent tearing.

**D-51 — Acceptance uses the deterministic exact test, not SwiftShader jitter.** The built-in
Selection test is the acceptance instrument: it freezes auto-rotation, follows one instance per
target, reports hits and mean aim error, and uses the real gesture engine. Under ANGLE SwiftShader a
frame can take 1–2 s, which exceeds the real 220 ms sticky window; a synthetic 12 px step/jitter test
therefore tests frame pacing, not hand selection. The exact 10-target run is the reported E2E result
(10/10, 0.5 px). Timing-sensitive hysteresis is exercised with synthetic timestamps in unit tests,
and the pose suite uses deterministic landmark replays rather than webcam footage. `applyMs`
measures only the CPU retarget solver, not MediaPipe inference or rendering.
