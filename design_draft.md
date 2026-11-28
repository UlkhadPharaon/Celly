# Mobile & tablet responsiveness + touch control for Celly

*   **Author:** Ulkhad Pharaon
*   **Status:** Draft
*   **Date:** 2026-11-27

---

## Overview

Celly is a research web app: a 3D animal cell driven with bare hands through the webcam, a
knowledge network and a quiz. The study compares three interaction modes (`hands`, `mouse`,
`text`) and stores the chosen mode with every answer, so the mode is data, not a preference.

This draft covers two linked problems found in a phone/tablet audit on 2026-11-27, measured
against the running dev server (`localhost:5173`) at iPhone 390×844 @3× touch, iPhone landscape
844×390 @3× touch, tablet 820×1180, and small phone 320×568. Screenshots are in
`.playwright-mcp/audit/`.

1. The layout is desktop-shaped. Several fixed bars and controls do not fit a 320–390 px phone
   screen, and the parts that do fit are not offset for the notch or the home indicator.
2. The 3D surfaces answer to the webcam and to a mouse button only. A finger drag, a two-finger
   pinch and a mouse wheel do nothing, while the app's own onboarding copy promises "drag to
   rotate, scroll to zoom" in mouse mode.

The plan fixes the copy, the layout and the input path, and adds phone/tablet test coverage. It
proposes no change to the study's data model; the one decision that would change it is Q1.

---

## The Problem

### Measured findings

| # | Finding | Evidence | Effect on a phone user |
|---|---|---|---|
| A1 | The top bar overflows the viewport on every phone | `.top-actions` spans x 195→377 at 320 px and 250→432 at 390 px; `innerWidth` is 320/390 | The help button (`top-help`) and the edge of the study-data button are off-screen and unreachable |
| A2 | Safe-area insets never resolve | `index.html` is `width=device-width, initial-scale=1` with no `viewport-fit=cover`, so `env(safe-area-inset-bottom)` stays `0px` on iOS | The bottom sheet, intro text and structure rail sit under the home indicator; the inset logic the CSS already writes is dead code |
| A3 | The collapsed bottom sheet has no margin | `--sheet-peek: 78px`; collapsed content is 76–78 px (head 44 + gap 6 + camera status 18 + top padding 8) | With `viewport-fit=cover` added, `padding-bottom` grows by the 34 px inset and the "Camera off" row is clipped |
| A4 | No touch input on the 3D surfaces | `src/core/app.ts` binds `pointermove` (hover), `click` (pick) and keyboard only: no `pointerdown`, no `wheel`, no multi-pointer. `canvas { touch-action: none }` swallows the gesture | A drag or pinch on the cell is a no-op — the browser gesture is blocked and the app returns nothing |
| A5 | Mouse-mode copy is false | `src/ui/onboarding.ts` `mouseLead` "Drag to rotate, scroll to zoom"; `src/study/tourSteps.ts` step 91/94 "Drag to rotate, scroll to zoom"; `src/ui/modeGate.ts` and `src/study/modeCopy.ts` "steered with clicks and dragging" | Mouse mode promises two controls that do not exist |
| A6 | Lab and network copy only teaches the pinch gesture | `interactiveLab.ts` lead "Pinch a structure to isolate it. Pinch empty space to release."; `knowledge.ts` lead/hint "Pinch a node to open it… left pinch to orbit" | On a phone there is no instruction for the gesture the user actually has (a finger) |
| A7 | The gesture hint is hidden exactly where it is needed | `main.css:3505` `.lab-hint { display: none }` at ≤1080 px | No tutorial on phones and portrait tablets |
| A8 | Touch targets below 44 px | Tab buttons 40×44 (`(pointer: coarse)` sets `min-width: 40px`), `.study-open` 32×32 (≤720 rule), `.btn.ghost` 30.9×30.9 on the Test page, `.sheet-toggle` 35.6×38 and `.help-btn` 33.2×38 inside the sheet, structure chips 34–36 px | Below the 44 px touch minimum; mis-taps |
| A9 | Small type | `.page-intro p` 11 px at ≤640; `.hud` 11.5 px at ≤1080 (visible 821–1080 px); label rows 9.5–10.5 px | Below the 12 px readable floor, and the HUD shows on portrait tablets |
| A10 | Landscape phone squeezes the stage | At 844×390 the top bar is 65.6 px tall, the intro occupies y 78→174 (96.5 px) and the sheet starts at y 312 | The stage between intro and sheet is ~290 px tall in the middle of the screen |
| A11 | No phone/tablet E2E coverage | `playwright.config.ts` has one project at 1440×900; no spec sets a coarse pointer or a touch viewport | Every regression above can reappear silently |
| A12 | `state` intents never reach the pages | `src/core/app.ts` `dispatch()` has `case 'state': break;`, so `InteractiveLabPage.case 'state'` — the only place `rotateAnchor` is cleared — is dead code | After the first hand rotate the anchor stays alive and the rig is pinned: measured rig settling at 2.216 rad and drifting +0.005 rad per 2.5 s where auto-rotate should add 0.12 rad/s |
| A13 | The same gap breaks hand zoom | `lastGesture` is only written by `case 'state'`, so `scaleBase` is recaptured on every `scale` intent and the absolute factor compounds | Measured: a scale sequence that should reach 1.2 lands at 1.597 — the cell zooms far past the fingers |

A12/A13 are pre-existing hand-mode defects, not responsive ones, but they are the reason the
pointer path cannot emit `scale`/`rotate` alone: the pages depend on `state`.

### What is already right (kept as the baseline)

*   The desktop layout (1440×900), the desktop control panel and the desktop HUD.
*   The bottom-sheet pattern at ≤1080 px — right structure, wrong collapsed height and trigger sizes.
*   The structure rail switches to a horizontal strip at ≤1080 px and keeps clear of the sheet.
*   The mode gate (three full-width 284.8 px options) fits a 320 px phone.
*   The textbook (text mode), the study layer and the test shell fit a phone and scroll internally.
*   `src/core/device.ts` already budgets phones (DPR cap 1, no shadows/bloom, fewer segments).

### Core problem in one sentence

The interaction model was built for a desktop webcam, and the phone/tablet work stopped at
re-flowing panels: on a touch screen the 3D cell is inert, and the copy tells users to do things
the app cannot receive.

---

## Goals

*   G1 — Every shell control (brand, tabs, auto-rotate, study, data, help) is inside the viewport
  and at least 44×44 px on touch devices, at 320, 360, 390, 768, 820, 844 and 1024 px wide, in
  both orientations.
*   G2 — A finger can rotate, zoom and select in the 3D lab, and orbit/select/hop in the knowledge
  network, on a phone and a tablet, with no camera and no mouse.
*   G3 — Safe areas are actually applied (notch, home indicator, landscape cutouts) on iOS Safari,
  Android Chrome and iPadOS.
*   G4 — Every piece of copy that names an input (onboarding, tour, mode gate, page leads, hints,
  legend) matches what the app really accepts on the device in front of the user.
*   G5 — Phone and tablet layouts are covered by automated tests, so the regressions above cannot
  come back silently.
*   G6 — The study data is unchanged: the mode field, the CSV/JSON export and the per-mode
  aggregate stay exactly as they are.

## Non-Goals

*   NG1 — No new interaction mode is added to the study data model (see Q1).
*   NG2 — No redesign of the desktop layout, panel or HUD.
*   NG3 — No new 3D features, camera moves, scene content or hand-gesture changes.
*   NG4 — No changes to MediaPipe hand tracking, the tracking worker, or the frame pipeline.
*   NG5 — No UI framework, CSS modules or component library. `src/styles/main.css` stays the one
  stylesheet.
*   NG6 — No performance re-architecture; the phone render budget in `src/core/device.ts` is not
  changed.

## Open Questions

*   **Q1 — Does touch become a fourth study mode?** Pointer input is needed on phones either way;
  the open decision is only what the data records.
    *   **Option A — keep three modes; pointer input lives inside `mouse` mode.** The 3D surfaces
      accept finger input in addition to the mouse wherever the mouse path is enabled (`mouse`
      mode, and `hands` mode as a fallback when no camera is live). Stored mode stays
      `hands|mouse|text`. Consequence: a phone participant who picks "With a mouse" is stored as
      `mouse`, and the export cannot separate which hand they used. Cost: no schema change.
    *   **Option B — add `touch` to `InteractionMode`.** `src/study/types.ts`, `INTERACTION_MODES`,
      `sanitizeMode`, the mode gate, tour/onboarding branches, the per-mode aggregate list and the
      session CSV header gain a fourth value; old sessions stay valid. Consequence: the comparison
      becomes four groups; a phone participant who drove with a finger is no longer pooled with a
      desktop mouse. Cost: one more branch in every mode path plus a note for earlier exports.
    *   **Option Q-C — record the device next to the mode.** Keep three modes and add a
      `deviceClass` field to `StudySession` (already available from `deviceProfile()`). The mode
      stays comparable and a phone-mouse participant is separable afterwards. Cost: a new session
      field, another sanitize branch, another CSV column, and a second axis to explain.

---

## Critical User Journeys (CUJs)

### CUJ 1: Phone, first run, with the camera

*   **Given**: 390×844 touch, no `celly:v03:session`, no `celly:v02:onboarded`.
*   **When**: The user opens the app, picks "With my hands", finishes the 4-step tour, lands in the lab.
*   **Then**: The top bar fits the screen; the tour card and its controls are fully visible; the
  structure rail is reachable above the bottom sheet; nothing is clipped by the home indicator;
  the hand controls behave as they do today.

### CUJ 2: Phone, mouse mode, driving the cell with a finger

*   **Given**: A stored session with `mode: 'mouse'`, tour completed, 390×844 touch.
*   **When**: The user drags one finger on the cell, spreads two fingers, taps an organelle, taps
  empty space.
*   **Then**: The rig follows the finger, the cell zooms with the pinch, a tap selects and opens
  the info overlay, a tap on empty space dismisses it. The intro the user read before this ("Drag,
  pinch or scroll to turn and zoom, tap a part") matches what happened.

### CUJ 3: Tablet and landscape phone

*   **Given**: 820×1180 tablet and an 844×390 landscape phone, touch.
*   **When**: The user opens the lab, the network and the test page.
*   **Then**: The top bar is fully visible in both orientations; the sheet hide/show trigger is
  44 px; the intro does not cover the cell in landscape; the network orbits with one finger and
  hops with a swipe.

### CUJ 4: Desktop regression

*   **Given**: 1440×900, fine pointer, `mode: 'mouse'`.
*   **When**: The user drags with the mouse button held, scrolls the wheel, clicks an organelle.
*   **Then**: Drag rotates, wheel zooms, click selects — the same behaviour as today, with the
  wheel case now actually working (it does nothing today). The desktop layout is unchanged.

---

## Technical Plan (Architecture)

Three layers, in shipping order. Layer 1 and 3 can ship alone; layer 2 is the behaviour that makes
layer 1 worth shipping.

### Layer 1 — Shell layout (CSS + one meta tag)

```
index.html                src/styles/main.css
------------              ---------------------------------------------------
viewport-fit=cover ─────▶ :root --safe-* actually resolve on iOS
                         @media (max-width: 820px) ──▶ two-row top bar
                         @media (max-width: 820px) ──▶ 44 px floor for tabs, auto-rotate,
                                                       study, sheet triggers, intro type
                         @media (max-width: 1080px) ─▶ .lab-hint visible, above the rail
                         --sheet-peek               ──▶ includes safe-bottom, stops clipping
                         --topbar-h                 ──▶ single source for intro/toast offsets
```

*   The top bar becomes two rows on phones: row 1 = brand + actions (preview chip, auto-rotate,
  study, data, help), row 2 = tabs centred. Implemented with `flex-wrap: wrap` on `.topbar`,
  `order: 3`, `flex: 1 1 100%`, `justify-content: center` on `.tabs`. The bar is `position: fixed`,
  so `.page-intro { top }`, `.test-shell { padding-top }` and `.toast-host { bottom }` take their
  offsets from `--topbar-h` instead of the hard-coded 64/66/70/72/76 px values now in place.
*   The bottom sheet keeps `bottom: 0` and `overflow: hidden`, and translates by
  `calc(100% - var(--sheet-peek))`; the safe-area padding stays inside the sheet below the last
  row, so it is only used when the sheet is open. `--sheet-peek` rises from 78 px to 84 px to
  absorb the collapsed content (head + status + gaps) plus rounding.
*   Minimum sizes go into the existing `@media (pointer: coarse)` block, which already carries the
  44 px rules for `.icon-btn`, `.project-link` and `.tab`. The two phone rules that *shrink*
  controls (`.study-open` to 32 px, `.tab` to `min-width: 40px`) are superseded by the 44 px floor.

### Layer 2 — Pointer and touch input

A new module owns the pointer state machine and emits the same `Intent` objects the hand pipeline
emits. Nothing is added to the gesture engine; the pages already consume `rotate`, `scale`,
`select`, `unselect` and `swipe`.

```
        pointer events (touch · pen · mouse · wheel)   ▲
                     │                                │
                     ▼                                │
      ┌────────────────────────────────┐              │
      │ src/core/pointerControls.ts    │  new module  │
      │  - active pointer map          │              │
      │  - tap vs drag discrimination  │              │
      │  - 1 pointer  → rotate         │              │
      │  - 2 pointers → scale          │              │
      │  - wheel     → scale           │              │
      │  - gated while overlays open   │              │
      └───────────────┬────────────────┘              │
                      │ Intent                        │
                      ▼                               │
          app.dispatch() ──▶ page.onIntent() ─────────┘
          (hand pipeline unchanged,
           same single recording path)
```

*   `src/core/pointerControls.ts` (new): class `PointerControls`, constructed with
    `{ canvas, isEnabled(): boolean, onIntent(i: Intent), onTap(x, y) }`.
    *   `pointerdown` records the pointer and its start point; emits nothing.
    *   `pointermove`: a fine pointer with no button keeps the existing hover; one active pointer
      past 8 px of travel emits `{ type: 'rotate', dx, dy, palm: { x, y } }`. `palm` is CSS pixels
      relative to the canvas origin, which is the same coordinate space
      `frameProcessor` already feeds the pages from (`viewport = { innerWidth, innerHeight }`,
      `palm` mapped to CSS px), so `interactiveLab`'s absolute rotation anchor needs no change.
      `dx`/`dy` are emitted because `knowledge.ts` consumes them directly. Re-emitting on every
      move event is safe: `rotate` handling stores the anchor's palm position and is idempotent.
    *   Two active pointers: emit `{ type: 'scale', factor, delta }` where `factor` is the module's
      own accumulated ratio from the distance at gesture start (deadzone 2 %, one-pole smoothing
      0.35 so the pinch does not snap), and `delta` is the per-event ratio. Both pages compute
      `clamp(scaleBase * factor, …)`, so an accumulated `factor` starting at 1 lands exactly on
      the intended scale instead of compounding (A13).
    *   Gesture framing is mandatory: emit `{ type: 'state', state: 'SCALING' }` when the second
      pointer lands (or on the first wheel event of a burst) so the pages capture `scaleBase`
      once, and `{ type: 'state', state: 'IDLE' }` when the gesture ends. Emitting `scale` without
      that frame is what makes today's hand zoom compound (A13), and the pointer path would repeat
      it. Rotation emits `{ type: 'state', state: 'ROTATING' }` on drag start and `IDLE` on
      release so the lab clears its anchor and resumes auto-rotate (A12).
    *   `pointerup`/`cancel`: a gesture with ≤ 10 px of travel and ≤ 500 ms duration is a tap →
      `onTap(x, y)` (the app runs the same `hitTest` → `pick` → `select`/`unselect` the mouse
      `click` path uses today). The existing `click` listener is replaced by this, so mouse, touch
      and pen all share one path.
    *   `wheel` emits `{ type: 'scale', factor, delta }` with the module's own burst accumulator,
      reset 120 ms after the last event.
    *   `isEnabled()` is supplied by the app and returns false while the mode gate, tour,
      onboarding, research panel, study layer or info overlay is open, so a gesture that began
      before an overlay opened cannot keep turning the cell behind it.

*   `src/core/app.ts`:
    *   construct `PointerControls` in `bindInput()` with the new predicates, and remove the
      `click` listener it replaces.
    *   `dispatch()` stops swallowing `state`: `case 'state': break;` becomes
      `this.current?.onIntent(intent)`. This fixes A12 and A13 for hands mode as well, and is
      required by the pointer path. `hover` keeps its current no-op.
    *   pages get `mode` through `PageContext` (added in `src/pages/page.ts`), set once in
      `enterMode` before the pages render, because the mode cannot change mid-session.

*   `src/pages/testing/testingPage.ts`: flashcards and MCQ are DOM cards above the canvas, so the
  canvas listener never sees their drags. A small pointer binding on the card element calls the
  existing `swipeCard(±1)` / `swipeQuestion(±1)`, which makes the on-card "Swipe right for 'knew
  it'" instruction true on touch.

### Layer 3 — Copy that matches the input

*   `src/pages/interactiveLab.ts` and `src/pages/knowledge.ts` keep two copy sets per language —
  gesture copy for `hands`, pointer copy for `mouse`/`text` — selected from the mode in
  `PageContext`. Pointer lead: "Drag, pinch or scroll to turn and zoom. Tap a part to open it."
  Hints: "Drag to turn · pinch to zoom" idle, "Tap empty space to close · drag to turn" selected.
  French equivalents for every string, matching `COPY`'s existing `en`/`fr` shape.
*   `src/ui/onboarding.ts` mouse step (`mouseLead`, `m1`–`m4`, `m3s`, `m4s`), `src/study/tourSteps.ts`
  mouse step (91, 94), `src/ui/modeGate.ts` `mouseSub` and `src/study/modeCopy.ts` description all
  name drag, pinch/scroll and tap — all true on both touch and mouse after layer 2.
*   The gesture legend (`src/ui/shell.ts` `LEGEND`) stays hand-specific; it is already hidden
  below 1280 px and only ever shows on a desktop.

---

## Alternatives Considered

### Alternative A: Touch reacts on the pages, not through a shared intent source

*   **Pros**: No new file; each page attaches its own listeners next to its own 3D code.
*   **Cons**: `interactiveLab`, `knowledge` and `testingPage` would each grow a second copy of
  tap-vs-drag and pinch state logic, and the lab's rotation anchor expects `palm` in the exact
  coordinate space the frame pipeline produces — duplicated per page and easy to get wrong.
*   **Reason for rejection**: Rejected on its own merits: three copies of one state machine, three
  places to fix a bug, and pages that no longer share one recording path for the study.

### Alternative B: Ship the CSS layout fixes only, leave the input alone

*   **Pros**: Smallest change, zero behavioural risk, no intent plumbing.
*   **Cons**: A phone still cannot rotate or zoom the cell; the copy still promises drag and scroll
  that do nothing; G2 and G4 fail outright. The responsive work would be cosmetic on the one
  surface the app exists for.
*   **Reason for rejection**: Rejected: it fixes the frame and leaves the picture blank.

### Alternative C: A gesture library (Hammer.js / use-gesture)

*   **Pros**: Mature pinch/tap handling, less code in the repo.
*   **Cons**: A new runtime dependency for one canvas and one card surface; the intent mapping to
  Celly's `palm`/`factor`/`state` conventions stays custom either way; D-62 already gates
  advisories, so a new dependency needs its own audit.
*   **Reason for rejection**: Rejected: the surface is small, the conventions are already defined
  in `src/types.ts`, and the repo's dependency policy is deliberately lean.

### Alternative D: Camera-first phones only (no pointer path; hands mode is "the mobile mode")

*   **Pros**: Matches the study's original three-group design exactly; no scope.
*   **Cons**: Any participant whose camera is denied, unavailable or blocked by an insecure
  context has no usable path on the device they are holding, and A5's false mouse copy stays.
*   **Reason for rejection**: Rejected: a phone user blocked by camera permission has no way to
  study at all.

---

## Non-Functional Requirements

*   **Performance**: the pointer path adds at most one `pointermove` listener and integer
  arithmetic per event — no per-event allocation beyond the intent object, no layout reads.
  Rotation/scale already run in the existing render loop. The phone render budget (DPR 1, no
  shadows/bloom) is unchanged.
*   **Privacy / data**: no new storage key, no new field, no network call. `viewport-fit=cover`
  changes only how the browser insets layout.
*   **Compatibility**: `PointerEvent` and `wheel` are supported in every browser Celly already
  targets (the app requires WebGL2); the module is attached behind the same canvas the renderer
  owns and is removed on `dispose()`. Two-finger pinch uses `pointerdown`/`pointermove` with
  `setPointerCapture` per pointer id, which works on iOS Safari 13+, Android Chrome and desktop
  Chromium/Firefox/Safari alike.
*   **Accessibility**: the 44 px floor restores the WCAG 2.5.5 target size; the hint becomes
  visible again at ≤1080 px so the gesture is discoverable; existing focus handling, ARIA labels
  and keyboard shortcuts are untouched.
*   **Rollout & rollback**: each layer is independently revertible (one CSS file, one module plus
  four call sites, one copy block). No schema migration; `celly:v03:session` is unchanged, so a
  rollback does not strand data.

---

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `index.html` (modify)

*   **Type / Scope**: HTML document head.
*   **Changes**: add `viewport-fit=cover` to the viewport meta →
  `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`. This is what makes
  `--safe-top/-bottom/-left/-right` resolve on iOS. Nothing else in the file changes.

#### 2. `src/styles/main.css` (modify)

*   **Type / Scope**: the single stylesheet (~5.6k lines); token layer, shell layer, phone media
  queries.
*   **Changes**:
    *   `:root`: add `--topbar-h` (phone default) and raise `--sheet-peek` from `78px` to `84px`.
    *   `@media (max-width: 820px)`: `.topbar { flex-wrap: wrap; }`,
      `.tabs { order: 3; flex: 1 1 100%; justify-content: center; }`;
      `.page-intro` / `.test-shell` / `.toast-host` take `var(--topbar-h)`; `.page-intro p`
      ≥ 12 px; `.lab-hint` is no longer hidden (rule at ~3505 removed for ≤1080 px) and is
      repositioned above the structure rail.
    *   `@media (pointer: coarse)`: `.tab { min-width: 44px; height: 44px }`,
      `.study-open { min-width: 44px; min-height: 44px }`,
      `.sheet-toggle, .controls .ghost-btn { min-width: 44px; min-height: 44px }`,
      `.structure-chip { min-height: 44px }`, `.hud { font-size: 12px }` at ≤1080.
    *   `.controls` at ≤1080: `transform: translate(-50%, calc(100% - var(--sheet-peek)))`
      (safe-bottom padding stays inside the sheet, used only when open).
    *   Landscape phone (`max-width: 1080px and max-height: 520px`, already present): reduce the
      intro to a single line (`h1` 18 px, `p` display none at ≤420 px height) so the stage is not
      split three ways, and keep the sheet peek.

#### 3. `src/core/pointerControls.ts` (create)

*   **Type / Scope**: TypeScript module, DOM listeners over the WebGL canvas.
*   **Changes**: export `PointerControls` plus the pure helpers `pointerStep()` (rotate step
  threshold), `pinchFactor(dist, base)` (deadzone + smoothing) and `classifyTap(track)`. Public
  surface: `constructor(opts)`, `attach()`, `detach()`, `isEnabled`. All intents emitted through
  `opts.onIntent`; taps through `opts.onTap`. No reads of app state — everything gated arrives
  through `opts.isEnabled`.

#### 4. `src/core/app.ts` (modify)

*   **Type / Scope**: application root; input binding, intent dispatch, page context.
*   **Changes**:
    *   `dispatch()`: forward `state` intents to `this.current?.onIntent(intent)` (fixes A12/A13).
    *   `bindInput()`: build `PointerControls` and remove the `click` listener it replaces; add
      `isEnabled()` = `!(modeGate.isOpen || tour.isOpen || onboarding.isOpen ||
      research.isOpen || studyLayer?.isOpen || overlay.isOpen)`. `Overlay` gains an `isOpen`
      getter if one does not exist.
    *   `enterMode()` / the page context factory at ~line 225: add `mode` to `PageContext` so the
      pages pick their copy.

#### 5. `src/pages/page.ts` (modify)

*   **Type / Scope**: page contracts.
*   **Changes**: `PageContext` gains `mode: InteractionMode`; `Page` gains
  `setMode?(mode: InteractionMode): void` for the three page implementations (optional, so
  `testingPage` can omit it). No behaviour change for `enter/exit/update/pick/onIntent`.

#### 6. `src/pages/interactiveLab.ts` (modify)

*   **Type / Scope**: 3D lab page, its copy and its intent switch.
*   **Changes**: extend `COPY` with a pointer variant (`lead`, `hintIdle`, `hintSelected`) for
  both languages, selected by `ctx.mode`; wire `updateHint()` to it. `onIntent` is unchanged —
  the pointer module supplies `palm` and `state` in the shape the existing `rotate`/`scale`/`select`
  branches already consume. Keep `get rigRotationY()` as the test hook (extend its doc comment to
  say "hands or pointer").

#### 7. `src/pages/knowledge.ts` (modify)

*   **Type / Scope**: knowledge network page and its copy.
*   **Changes**: pointer variant for `lead` and `hint`, selected by `ctx.mode`; `onIntent`
  unchanged (`rotate` uses `dx`/`dy`, `swipe` hops, `scale` uses `scaleBase * factor`).

#### 8. `src/pages/testing/testingPage.ts` (modify)

*   **Type / Scope**: quiz/flashcard DOM surfaces.
*   **Changes**: a pointer binding on the flashcard/MCQ card element (tap = flip/grade, horizontal
  drag past 80 px = `swipeCard`/`swipeQuestion` with the existing threshold of 0.7 progress) so
  the on-card swipe instruction works without the canvas. No change to the card templates.

#### 9. `src/ui/onboarding.ts` (modify)

*   **Type / Scope**: first-run onboarding, mouse branch.
*   **Changes**: rewrite `mouseLead`, `m1`–`m4`, `m3s`, `m4s` (and the `fr` block) to name drag,
  pinch/scroll and tap, all true after layer 2. The hands steps and the camera step are untouched.

#### 10. `src/study/tourSteps.ts` (modify)

*   **Type / Scope**: guided-tour copy, mouse branch (lines 91/94).
*   **Changes**: same input vocabulary as the onboarding; hands and text steps untouched.

#### 11. `src/ui/modeGate.ts` and `src/study/modeCopy.ts` (modify)

*   **Type / Scope**: mode gate option copy and the per-mode study copy.
*   **Changes**: `mouseSub` / `mouse` description → "The same 3D cell, steered by drag, pinch and
  click. No camera." (and French). If Q1 selects Option B, this is also where the fourth gate
  option is added.

#### 12. `playwright.config.ts` (modify)

*   **Type / Scope**: Playwright configuration.
*   **Changes**: keep `chromium` at 1440×900; add a `phone` project (`devices['iPhone 13']`:
  390×844, `isMobile`, `hasTouch`, DPR 3) and a `smallPhone` project (320×568, touch). Keep the
  single `webServer` entry and `reuseExistingServer`. Specs opt into the phone projects by
  `test.use({ ...devices['iPhone 13'] })` rather than new files.

#### 13. `tests/e2e/mobileLayout.spec.ts` (create)

*   **Type / Scope**: responsive E2E.
*   **Changes**: seeds `celly:v02:onboarded` + `celly:v03:session` (`mode: 'mouse'`,
  `tourCompleted: true`) before load so the gate, tour and onboarding never intercept. For each
  width (320, 390, 768, 820, and 844×390 landscape) assert: every visible `.topbar` control is
  inside the viewport and ≥44×44; `document.documentElement.scrollWidth === innerWidth`;
  `.lab-hint` is visible; `.page-intro p` computes to ≥ 12 px; the sheet trigger sits above the
  safe-area padding and nothing under the collapsed sheet is clipped. Then visits the knowledge
  and test pages and repeats the containment assertions.

#### 14. `tests/e2e/pointerControl.spec.ts` (create)

*   **Type / Scope**: input E2E, desktop and phone projects.
*   **Changes**: dispatch synthetic `PointerEvent`s (`pointerdown/move/up`, one and two pointer
  ids) on `canvas.celly-canvas` through `page.evaluate`, and assert on `window.__celly`:
  one-finger drag changes `pages.get('interactive').rigRotationY` by > 0.05 rad; a two-pointer
  pinch changes `zoom.scale.x`; a tap on an organelle's projected position opens the info overlay
  (`.overlay-anchor` visible) and a tap on empty space closes it; on desktop a mouse drag plus a
  `wheel` event produce the same two changes. Also assert the hand path is unaffected: the
  existing `selectionDpr` / `reducedMotion` specs still pass.

#### 15. `tests/unit/pointerMath.test.ts` (create)

*   **Type / Scope**: Vitest unit tests for the pure helpers.
*   **Changes**: rotate step threshold (8 px), pinch factor deadzone (2 %), pinch smoothing
  monotonicity, tap classification (≤10 px and ≤500 ms), wheel burst reset.

#### 16. `DECISIONS.md` and `CHANGELOG.md` (modify)

*   **Type / Scope**: project records.
*   **Changes**: `DECISIONS.md` gains `D-63` (pointer/touch input reuses the intent pipeline and
  `state` is forwarded to pages), `D-64` (phones get a two-row top bar and a 44 px floor;
  `viewport-fit=cover`), and, if Q1 is answered Option B or C, one further entry naming the data
  decision. `CHANGELOG.md` gains Added/ Fixed entries for the touch path, the safe areas, the
  44 px floor and the A12/A13 fixes.

### Verification Plan

*   **Build**: `npm run build` (tsc + vite) must pass; `npm run lint` must pass with no new
  warnings (eslint flat config, Prettier formatting via `npm run format:check` if configured).
*   **Unit Tests**: `npm run test:unit` must pass, including the new `pointerMath` tests, and the
  existing `studyStore` / `settings` specs, which are the guards against an accidental data change.
*   **Typecheck**: `npm run typecheck` (or the build's tsc step) clean under strict TS.
*   **E2E**: `npm run test:e2e` (all projects) must pass. The new phone projects are the gate:
  `mobileLayout.spec.ts` and `pointerControl.spec.ts` must pass at 320/390/768/820 and 844×390,
  and the existing specs must pass unchanged on desktop.
*   **Manual spot-check**: iPhone 390×844 and an iPad in both orientations against the dev server,
  confirming the top bar, the sheet open/close, a finger rotate/pinch/tap, and that the tour card
  and mode gate are not clipped. `.playwright-mcp/audit/` screenshots are the before-state
  reference.
*   **Data check** (if Q1 is Option B/C): export one participant from the research panel and
  confirm the CSV header and the aggregate table carry the new value without breaking older rows.

---

## Future Improvements

*   **Momentum on a pointer flick**: emit the remaining `inertia` from a flick so a fast finger
  throw coasts, matching the hand pipeline's release behaviour.
*   **Keyboard parity for zoom**: `+`/`-` on the lab, since wheel zoom now exists and keyboard
  users have no equivalent.
*   **Landscape-specific framing**: a shorter camera tween for the cell so the stage fills the
  844×390 band instead of the portrait framing scaled down.

---

*Drafted with EGM*