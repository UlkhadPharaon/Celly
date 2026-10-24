# Final report — Celly v0.2.1 hand-tracking round 2

**Baseline:** `709c150` · **Release:** v0.2.1 (`9c6e566` tag, plus this work)

**Scope:** right-hand selection, wrist pivot/orbit, and finger retargeting, fixed at their root causes.

## Executive summary

All three defects are fixed on the production path:

| Area | Root cause | Final result |
|---|---|---|
| Wrist pivot | GLB armature node translation moved the effective pivot away from the wrist | **0 px / 0 %** wrist offset over 50 samples |
| Finger retargeting | World-directions applied without rest calibration, parent order or joint limits | **4.24°** mean / **6.54°** max joint error; worst bone-length CV **0.039 %** |
| Organelle selection | Aggregate pick centres, commit-on-press, re-pick during pinch, jumping multi-instance anchors | **10/10** first-attempt hits, **0.5 px** mean aim error |

The left-hand pinch/rotation and right-hand rotation paths are preserved. `npm test` (95/95),
`npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:e2e` (8/8) all pass.

## Root causes and fixes

The full evidence and reasoning are in [`DIAGNOSIS_ROUND2.md`](DIAGNOSIS_ROUND2.md). Decisions
D-46 … D-51 in [`DECISIONS.md`](DECISIONS.md) record the trade-offs.

### Issue 2 — wrist pivot / orbit (fixed first)

- The GLB armature nodes carry translations; the hand container rotated around the armature origin
  rather than the wrist. `00_WRIST` is at the origin in bone space.
- The container is now the wrist root: armature translation is neutralised and `root.position` is
  the mapped wrist. The palm basis is orthonormal (Gram–Schmidt), the root quaternion is the
  shortest-arc delta against the rest pose, and position is assigned directly (only orientation and
  fingers are damped). Mirroring is a screen-position transform; orientation data is not reflected.
- Left/right meshes remain separate and no negative scale is introduced.
- Debug axes, palm normal/dot and wrist offset are exposed in `debugHand()` and the `D` overlay.

### Issue 3 — finger retargeting (fixed second)

- Rest table per driven bone (rest direction in parent space, rest local quaternion, soft flexion
  limit). The solver walks **parent first** and writes local rotations only, so bone lengths cannot
  change.
- Shortest-arc quaternion damping plus joint limits and confidence fallback to rest. Procedural glass
  hand is the fallback when the GLB is absent or invalid.
- Load-time skin audit checks unweighted vertices, over-four influences, weight sums, bind-matrix
  finiteness, bone count and bone-length stability. The reference
  [`bandinopla/three-mediapipe-rig`](https://github.com/bandinopla/three-mediapipe-rig) was studied
  for its principles and reimplemented (MIT; see D-47), not ported.

### Issue 1 — right-hand selection (fixed third)

- One pick anchor and enlarged invisible proxy **per instance**, so mitochondria, lysosomes,
  centrioles, etc. no longer share an aggregate centre at the nucleus.
- Screen-space proximity (40–62 px by hand span) is primary; exact ray picking is the fallback.
  Membrane, cytoplasm and particle systems are blank for hand picking.
- Aim is the position ~100 ms before pinch start (35 ms fallback after >55 px travel). The hovered
  target is frozen for the pinch. Selection commits on **release**, after a ≥100 ms hold and ≤36 px
  travel; rejected pinches are logged.
- Sticky armed hover: ~220 ms / ~96 px with 20 px hysteresis. Test/overlay anchors choose the
  largest projected instance once, then follow one instance via screen-space memory.
- Built-in Selection test (`T`) with nucleus, mitochondrion, Golgi, rough ER, smooth ER, lysosome,
  vacuole, centriole, peroxisome and nucleolus. Debug view (`D`) shows raw/filtered/locked cursors,
  radius, armed target, rig angle/skin and recent pinch events.

## Verification

### Commands

```bash
npm test              # 95/95 unit tests
npm run lint          # clean
npm run typecheck     # clean
npm run build         # clean production bundle
npm run test:e2e      # 8/8 Playwright tests
node scripts/verify-hands.mjs   # screenshots + measured hand metrics
```

The hand harness requires the dev server on `:5173`; it waits on `window.__celly.renderedFrames`
rather than fixed sleeps. Raw results are in
[`docs/hand-verification.json`](docs/hand-verification.json).

### Measured acceptance

| Requirement | Measured |
|---|---|
| First-attempt selection ≥ 90 % | **100 % (10/10)** |
| Aim error | **0.5 px mean** |
| Wrist offset ≤ 1–2 % screen height | **0 px / 0 %** (mean and max, 50 samples) |
| Mean joint-angle error ≤ 10–12° | **4.24°** overall; **4.26°** static; max **6.54°** |
| Constant bone lengths | **0.039 %** worst CV across 15 bones / 50 samples |
| Palm/back facing | Palm-normal dot **-0.991** |
| Skin health | `Hand_R` 10,116 vertices, 0 unweighted, 0 over-4, weight sums 1.0, 21 bones, finite binds |
| Solver latency | **0.45 ms mean / 1.1 ms max** (CPU solve only) |
| Procedural fallback | Toggle both ways through the control panel; both present at 0 px offset; rigged hand restored |
| Visual regressions | Pose suite inspected; screenshots show no tearing/collapse |

Static per-finger mean error: index 1.88°, middle 0.08°, ring 1.01°, pinky 1.29°; thumb 17.04°.
The thumb is a documented limitation (below).

### Pose suite and screenshots

13 deterministic poses (14 JSON replay fixtures): open, fist, pinch, point, peace, thumbs-up, OK,
spread, wiggle, slow wrist rotation, palm, back, fast movement. Screenshots and an inventory are in
[`docs/screenshots/hand-tests/`](docs/screenshots/hand-tests/):

- pose suite: `pose-open.png` … `pose-fast-movement.png`, plus `hand-left.png`;
- `debug-hand.png` (raw/filtered/locked cursor, radius, rig and pinch log);
- `selection-test-exact.png` (10/10, 0.5 px);
- `procedural-hand.png` and `rigged-restored.png` (control-panel toggle both ways).

## Limitations

- **Thumb angle:** ~17° mean, while the other fingers are 0.08–1.88°. The GLB thumb rest pose and
  the synthetic open-thumb pose disagree; overall mean still passes, but this needs real-hand rest
  calibration in v0.3.
- **Synthetic replays:** the pose suite is deterministic landmark input, not webcam footage. It makes
  regressions reproducible but does not cover skin tone, lighting, occlusion or camera noise.
- **Latency scope:** `applyMs` is the CPU retarget solver only. It excludes MediaPipe inference,
  filtering, rendering and compositing; end-to-end p95 was not measured.
- **Skin strain:** the audit checks weights/binds and screenshots inspect deformation, but there is
  no per-vertex strain metric.
- **Selection evidence:** the exact built-in test is the acceptance instrument. Under SwiftShader a
  frame can exceed the real 220 ms sticky window, so synthetic step-jitter E2E would measure frame
  pacing rather than selection; timing-sensitive behavior is unit-tested with synthetic timestamps.
- **Procedural hand:** diagnostic capsule/glass representation, not a skinned rig; it follows the
  same wrist and landmarks but is not a visual production fallback.

## v0.3 recommendations

1. Record real hands across users, distances and palm orientations; fit thumb rest/limits and rerun
   the joint-error acceptance on those captures.
2. Instrument end-to-end latency from MediaPipe timestamp to rendered frame; target p95 < 100 ms.
3. Add a per-vertex edge-length/strain check to CI for every pose and test target.
4. Make selection confidence-weighted and preview the frozen armed target before release.
5. Run real-device first-attempt trials by organelle size, especially the concentric
   nucleus/nuclear-envelope/nucleolus cases and small peripheral organelles.
