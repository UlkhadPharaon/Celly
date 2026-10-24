# Round 2 diagnosis — hand pivot, retargeting and selection

**Scope:** Celly v0.2.1, the rigged `Hand_L` / `Hand_R` GLB path and the right-hand selection path.
**Order:** fix Issue 2 (pivot) → Issue 3 (retargeting) → Issue 1 (selection). Issue 2 had to be
correct before angle error or selection could be measured on a stable hand.

## Confirmed causes

### Issue 2 — the hand orbited instead of rotating around the wrist

The GLB armature nodes carry non-zero translations. `HandRig` placed the armature under the hand
container and rotated the container, so the effective pivot was the **armature origin**, not the
wrist. `00_WRIST` itself has its head at `(0, 0, 0)` in bone space. A wrist roll therefore moved the
whole hand on an arc, and the virtual wrist could sit several centimetres from the tracked wrist.

Evidence:

- Before the fix, the GLB node transform was the only source of a non-zero wrist offset; zeroing the
  armature translation and making the container the wrist root removed it.
- The final `debugHand()` measurement is **0 px / 0 % of viewport height** on every sampled pose,
  including fast movement (50 samples; [`docs/hand-verification.json`](docs/hand-verification.json)).
- Palm and back poses have a palm-normal dot of **-0.991**, so orientation flips rather than orbiting.

### Issue 3 — finger retargeting did not respect the rig's rest pose

The previous path rotated bones toward world-space landmark directions without accounting for the
GLB rest orientations, parent rotations, or joint limits. The symptoms were finger collapse/tearing
and a large finger-angle error, especially when the palm was rotated. There was also no health check
for the skin binding and no fallback if the GLB failed.

The fix is a reimplementation of the principles in
[`bandinopla/three-mediapipe-rig`](https://github.com/bandinopla/three-mediapipe-rig), not a code
port. The reference is MIT-licensed; its useful ideas are the wrist-centred root, a captured rest
pose, parent-first local rotations, and a rest-pose calibration table. Celly's implementation is
written against its own `HandFrame` / GLB naming and adds the Celly-specific constraints, skin audit,
debug overlay and deterministic pose fixtures. The rationale is recorded as **D-47** in
[`DECISIONS.md`](DECISIONS.md).

Evidence and resulting state:

- A rest table is captured once per side (`restBones`, rest direction in parent space, rest local
  quaternion, max flexion). The solver walks **parent first** and only writes local rotations.
- The rig's local bone lengths are unchanged by construction; measured across 50 poses the worst
  coefficient of variation is **0.039 %** after container-scale normalisation (15 bones).
- Skin audit: `Hand_R` 10,116 vertices, **0 unweighted**, 0 over-4 influences, weight sum 1.0,
  21 bones, finite bind matrices. The same audit runs on `Hand_L`.
- Mean joint-angle error is **4.26°** on static poses and **4.24°** across all 50 samples; worst
  static sample 4.71°. The thumb remains a known outlier at ~17° mean because its GLB rest pose and
  the synthetic open-thumb pose disagree; the other fingers average 0.08–1.88°.
- CPU solver time is **0.45 ms mean / 1.1 ms max**; no tearing/collapse is visible in the pose suite.

### Issue 1 — the wrong organelle could be selected

Four independent causes stacked:

1. **Aggregate pick centres.** Most organelles have several instances, but picking used one
   bounding sphere for the whole part. The aggregate centre of the six mitochondria / seven
   lysosomes / etc. sat near the cell centre, often on the nucleus. Aiming at a mitochondrion could
   therefore pick the nucleus or nucleolus. Picking now creates one anchor (and one invisible pick
   proxy) per real instance.
2. **Selection committed on pinch start.** A pinch that began while crossing an organelle selected
   it before the user had a chance to hold or release, and a target change during the pinch was
   invisible. Selection now commits on **release**, requires a ≥100 ms hold, and rejects travel
   over 36 px; the engine captures the target at pinch start and holds it.
3. **A moving pre-pinch aim changed the target.** The aim lock is deliberately 100 ms old (35 ms
   fallback after >55 px travel). Re-picking the scene from that locked point during the gesture
   could select a neighbour. Scene hover is now frozen for the duration of a pinch.
4. **Unstable markers/anchors.** Choosing “the largest projected instance” every frame made a
   multi-instance vacuole/Golgi marker jump to another instance when the cell rotated, producing a
   recorded 279 px aim error. Anchors now follow one instance via screen-space anchor memory, and
   the built-in Selection test clears that memory on restart.

Additional selection safeguards:

- Enlarged invisible proxies follow each instance; screen-space proximity (40–62 px, scaled by hand
  span) is primary, exact ray picking is the fallback.
- A time-limited (~220 ms) sticky armed target keeps a few pixels of jitter from changing the
  target; 20 px hysteresis stops two overlapping organelles from swapping.
- Membrane, cytoplasm and particle systems are blank for hand picking.
- The debug overlay (`D`) draws raw/filtered/locked cursors, pick radius, armed target and the last
  20 pinch events. The built-in Selection test (`T`) reports hits and mean aim error.

Evidence:

- Final built-in test: **10/10 hits, 100 %, mean aim error 0.5 px** on nucleus, mitochondrion,
  Golgi, rough ER, smooth ER, lysosome, vacuole, centriole, peroxisome and nucleolus.
  [`selection-test-exact.png`](docs/screenshots/hand-tests/selection-test-exact.png)
- Existing gesture e2e selection test still passes, including overlay/chrome clearance.
- Per-instance proxies are covered indirectly by `nearestWithin` unit tests and the e2e selection;
  the exact test is the acceptance evidence for the built-in harness.

## Acceptance status

| Requirement | Result |
|---|---|
| First-attempt organelle selection ≥90 % | **100 % (10/10)** exact built-in test |
| Selection test reports hit rate and aim error | Complete panel: 10/10, 0.5 px |
| Wrist offset ≤1–2 % screen height | **0 %** (0 px) |
| Palm/back correct, no flips | Palm-normal dot **-0.991** |
| Mean joint-angle error ≤10–12° | **4.24°** overall |
| Constant bone lengths | Worst CV **0.039 %** |
| No visible tearing/collapse | Pose suite + close inspection; skin audit clean |
| Latency <100 ms | Solver **0.45 ms mean**; end-to-end MediaPipe + render latency not measured |
| Pose suite and replays | 13 poses, 14 JSON fixtures, screenshots in `docs/screenshots/hand-tests/` |
| Procedural fallback | Toggle both ways; both follow pose at 0 px wrist offset |

## Limitations

- The thumb's mean joint-angle error is ~17°. Overall mean remains under the 5° target, but the
  thumb is the one finger that would benefit from a real rest-pose calibration in v0.3.
- The pose data is deterministic synthetic landmark input, not a real webcam recording. It makes
  the rig regression reproducible, but real skin-tone, lighting, occlusion and camera-noise behavior
  still needs a device pass.
- `applyMs` measures the CPU retarget solver only. MediaPipe inference, landmark filtering, the
  render loop and compositor are outside that number.
- Joint angles are compared on the landmark skeleton, not on the deformed skin. Visual screenshots
  and the skin audit rule out gross tearing, but there is no per-vertex strain metric.
- Under SwiftShader the frame time can exceed the 220 ms sticky window, so synthetic jitter E2E is
  not meaningful; timing behavior is covered with synthetic timestamps in unit tests instead.

## v0.3 recommendations

1. Record real hands (multiple users, distances and palm orientations), fit the thumb rest/limit,
   and drive the acceptance metric from those captures.
2. Add end-to-end latency instrumentation from the MediaPipe timestamp through the render; target
   p95 <100 ms at 30 fps.
3. Add a per-vertex edge-length/strain check to the skin audit and run it in CI on every pose.
4. Make selection anchors confidence-weighted and add a brief “armed target” preview so a user can
   see the frozen target before release.
5. Add real-device selection trials with 40–60 px proximity and report first-attempt rate by
   organelle size; small overlapping structures (nucleolus/envelope) remain the hardest cases.
