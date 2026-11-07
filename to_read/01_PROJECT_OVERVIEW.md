# 01_PROJECT_OVERVIEW.md — Celly v0.2

## Product: Celly v0.2 (at F:/TKS/BUILD/Celly)

**A touch-free 3D cell biology laboratory.** Users explore a procedural animal cell using bare-hand gesture tracking via webcam with mouse/keyboard as fallback.

### Target audience
- High-school students studying cell biology
- Self-directed learners interested in biology visualization
- Educators looking for an interactive lab tool

### Core sections

| Section | What it does |
|---|---|
| **Interactive Lab** | Explore a 3D procedural animal cell with 15 named organelles. Pinch to select/isolate, left-hand pinch to rotate, two-hand pinch to scale. |
| **Knowledge** | Navigate a 36-node graph of cell-biology concepts in a deterministic 3D force layout. Pinch to fly camera in and open overlay. |
| **Test** | Multiple-choice quizzes (48 questions), Leitner flashcards (36 cards), guided questionnaire sets (3 × 10). Progress persists in localStorage. |

### Technology stack

| Layer | Technology | Notes |
|---|---|---|
| **Runtime** | Vanilla TypeScript 6.0.3 | No framework; custom reactive store (~60 lines) |
| **Rendering** | Three.js 0.186.1 | One renderer, one scene, post-processing (UnrealBloomPass) |
| **Tracking** | MediaPipe Tasks Vision 1.1.0 | `HandLandmarker` running in a **Web Worker** (NEW since v0.2.1) |
| **Build** | Vite 8.3.4 | ES modules, manual chunks for three/mediapipe |
| **Testing** | Vitest 5.0.4 + Playwright 1.64.0 | 91 unit tests + 3 e2e specs |
| **Styling** | CSS Custom Properties + glass/grain aesthetic | No CSS-in-JS |
| **Content** | Static JSON (organelles.json, knowledge.json, questions.json) | Typed at build time |
| **Persistence** | localStorage (`celly:v02:*` keys) | Settings, onboarding flag, Leitner state, progress |

### Hand representation evolution

| Version | Method | Pros | Cons |
|---|---|---|---|
| **v0.1–v0.2 (initial)** | GLB hand rig (`handRig.ts`) | Real bone retargeting, skin weights | Complex, fragile, ~13MB assets, pivot bugs |
| **v0.2.1 (fb620bd)** | Generated low-poly skinned mesh | Simpler than GLB, wrist-rooted | Still required geometry generation, 1149 verts |
| **HEAD + uncommitted** | **Skeleton overlay** (`skeletonHand.ts`) | Lightweight (lines+points), no animation weight complexity, ~7KB vs 13MB | No flesh/skin look, purely skeletal |

The skeleton hand places every joint on the camera ray through its mapped screen position. Index fingertip projects exactly under the cursor at any viewport size or FOV. World landmarks supply shape; normalized landmarks supply pointer placement. This eliminates all palm-basis retargeting bugs from the old approach while keeping depth for bloom pass aesthetics.

### Current development state

- **Committed HEAD:** `4a17a1d feat: skeleton hand overlay, live onboarding camera check and small-screen chrome`
- **Uncommitted changes:** 13 modified files (+621/-294 lines), 4 new untracked files
  - `trackingWorker.ts`, `trackingProtocol.ts` — Web Worker inference pipeline
  - `tests/e2e/overlayPerf.spec.ts`, `tests/e2e/trackingWorker.spec.ts` — new E2E tests
  - Major behavioral change: selection now commits on **pinch-start**, not release
  - Pinch `minHoldMs` dropped from 70 → 0
- **Baseline was fb620bd** (the point where hand math/rig/pinching were stable before worker migration)

### Key behavioral changes in uncommitted work

| Change | File | Impact |
|---|---|---|
| Selection commits on pinch-start, not release | `gestureEngine.ts` | Simpler but less forgiving — misfires during finger closure possible |
| Hold time requirement removed (70ms → 0ms) | `pinch.ts` | Pinch activates immediately above threshold |
| `detect()` → `poll()` pattern | `handTracker.ts` | Asynchronous frame consumption from worker |
| Detection timing separated from render clock | `app.ts` | Filter timestep driven by actual detection arrival rate |
| Hand loss tolerance refined | `app.ts` | Single lost transition emitted instead of repeated synthetic frames |
| DPR passed to hand layer | `app.ts` + `handLayer.ts` | Skeleton joints get proper CSS-pixel sizing |
