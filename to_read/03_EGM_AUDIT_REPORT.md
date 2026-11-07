# 03_EGM_AUDIT_REPORT.md — EGM Audit Report

## EGM Skill Usage

The Elephant-Goldfish Model (EGM) skill was loaded from:
`C:/Users/ulric/hermes-plugins/elephant-goldfish-model/SKILL.md`

**Workflow applied:** Bootstrap + Drift Report hybrid, adapted for an evolving codebase where both committed state and uncommitted work-in-progress coexist.

### EGM Procedures Followed

1. **Artifact-first delivery** — All findings written to `to_read/`, not presented inline
2. **Plain-English standard** — Direct descriptions without buzzwords
3. **Default to stress-testing** — Every architectural assumption challenged
4. **Critique first** — Weaknesses identified before confirming strengths
5. **Evidence-backed** — Each finding references actual file:line locations

### Goldfish Persona Application

#### Design Critic Lens
- **Strongest objection:** Selection committing on pinch-start (uncommitted) removes all hold-time and travel-budget safeguards. A user's hand shaking as fingers close will select whatever the cursor happens to cover at that exact moment, regardless of intentionality. The old "commit on release" design had a 170ms window (70ms hold + 100ms post-pinch) for users to abort by opening their fingers — the new system has zero abort window.
- **Verdict:** Legitimate UX risk. Should be validated with real-device user testing before merging. Requires either reverting or adding visual feedback during the now-instant selection trigger.

#### Zoom Out Lens
- **Strongest objection:** Web Worker approach is architecturally sound but introduces IPC complexity: message serialization overhead (ImageBitmap transfer + Result deserialization), race conditions between worker init failures and main-thread UI state, and the XHR shim for ES module workers handling MediaPipe WASM glue. This adds a failure surface that didn't exist in the main-thread version.
- **Verdict:** Acceptable trade-off if main-thread responsiveness improves measurably. Without FPS benchmarking data comparing main-thread vs worker inference latency, this is an educated guess rather than proven optimization.

#### Comprehension Lens
- **Strongest objection:** Detection timing (`detectionDt()` function in uncommitted app.ts) separates landmark filter timestep from render clock. This is correct (workers don't fire at consistent intervals). BUT it means filters see variable dt values — sometimes large gaps when the worker is busy, sometimes small gaps when results arrive quickly. One-Euro filters are designed for relatively uniform sampling; large dt jumps could cause transient overshoot or jitter that wasn't present with the steady 30Hz main-thread cadence.
- **Verdict:** Needs empirical validation under load. Filter parameters may need retuning for async detection arrival patterns.

#### Structural Lens
- **Strongest objection:** The skeleton hand (`skeletonHand.ts`) creates ALL rendering objects (points geometry, shader materials, LineMaterial instances, glow sprite) per side during construction. On low-end devices creating two SkeletonHand instances (~2000 lines each worth of GPU resources) plus cell model + knowledge graph, memory budget needs verification on phones with 4GB VRAM.
- **Verdict:** Low probability of issue given skeleton simplicity, but should be verified on reference hardware (RTX 3050 Laptop, 4GB VRAM).

#### Style Lens
- **Observation:** Consistent naming, BEM-like CSS classes, TypeScript strict mode enforced, proper JSDoc comments throughout. No obvious style inconsistencies found.

#### Implementation Readiness Lens
- **Verified facts:**
  - TypeScript 6.0.3 strict mode ✅
  - ESLint flat config, typescript-eslint recommended ✅
  - Vite manual chunks correctly split three/mediapipe ✅
  - 91 Vitest tests pass ✅
  - No unused imports ✅
  - Two new e2e specs added (but browser env required to run)

### Known Limitations

1. **No live device session:** Could not observe hand tracking quality across lighting/skin-tone/distance variations
2. **No automated dependency scanning:** Did not run `npm audit`
3. **No performance profiling:** FPS, memory, GC measurements not captured on reference hardware
4. **Uncommitted code only partially inspected:** Working tree changes read via `git diff` but not fully analyzed in isolation
5. **Worker communication reliability unknown:** Message loss/duplication edge cases not tested in audit
