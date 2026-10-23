# Plan — Celly v0.2

Order follows §14 of the brief. Each milestone is shippable on its own and ended with a commit.

**Status: all milestones complete.** v0.2.0 shipped 2026-10-22; v0.2.1 (real-device pass)
shipped 2026-10-23. See [`CHANGELOG.md`](CHANGELOG.md).

## M0 — Inventory & decisions
- [x] Recursive asset sweep, GLB introspection, Blender/Node audit
- [x] `ASSET_INVENTORY.md`, this plan, `DECISIONS.md`
- [x] Prune v0.1 scaffold that does not fit the v0.2 architecture (kept in git history)

## M1 — Scaffold + tracking + gestures (thin vertical slice)
- [x] Vite/TS strict project, CSS design tokens, self-hosted fonts
- [x] `core/`: typed store, tween engine, page router, render loop, replay hand
- [x] `tracking/`: webcam + HandLandmarker (GPU→CPU), One-Euro filter, hand-side
      resolution with identity stabilisation, quality score
- [x] `gestures/`: pinch hysteresis, state machine, virtual cursors
- [x] Debug view: raw vs filtered landmarks, state, thresholds, FPS
- [x] **Slice: webcam → landmarks → pinch → rotate the cell**

## M2 — Interactive Lab
- [x] Procedural cell: 15 organelle types, named groups, instanced ribosomes
- [x] Fresnel membrane, PMREM env, bloom, ambient particles
- [x] Auto-rotate + Stop, left-pinch rotate, two-hand scale
- [x] Select → ghost-isolate + centre + scale + anchored overlay
- [x] Unselect on blank pinch; hover chip; halo + emissive pulse

## M3 — 3D hand meshes
- [x] GLB load, bone→landmark map, hand-local-frame retargeting, slerp
- [x] Screen→scene placement with depth cue, mirror X/Y, swap
- [x] Translucent material, pinch glow
- [x] Procedural skeletal fallback
- [x] Pinch-midpoint anchoring so the fingertips meet the virtual cursor

## M4 — Knowledge network
- [x] `knowledge.json` (36 nodes, ~90 edges) + deterministic 3D force layout
- [x] Glowing edges with travelling pulses, billboard labels, category colours
- [x] Focus by pinch → camera fly, dim non-neighbours, overlay, related hops
- [x] Rotate / scale / isolate inside focus; "Open in Lab" / "Test me"

## M5 — Testing knowledge
- [x] Mode selector (3 gesture cards + guided sets)
- [x] MCQ: hover + pinch-select, 70 ms pinch hold, validate, feedback states
- [x] Questionnaire: 3 × 10, progress, score, review of every question
- [x] Flashcards: pinch-flip, swipe L/R, Leitner boxes in `localStorage`
- [x] Review list of missed questions and missed cards with explanations

## M6 — Onboarding & polish
- [x] 3-step onboarding (camera → hands check → gesture primer), skippable, re-openable
- [x] Camera-denied / no-camera / insecure-context screens with mouse fallback
- [x] Motion continuity between pages; dispose discipline; reduced motion; high contrast
- [x] Responsive down to 13" laptop (1440×900 verified; layout collapses below 1100 px)

## M7 — Verification & docs
- [x] Vitest: pinch hysteresis, reach mapping, hand-side resolution, gesture state machine,
      Leitner, scoring, content integrity (62 tests)
- [x] Playwright: 8 specs — smoke, navigation, i18n, quiz, flashcards, synthetic-hand
      select/unselect, knowledge focus, two-hand scale
- [x] `README.md`, `DECISIONS.md` final, `CREDITS.md`, `CHANGELOG.md`
- [x] `npm run lint && npm run typecheck && npm test && npm run build` all green
- [x] 11 screenshots in `docs/screenshots` via `scripts/shots.mjs`
- [ ] Demo recording — not captured; the screenshot harness covers every key state

## Performance budget

| Budget | Target | Actual |
|---|---|---|
| Render | 60 fps | 60 fps at 1600×1000 on the reference machine (software rasteriser in CI is slower) |
| Tracking | ≥ 30 fps | 30–60 fps depending on camera and delegate |
| Draw calls | ≤ 120 Lab / ≤ 160 Knowledge | within budget (`renderer.info` in the debug panel) |
| Triangles | ≤ 400 k | within budget |
| Hot loop | no per-frame allocations | vectors/quaternions reused in the hand, gesture and hover paths |

## Verification log — 2026-10-22

| Command | Result |
|---|---|
| `npm install` | clean, no peer-dependency flag required |
| `npm run typecheck` | 0 errors (strict, `noUnusedLocals`, `noUnusedParameters`) |
| `npm run lint` | 0 errors |
| `npm test` | 5 files, 53 tests passed |
| `npm run test:e2e` | 8 tests passed (fake camera + synthetic landmarks) |
| `npm run build` | production bundle written to `dist/` |
| `node scripts/shots.mjs` | 11 screenshots regenerated at 1600×1000 |

## Verification log — 2026-10-23 (v0.2.1)

| Command | Result |
|---|---|
| `npm run typecheck` | 0 errors (strict) |
| `npm run lint` | 0 errors |
| `npm test` | 6 files, 62 tests passed |
| `npm run test:e2e` | 8 tests passed; overlay visibility and chrome-clearance assertions included |
| `npm run build` | production bundle written to `dist/` |
| `node scripts/shots.mjs` | 11 screenshots; focused knowledge card visible and clear of both rails |
