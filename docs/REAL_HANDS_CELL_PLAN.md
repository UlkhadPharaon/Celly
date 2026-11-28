# Celly v0.3 — Real 3D Hands, Realistic 3D Cell, Tracking & Offline Optimization Plan

> **Purpose:** Master implementation plan and living handoff document. If this session runs out of context or credit, any AI agent can read this file and resume from the next unchecked item without losing any context.

Last updated: 2026-11-28  
Repo root: `f:\TKS\BUILD\Celly`  
Baseline verification at plan creation: `tsc --noEmit` (0 errors), `vitest run` (20 files, 192 tests passed).

---

## 1. Current State & Key Assets

| Asset / Module | Current State | Target State |
|---|---|---|
| `hands_rigged.glb` (root, 1.25 MB) | Present in repo root; `scripts/fetch-assets.mjs` actively deletes `hands_*.glb` from `public/` | Copied to `public/models/hands_rigged.glb` and loaded locally offline |
| `src/scene/skeletonHand.ts` | 21-joint `Points` + 21-bone `LineSegments2` stick skeleton | Replaced by `src/scene/realHand.ts` + `src/scene/handMath.ts` (real 3D rigged skinned hand meshes `Hand_L_Mesh` / `Hand_R_Mesh` with `00_WRIST`..`20_PINKY_TIP` bones) |
| `src/scene/handLayer.ts` | Instantiates `SkeletonHand` | Instantiates `RealHand`, preserves `debugContainer(side)` and 0 px index-tip cursor anchoring |
| `src/scene/cellModel.ts` + `shapes.ts` + `textures.ts` | Basic geometric primitives (plain ellipsoid mitochondria, 1-sided ribbon ER, simple torus Golgi, single-cylinder centrioles) | Anatomically accurate 3D organelles (3D cristae inside translucent mitochondria, thickened Rough ER with 80S ribosomes, dilated-rim Golgi + budding vesicles, octagonal nuclear pores + chromatin + bi-layered nucleolus, 9×3 pinwheel centrioles, translucent lysosomes/peroxisomes with internal cores, transmembrane protein channels) |
| `public/mediapipe-wasm/` & `public/models/hand_landmarker.task` | Already local (7.8 MB model + WASM) | Verified 100% offline-capable (no external network required) |
| `src/tracking/` & `src/gestures/` | Worker-based `HandLandmarker` + One-Euro filter + `FrameScheduler` | Tuned for stability, zero-allocation hot path, clean error handling |

---

## 2. Architecture & File Map

### 2.1 Real 3D Hands Pipeline
1. `scripts/fetch-assets.mjs`
   - Copies `hands_rigged.glb` → `public/models/hands_rigged.glb` (idempotent).
2. `src/scene/handMath.ts`
   - Pure math (no DOM, unit-testable): `palmBasis`, `palmDeltaQuaternion`, `boneLocalQuaternion`, `clampJointAngle`, `dampQuaternion`.
   - Bone naming in `hands_rigged.glb`: `00_WRIST`, `01_THUMB_CMC`, `02_THUMB_MCP`, `03_THUMB_IP`, `04_THUMB_TIP`, `05_INDEX_MCP` .. `08_INDEX_TIP`, `09_MIDDLE_MCP` .. `12_MIDDLE_TIP`, `13_RING_MCP` .. `16_RING_TIP`, `17_PINKY_MCP` .. `20_PINKY_TIP`.
3. `src/scene/realHand.ts`
   - Loads `models/hands_rigged.glb` once via shared `GLTFLoader` cache (cloning skeleton cleanly via `SkeletonUtils.clone` or per-side scene instance).
   - Provides an immediate procedural 3D articulated capsule-and-palm fallback while the GLB streams in (or if GLB fails in headless/test environments).
   - Material: realistic anatomical `MeshPhysicalMaterial` (natural warm skin/bio-lab tone with subtle sheen, roughness ~0.48, subtle rim highlight so fingers stay legible over the dark lab background and bright cell membrane).
   - **Zero-drift cursor anchoring:** After retargeting wrist + 15 finger bones and calling `updateMatrixWorld(true)`, reads the world position of `08_INDEX_TIP` and shifts `container.position` by `(targetIndexWorld - currentIndexTipWorld)` so the 3D index fingertip lands at **0 px** offset from the cursor.
   - Pinch glow sprite + subtle index/thumb tip highlight when `pinching === true`.
   - Full `dispose()` method.
4. `src/scene/handLayer.ts`
   - Uses `RealHand` instead of `SkeletonHand`.
   - Keeps `debugContainer(side)` and `resetCalibration()` APIs intact.

### 2.2 Realistic 3D Cell Pipeline
All 15 organelle IDs in `ORGANELLE_BY_ID` (`src/data/catalog.ts`) and `PICKABLE_IDS` (`src/scene/cellModel.ts`) remain identical so picking, isolation, focus-dim, knowledge links, and quizzes work seamlessly:
- `membrane`: Translucent Fresnel phospholipid bilayer + procedural lipid micro-bump + instanced transmembrane protein channel complexes.
- `cytoplasm`: Subtle volumetric cytosol + micro-particles.
- `nuclear-envelope`: Double-membrane shell with cutaway/translucent view + instanced 3D octagonal nuclear pore complexes.
- `nucleus` (chromatin): Dense, multi-strand fibrous euchromatin & heterochromatin coils inside the envelope.
- `nucleolus`: Bi-layered dense fibrillar center + granular component.
- `mitochondrion` (×6): Translucent smooth outer membrane + 3D folded inner membrane cristae + matrix granules / mtDNA rings.
- `rough-er`: Thickened, interconnected 3D cisternae sacs wrapping the nucleus + dense surface-bound 80S ribosomes.
- `smooth-er`: Branching, anastomosing 3D tubular network.
- `golgi`: 5–6 stacked curved cisternae with dilated bulbous rims (cis → trans) + budding transport vesicles.
- `ribosome`: Instanced 80S two-subunit (60S + 40S) ribosomes.
- `lysosome` (×7): Translucent lipid membrane revealing internal hydrolytic enzyme granules.
- `peroxisome` (×5): Translucent membrane revealing internal faceted crystalline urate oxidase core.
- `vacuole` (×3): Clearcoat fluid-filled tonoplast sacs.
- `centriole`: Two strictly orthogonal (90°) barrels, each with 9 microtubule triplets (27 tubules per barrel).
- `cytoskeleton`: Radiating microtubules + cortical actin microfilaments.

---

## 3. Execution Phases & Checkpoints

### Phase 1 — Asset & Offline Pipeline
- [x] Update `scripts/fetch-assets.mjs` to copy `hands_rigged.glb` → `public/models/hands_rigged.glb`
- [x] Run `node scripts/fetch-assets.mjs` and verify `public/models/hands_rigged.glb` exists
- [x] Verify `index.html` and `src/` have zero required external CDN fetches for core app / tracking / models

### Phase 2 — Real 3D Hands (Purpose-Built MediaPipe-Native Anatomical Hand)
- [x] Create `src/scene/handMath.ts` (palm basis, bone/joint math, unit tests in `tests/unit/handMath.test.ts`)
- [x] Replace external GLB rig (`hands_rigged.glb` had baked Blender bind-pose rotations causing finger/palm distortion) with a **purpose-built, MediaPipe-native sculpted 3D human hand** in `src/scene/realHand.ts`:
  - Dynamically deformable sculpted 3D palm mesh (`[0, 1, 5, 9, 13, 17]` dorsal arch + palmar hollow)
  - Anatomically tapered `LatheGeometry` phalanges (condyle/waist profile) + 21 joint spheres + 5 fingernails
  - `MeshPhysicalMaterial` with natural skin tone, sheen, clearcoat, and pinch glow
  - Zero external GLB loading delay, 100% offline, zero bind-pose distortion
- [x] Fix wrist rotation anchor in `src/scene/handLayer.ts`: anchor world-landmark deltas at **`frame.wristScreen` + `frame.world[0]`** (instead of `frame.cursor` + `frame.world[8]`) so rotating the wrist pivots the hand around the wrist itself without orbiting or sliding in space
- [x] Verify `tsc --noEmit`, `eslint .`, and `vitest run` (21 files, 197 tests)

### Phase 3 — Realistic 3D Eukaryotic Cell
- [x] Upgrade `src/scene/shapes.ts` (3D cristae geometry, thickened cisternae, dilated Golgi, 9×3 triplet centriole, 80S two-subunit ribosome, octagonal nuclear pore ring, transmembrane protein channel)
- [x] Upgrade `src/scene/cellModel.ts` for all 15 organelles while preserving `PICKABLE_IDS`, `pickAnchors`, `opacityTargets`, `emissiveTargets`, and draw-call/triangle budgets (≤ 120 draw calls, ≤ 400k triangles)
- [x] Verify `npm run build` (passed cleanly in 5.33s)
- [ ] Update `tests/e2e/gestures.spec.ts` lines 165–167 (currently assert legacy `skeletonSource: 'skeleton'`, `skeletonPoints: 21`, `skeletonSegments: 21` from `SkeletonHand`) to assert `RealHand` debug state, and re-run Playwright e2e tests

### Phase 4 — Hand Tracking Reliability & Performance Optimization
- [x] Audit `src/tracking/` & `src/gestures/` & `src/core/app.ts` (worker single-flight backpressure, One-Euro filter `sanitizeDt`, pinch hysteresis)
- [x] Fix `RealHand` bone retargeting bugs:
  1. Replaced `parent.matrixWorld.invert()` + `setFromRotationMatrix()` (which corrupted rotations whenever `root.scale != 1`) with `parent.getWorldQuaternion().invert()` (ignores scale).
  2. Added `setMirrored(mirrorX)` chirality matching: when `mirrorX` is enabled, a mirrored right hand has left-hand geometry (`Armature_Hand_L`) and vice versa, preventing 180° palm-flipping and crossed fingers.
- [x] Verify `SceneManager` dispose discipline and render stats

### Phase 5 — Full Verification & Handoff
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`
- [ ] Run `npm test`
- [ ] Run `npm run build`
- [ ] Run Playwright e2e tests (`npm run test:e2e`)
- [ ] Update this document and `progress.md` with final verification results
